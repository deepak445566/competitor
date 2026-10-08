function int(value: string | undefined, fallback: number, min = 0): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

export const config = {
  mongodbUri:
    process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017/competitor-monitor",

  adminUsername: process.env.ADMIN_USERNAME ?? "",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  sessionSecret: process.env.SESSION_SECRET ?? "",

  /** Max pages crawled per competitor per check. */
  crawlMaxPages: int(process.env.CRAWL_MAX_PAGES, 50, 1),
  /** Parallel page loads per crawl (forced to 1 when robots.txt sets Crawl-delay). */
  crawlConcurrency: int(process.env.CRAWL_CONCURRENCY, 3, 1),
  /** Per-page navigation timeout. */
  crawlTimeoutMs: int(process.env.CRAWL_TIMEOUT_MS, 30_000, 1000),
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
