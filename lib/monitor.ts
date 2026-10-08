import "server-only";
import { Types } from "mongoose";
import { config } from "./config";
import { crawlSite, type CrawledPage } from "./crawler/crawl";
import { connectDB } from "./db";
import { fetchRobotsTxt } from "./crawler/seo";
import { detectChanges, robotsTxtChange } from "./diff";
import { Change, Competitor, Page, Snapshot, type CompetitorDoc } from "./models";
import { notifyBaseline, notifyChanges, notifyFailure } from "./notify";

const hasContent = (p: { statusCode: number; contentHash?: string }) =>
  p.statusCode > 0 && p.statusCode < 400 && !!p.contentHash;

/** A check still "running" after the crawl time limit + 5 min was killed (restart, hosting timeout). */
const staleCutoff = () => new Date(Date.now() - config.crawlTimeLimitMs - 5 * 60_000);

/** Atomically mark a competitor as crawling. Returns null if a (live) check is already running. */
async function claim(competitorId: string): Promise<CompetitorDoc | null> {
  await connectDB();
  if (!Types.ObjectId.isValid(competitorId)) return null;
  await recoverInterruptedChecks(); // frees competitors stuck on a killed check
  return Competitor.findOneAndUpdate(
    { _id: competitorId, status: { $ne: "crawling" } },
    { $set: { status: "crawling", lastError: null } },
    { returnDocument: "after" },
  ).lean<CompetitorDoc>();
}

/**
 * "Check Now": claim the competitor and start the check without waiting for it.
 * Returns the running check (or null if one is already running) so the caller can keep
 * a serverless function alive until it finishes, via `after(() => started.run)`.
 * Wrapped in an object: returning the promise itself would make `await startCheck()` wait for the whole crawl.
 */
export async function startCheck(competitorId: string): Promise<{ run: Promise<void> } | null> {
  const competitor = await claim(competitorId);
  return competitor ? { run: runCheck(competitor) } : null;
}

/** Old snapshot → new crawl → compare → save changes → notify. Never throws. */
async function runCheck(competitor: CompetitorDoc): Promise<void> {
  const started = Date.now();
  const snapshot = await Snapshot.create({ competitorId: competitor._id, status: "running" });
  console.log(`[monitor] checking ${competitor.name} (${competitor.url})`);

  try {
    const prev = await Snapshot.findOne({
      competitorId: competitor._id,
      status: "completed",
      _id: { $ne: snapshot._id },
    })
      .sort({ startedAt: -1 })
      .lean();
    const prevPages = prev ? await Page.find({ snapshotId: prev._id }).lean() : [];

    let lastProgress = 0;
    const result = await crawlSite(
      competitor.url,
      competitor.maxPages || config.crawlMaxPages,
      prev
        ? {
            method: prev.discoveryMethod,
            discoveredUrls: prev.discoveredUrls,
            crawledUrls: prevPages.filter(hasContent).map((p) => p.url),
          }
        : null,
      (crawled) => {
        if (crawled - lastProgress >= 5) {
          lastProgress = crawled;
          void Snapshot.updateOne({ _id: snapshot._id }, { $set: { pagesCrawled: crawled } }).exec();
        }
      },
    );

    // The competitor may have been deleted while we were crawling.
    if (!(await Competitor.exists({ _id: competitor._id }))) {
      await Snapshot.deleteOne({ _id: snapshot._id });
      return;
    }

    const okPages = result.pages.filter(hasContent);
    if (okPages.length === 0) {
      const home = result.pages[0];
      throw new Error(
        `Could not load any page${home ? ` (homepage: ${home.error ?? `HTTP ${home.statusCode}`})` : ""}`,
      );
    }

    await Page.insertMany(
      result.pages.map((p: CrawledPage) => ({ ...p, snapshotId: snapshot._id, competitorId: competitor._id })),
    );

    // Read separately from discovery so rule changes can be compared between snapshots.
    const origin = new URL(competitor.url).origin;
    const fetchedRobots = await fetchRobotsTxt(origin);
    const robotsTxt = fetchedRobots === undefined ? (prev?.robotsTxt ?? null) : fetchedRobots;

    const changes = prev
      ? detectChanges(
          { method: prev.discoveryMethod, discoveredUrls: prev.discoveredUrls, pages: prevPages },
          { method: result.method, discoveredUrls: result.discoveredUrls, pages: result.pages },
        )
      : [];
    const robotsChange = prev && fetchedRobots !== undefined ? robotsTxtChange(prev.robotsTxt, robotsTxt, origin) : null;
    if (robotsChange) changes.push(robotsChange);
    if (changes.length) {
      await Change.insertMany(
        changes.map((c) => ({ ...c, competitorId: competitor._id, snapshotId: snapshot._id })),
      );
    }

    const now = new Date();
    await Snapshot.updateOne(
      { _id: snapshot._id },
      {
        $set: {
          status: "completed",
          isBaseline: !prev,
          engine: result.engine,
          finishedAt: now,
          robotsFound: result.robotsFound,
          robotsTxt,
          sitemapUrls: result.sitemapUrls,
          discoveryMethod: result.method,
          discoveredUrls: result.discoveredUrls,
          lastmods: result.lastmods,
          pagesCrawled: result.pages.length,
          pagesFailed: result.pages.length - okPages.length,
          changesCount: changes.length,
          error: result.warning,
        },
      },
    );
    await Competitor.updateOne(
      { _id: competitor._id },
      {
        $set: {
          status: "idle",
          lastCheckedAt: now,
          lastSuccessAt: now,
          lastError: result.warning,
          lastSnapshotId: snapshot._id,
          pagesMonitored: okPages.length,
        },
      },
    );

    if (!prev) await notifyBaseline(competitor, snapshot._id, okPages.length);
    else if (changes.length) await notifyChanges(competitor, snapshot._id, changes);

    await pruneOldSnapshots(competitor._id);
    console.log(
      `[monitor] ${competitor.name}: ${okPages.length}/${result.pages.length} pages, ` +
        `${changes.length} changes, ${((Date.now() - started) / 1000).toFixed(1)}s (${result.engine})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[monitor] ${competitor.name} failed:`, message);
    await Page.deleteMany({ snapshotId: snapshot._id }).catch(() => {});
    await Snapshot.updateOne(
      { _id: snapshot._id },
      { $set: { status: "failed", finishedAt: new Date(), error: message } },
    ).catch(() => {});
    await Competitor.updateOne(
      { _id: competitor._id },
      { $set: { status: "error", lastCheckedAt: new Date(), lastError: message } },
    ).catch(() => {});
    await notifyFailure(competitor, snapshot._id, message).catch(() => {});
  }
}

