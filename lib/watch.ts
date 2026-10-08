import "server-only";
import { config } from "./config";
import { MAX_SITEMAP_URLS, discover } from "./crawler/discovery";
import { extractPage, parseDate } from "./crawler/extract";
import { createFetcher } from "./crawler/fetcher";
import { normalizeUrl } from "./crawler/url";
import { connectDB } from "./db";
import { newPageChange, type ChangeDraft, type ComparablePage } from "./diff";
import { Change, Competitor, Snapshot, type CompetitorDoc } from "./models";
import { notifyChanges } from "./notify";

/** New URLs opened per run to read their title/date; the rest are reported from the URL alone. */
const MAX_OPEN = 10;
const MAX_ALERTS = 300;
/** On sitemaps cut off at MAX_SITEMAP_URLS, only trust "new" URLs with a recent lastmod. */
const TRUNCATED_LASTMOD_DAYS = 3;

/**
 * Lightweight new-upload watch between full checks: read the sitemap, and for URLs
 * not seen before, open them, save "New Blog/Product/Page" changes and alert right away.
 */
export async function watchNewUploads(): Promise<number> {
  if (config.watchIntervalMinutes <= 0) return 0;
  await connectDB();
  const competitors = await Competitor.find({ status: { $ne: "crawling" }, lastSnapshotId: { $ne: null } }).lean<
    CompetitorDoc[]
  >();
  let alerts = 0;
  for (const competitor of competitors) {
    try {
      alerts += await watchCompetitor(competitor);
    } catch (err) {
      console.error(`[watch] ${competitor.name}:`, err instanceof Error ? err.message : err);
    }
  }
  return alerts;
}

async function watchCompetitor(competitor: CompetitorDoc): Promise<number> {
  const snapshot = await Snapshot.findOne({ competitorId: competitor._id, status: "completed" })
    .sort({ startedAt: -1 })
    .select("_id discoveryMethod discoveredUrls")
    .lean();
  // Sites without a sitemap are only covered by the full check (link crawling is too heavy here).
  if (!snapshot || snapshot.discoveryMethod !== "sitemap" || snapshot.discoveredUrls.length === 0) return 0;

  const discovery = await discover(competitor.url);
  if (discovery.pageUrls.length === 0) return 0;

  const known = new Set(snapshot.discoveredUrls);
  const truncated = discovery.pageUrls.length >= MAX_SITEMAP_URLS;
  const recent = Date.now() - TRUNCATED_LASTMOD_DAYS * 86400_000;
  const fresh = discovery.pageUrls.filter((url) => {
    if (known.has(url)) return false;
    if (!truncated) return true;
    const lastmod = parseDate(discovery.lastmod.get(url));
    return !!lastmod && lastmod.getTime() >= recent;
  });
  if (fresh.length === 0) return 0;

  // Open the first few new URLs to get title, type and publish date.
  const opened = new Map<string, ComparablePage | null>();
  const { fetcher } = await createFetcher();
  try {
    for (const url of fresh.slice(0, MAX_OPEN)) {
      const res = await fetcher.fetchPage(url);
      if (res.status >= 400) {
        opened.set(url, null); // listed in the sitemap but broken: not a real upload
        continue;
      }
      if (!res.html) continue;
      const finalUrl = normalizeUrl(res.finalUrl) ?? url;
      opened.set(url, {
        url,
        finalUrl,
        statusCode: res.status,
        ...extractPage(res.html, finalUrl, new URL(competitor.url).hostname),
      });
    }
  } finally {
    await fetcher.close();
  }

  const drafts: ChangeDraft[] = fresh
    .filter((url) => opened.get(url) !== null)
    .slice(0, MAX_ALERTS)
    .map((url) => newPageChange(url, opened.get(url) ?? undefined));

  // Remember every fresh URL on the snapshot, so neither this watch nor the next full check reports it again.
  await Snapshot.updateOne({ _id: snapshot._id }, { $addToSet: { discoveredUrls: { $each: fresh } } });
  if (drafts.length === 0) return 0;

  await Change.insertMany(drafts.map((d) => ({ ...d, competitorId: competitor._id, snapshotId: snapshot._id })));
  await Snapshot.updateOne({ _id: snapshot._id }, { $inc: { changesCount: drafts.length } });
  await notifyChanges(competitor, snapshot._id, drafts, "🆕 New upload");
  console.log(`[watch] ${competitor.name}: ${drafts.length} new upload(s)`);
  return drafts.length;
}
