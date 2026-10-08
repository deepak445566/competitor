import "server-only";
import type { Browser, BrowserContext } from "playwright";
import { config } from "../config";
import { crawlerUserAgent } from "./user-agent";

export interface FetchResult {
  status: number;
  finalUrl: string;
  /** Present only for successful HTML responses. */
  html: string | null;
  error: string | null;
}

export interface Fetcher {
  engine: "playwright" | "fetch";
  fetchPage(url: string): Promise<FetchResult>;
  /** Raw response body (robots.txt / sitemaps) through this fetcher's network stack. */
  fetchText(url: string): Promise<{ status: number; body: string } | null>;
  close(): Promise<void>;
}

const isHtml = (contentType: string | undefined) =>
  !contentType || /text\/html|application\/xhtml\+xml/i.test(contentType);

const message = (err: unknown) => (err instanceof Error ? err.message : String(err)).split("\n")[0].slice(0, 300);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// no-cache asks CDNs in front of the competitor's site to revalidate, so we never read a stale copy.
const BROWSER_HEADERS = { "accept-language": "en-IN,en-US;q=0.9,en;q=0.8", "cache-control": "no-cache", pragma: "no-cache" };

/** Plain HTTP fetch – no JavaScript rendering. Used as fallback when Chromium is unavailable. */
export function createHttpFetcher(): Fetcher {
  const headers = { ...BROWSER_HEADERS, "user-agent": crawlerUserAgent() };
  return {
    engine: "fetch",
    async fetchPage(url) {
      try {
        const res = await fetch(url, {
          headers: { ...headers, accept: "text/html,application/xhtml+xml" },
          redirect: "follow",
          signal: AbortSignal.timeout(config.crawlTimeoutMs),
        });
        const ok = res.status < 400 && isHtml(res.headers.get("content-type") ?? undefined);
        return {
          status: res.status,
          finalUrl: res.url || url,
          html: ok ? await res.text() : null,
          error: ok ? null : res.status >= 400 ? `HTTP ${res.status}` : "Not an HTML page",
        };
      } catch (err) {
        return { status: 0, finalUrl: url, html: null, error: message(err) };
      }
    },
    async fetchText(url) {
      try {
        const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(20_000) });
        return { status: res.status, body: res.ok ? await res.text() : "" };
      } catch {
        return null;
      }
    },
    async close() {},
  };
}

async function launchChromium(): Promise<Browser> {
  const { chromium } = await import("playwright");
  try {
    // Full Chromium ("new headless") behaves like a normal browser. The lighter
    // headless shell is rejected by bot-protected sites (e.g. ERR_HTTP2_PROTOCOL_ERROR on Akamai).
    return await chromium.launch({ headless: true, channel: "chromium" });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

/** Headless Chromium via Playwright, so JavaScript-rendered sites are captured correctly. */
export async function createPlaywrightFetcher(): Promise<Fetcher> {
  const browser = await launchChromium();
  const context: BrowserContext = await browser.newContext({
    userAgent: crawlerUserAgent(browser.version()),
    locale: "en-IN",
    viewport: { width: 1366, height: 900 },
    extraHTTPHeaders: BROWSER_HEADERS,
    ignoreHTTPSErrors: true,
  });
  // We only need the DOM; skip heavy assets (img src attributes are still in the HTML).
  await context.route("**/*", (route) =>
    ["image", "media", "font"].includes(route.request().resourceType()) ? route.abort() : route.continue(),
  );

  const load = async (url: string): Promise<FetchResult> => {
    const page = await context.newPage();
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.crawlTimeoutMs });
      if (!response) return { status: 0, finalUrl: url, html: null, error: "No response" };
      const status = response.status();
      if (status >= 400) return { status, finalUrl: page.url(), html: null, error: `HTTP ${status}` };
      if (!isHtml(response.headers()["content-type"])) {
        return { status, finalUrl: page.url(), html: null, error: "Not an HTML page" };
      }
      // Give client-rendered content a moment to settle, without waiting forever on chatty pages.
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      return { status, finalUrl: page.url(), html: await page.content(), error: null };
    } catch (err) {
      return { status: 0, finalUrl: url, html: null, error: message(err) };
    } finally {
      await page.close().catch(() => {});
    }
  };

  return {
    engine: "playwright",
    async fetchPage(url) {
      const first = await load(url);
      // Network-level failures (resets, timeouts) are often transient: retry once.
      if (first.status !== 0) return first;
      await sleep(2000);
      return load(url);
    },
    async fetchText(url) {
      const page = await context.newPage();
      try {
        const response = await page.goto(url, { timeout: 30_000 });
        if (!response) return null;
        return { status: response.status(), body: response.ok() ? await response.text() : "" };
      } catch {
        return null;
      } finally {
        await page.close().catch(() => {});
      }
    },
    async close() {
      await context.close().catch(() => {});
      await browser.close().catch(() => {});
    },
  };
}

/** Playwright by default; falls back to plain HTTP if Chromium can't launch. */
export async function createFetcher(): Promise<{ fetcher: Fetcher; warning: string | null }> {
  if (config.crawlerEngine === "fetch") return { fetcher: createHttpFetcher(), warning: null };
  try {
    return { fetcher: await createPlaywrightFetcher(), warning: null };
  } catch (err) {
    const warning = `Playwright unavailable, used plain HTTP instead (${message(err)}). Run "npx playwright install chromium".`;
    console.warn(`[crawler] ${warning}`);
    return { fetcher: createHttpFetcher(), warning };
  }
}
