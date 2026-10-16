import "server-only";
import { Types } from "mongoose";
import { connection } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { archiveRoot, archiveUnavailable, nextArchiveAt } from "./archive";
import { requireAdmin } from "./auth/dal";
import { config } from "./config";
import { classifyByUrl } from "./crawler/extract";
import { connectDB } from "./db";
import { startOfToday } from "./format";
import { recoverInterruptedChecks } from "./monitor";
import {
  Archive,
  CHANGE_TYPES,
  Change,
  Competitor,
  FeedItem,
  Group,
  Notification,
  Page,
  Snapshot,
  type ChangeDoc,
  type ChangeType,
  type CompetitorDoc,
  type GroupDoc,
  type PageType,
} from "./models";
import { FULL_LIST, buildGroupReport, type Report } from "./report";
import { brandTokensFor, buildTopicReport, type TopicReport } from "./topics";

// Every exported reader verifies the session first (Data Access Layer pattern).
// connection() keeps DB reads and Date.now() out of prerendering (they're always per-request).
// It must run first: requireAdmin() checks the session expiry with Date.now().
async function ready() {
  await connection();
  await requireAdmin();
  await connectDB();
}

export type ChangeWithCompetitor = ChangeDoc & { competitorName?: string };

async function countByType(match: Record<string, unknown>): Promise<Partial<Record<ChangeType, number>>> {
  const rows = await Change.aggregate<{ _id: ChangeType; n: number }>([
    { $match: match },
    { $group: { _id: "$type", n: { $sum: 1 } } },
  ]);
  return Object.fromEntries(rows.map((r) => [r._id, r.n]));
}

async function attachNames(changes: ChangeDoc[]): Promise<ChangeWithCompetitor[]> {
  const ids = [...new Set(changes.map((c) => String(c.competitorId)))];
  const competitors = await Competitor.find({ _id: { $in: ids } }).select("name").lean();
  const names = new Map(competitors.map((c) => [String(c._id), c.name]));
  return changes.map((c) => ({ ...c, competitorName: names.get(String(c.competitorId)) }));
}

/** Change types grouped into the few kinds of activity the dashboard chart shows. */
export const ACTIVITY_GROUPS = [
  { key: "content", label: "New & removed pages", types: ["new_page", "new_blog", "new_product", "deleted_page"] },
  { key: "pricing", label: "Pricing", types: ["price_change"] },
  { key: "seo", label: "SEO & copy", types: ["title_change", "meta_change", "heading_change", "seo_change", "content_change"] },
  { key: "links", label: "Links & images", types: ["internal_link_added", "internal_link_removed", "image_change"] },
] as const satisfies readonly { key: string; label: string; types: readonly ChangeType[] }[];
export type ActivityKey = (typeof ACTIVITY_GROUPS)[number]["key"];
export interface ActivityDay {
  /** YYYY-MM-DD in APP_TIMEZONE. */
  day: string;
  counts: Record<ActivityKey, number>;
  total: number;
}

const ACTIVITY_DAYS = 14;
/** Recent changes the dashboard digest groups by day, competitor and type. */
const DIGEST_LIMIT = 400;
const dayKey = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Changes per day for the last ACTIVITY_DAYS days, split by activity group. */
async function getActivity(today: Date): Promise<ActivityDay[]> {
  const since = new Date(today.getTime() - (ACTIVITY_DAYS - 1) * 86400_000);
  const rows = await Change.aggregate<{ _id: { day: string; type: ChangeType }; n: number }>([
    { $match: { createdAt: { $gte: since } } },
    {
      $group: {
        _id: { day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: config.timeZone } }, type: "$type" },
        n: { $sum: 1 },
      },
    },
  ]);
  const groupOf = new Map<ChangeType, ActivityKey>(ACTIVITY_GROUPS.flatMap((g) => g.types.map((t) => [t, g.key] as const)));
  const days: ActivityDay[] = Array.from({ length: ACTIVITY_DAYS }, (_, i) => ({
    // Noon avoids landing on the previous day when converting to the timezone.
    day: dayKey(new Date(since.getTime() + i * 86400_000 + 12 * 3600_000)),
    counts: { content: 0, pricing: 0, seo: 0, links: 0 },
    total: 0,
  }));
  const byDay = new Map(days.map((d) => [d.day, d]));
  for (const r of rows) {
    const day = byDay.get(r._id.day);
    const group = groupOf.get(r._id.type);
    if (!day || !group) continue;
    day.counts[group] += r.n;
    day.total += r.n;
  }
  return days;
}

