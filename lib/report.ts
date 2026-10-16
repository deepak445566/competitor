import "server-only";
import type { Types } from "mongoose";
import { Change, Competitor, Group, type ChangeType } from "./models";
import { brandTokensFor, buildTopicReport, type Term } from "./topics";

// A readable "what did each competitor do" report for one parent and period, built from the change history.
// Plain JSON, so the archive job can save it to disk before the changes behind it are deleted.

export interface ReportItem {
  title: string;
  url: string;
  at: string;
}
export interface ReportPrice {
  url: string;
  before: string;
  after: string;
  at: string;
}
export interface ReportTitle {
  url: string;
  before: string;
  after: string;
  at: string;
}
export interface ReportNote {
  url: string;
  text: string;
  at: string;
}

/** A change kept with its full detail (content lines, linking pages, images…), for the Excel download. */
export interface ReportDetail {
  type: ChangeType;
  url: string;
  summary: string;
  oldValue: string;
  newValue: string;
  added: string[];
  removed: string[];
  at: string;
}

export interface CompetitorReport {
  id: string;
  name: string;
  host: string;
  counts: Partial<Record<ChangeType, number>>;
  total: number;
  newBlogs: ReportItem[];
  newProducts: ReportItem[];
  newPages: ReportItem[];
  prices: ReportPrice[];
  removed: ReportNote[];
  titles: ReportTitle[];
  seo: ReportNote[];
  topics: Term[];
  /** Content, heading, meta, link and image changes in full; only in downloads and archives. */
  details?: ReportDetail[];
}

export interface Report {
  version: 1;
  group: { id: string | null; name: string };
  from: string;
  to: string;
  generatedAt: string;
  competitors: CompetitorReport[];
  highlights: string[];
  topics: Term[];
}

/** Types listed one by one; everything else is only counted. */
const DETAIL_TYPES: ChangeType[] = ["new_blog", "new_product", "new_page", "price_change", "deleted_page", "title_change", "seo_change"];
/** Only counted on the page; listed in full in downloads and archives. */
export const OTHER_TYPES: ChangeType[] = [
  "content_change",
  "heading_change",
  "meta_change",
  "internal_link_added",
  "internal_link_removed",
  "image_change",
];
/** Most entries kept per list by default, so a report stays small even for a very busy competitor. */
const MAX_PER_LIST = 150;
/** For downloads and archives, which should hold (nearly) everything. */
export const FULL_LIST = 5000;

const slugText = (url: string) => {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return decodeURIComponent(last).replace(/\.[a-z]+$/i, "").replace(/[-_]+/g, " ") || url;
  } catch {
    return url;
  }
};
/** "Power BI Resources | Simplilearn" → "Power BI Resources". */
const cleanTitle = (title: string) => title.replace(/\s+\|\s+[^|]{1,40}$/, "").trim() || title;
const priceList = (diff: string[] | undefined, whole: string | null | undefined) => {
  const list = diff?.length ? diff : (whole ?? "").split(", ").filter(Boolean);
  if (!list.length) return "—";
  return list.length > 6 ? `${list.slice(0, 6).join(", ")} +${list.length - 6}` : list.join(", ");
};
const plural = (n: number, word: string) => `${n.toLocaleString("en-IN")} ${word}${n === 1 ? "" : "s"}`;

