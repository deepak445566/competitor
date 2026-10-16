function int(value: string | undefined, fallback: number, min = 0): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

/** Vercel and similar: each request is a function killed after maxDuration (300s), with no browser installed. */
const serverless = !!process.env.VERCEL;

export const config = {
  serverless,

  mongodbUri:
    process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/competitor-monitor",

  adminUsername: process.env.ADMIN_USERNAME ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "",

  /**
   * Full checks running at the same time in this server; the rest wait their turn.
   * Higher on serverless: there is no browser to overload (plain HTTP only), and a check
   * waiting in line still burns its function's 300s, so a long queue gets checks killed.
   */
  maxConcurrentChecks: int(process.env.MAX_CONCURRENT_CHECKS, serverless ? 20 : 2, 1),
  /** Max pages crawled per competitor per check. */
  crawlMaxPages: int(process.env.CRAWL_MAX_PAGES, 50, 1),
  /** Parallel page loads per crawl (forced to 1 when robots.txt sets Crawl-delay). */
  crawlConcurrency: int(process.env.CRAWL_CONCURRENCY, 3, 1),
  /** Per-page navigation timeout. */
  crawlTimeoutMs: int(process.env.CRAWL_TIMEOUT_MS, 30_000, 1000),
  /**
   * Hard stop for one whole crawl; pages fetched so far are still saved and compared.
   * Shorter on Vercel, where a function is killed at maxDuration (300s) — stop early and save instead.
   * There it counts from the moment the check starts (time waiting in line and reading sitemaps
   * included), leaving room for the last page load and for saving before the function is killed.
   */
  crawlTimeLimitMs: int(process.env.CRAWL_TIME_LIMIT_SECONDS, serverless ? 220 : 1200, 30) * 1000,
  crawlerEngine: (process.env.CRAWLER_ENGINE === "fetch" ? "fetch" : "playwright") as
    | "playwright"
    | "fetch",
  /** Empty = desktop Chrome user agent (see lib/crawler/user-agent.ts). */
  userAgent: process.env.CRAWLER_USER_AGENT ?? "",

  /** Automatic re-check interval. 0 disables the built-in scheduler. */
  checkIntervalHours: int(process.env.CHECK_INTERVAL_HOURS, 24),
  /** Quick sitemap check for brand-new blogs/products between full checks. 0 disables. */
  watchIntervalMinutes: int(process.env.WATCH_INTERVAL_MINUTES, 30),
  /** How many snapshots keep their full page data (older ones keep only metadata). */
  snapshotRetention: int(process.env.SNAPSHOT_RETENTION, 3, 2),

  /**
   * Every this many days, changes/notifications older than this many days are written to CSV files
   * in ARCHIVE_DIR and then deleted from MongoDB, so the database doesn't fill up. 0 disables.
   */
  retentionDays: int(process.env.RETENTION_DAYS, 7),
  /** Folder for the CSV archives (relative to the app folder). Must be a lasting disk, not serverless /tmp. */
  archiveDir: process.env.ARCHIVE_DIR || "archives",

  cronSecret: process.env.CRON_SECRET ?? "",
  timeZone: process.env.APP_TIMEZONE ?? "Asia/Kolkata",
  appUrl: process.env.APP_URL ?? "http://localhost:3000",

  smtp: {
    host: process.env.SMTP_HOST ?? "",
    port: int(process.env.SMTP_PORT, 587, 1),
    user: process.env.SMTP_USER ?? "",
    pass: process.env.SMTP_PASS ?? "",
    from: process.env.EMAIL_FROM ?? process.env.SMTP_USER ?? "",
  },
  notifyEmail: process.env.NOTIFY_EMAIL ?? "",
};
