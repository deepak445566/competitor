import "server-only";
import { gunzipSync } from "node:zlib";
import * as cheerio from "cheerio";
import robotsParser from "robots-parser";
import { isCrawlableUrl, isSameSite, normalizeUrl } from "./url";
import { ROBOTS_AGENT, crawlerUserAgent } from "./user-agent";

type TextResult = { status: number; body: string } | null;
/** Second way to download a file, e.g. through the browser when plain HTTP is stalled. */
export type TextFallback = (url: string) => Promise<TextResult>;

const MAX_SITEMAP_FILES = 50;
export const MAX_SITEMAP_URLS = 10_000;
/** Child sitemaps listing archives rather than content. */
const TAXONOMY_SITEMAP = /(?:tag|category|categories|author|attachment|archive|format|taxonomy)[-_]?sitemap|sitemap[-_]?(?:tag|category|categories|author|attachment|archive)/i;

export interface RobotsRules {
  found: boolean;
  isAllowed(url: string): boolean;
  crawlDelayMs: number;
  sitemaps: string[];
}

export interface DiscoveryResult {
  robots: RobotsRules;
  /** Sitemap files that were actually read. */
  sitemapUrls: string[];
  /** Page URLs listed in the sitemap(s), filtered to same-site, crawlable, robots-allowed. */
  pageUrls: string[];
  /** Sitemap <lastmod> per page URL, when present. */
  lastmod: Map<string, string>;
}

async function httpText(url: string): Promise<TextResult> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": crawlerUserAgent(), accept: "*/*", "cache-control": "no-cache", pragma: "no-cache" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { status: res.status, body: "" };
    const buf = Buffer.from(await res.arrayBuffer());
    // Raw .gz sitemaps (not transfer-encoded) start with the gzip magic bytes.
    const body = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString("utf8") : buf.toString("utf8");
    return { status: res.status, body };
  } catch {
    return null;
  }
}

/** Plain HTTP first; if the request fails outright (timeout/reset), try the fallback. */
async function fetchText(url: string, fallback?: TextFallback): Promise<TextResult> {
  const res = await httpText(url);
  if (res || !fallback) return res;
  return fallback(url);
}

export async function loadRobots(origin: string, fallback?: TextFallback): Promise<RobotsRules> {
  const robotsUrl = `${origin}/robots.txt`;
  const res = await fetchText(robotsUrl, fallback);
  // Only a real 200 robots.txt counts; anything else means "no rules".
  if (!res || res.status !== 200 || /<html/i.test(res.body.slice(0, 500))) {
    return { found: false, isAllowed: () => true, crawlDelayMs: 0, sitemaps: [] };
  }
  const robots = robotsParser(robotsUrl, res.body);
  const ua = ROBOTS_AGENT;
  const delaySeconds = robots.getCrawlDelay(ua) ?? 0;
  return {
    found: true,
    isAllowed: (url) => robots.isAllowed(url, ua) !== false,
    crawlDelayMs: Math.min(delaySeconds, 10) * 1000,
    sitemaps: robots.getSitemaps(),
  };
}

export async function discover(siteUrl: string, fallback?: TextFallback): Promise<DiscoveryResult> {
  const root = new URL(siteUrl);
  const robots = await loadRobots(root.origin, fallback);

  const queue = [...new Set([...robots.sitemaps, `${root.origin}/sitemap.xml`])];
  const seenSitemaps = new Set<string>();
  const readSitemaps: string[] = [];
  const pages = new Set<string>();
  const lastmod = new Map<string, string>();

  while (queue.length && seenSitemaps.size < MAX_SITEMAP_FILES && pages.size < MAX_SITEMAP_URLS) {
    const sitemapUrl = queue.shift()!;
    if (seenSitemaps.has(sitemapUrl)) continue;
    seenSitemaps.add(sitemapUrl);

    const res = await fetchText(sitemapUrl, fallback);
    if (!res || res.status !== 200 || !/<(?:urlset|sitemapindex)[\s>]/i.test(res.body)) continue;
    readSitemaps.push(sitemapUrl);

    const $ = cheerio.load(res.body, { xml: true });
    // Big sites hit MAX_SITEMAP_URLS before reading every child sitemap, so read the most recently
    // updated ones first and taxonomy/archive sitemaps (tags, authors…) last.
    const children = $("sitemapindex > sitemap")
      .map((_, el) => ({
        loc: $(el).children("loc").first().text().trim(),
        at: Date.parse($(el).children("lastmod").first().text().trim()) || 0,
        archive: TAXONOMY_SITEMAP.test($(el).children("loc").first().text()),
      }))
      .get()
      .filter((c) => c.loc && !seenSitemaps.has(c.loc))
      .sort((a, b) => Number(a.archive) - Number(b.archive) || b.at - a.at);
    queue.push(...children.map((c) => c.loc));
    $("urlset > url").each((_, el) => {
      if (pages.size >= MAX_SITEMAP_URLS) return false;
      const url = normalizeUrl($(el).children("loc").first().text());
      if (url && isSameSite(url, root.hostname) && isCrawlableUrl(url) && robots.isAllowed(url)) {
        pages.add(url);
        const modified = $(el).children("lastmod").first().text().trim();
        if (modified) lastmod.set(url, modified);
      }
    });
  }

  return { robots, sitemapUrls: readSitemaps, pageUrls: [...pages], lastmod };
}