export async function buildReport(
  group: { id: Types.ObjectId | string | null; name: string },
  from: Date,
  to: Date,
  maxPerList = MAX_PER_LIST,
): Promise<Report> {
  const competitors = await Competitor.find(group.id ? { groupId: group.id } : { groupId: null }).select("name host").lean();
  const ids = competitors.map((c) => c._id);
  const period = { competitorId: { $in: ids }, createdAt: { $gte: from, $lt: to } };

  const full = maxPerList >= FULL_LIST;
  const [counts, details, others] = await Promise.all([
    Change.aggregate<{ _id: { c: Types.ObjectId; t: ChangeType }; n: number }>([
      { $match: period },
      { $group: { _id: { c: "$competitorId", t: "$type" }, n: { $sum: 1 } } },
    ]),
    Change.find({ ...period, type: { $in: DETAIL_TYPES } })
      .sort({ createdAt: -1 })
      .select("competitorId type url summary oldValue newValue added removed createdAt")
      .lean(),
    full
      ? Change.find({ ...period, type: { $in: OTHER_TYPES } })
          .sort({ createdAt: -1 })
          .select("competitorId type url summary oldValue newValue added removed createdAt")
          .lean()
      : Promise.resolve([]),
  ]);

  const rows = new Map<string, CompetitorReport>(
    competitors.map((c) => [
      String(c._id),
      { id: String(c._id), name: c.name, host: c.host, counts: {}, total: 0, newBlogs: [], newProducts: [], newPages: [], prices: [], removed: [], titles: [], seo: [], topics: [] },
    ]),
  );
  for (const r of counts) {
    const row = rows.get(String(r._id.c));
    if (!row) continue;
    row.counts[r._id.t] = r.n;
    row.total += r.n;
  }

  const seen = new Set<string>();
  const push = <T>(list: T[], item: T) => list.length < maxPerList && list.push(item);
  for (const ch of details) {
    const row = rows.get(String(ch.competitorId));
    if (!row) continue;
    const at = ch.createdAt.toISOString();
    // The same new post can be reported by the RSS watch and a full check: list it once.
    const key = `${row.id} ${ch.type} ${ch.url}`;
    if (ch.type.startsWith("new_") && seen.has(key)) continue;
    seen.add(key);
    const title = cleanTitle(
      ch.newValue || (ch.summary && !ch.summary.startsWith("Discovered") ? ch.summary.split(" · ")[0] : "") || slugText(ch.url),
    );
    switch (ch.type) {
      case "new_blog":
        push(row.newBlogs, { title, url: ch.url, at });
        break;
      case "new_product":
        push(row.newProducts, { title, url: ch.url, at });
        break;
      case "new_page":
        push(row.newPages, { title, url: ch.url, at });
        break;
      case "price_change":
        // Only the prices that went away / appeared, not every price on the page.
        push(row.prices, {
          url: ch.url,
          before: priceList(ch.removed, ch.oldValue),
          after: priceList(ch.added, ch.newValue),
          at,
        });
        break;
      case "deleted_page":
        push(row.removed, { url: ch.url, text: [ch.oldValue, ch.summary].filter(Boolean).join(" — "), at });
        break;
      case "title_change":
        push(row.titles, { url: ch.url, before: ch.oldValue ?? "", after: ch.newValue ?? "", at });
        break;
      case "seo_change":
        push(row.seo, { url: ch.url, text: ch.summary, at });
        break;
    }
  }

  for (const ch of others) {
    const row = rows.get(String(ch.competitorId));
    if (!row) continue;
    (row.details ??= []).push({
      type: ch.type,
      url: ch.url,
      summary: ch.summary ?? "",
      oldValue: ch.oldValue ?? "",
      newValue: ch.newValue ?? "",
      added: ch.added ?? [],
      removed: ch.removed ?? [],
      at: ch.createdAt.toISOString(),
    });
  }

  // Topics in the titles of new content, per competitor and across the parent.
  const allTitles: string[] = [];
  for (const row of rows.values()) {
    const titles = [...row.newBlogs, ...row.newProducts, ...row.newPages].map((i) => i.title);
    allTitles.push(...titles);
    const t = buildTopicReport(titles, [], [], [], brandTokensFor(row.name, row.host));
    row.topics = [...t.phrases.slice(0, 8), ...t.words.slice(0, 8)];
  }
  const groupTopics = buildTopicReport(allTitles, [], [], [], new Set(competitors.flatMap((c) => [...brandTokensFor(c.name, c.host)])));

  const list = [...rows.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return {
    version: 1,
    group: { id: group.id ? String(group.id) : null, name: group.name },
    from: from.toISOString(),
    to: to.toISOString(),
    generatedAt: new Date().toISOString(),
    competitors: list,
    highlights: highlights(list, groupTopics.phrases.length ? groupTopics.phrases : groupTopics.words),
    topics: [...groupTopics.phrases.slice(0, 12), ...groupTopics.words.slice(0, 12)],
  };
}

/** Plain-language takeaways (no AI: just the biggest numbers). */
function highlights(list: CompetitorReport[], topics: Term[]): string[] {
  const out: string[] = [];
  const n = (c: CompetitorReport, t: ChangeType) => c.counts[t] ?? 0;
  const newContent = (c: CompetitorReport) => n(c, "new_blog") + n(c, "new_product") + n(c, "new_page");
  const top = (score: (c: CompetitorReport) => number) => [...list].sort((a, b) => score(b) - score(a))[0];

  if (list.every((c) => c.total === 0)) return ["No changes were recorded for these competitors in this period."];

  const content = top(newContent);
  if (content && newContent(content) > 0) {
    out.push(
      `${content.name} added the most new content: ${[
        n(content, "new_blog") && plural(n(content, "new_blog"), "blog"),
        n(content, "new_product") && plural(n(content, "new_product"), "product/package"),
        n(content, "new_page") && plural(n(content, "new_page"), "other page"),
      ]
        .filter(Boolean)
        .join(", ")}.`,
    );
  }
  const blogs = top((c) => n(c, "new_blog"));
  if (blogs && blogs !== content && n(blogs, "new_blog") > 0) out.push(`${blogs.name} published the most blogs (${n(blogs, "new_blog")}).`);
  const products = list.filter((c) => n(c, "new_product") > 0);
  if (products.length) out.push(`New products/packages: ${products.map((c) => `${c.name} (${n(c, "new_product")})`).join(", ")}.`);
  const prices = list.filter((c) => n(c, "price_change") > 0);
  out.push(
    prices.length
      ? `Prices changed at ${prices.map((c) => `${c.name} (${plural(n(c, "price_change"), "page")})`).join(", ")}.`
      : "No competitor changed its prices.",
  );
  const removed = list.filter((c) => n(c, "deleted_page") > 0);
  if (removed.length) out.push(`Pages removed: ${removed.map((c) => `${c.name} (${n(c, "deleted_page")})`).join(", ")}.`);
  const seo = top((c) => n(c, "title_change") + n(c, "meta_change") + n(c, "seo_change"));
  const seoN = seo ? n(seo, "title_change") + n(seo, "meta_change") + n(seo, "seo_change") : 0;
  if (seoN > 0) out.push(`${seo.name} worked most on SEO: ${plural(seoN, "title/meta/SEO change")}.`);
  const quiet = list.filter((c) => c.total === 0);
  if (quiet.length) out.push(`No activity from ${quiet.map((c) => c.name).join(", ")}.`);
  if (topics.length) out.push(`Common topics in new content: ${topics.slice(0, 6).map((t) => `${t.term} (${t.count})`).join(", ")}.`);
  return out;
}

/** Report for a parent by id (`"none"` = competitors without a parent); null when the parent doesn't exist. */
export async function buildGroupReport(groupParam: string, from: Date, to: Date, maxPerList?: number): Promise<Report | null> {
  if (groupParam === "none") return buildReport({ id: null, name: "Without a parent" }, from, to, maxPerList);
  const group = await Group.findById(groupParam).select("name").lean();
  return group ? buildReport({ id: group._id, name: group.name }, from, to, maxPerList) : null;
}
