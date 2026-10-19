import "server-only";
import { config } from "../config";
import type { DiscoveryMethod } from "../models";
import { discover } from "./discovery";
import { classifyByUrl, extractPage, parseDate, type ExtractedPage } from "./extract";
import { createFetcher } from "./fetcher";
import { isCrawlableUrl, isSameSite, normalizeUrl } from "./url";

/** Previously-known URLs that vanished from discovery get re-fetched (up to this many) to confirm deletion. */
const MAX_VERIFY = 25;
/** Sitemap URLs modified within this many days are crawled before older ones. */
const RECENT_PRIORITY_DAYS = 30;
/** Responses meaning "slow down" (forbidden by bot protection, rate limited, temporarily unavailable). */
const BLOCKED_STATUSES = new Set([403, 429, 503]);
/** Bot protection (e.g. Akamai) often cuts the connection instead of answering 403. */
const BLOCKED_ERRORS = /ERR_HTTP2_PROTOCOL_ERROR|ERR_CONNECTION_RESET|ERR_EMPTY_RESPONSE|ERR_CONNECTION_CLOSED/;
const isBlocked = (res: { status: number; error: string | null }) =>
  BLOCKED_STATUSES.has(res.status) || (res.status === 0 && BLOCKED_ERRORS.test(res.error ?? ""));
const blockedLabel = (res: { status: number; error: string | null }) =>
  res.status ? `HTTP ${res.status}` : (res.error?.match(BLOCKED_ERRORS)?.[0] ?? "connection refused");
/** Share of the time left that reading sitemaps may use, so big sitemaps can't eat the whole crawl. */
const DISCOVERY_SHARE = 0.35;
/** Pause between pages in slow mode (+ up to 2s random), and before retrying a blocked page. */
const SLOW_DELAY_MS = 4000;
const SLOW_RETRY_MS = 8000;
/** Consecutive blocked pages (after retry) in slow mode before giving up on the site for this check. */
const MAX_BLOCKED_IN_A_ROW = 3;
/** Usual blog index paths. Many sites leave the blog out of the sitemap (and even the nav), so probe them. */
const BLOG_HUB_PATHS = ["/blog", "/blogs", "/news", "/articles", "/insights"];

export interface CrawledPage extends Partial<ExtractedPage> {
  url: string;
  finalUrl: string;
  statusCode: number;
  error: string | null;
  sitemapLastmod?: Date | null;
}

export interface PreviousCrawl {
  method: DiscoveryMethod;
  discoveredUrls: string[];
  crawledUrls: string[];
}