export async function getDashboardData() {
  await ready();
  await recoverInterruptedChecks(); // clears checks a killed process left as "Checking…"
  const today = startOfToday();
  const yesterday = new Date(today.getTime() - 86400_000);
  const weekAgo = new Date(Date.now() - 7 * 86400_000);

  const [competitors, todayCounts, weekCounts, yesterdayTotal, recent, weekly, activity] = await Promise.all([
    Competitor.find().sort({ name: 1 }).lean<CompetitorDoc[]>(),
    countByType({ createdAt: { $gte: today } }),
    countByType({ createdAt: { $gte: weekAgo } }),
    Change.countDocuments({ createdAt: { $gte: yesterday, $lt: today } }),
    Change.find().sort({ createdAt: -1 }).limit(DIGEST_LIMIT).lean<ChangeDoc[]>(),
    Change.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { createdAt: { $gte: weekAgo } } },
      { $group: { _id: "$competitorId", n: { $sum: 1 } } },
    ]),
    getActivity(today),
  ]);
  const sum = (counts: Partial<Record<ChangeType, number>>) => Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const weeklyById = new Map(weekly.map((w) => [String(w._id), w.n]));
  const lastCheckedAt = competitors.reduce<Date | null>(
    (latest, c) => (c.lastCheckedAt && (!latest || c.lastCheckedAt > latest) ? c.lastCheckedAt : latest),
    null,
  );

  return {
    now: Date.now(),
    competitors: competitors.map((c) => ({ ...c, changesThisWeek: weeklyById.get(String(c._id)) ?? 0 })),
    lastCheckedAt,
    activity,
    stats: {
      competitors: competitors.length,
      pagesMonitored: competitors.reduce((a, c) => a + (c.pagesMonitored ?? 0), 0),
      changesToday: sum(todayCounts),
      changesYesterday: yesterdayTotal,
      changesWeek: sum(weekCounts),
      today: todayCounts,
      week: weekCounts,
    },
    recentChanges: await attachNames(recent),
  };
}

export async function getCompetitors() {
  await ready();
  await recoverInterruptedChecks();
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const [groupDocs, competitors, weekly, highlights] = await Promise.all([
    Group.find().sort({ name: 1 }).lean<GroupDoc[]>(),
    Competitor.find().sort({ createdAt: -1 }).lean<CompetitorDoc[]>(),
    Change.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { createdAt: { $gte: weekAgo } } },
      { $group: { _id: "$competitorId", n: { $sum: 1 } } },
    ]),
    // The latest change worth reading per competitor (new content or a price change).
    Change.aggregate<{ _id: Types.ObjectId; type: ChangeType; url: string; summary: string; createdAt: Date }>([
      { $match: { type: { $in: HIGHLIGHT_TYPES } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: "$competitorId", type: { $first: "$type" }, url: { $first: "$url" }, summary: { $first: "$summary" }, createdAt: { $first: "$createdAt" } } },
    ]),
  ]);
  const weeklyById = new Map(weekly.map((w) => [String(w._id), w.n]));
  const highlightById = new Map(highlights.map((h) => [String(h._id), h]));
  const intervalMs = config.checkIntervalHours * 3600_000;

  // Plain, serializable rows: the list is filtered and sorted in the browser.
  const rows: CompetitorRow[] = competitors.map((c) => {
    const h = highlightById.get(String(c._id));
    return {
      id: String(c._id),
      groupId: c.groupId ? String(c.groupId) : null,
      name: c.name,
      url: c.url,
      host: c.host,
      status: c.status,
      pagesMonitored: c.pagesMonitored ?? 0,
      maxPages: c.maxPages,
      changesThisWeek: weeklyById.get(String(c._id)) ?? 0,
      lastError: c.lastError ?? null,
      createdAt: c.createdAt.toISOString(),
      lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
      nextCheckAt: intervalMs > 0 && c.lastCheckedAt ? new Date(c.lastCheckedAt.getTime() + intervalMs).toISOString() : null,
      highlight: h ? { type: h.type, url: h.url, summary: h.summary, at: h.createdAt.toISOString() } : null,
    };
  });
  const groups: GroupRow[] = groupDocs.map((g) => {
    const members = rows.filter((r) => r.groupId === String(g._id));
    return {
      id: String(g._id),
      name: g.name,
      count: members.length,
      crawling: members.filter((m) => m.status === "crawling").length,
      failing: members.filter((m) => m.status === "error").length,
      changesThisWeek: members.reduce((a, m) => a + m.changesThisWeek, 0),
      pagesMonitored: members.reduce((a, m) => a + m.pagesMonitored, 0),
      members: members.slice(0, 4).map((m) => m.name),
    };
  });
  return { now: Date.now(), competitors: rows, groups };
}

