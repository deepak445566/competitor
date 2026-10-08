import "server-only";
import { Types } from "mongoose";
import { connection } from "next/server";
import { requireAdmin } from "./auth/dal";
import { classifyByUrl } from "./crawler/extract";
import { connectDB } from "./db";
import { startOfToday } from "./format";
import { recoverInterruptedChecks } from "./monitor";
import {
  CHANGE_TYPES,
  Change,
  Competitor,
  FeedItem,
  Notification,
  Page,
  Snapshot,
  type ChangeDoc,
  type ChangeType,
  type CompetitorDoc,
  type PageType,
} from "./models";
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

export async function getDashboardData() {
  await ready();
  await recoverInterruptedChecks(); // clears checks a killed process left as "Checking…"
  const today = startOfToday();
  const weekAgo = new Date(Date.now() - 7 * 86400_000);

  const [competitors, todayCounts, weekCounts, recent] = await Promise.all([
    Competitor.find().sort({ name: 1 }).lean<CompetitorDoc[]>(),
    countByType({ createdAt: { $gte: today } }),
    countByType({ createdAt: { $gte: weekAgo } }),
    Change.find().sort({ createdAt: -1 }).limit(20).lean<ChangeDoc[]>(),
  ]);
  const sum = (counts: Partial<Record<ChangeType, number>>) => Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  return {
    now: Date.now(),
    competitors,
    stats: {
      competitors: competitors.length,
      pagesMonitored: competitors.reduce((a, c) => a + (c.pagesMonitored ?? 0), 0),
      changesToday: sum(todayCounts),
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
  const [competitors, weekly] = await Promise.all([
    Competitor.find().sort({ createdAt: -1 }).lean<CompetitorDoc[]>(),
    Change.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { createdAt: { $gte: weekAgo } } },
      { $group: { _id: "$competitorId", n: { $sum: 1 } } },
    ]),
  ]);
  const weeklyById = new Map(weekly.map((w) => [String(w._id), w.n]));
  return {
    now: Date.now(),
    competitors: competitors.map((c) => ({ ...c, changesThisWeek: weeklyById.get(String(c._id)) ?? 0 })),
  };
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

  const type = CHANGE_TYPES.includes(filter.type as ChangeType) ? (filter.type as ChangeType) : undefined;
  const page = Math.max(1, filter.page ?? 1);
  const changeQuery = { competitorId: competitor._id, ...(type ? { type } : {}) };

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