export interface CrawlResult {
  engine: "playwright" | "fetch";
  warning: string | null;
  robotsFound: boolean;
  sitemapUrls: string[];
  method: DiscoveryMethod;
  discoveredUrls: string[];
  /** Sitemap <lastmod> dates, newest first. */
  lastmods: { url: string; at: Date }[];
  pages: CrawledPage[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Many generated sitemaps stamp every URL with the build/request time (`lastModified: new Date()`),
 * which would make old pages look freshly updated. Drop the timestamp shared by a large share of URLs.
 */
function dropGeneratedLastmods(entries: { url: string; at: Date }[]) {
  const counts = new Map<number, number>();
  for (const e of entries) counts.set(e.at.getTime(), (counts.get(e.at.getTime()) ?? 0) + 1);
  const generated = new Set(
    [...counts]
      .filter(([stamp, count]) => {
        // A precise time (not midnight) shared by several URLs is a build/request stamp, not an edit.
        const precise = stamp % 86400_000 !== 0;
        return (precise && count >= 3) || (count >= 5 && count / entries.length >= 0.3);
      })
      .map(([stamp]) => stamp),
  );
  return entries.filter((e) => !generated.has(e.at.getTime()));
}

/** `deadline` (ms epoch): stop crawling then and return the pages fetched so far. */
export async function crawlSite(
  siteUrl: string,
  maxPages: number,
  previous: PreviousCrawl | null,
  deadline: number,
  onProgress?: (crawled: number) => void,
): Promise<CrawlResult> {
  const home = normalizeUrl(siteUrl)!;
  const rootHost = new URL(home).hostname;
  // Kept as an object: the fetcher may add a warning mid-crawl (e.g. Chromium failed to start).
  const created = await createFetcher();
  const fetcher = created.fetcher;
  const warnings: string[] = [];
  let discovery;
  try {
    const discoveryStopAt = Date.now() + Math.max(0, deadline - Date.now()) * DISCOVERY_SHARE;
    discovery = await discover(home, (url) => fetcher.fetchText(url), discoveryStopAt);
  } catch (err) {
    await fetcher.close();
    throw err;
  }
  const { robots } = discovery;
  const method: DiscoveryMethod = discovery.pageUrls.length > 0 ? "sitemap" : "links";

  const discovered = new Set<string>([home, ...discovery.pageUrls]);
  const prevDiscovered = new Set(previous?.discoveredUrls ?? []);
  const prevCrawled = (previous?.crawledUrls ?? []).filter(
    (u) => isSameSite(u, rootHost) && robots.isAllowed(u),
  );

  // Sitemap <lastmod> per URL, newest first, so the latest blogs/products get crawled.
  const lastmods = dropGeneratedLastmods(
    discovery.pageUrls
      .map((url) => ({ url, at: parseDate(discovery.lastmod.get(url)) }))
      .filter((x): x is { url: string; at: Date } => x.at !== null),
  ).sort((a, b) => b.at.getTime() - a.at.getTime());
  const lastmodByUrl = new Map(lastmods.map((x) => [x.url, x.at]));
  const modifiedAt = new Map(lastmods.map((x) => [x.url, x.at.getTime()]));
  const byNewest = (urls: string[]) =>
    [...urls].sort((a, b) => (modifiedAt.get(b) ?? 0) - (modifiedAt.get(a) ?? 0));
  const recentCutoff = Date.now() - RECENT_PRIORITY_DAYS * 86400_000;
  const recentlyModified = lastmods
    .filter((x) => x.at.getTime() >= recentCutoff)
    .slice(0, Math.ceil(maxPages / 2))
    .map((x) => x.url);

  // Order matters when the site is bigger than maxPages: homepage → brand-new sitemap URLs
  // → recently modified URLs → pages we tracked last time → everything else (newest first).
  const fresh = previous ? byNewest(discovery.pageUrls.filter((u) => !prevDiscovered.has(u))) : [];
  const queue: string[] = [];
  const queued = new Set<string>();
  const enqueue = (url: string) => {
    if (!queued.has(url)) {
      queued.add(url);
      queue.push(url);
    }
  };
  // Blog hubs missing from the sitemap: crawled right after the homepage, and their post links followed.
  const blogHubs = new Set<string>();
  if (method === "sitemap") {
    const origin = new URL(home).origin;
    for (const path of BLOG_HUB_PATHS) {
      const hub = normalizeUrl(origin + path);
      if (!hub || discovered.has(hub) || !robots.isAllowed(hub) || Date.now() > deadline) continue;
      if (prevDiscovered.has(hub)) {
        blogHubs.add(hub);
        continue;
      }
      const res = await fetcher.fetchText(hub);
      if (res?.status === 200 && /<html/i.test(res.body.slice(0, 2000))) blogHubs.add(hub);
    }
  }

  [home, ...blogHubs, ...fresh, ...recentlyModified, ...prevCrawled, ...byNewest(discovery.pageUrls)].forEach(enqueue);

  const pages: CrawledPage[] = [];
  let next = 0; // queue position of the next URL to crawl

  // Slow mode: the first 403/429/503 means the site is limiting us. From then on crawl one page
  // at a time with a pause (like a person browsing), and retry each blocked page once after a wait.
  let slowMode = false;
  // If pages stay blocked even in slow mode, the site is refusing automated access: stop early
  // and keep what we have instead of spending the whole time limit on blocked requests.
  let blockedInARow = 0;
  let gaveUp = false;
  const crawlOne = async (url: string, followLinks: boolean) => {
    let res = await fetcher.fetchPage(url);
    if (isBlocked(res) && Date.now() < deadline) {
      if (!slowMode) {
        slowMode = true;
        warnings.push(`Site limited requests (${blockedLabel(res)}); switched to slow mode.`);
        console.warn(`[crawler] ${rootHost}: ${blockedLabel(res)}, switching to slow mode`);
      }
      await sleep(res.retryAfterMs ?? SLOW_RETRY_MS);
      res = await fetcher.fetchPage(url);
    }
    blockedInARow = isBlocked(res) ? blockedInARow + 1 : 0;
    if (slowMode && blockedInARow >= MAX_BLOCKED_IN_A_ROW && !gaveUp) {
      gaveUp = true;
      warnings.push(
        `The site keeps blocking automated access (${blockedLabel(res)}), so only the pages that loaded were saved.`,
      );
      console.warn(`[crawler] ${rootHost}: still blocked in slow mode, stopping early`);
    }
    const finalUrl = normalizeUrl(res.finalUrl) ?? url;
    const page: CrawledPage = {
      url,
      finalUrl,
      statusCode: res.status,
      error: res.error,
      sitemapLastmod: lastmodByUrl.get(url) ?? null,
    };
    if (res.html) {
      Object.assign(page, extractPage(res.html, finalUrl, rootHost));
      if (followLinks) {
        for (const link of page.internalLinks ?? []) {
          if (isCrawlableUrl(link) && robots.isAllowed(link)) {
            discovered.add(link);
            enqueue(link);
          }
        }
      } else if ((blogHubs.has(url) && finalUrl !== home) || page.pageType === "blog") {
        // Sitemap mode: still pick up blog posts the sitemap leaves out, ahead of the rest of the queue.
        const links = new Set(page.internalLinks ?? []);
        // Hubs that show one page of posts often list them all in JSON-LD / framework data, not as <a>.
        if (blogHubs.has(url)) {
          for (const raw of res.html.match(/https?:\/\/[^\s"'<>\\]+/g) ?? []) {
            const link = normalizeUrl(raw);
            if (link && isSameSite(link, rootHost)) links.add(link);
          }
        }
        const posts = [...links].filter((l) => classifyByUrl(l) === "blog");
        // Only a hub that lists posts counts (sites answering 200 to any path would otherwise add junk).
        if (blogHubs.has(url) && posts.length > 0) discovered.add(url);
        for (const link of posts) {
          if (!queued.has(link) && isCrawlableUrl(link) && robots.isAllowed(link)) {
            discovered.add(link);
            queued.add(link);
            queue.splice(next, 0, link);
          }
        }
      }
    }
    pages.push(page);
    onProgress?.(pages.length);
  };

  try {
    // Without a sitemap, discover pages by following internal links (breadth-first).
    const followLinks = method === "links";
    const workers = robots.crawlDelayMs > 0 ? 1 : config.crawlConcurrency;
    let started = 0;
    let inFlight = 0;

    await Promise.all(
      Array.from({ length: workers }, async (_, worker) => {
        while (started < maxPages && Date.now() < deadline) {
          if (gaveUp || (slowMode && worker > 0)) break; // slow mode: only one worker keeps going
          if (next >= queue.length) {
            if (inFlight === 0) break;
            await sleep(100); // another worker may still add links
            continue;
          }
          const url = queue[next++];
          started++;
          inFlight++;
          try {
            await crawlOne(url, followLinks);
          } finally {
            inFlight--;
          }
          const pause = Math.max(robots.crawlDelayMs, slowMode ? SLOW_DELAY_MS + Math.random() * 2000 : 0);
          if (pause) await sleep(pause);
        }
      }),
    );

    // Confirm "deleted" candidates: known last time, missing from discovery now, not crawled above.
    const crawled = new Set(pages.map((p) => p.url));
    const toVerify = [...prevDiscovered]
      .filter((u) => !discovered.has(u) && !crawled.has(u) && isSameSite(u, rootHost) && isCrawlableUrl(u))
      .slice(0, MAX_VERIFY);
    for (const url of toVerify) {
      if (Date.now() > deadline || gaveUp) break;
      await crawlOne(url, false);
      if (robots.crawlDelayMs) await sleep(robots.crawlDelayMs);
    }

    // Bot protection often holds back the homepage during the first burst of requests: try it once more.
    const homeAt = pages.findIndex((p) => p.url === home);
    if (homeAt >= 0 && pages[homeAt].title === undefined && Date.now() < deadline) {
      const [failed] = pages.splice(homeAt, 1);
      await sleep(SLOW_RETRY_MS);
      await crawlOne(home, false);
      if (pages[pages.length - 1].title === undefined) pages[pages.length - 1] = failed;
    }
  } finally {
    await fetcher.close();
  }

  return {
    engine: fetcher.engine,
    warning: [created.warning, ...warnings].filter(Boolean).join(" ") || null,
    robotsFound: robots.found,
    sitemapUrls: discovery.sitemapUrls,
    method,
    discoveredUrls: [...discovered].slice(0, 10_000),
    lastmods: lastmods.slice(0, 10_000),
    pages,
  };
}