/** Keep full page data only for the latest N completed snapshots; older ones keep metadata + changes. */
async function pruneOldSnapshots(competitorId: Types.ObjectId) {
  const old = await Snapshot.find({ competitorId, status: "completed" })
    .sort({ startedAt: -1 })
    .skip(config.snapshotRetention)
    .select("_id")
    .lean();
  if (!old.length) return;
  const ids = old.map((s) => s._id);
  await Page.deleteMany({ snapshotId: { $in: ids } });
  await Snapshot.updateMany({ _id: { $in: ids } }, { $set: { discoveredUrls: [], lastmods: [] } });
}

/** Run checks for competitors whose last check is older than CHECK_INTERVAL_HOURS, one at a time. */
export async function runDueChecks(): Promise<number> {
  if (config.checkIntervalHours <= 0) return 0;
  await connectDB();
  const cutoff = new Date(Date.now() - config.checkIntervalHours * 3600_000);
  const due = await Competitor.find({
    status: { $ne: "crawling" },
    $or: [{ lastCheckedAt: null }, { lastCheckedAt: { $exists: false } }, { lastCheckedAt: { $lt: cutoff } }],
  })
    .select("_id")
    .lean();

  let ran = 0;
  for (const { _id } of due) {
    const competitor = await claim(String(_id));
    if (!competitor) continue;
    await runCheck(competitor);
    ran++;
  }
  return ran;
}

/** After a restart, checks that were mid-crawl can never finish; mark them failed. */
export async function recoverInterruptedChecks(): Promise<void> {
  await connectDB();
  // Only checks older than the crawl time limit: a fresh one may be running in another
  // process (e.g. another serverless instance) and must not be failed.
  const cutoff = staleCutoff();
  const message = "Check was interrupted (server restart or hosting time limit). Click Check Now to retry.";
  const stale = await Snapshot.find({ status: "running", startedAt: { $lt: cutoff } }).select("_id").lean();
  if (stale.length) {
    const ids = stale.map((s) => s._id);
    await Page.deleteMany({ snapshotId: { $in: ids } });
    await Snapshot.updateMany({ _id: { $in: ids } }, { $set: { status: "failed", finishedAt: new Date(), error: message } });
  }
  await Competitor.updateMany(
    { status: "crawling", updatedAt: { $lt: cutoff } },
    { $set: { status: "error", lastError: message } },
  );
}