/** A parent group (e.g. CourseUnbox) with totals over its competitors. */
export interface GroupRow {
  id: string;
  name: string;
  count: number;
  crawling: number;
  failing: number;
  changesThisWeek: number;
  pagesMonitored: number;
  /** First few competitor names, for the card preview. */
  members: string[];
}

const HIGHLIGHT_TYPES: ChangeType[] = ["new_blog", "new_product", "new_page", "price_change", "deleted_page"];

export interface CompetitorRow {
  id: string;
  groupId: string | null;
  name: string;
  url: string;
  host: string;
  status: CompetitorDoc["status"];
  pagesMonitored: number;
  maxPages: number;
  changesThisWeek: number;
  lastError: string | null;
  createdAt: string;
  lastCheckedAt: string | null;
  nextCheckAt: string | null;
  highlight: { type: ChangeType; url: string; summary: string; at: string } | null;
}

export const CHANGES_PAGE_SIZE = 50;
export const RECENT_WINDOWS = [7, 30, 90] as const;
const MAX_RECENT = 300;

export interface RecentUpdate {
  url: string;
  title?: string;
  type: PageType;
  /** "published": the page's own publish date is in the window; "updated": only modified/lastmod is. */
  kind: "published" | "updated";
  at: Date;
}

type RecentPage = {
  url: string;
  title?: string;
  pageType: PageType;
  publishedAt?: Date | null;
  modifiedAt?: Date | null;
  sitemapLastmod?: Date | null;
};

/** What the competitor published or updated recently, from page dates + sitemap <lastmod>. */
function buildRecentUpdates(pages: RecentPage[], lastmods: { url: string; at: Date }[], since: Date): RecentUpdate[] {
  const items = new Map<string, RecentUpdate>();
  for (const p of pages) {
    const updated = p.modifiedAt ?? p.sitemapLastmod;
    if (p.publishedAt && p.publishedAt >= since) {
      items.set(p.url, { url: p.url, title: p.title, type: p.pageType, kind: "published", at: p.publishedAt });
    } else if (updated && updated >= since) {
      items.set(p.url, { url: p.url, title: p.title, type: p.pageType, kind: "updated", at: updated });
    }
  }
  const crawled = new Set(pages.map((p) => p.url));
  for (const { url, at } of lastmods) {
    if (at < since) break; // stored newest first
    if (!crawled.has(url) && !items.has(url)) items.set(url, { url, type: classifyByUrl(url), kind: "updated", at });
  }
  return [...items.values()].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, MAX_RECENT);
}

const NEW_CONTENT_TYPES: ChangeType[] = ["new_blog", "new_product", "new_page"];

/** "seo-executive-meaning" → "seo executive meaning", for new pages we only know by URL. */
function slugText(url: string): string {
  const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
  return decodeURIComponent(last).replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ");
}

