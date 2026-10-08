import "server-only";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { parseDate } from "./crawler/extract";
import { normalizeUrl } from "./crawler/url";
import { crawlerUserAgent } from "./crawler/user-agent";
import { connectDB } from "./db";
import { newPageChange, type ChangeDraft } from "./diff";
import { Change, Competitor, FeedItem, Snapshot, type CompetitorDoc } from "./models";
import { notifyChanges } from "./notify";

const COMMON_FEED_PATHS = [
  "/feed",
  "/rss.xml",
  "/feed.xml",
  "/atom.xml",
  "/rss",
  "/index.xml",
  "/blog/feed",
  "/blog/rss.xml",
  "/blogs/feed",
  "/blog/feed.xml",
];
const MAX_FEEDS = 5;
const REDISCOVER_MS = 24 * 3600_000;
const MAX_ALERTS = 50;

interface ParsedItem {
  key: string;
  url: string;
  title: string;
  categories: string[];
  publishedAt: Date | null;
}

async function get(url: string, timeoutMs = 15_000): Promise<{ status: number; body: string; type: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": crawlerUserAgent(), accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8", "cache-control": "no-cache" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { status: res.status, body: res.ok ? await res.text() : "", type: res.headers.get("content-type") ?? "" };
  } catch {
    return null;
  }
}

const looksLikeFeed = (body: string) => /<(?:rss|feed|rdf:RDF)[\s>]/i.test(body.slice(0, 2000));

/** Feeds advertised by the homepage, plus well-known paths that actually return a feed. */
export async function discoverFeeds(siteUrl: string): Promise<string[]> {
  const found = new Set<string>();
  const home = await get(siteUrl);
  if (home?.body) {
    const $ = cheerio.load(home.body);
    $('link[rel~="alternate" i][type*="rss" i], link[rel~="alternate" i][type*="atom" i]').each((_, el) => {
      const href = normalizeUrl($(el).attr("href") ?? "", siteUrl);
      // Skip per-post comment feeds WordPress advertises.
      if (href && !/comments?\/feed|\/comments(?:\/|$)/i.test(href)) found.add(href);
    });
  }
  if (found.size === 0) {
    const origin = new URL(siteUrl).origin;
    for (const path of COMMON_FEED_PATHS) {
      const res = await get(origin + path, 10_000);
      if (res?.status === 200 && looksLikeFeed(res.body)) {
        found.add(normalizeUrl(origin + path)!);
        break; // one working well-known feed is enough
      }
    }
  }
  const verified: string[] = [];
  for (const url of [...found].slice(0, MAX_FEEDS)) {
    const res = await get(url);
    if (res?.status === 200 && looksLikeFeed(res.body)) verified.push(url);
  }
  return verified;
}

export function parseFeed(xml: string, feedUrl: string): ParsedItem[] {
  const $ = cheerio.load(xml, { xml: true });
  const items: ParsedItem[] = [];
  const text = (el: cheerio.Cheerio<AnyNode>, sel: string) => el.find(sel).first().text().trim();

  // RSS 2.0 / RSS 1.0 (RDF)
  $("item").each((_, node) => {
    const el = $(node);
    const link = normalizeUrl(text(el, "link") || el.find("guid[isPermaLink!='false']").first().text().trim(), feedUrl);
    if (!link) return;
    items.push({
      key: text(el, "guid") || link,
      url: link,
      title: text(el, "title"),
      categories: el.find("category").map((_, c) => $(c).text().trim()).get().filter(Boolean),
      publishedAt: parseDate(text(el, "pubDate") || text(el, "dc\\:date") || text(el, "date")),
    });
  });

  // Atom
  $("entry").each((_, node) => {
    const el = $(node);
    const href =
      el.find('link[rel="alternate"]').first().attr("href") ?? el.find("link").first().attr("href") ?? "";
    const link = normalizeUrl(href, feedUrl);
    if (!link) return;
    items.push({
      key: text(el, "id") || link,
      url: link,
      title: text(el, "title"),
      categories: el.find("category").map((_, c) => $(c).attr("term") ?? $(c).text().trim()).get().filter(Boolean),
      publishedAt: parseDate(text(el, "published") || text(el, "updated")),
    });
  });
  return items;
}

