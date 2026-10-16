import "server-only";
import type { Browser, BrowserContext, Page } from "playwright";
import { config } from "../config";
import { crawlerUserAgent } from "./user-agent";

export interface FetchResult {
  status: number;
  finalUrl: string;
  /** Present only for successful HTML responses. */
  html: string | null;
  error: string | null;
  /** From a Retry-After header on 429/503, capped at 60s. */
  retryAfterMs?: number;
}

/** Retry-After is either seconds or an HTTP date. */
function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 60_000) : undefined;
}

/** Interstitial "checking your browser" pages (Cloudflare, Sucuri, DDoS-Guard…). */
const BOT_CHECK_TITLE = /just a moment|attention required|checking your browser|please wait|ddos-guard|security check/i;
const BOT_CHECK_STATUS = new Set([403, 429, 503]);

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
export function createHttpFetcher(timeoutMs = config.crawlTimeoutMs): Fetcher {
  const headers = { ...BROWSER_HEADERS, "user-agent": crawlerUserAgent() };
  return {
    engine: "fetch",
    async fetchPage(url) {
      try {
        const res = await fetch(url, {
          headers: { ...headers, accept: "text/html,application/xhtml+xml" },
          redirect: "follow",
          signal: AbortSignal.timeout(timeoutMs),
        });
        const ok = res.status < 400 && isHtml(res.headers.get("content-type") ?? undefined);
        return {
          status: res.status,
          finalUrl: res.url || url,
          html: ok ? await res.text() : null,
          error: ok ? null : res.status >= 400 ? `HTTP ${res.status}` : "Not an HTML page",
          retryAfterMs: parseRetryAfter(res.headers.get("retry-after")),
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

async function launchChromium(http1 = false): Promise<Browser> {
  const { chromium } = await import("playwright");
  const args = http1 ? ["--disable-http2"] : [];
  try {
    // Full Chromium ("new headless") behaves like a normal browser. The lighter
    // headless shell is rejected by bot-protected sites (e.g. ERR_HTTP2_PROTOCOL_ERROR on Akamai).
    return await chromium.launch({ headless: true, channel: "chromium", args });
  } catch {
    return await chromium.launch({ headless: true, args });
  }
}

/** Chromium is swapped for a fresh one after this many pages, so memory doesn't build up on big crawls. */
const PAGES_PER_BROWSER = 200;

const isClosedError = (err: unknown) => /has been closed|browser.*disconnected|Target closed/i.test(message(err));

interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  /** Pages loaded / currently open in this browser. */
  used: number;
  open: number;
  retired: boolean;
}

async function openSession(http1: boolean): Promise<BrowserSession> {
  const browser = await launchChromium(http1);
  const context = await browser.newContext({
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
  return { browser, context, used: 0, open: 0, retired: false };
}

async function closeSession(s: BrowserSession) {
  await s.context.close().catch(() => {});
  await s.browser.close().catch(() => {});
}

/**
 * Headless Chromium via Playwright, so JavaScript-rendered sites are captured correctly.
 * If Chromium crashes or is closed mid-crawl, a new one is launched instead of failing the whole check.
 */
export async function createPlaywrightFetcher(): Promise<Fetcher> {
  // Akamai sometimes cuts HTTP/2 connections from headless Chromium; HTTP/1.1 usually gets through.
  let http1 = false;
  let current: Promise<BrowserSession> | null = openSession(http1);
  await current; // fail fast here when Chromium isn't installed
  let closed = false;

  const retire = (s: BrowserSession) => {
    s.retired = true;
    if (s.open === 0) void closeSession(s);
  };
  const getSession = async (): Promise<BrowserSession> => {
    if (closed) throw new Error("Fetcher closed");
    const pending = (current ??= openSession(http1));
    let s: BrowserSession;
    try {
      s = await pending;
    } catch (err) {
      if (current === pending) current = null; // let the next page try launching again
      throw err;
    }
    if (s.browser.isConnected() && !s.retired && s.used < PAGES_PER_BROWSER) return s;
    if (current === pending) {
      current = null;
      retire(s);
    }
    return getSession();
  };

  /** Run `fn` on a fresh tab; on a dead browser, relaunch and try once more. */
  const withPage = async <T>(fn: (page: Page) => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const s = await getSession();
      s.used++;
      s.open++;
      let page: Page | null = null;
      try {
        page = await s.context.newPage();
        return await fn(page);
      } catch (err) {
        const dead = isClosedError(err) || !s.browser.isConnected();
        if (dead && !s.retired) {
          console.warn(`[crawler] Chromium closed unexpectedly (${message(err)}), relaunching`);
          s.retired = true;
        }
        if (dead && attempt === 0) continue;
        throw err;
      } finally {
        await page?.close().catch(() => {});
        s.open--;
        if (s.retired && s.open === 0) void closeSession(s);
      }
    }
  };

  const load = async (url: string): Promise<FetchResult> => {
    try {
      return await withPage(async (page) => {
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: config.crawlTimeoutMs });
        if (!response) return { status: 0, finalUrl: url, html: null, error: "No response" };
        let status = response.status();
        if (BOT_CHECK_STATUS.has(status) && BOT_CHECK_TITLE.test(await page.title().catch(() => ""))) {
          // A "checking your browser" interstitial: let the browser finish it, as a normal visitor's would.
          // (No CAPTCHA solving — if it needs a human, the page stays blocked.)
          const passed = await page
            .waitForFunction((re) => !new RegExp(re, "i").test(document.title), BOT_CHECK_TITLE.source, {
              timeout: 20_000,
            })
            .then(() => true, () => false);
          if (passed) {
            await page.waitForLoadState("domcontentloaded").catch(() => {});
            status = 200;
          }
        }
        if (status >= 400) {
          return {
            status,
            finalUrl: page.url(),
            html: null,
            error: `HTTP ${status}${BOT_CHECK_STATUS.has(status) ? " (blocked or rate-limited)" : ""}`,
            retryAfterMs: parseRetryAfter(response.headers()["retry-after"]),
          };
        }
        if (!isHtml(response.headers()["content-type"])) {
          return { status, finalUrl: page.url(), html: null, error: "Not an HTML page" };
        }
        // Give client-rendered content a moment to settle, without waiting forever on chatty pages.
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        return { status, finalUrl: page.url(), html: await page.content(), error: null };
      });
    } catch (err) {
      return { status: 0, finalUrl: url, html: null, error: message(err) };
    }
  };

  return {
    engine: "playwright",
    async fetchPage(url) {
      const first = await load(url);
      // Network-level failures (resets, timeouts) are often transient: retry once.
      if (first.status !== 0) return first;
      if (!http1 && first.error?.includes("ERR_HTTP2_PROTOCOL_ERROR")) {
        http1 = true;
        console.warn(`[crawler] ${new URL(url).hostname} rejected HTTP/2, switching Chromium to HTTP/1.1`);
        const s = await current?.catch(() => null);
        if (s) s.retired = true; // next page opens a fresh browser with HTTP/2 disabled
      }
      await sleep(2000);
      return load(url);
    },
    async fetchText(url) {
      try {
        return await withPage(async (page) => {
          const response = await page.goto(url, { timeout: 30_000 });
          if (!response) return null;
          return { status: response.status(), body: response.ok() ? await response.text() : "" };
        });
      } catch {
        return null;
      }
    },
    async close() {
      closed = true;
      const s = await current?.catch(() => null);
      current = null;
      if (s) await closeSession(s);
    },
  };
}

/** Too little readable text: the page is probably built by JavaScript in the browser. */
const MIN_WORDS = 80;
function looksLikeJsShell(html: string): boolean {
  const body = html.match(/<body[\s\S]*<\/body>/i)?.[0] ?? html;
  const text = body
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ");
  return text.split(/\s+/).filter((w) => w.length > 1).length < MIN_WORDS;
}

/** Plain HTTP gets this long before Chromium takes over (bot-protected sites often just hang plain requests). */
const HTTP_FIRST_TIMEOUT_MS = 15_000;
/** After this many pages in a row where only Chromium worked, skip plain HTTP for the rest of the crawl. */
const BROWSER_FIRST_AFTER = 3;
/** URL paths that are clearly files, not pages. */
const FILE_PATH = /.(?!html?$|php$|aspx?$|jsp$)[a-z0-9]{1,5}$/i;

/**
 * Plain HTTP first (fast: most sites send their full HTML), and headless Chromium only for pages
 * that need it — JavaScript-built pages, or requests the site blocks. Chromium starts on first need.
 * Sites that block plain HTTP on most pages (Akamai: MakeMyTrip…) switch to Chromium-first.
 */
function createHybridFetcher(onBrowserError: (warning: string) => void): Fetcher {
  const http = createHttpFetcher(Math.min(HTTP_FIRST_TIMEOUT_MS, config.crawlTimeoutMs));
  let browserOnlyInARow = 0;
  let browserFirst = false;
  let browser: Promise<Fetcher | null> | null = null;
  let usedBrowser = false;
  const getBrowser = () =>
    (browser ??= createPlaywrightFetcher().catch((err) => {
      onBrowserError(`Playwright unavailable, used plain HTTP only (${message(err)}). Run "npx playwright install chromium".`);
      return null;
    }));

  return {
    get engine() {
      return usedBrowser ? "playwright" : "fetch";
    },
    async fetchPage(url) {
      if (browserFirst) {
        const b = await getBrowser();
        if (b) {
          const rendered = await b.fetchPage(url);
          if (rendered.html || rendered.status !== 0) return rendered;
          // Browser couldn't reach it at all: plain HTTP is still worth a try.
          const res = await http.fetchPage(url);
          return res.html ? res : rendered;
        }
      }
      const res = await http.fetchPage(url);
      const needsBrowser =
        BOT_CHECK_STATUS.has(res.status) ||
        res.status === 0 ||
        (res.html !== null && looksLikeJsShell(res.html)) ||
        // Bot protection sometimes answers plain requests with a stub (e.g. JSON "200-OK") instead of the page.
        (res.html === null && res.status < 400 && !FILE_PATH.test(new URL(url).pathname));
      if (!needsBrowser) {
        browserOnlyInARow = 0;
        return res;
      }
      const b = await getBrowser();
      if (!b) return res;
      usedBrowser = true;
      const rendered = await b.fetchPage(url);
      const plainBlocked = !res.html || BOT_CHECK_STATUS.has(res.status);
      if (rendered.html && plainBlocked && ++browserOnlyInARow >= BROWSER_FIRST_AFTER && !browserFirst) {
        browserFirst = true;
        console.warn(`[crawler] ${new URL(url).hostname} blocks plain HTTP, using Chromium for every page`);
      }
      // Keep the plain response if the browser did no better (e.g. both blocked).
      return rendered.html || !res.html ? rendered : res;
    },
    async fetchText(url) {
      const res = await http.fetchText(url);
      if (res && !BOT_CHECK_STATUS.has(res.status)) return res;
      const b = await getBrowser();
      return (b && (await b.fetchText(url))) ?? res;
    },
    async close() {
      const b = await browser;
      await b?.close();
    },
  };
}

/**
 * Default ("playwright"): hybrid — plain HTTP, Chromium only where a page needs it.
 * CRAWLER_ENGINE=fetch: plain HTTP only.
 */
export async function createFetcher(): Promise<{ fetcher: Fetcher; warning: string | null }> {
  if (config.crawlerEngine === "fetch") return { fetcher: createHttpFetcher(), warning: null };
  const result: { fetcher: Fetcher; warning: string | null } = { fetcher: null!, warning: null };
  result.fetcher = createHybridFetcher((warning) => {
    console.warn(`[crawler] ${warning}`);
    result.warning = warning;
  });
  return result;
}