/** Topics of content published/discovered in the window vs the previous window of equal length. */
async function getTopicReport(
  competitor: CompetitorDoc,
  pages: { url: string; title?: string; h1?: string[]; publishedAt?: Date | null }[],
  days: number,
): Promise<TopicReport> {
  const now = Date.now();
  const from = now - days * 86400_000;
  const prevFrom = now - 2 * days * 86400_000;
  const [changes, feedItems] = await Promise.all([
    Change.find({ competitorId: competitor._id, type: { $in: NEW_CONTENT_TYPES }, createdAt: { $gte: new Date(prevFrom) } })
      .select("url newValue createdAt")
      .lean(),
    FeedItem.find({
      competitorId: competitor._id,
      $or: [{ publishedAt: { $gte: new Date(prevFrom) } }, { publishedAt: null, firstSeenAt: { $gte: new Date(prevFrom) } }],
    })
      .select("url title categories publishedAt firstSeenAt")
      .lean(),
  ]);

  // One document per URL, dated by its earliest known publish/discovery time.
  const docs = new Map<string, { at: number; text: string[]; categories: string[] }>();
  const add = (url: string, at: Date, text: string, categories: string[] = []) => {
    const doc = docs.get(url) ?? { at: at.getTime(), text: [], categories: [] };
    doc.at = Math.min(doc.at, at.getTime());
    if (text) doc.text.push(text);
    doc.categories.push(...categories);
    docs.set(url, doc);
  };
  for (const p of pages) {
    if (p.publishedAt && p.publishedAt.getTime() >= prevFrom) add(p.url, p.publishedAt, `${p.title ?? ""} ${p.h1?.[0] ?? ""}`);
  }
  for (const f of feedItems) add(f.url, f.publishedAt ?? f.firstSeenAt, f.title, f.categories);
  for (const c of changes) add(c.url, c.createdAt, c.newValue || slugText(c.url));

  const all = [...docs.values()];
  const current = all.filter((d) => d.at >= from);
  const previous = all.filter((d) => d.at < from);
  return buildTopicReport(
    current.map((d) => d.text.join(" ")),
    previous.map((d) => d.text.join(" ")),
    current.flatMap((d) => [...new Set(d.categories)]),
    previous.flatMap((d) => [...new Set(d.categories)]),
    brandTokensFor(competitor.name, competitor.host),
  );
}

export async function getCompetitorDetail(id: string, filter: { type?: string; page?: number; recent?: number }) {
  await ready();
  if (!Types.ObjectId.isValid(id)) return null;
  await recoverInterruptedChecks();
  const competitor = await Competitor.findById(id).lean<CompetitorDoc>();
  if (!competitor) return null;
  const group = competitor.groupId ? await Group.findById(competitor.groupId).select("name").lean<GroupDoc>() : null;

  const type = CHANGE_TYPES.includes(filter.type as ChangeType) ? (filter.type as ChangeType) : undefined;
  const page = Math.max(1, filter.page ?? 1);
  const changeQuery = { competitorId: competitor._id, ...(type ? { type } : {}) };

  const day = 86400_000;
  const nowMs = Date.now();
  const [last7, prev7, counts30] = await Promise.all([
    Change.countDocuments({ competitorId: competitor._id, createdAt: { $gte: new Date(nowMs - 7 * day) } }),
    Change.countDocuments({ competitorId: competitor._id, createdAt: { $gte: new Date(nowMs - 14 * day), $lt: new Date(nowMs - 7 * day) } }),
    countByType({ competitorId: competitor._id, createdAt: { $gte: new Date(nowMs - 30 * day) } }),
  ]);

  const [snapshots, running, countsByType, totalFiltered, changes] = await Promise.all([
    Snapshot.find({ competitorId: competitor._id, status: { $ne: "running" } })
      .sort({ startedAt: -1 })
      .limit(20)
      .select("-discoveredUrls -lastmods")
      .lean(),
    Snapshot.findOne({ competitorId: competitor._id, status: "running" }).select("-discoveredUrls -lastmods").lean(),
    countByType({ competitorId: competitor._id }),
    Change.countDocuments(changeQuery),
    Change.find(changeQuery)
      .sort({ createdAt: -1, _id: 1 })
      .skip((page - 1) * CHANGES_PAGE_SIZE)
      .limit(CHANGES_PAGE_SIZE)
      .lean<ChangeDoc[]>(),
  ]);

  const latest = snapshots.find((s) => s.status === "completed");
  const pages = latest
    ? await Page.find({ snapshotId: latest._id })
        .select("url title h1 pageType statusCode wordCount prices error publishedAt modifiedAt sitemapLastmod robotsMeta canonical")
        .sort({ url: 1 })
        .limit(1000)
        .lean()
    : [];
  // Newest content first; pages without any date go last.
  const dateOf = (p: (typeof pages)[number]) =>
    (p.publishedAt ?? p.modifiedAt ?? p.sitemapLastmod)?.getTime() ?? 0;
  pages.sort((a, b) => dateOf(b) - dateOf(a));

  const recentDays = (RECENT_WINDOWS as readonly number[]).includes(filter.recent ?? 0) ? filter.recent! : 30;
  const lastmods = latest ? ((await Snapshot.findById(latest._id).select("lastmods").lean())?.lastmods ?? []) : [];
  const recent = buildRecentUpdates(pages, lastmods, new Date(Date.now() - recentDays * 86400_000));
  const topics = await getTopicReport(competitor, pages, recentDays);

  return {
    now: Date.now(),
    competitor,
    group: group ? { id: String(group._id), name: group.name } : null,
    running,
    latest,
    snapshots,
    countsByType,
    changes,
    type,
    page,
    totalPages: Math.max(1, Math.ceil(totalFiltered / CHANGES_PAGE_SIZE)),
    pages,
    recent,
    recentDays,
    topics,
    activity: { last7, prev7, counts30 },
    nextCheckAt:
      config.checkIntervalHours > 0 && competitor.lastCheckedAt
        ? new Date(competitor.lastCheckedAt.getTime() + config.checkIntervalHours * 3600_000)
        : null,
  };
}