/** Check every competitor's RSS/Atom feeds for new posts and alert. Returns number of new posts. */
export async function watchFeeds(): Promise<number> {
  await connectDB();
  const competitors = await Competitor.find().lean<CompetitorDoc[]>();
  let total = 0;
  for (const competitor of competitors) {
    try {
      total += await watchCompetitorFeeds(competitor);
    } catch (err) {
      console.error(`[feeds] ${competitor.name}:`, err instanceof Error ? err.message : err);
    }
  }
  return total;
}

async function watchCompetitorFeeds(competitor: CompetitorDoc): Promise<number> {
  let feedUrls = competitor.feedUrls ?? [];
  const stale = !competitor.feedsDiscoveredAt || Date.now() - competitor.feedsDiscoveredAt.getTime() > REDISCOVER_MS;
  if (feedUrls.length === 0 && stale) {
    feedUrls = await discoverFeeds(competitor.url);
    await Competitor.updateOne({ _id: competitor._id }, { $set: { feedUrls, feedsDiscoveredAt: new Date() } });
    if (feedUrls.length) console.log(`[feeds] ${competitor.name}: found ${feedUrls.join(", ")}`);
  }
  if (feedUrls.length === 0) return 0;

  const fresh: ParsedItem[] = [];
  for (const feedUrl of feedUrls) {
    const res = await get(feedUrl);
    if (!res || res.status !== 200 || !looksLikeFeed(res.body)) continue;
    const items = parseFeed(res.body, feedUrl);
    if (items.length === 0) continue;

    // First read of a feed is a silent baseline: only posts appearing later are "new".
    const baseline = !(await FeedItem.exists({ competitorId: competitor._id, feedUrl }));
    const seen = new Set(
      (await FeedItem.find({ competitorId: competitor._id, key: { $in: items.map((i) => i.key) } }).select("key").lean()).map(
        (d) => d.key,
      ),
    );
    const unseen = items.filter((i) => !seen.has(i.key));
    if (unseen.length === 0) continue;
    await FeedItem.insertMany(
      unseen.map((i) => ({ ...i, competitorId: competitor._id, feedUrl })),
      { ordered: false },
    ).catch(() => {}); // duplicate keys from a parallel run are fine
    if (!baseline) fresh.push(...unseen);
  }
  if (fresh.length === 0) return 0;

  // Skip posts already reported as new by the sitemap watch or a full check.
  const alreadyReported = new Set(
    (
      await Change.find({
        competitorId: competitor._id,
        type: { $in: ["new_blog", "new_product", "new_page"] },
        url: { $in: fresh.map((i) => i.url) },
      })
        .select("url")
        .lean()
    ).map((c) => c.url),
  );
  const unique = [...new Map(fresh.filter((i) => !alreadyReported.has(i.url)).map((i) => [i.url, i])).values()];
  if (unique.length === 0 || !competitor.lastSnapshotId) return 0;

  const drafts: ChangeDraft[] = unique.slice(0, MAX_ALERTS).map((i) =>
    newPageChange(i.url, {
      url: i.url,
      finalUrl: i.url,
      statusCode: 200,
      contentHash: "feed",
      pageType: "blog",
      title: i.title,
      publishedAt: i.publishedAt,
    }),
  );
  const snapshotId = competitor.lastSnapshotId;
  await Change.insertMany(drafts.map((d) => ({ ...d, competitorId: competitor._id, snapshotId })));
  // Known from now on, so the sitemap watch / next full check don't report them again.
  await Snapshot.updateOne(
    { _id: snapshotId },
    { $addToSet: { discoveredUrls: { $each: unique.map((i) => i.url) } }, $inc: { changesCount: drafts.length } },
  );
  await notifyChanges(competitor, snapshotId, drafts, "📰 New post (RSS)");
  console.log(`[feeds] ${competitor.name}: ${drafts.length} new post(s)`);
  return drafts.length;
}
