const SKIP_EXTENSIONS =
  /\.(?:jpe?g|png|gif|webp|avif|svg|ico|bmp|tiff?|pdf|docx?|xlsx?|pptx?|csv|zip|rar|7z|gz|tar|mp[34]|m4a|wav|avi|mov|wmv|webm|ogg|woff2?|ttf|eot|otf|css|js|mjs|json|xml|txt|rss|atom|apk|exe|dmg)$/i;

const TRACKING_PARAMS = /^(?:utm_\w+|gclid|fbclid|msclkid|mc_cid|mc_eid|_ga|ref|srsltid)$/i;

/** Strip `www.` so www and apex count as the same site. */
export function siteHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

/**
 * Canonical form used as the identity of a page across snapshots:
 * no hash, no tracking params, sorted query, no trailing slash (except root).
 */
export function normalizeUrl(input: string, base?: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim(), base);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (
    (url.protocol === "http:" && url.port === "80") ||
    (url.protocol === "https:" && url.port === "443")
  ) {
    url.port = "";
  }
  const params = [...url.searchParams.entries()]
    .filter(([key]) => !TRACKING_PARAMS.test(key))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = new URLSearchParams(params).toString();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString();
}

export function isSameSite(url: string, rootHost: string): boolean {
  try {
    return siteHost(new URL(url).hostname) === siteHost(rootHost);
  } catch {
    return false;
  }
}

/** Looks like an HTML page we should load (not an asset/download). */
export function isCrawlableUrl(url: string): boolean {
  try {
    const { pathname } = new URL(url);
    return !SKIP_EXTENSIONS.test(pathname) && !/\/(?:wp-json|feed|cdn-cgi)(?:\/|$)/i.test(pathname);
  } catch {
    return false;
  }
}

/** Validate and normalize a competitor URL typed by the admin. */
export function parseSiteUrl(input: string): URL | null {
  const raw = input.trim();
  if (!raw) return null;
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  const normalized = normalizeUrl(withScheme);
  if (!normalized) return null;
  const url = new URL(normalized);
  if (!url.hostname.includes(".") && url.hostname !== "localhost") return null;
  return url;
}
