import type * as cheerio from "cheerio";
import { crawlerUserAgent } from "./user-agent";
import { normalizeUrl } from "./url";

export interface SeoSignals {
  /** Combined, sorted directives from <meta name="robots"> and <meta name="googlebot">, e.g. "noindex, nofollow". */
  robotsMeta: string;
  /** Absolute canonical URL ("" when the page declares none). */
  canonical: string;
  /** Sorted "lang → url" pairs from <link rel="alternate" hreflang>. */
  hreflang: string[];
}

export function extractSeo($: cheerio.CheerioAPI, base: string): SeoSignals {
  const directives = new Set<string>();
  $('meta[name="robots" i], meta[name="googlebot" i]').each((_, el) => {
    for (const d of ($(el).attr("content") ?? "").toLowerCase().split(",")) {
      const value = d.trim();
      if (value) directives.add(value);
    }
  });

  const canonicalHref = $('link[rel="canonical" i]').first().attr("href");
  const hreflang = new Set<string>();
  $('link[rel="alternate" i][hreflang]').each((_, el) => {
    const url = normalizeUrl($(el).attr("href") ?? "", base);
    if (url) hreflang.add(`${($(el).attr("hreflang") ?? "").toLowerCase()} → ${url}`);
  });

  return {
    robotsMeta: [...directives].sort().join(", "),
    canonical: (canonicalHref && normalizeUrl(canonicalHref, base)) || "",
    hreflang: [...hreflang].sort(),
  };
}

/**
 * robots.txt text for change tracking: string = contents, null = the site has none (404/HTML),
 * undefined = couldn't check (network error / 5xx), so a flaky request is never reported as "removed".
 */
export async function fetchRobotsTxt(origin: string): Promise<string | null | undefined> {
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "user-agent": crawlerUserAgent(), "cache-control": "no-cache" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status >= 500 || res.status === 429) return undefined;
    if (res.status !== 200) return null;
    const text = await res.text();
    return /<html/i.test(text.slice(0, 500)) ? null : text.replace(/\r\n/g, "\n").trim();
  } catch {
    return undefined;
  }
}
