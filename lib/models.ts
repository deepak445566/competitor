import "server-only";
import mongoose, { Schema, Types, type Model } from "mongoose";

export const CHANGE_TYPES = [
  "new_page",
  "deleted_page",
  "new_blog",
  "new_product",
  "price_change",
  "content_change",
  "title_change",
  "meta_change",
  "heading_change",
  "internal_link_added",
  "internal_link_removed",
  "image_change",
  "seo_change",
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export type PageType = "page" | "blog" | "product";
export type DiscoveryMethod = "sitemap" | "links";

// ---------- Competitor ----------

export interface CompetitorDoc {
  _id: Types.ObjectId;
  name: string;
  url: string;
  host: string;
  status: "idle" | "crawling" | "error";
  maxPages: number;
  pagesMonitored: number;
  lastCheckedAt?: Date | null;
  lastSuccessAt?: Date | null;
  lastError?: string | null;
  lastSnapshotId?: Types.ObjectId | null;
  /** RSS/Atom feeds found on the site (re-discovered daily while empty). */
  feedUrls?: string[];
  feedsDiscoveredAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const competitorSchema = new Schema<CompetitorDoc>(
  {
    name: { type: String, required: true, trim: true },
    url: { type: String, required: true },
    host: { type: String, required: true, index: true },
    status: { type: String, enum: ["idle", "crawling", "error"], default: "idle" },
    maxPages: { type: Number, default: 50 },
    pagesMonitored: { type: Number, default: 0 },
    lastCheckedAt: Date,
    lastSuccessAt: Date,
    lastError: String,
    lastSnapshotId: { type: Schema.Types.ObjectId, ref: "Snapshot" },
    feedUrls: { type: [String], default: [] },
    feedsDiscoveredAt: Date,
  },
  { timestamps: true },
);

// ---------- Snapshot (one per check) ----------

export interface SnapshotDoc {
  _id: Types.ObjectId;
  competitorId: Types.ObjectId;
  status: "running" | "completed" | "failed";
  isBaseline: boolean;
  engine: "playwright" | "fetch";
  startedAt: Date;
  finishedAt?: Date | null;
  robotsFound: boolean;
  /** Raw robots.txt at check time, to alert on rule changes. Undefined on snapshots from older versions. */
  robotsTxt?: string | null;
  sitemapUrls: string[];
  discoveryMethod: DiscoveryMethod;
  /** Every same-site URL known at check time (sitemap entries or links seen while crawling). */
  discoveredUrls: string[];
  /** Sitemap <lastmod> per URL (only URLs that have one), newest first. */
  lastmods: { url: string; at: Date }[];
  pagesCrawled: number;
  pagesFailed: number;
  changesCount: number;
  error?: string | null;
}

const snapshotSchema = new Schema<SnapshotDoc>({
  competitorId: { type: Schema.Types.ObjectId, ref: "Competitor", required: true, index: true },
  status: { type: String, enum: ["running", "completed", "failed"], default: "running" },
  isBaseline: { type: Boolean, default: false },
  engine: { type: String, enum: ["playwright", "fetch"], default: "playwright" },
  startedAt: { type: Date, default: Date.now },
  finishedAt: Date,
  robotsFound: { type: Boolean, default: false },
  robotsTxt: String,
  sitemapUrls: { type: [String], default: [] },
  discoveryMethod: { type: String, enum: ["sitemap", "links"], default: "links" },
  discoveredUrls: { type: [String], default: [] },
  lastmods: { type: [{ url: String, at: Date, _id: false }], default: [] },
  pagesCrawled: { type: Number, default: 0 },
  pagesFailed: { type: Number, default: 0 },
  changesCount: { type: Number, default: 0 },
  error: String,
});
snapshotSchema.index({ competitorId: 1, startedAt: -1 });

// ---------- Page (crawled page inside a snapshot) ----------

export interface PageDoc {
  _id: Types.ObjectId;
  snapshotId: Types.ObjectId;
  competitorId: Types.ObjectId;
  url: string;
  finalUrl: string;
  statusCode: number;
  error?: string | null;
  pageType: PageType;
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  content: string;
  wordCount: number;
  contentHash: string;
  images: string[];
  internalLinks: string[];
  externalLinks: string[];
  prices: string[];
  publishedAt?: Date | null;
  modifiedAt?: Date | null;
  sitemapLastmod?: Date | null;
  // SEO signals. No schema defaults on purpose: undefined = crawled by an older version, so not compared.
  robotsMeta?: string;
  canonical?: string;
  hreflang?: string[];
  crawledAt: Date;
}

const pageSchema = new Schema<PageDoc>({
  snapshotId: { type: Schema.Types.ObjectId, ref: "Snapshot", required: true },
  competitorId: { type: Schema.Types.ObjectId, ref: "Competitor", required: true },
  url: { type: String, required: true },
  finalUrl: String,
  statusCode: { type: Number, default: 0 },
  error: String,
  pageType: { type: String, enum: ["page", "blog", "product"], default: "page" },
  title: { type: String, default: "" },
  metaDescription: { type: String, default: "" },
  h1: { type: [String], default: [] },
  h2: { type: [String], default: [] },
  content: { type: String, default: "" },
  wordCount: { type: Number, default: 0 },
  contentHash: { type: String, default: "" },
  images: { type: [String], default: [] },
  internalLinks: { type: [String], default: [] },
  externalLinks: { type: [String], default: [] },
  prices: { type: [String], default: [] },
  publishedAt: Date,
  modifiedAt: Date,
  sitemapLastmod: Date,
  robotsMeta: String,
  canonical: String,
  hreflang: { type: [String], default: undefined },
  crawledAt: { type: Date, default: Date.now },
});
pageSchema.index({ snapshotId: 1, url: 1 });
pageSchema.index({ competitorId: 1 });

// ---------- Change (change history) ----------

export interface ChangeDoc {
  _id: Types.ObjectId;
  competitorId: Types.ObjectId;
  snapshotId: Types.ObjectId;
  type: ChangeType;
  url: string;
  summary: string;
  oldValue?: string | null;
  newValue?: string | null;
  added: string[];
  removed: string[];
  /** Weight used in totals, e.g. number of links added. */
  count: number;
  createdAt: Date;
}

const changeSchema = new Schema<ChangeDoc>({
  competitorId: { type: Schema.Types.ObjectId, ref: "Competitor", required: true },
  snapshotId: { type: Schema.Types.ObjectId, ref: "Snapshot", required: true },
  type: { type: String, enum: CHANGE_TYPES, required: true },
  url: { type: String, required: true },
  summary: { type: String, default: "" },
  oldValue: String,
  newValue: String,
  added: { type: [String], default: [] },
  removed: { type: [String], default: [] },
  count: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
});
changeSchema.index({ competitorId: 1, createdAt: -1 });
changeSchema.index({ createdAt: -1, type: 1 });
changeSchema.index({ snapshotId: 1 });

// ---------- Notification ----------

export interface NotificationItem {
  type: ChangeType;
  url: string;
  text: string;
}

export interface NotificationDoc {
  _id: Types.ObjectId;
  competitorId: Types.ObjectId;
  competitorName: string;
  snapshotId: Types.ObjectId;
  title: string;
  lines: string[];
  /** The individual uploads/changes behind the summary lines (capped). */
  items: NotificationItem[];
  read: boolean;
  emailStatus: "sent" | "skipped" | "failed";
  emailError?: string | null;
  createdAt: Date;
}

const notificationSchema = new Schema<NotificationDoc>({
  competitorId: { type: Schema.Types.ObjectId, ref: "Competitor", required: true },
  competitorName: { type: String, required: true },
  snapshotId: { type: Schema.Types.ObjectId, ref: "Snapshot", required: true },
  title: { type: String, required: true },
  lines: { type: [String], default: [] },
  items: { type: [{ type: { type: String }, url: String, text: String, _id: false }], default: [] },
  read: { type: Boolean, default: false },
  emailStatus: { type: String, enum: ["sent", "skipped", "failed"], default: "skipped" },
  emailError: String,
  createdAt: { type: Date, default: Date.now },
});
notificationSchema.index({ read: 1, createdAt: -1 });

function model<T>(name: string, schema: Schema<T>): Model<T> {
  // In dev, hot reload re-runs this file: re-register so schema edits apply without a restart.
  if (mongoose.models[name]) {
    if (process.env.NODE_ENV === "production") return mongoose.models[name] as Model<T>;
    mongoose.deleteModel(name);
  }
  return mongoose.model<T>(name, schema);
}

export const Competitor = model("Competitor", competitorSchema);
export const Snapshot = model("Snapshot", snapshotSchema);
export const Page = model("Page", pageSchema);
export const Change = model("Change", changeSchema);
export const Notification = model("Notification", notificationSchema);

// ---------- FeedItem (posts seen in a competitor's RSS/Atom feed) ----------

export interface FeedItemDoc {
  _id: Types.ObjectId;
  competitorId: Types.ObjectId;
  feedUrl: string;
  /** guid, or the link when the feed has no guid. */
  key: string;
  url: string;
  title: string;
  categories: string[];
  publishedAt?: Date | null;
  firstSeenAt: Date;
}

const feedItemSchema = new Schema<FeedItemDoc>({
  competitorId: { type: Schema.Types.ObjectId, ref: "Competitor", required: true },
  feedUrl: { type: String, required: true },
  key: { type: String, required: true },
  url: { type: String, required: true },
  title: { type: String, default: "" },
  categories: { type: [String], default: [] },
  publishedAt: Date,
  firstSeenAt: { type: Date, default: Date.now },
});
feedItemSchema.index({ competitorId: 1, key: 1 }, { unique: true });
feedItemSchema.index({ competitorId: 1, publishedAt: -1 });

export const FeedItem = model("FeedItem", feedItemSchema);