export async function getNotifications() {
  await ready();
  const notifications = await Notification.find().sort({ createdAt: -1 }).limit(100).lean();
  return { now: Date.now(), notifications };
}

export async function getUnreadCount(): Promise<number> {
  await ready();
  return Notification.countDocuments({ read: false });
}

export interface ArchiveRow {
  id: string;
  hasReport: boolean;
  rows: number;
  bytes: number;
  from: string;
  to: string;
  createdAt: string;
}

/** Retention status, plus the CSV archives of one parent (`"none"` = without a parent) when given. */
export async function getArchives(group?: string) {
  await ready();
  const [next, docs] = await Promise.all([
    nextArchiveAt(),
    group === "none" || (group && Types.ObjectId.isValid(group))
      ? Archive.find({ groupId: group === "none" ? null : group }).sort({ createdAt: -1 }).limit(100).lean()
      : Promise.resolve([]),
  ]);
  return {
    retentionDays: config.retentionDays,
    unavailable: archiveUnavailable(),
    nextAt: next?.toISOString() ?? null,
    archives: docs.map(
      (a): ArchiveRow => ({
        id: String(a._id),
        hasReport: !!a.reportFile,
        rows: a.rows,
        bytes: a.bytes,
        from: a.from.toISOString(),
        to: a.to.toISOString(),
        createdAt: a.createdAt.toISOString(),
      }),
    ),
  };
}

export const REPORT_WINDOWS = [7, 14] as const;

/**
 * The "what did each competitor do" report: live from the database for the last `days` days,
 * or the one saved with an archive (its changes are no longer in the database).
 */
export async function getReport(params: { group?: string; days?: number; archive?: string; full?: boolean }): Promise<
  | { report: Report; source: "live"; days: number }
  | { report: Report; source: "archive"; archiveId: string }
  | { error: string }
  | null
> {
  await ready();
  if (params.archive) {
    if (!Types.ObjectId.isValid(params.archive)) return null;
    const a = await Archive.findById(params.archive).lean();
    if (!a) return null;
    if (!a.reportFile) return { error: "This archive was made before reports existed. Download its CSV instead." };
    const root = archiveRoot();
    const file = path.resolve(root, a.reportFile);
    if (!file.startsWith(root + path.sep)) return null;
    const json = await readFile(file, "utf8").catch(() => null);
    if (!json) return { error: `The report file is missing on the server (${a.reportFile}).` };
    return { report: JSON.parse(json) as Report, source: "archive", archiveId: String(a._id) };
  }
  const group = params.group;
  if (!group || (group !== "none" && !Types.ObjectId.isValid(group))) return null;
  const days = (REPORT_WINDOWS as readonly number[]).includes(params.days ?? 0) ? params.days! : 7;
  const to = new Date();
  const report = await buildGroupReport(group, new Date(to.getTime() - days * 86400_000), to, params.full ? FULL_LIST : undefined);
  return report && { report, source: "live", days };
}
