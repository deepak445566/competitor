import type { ChangeType, DiscoveryMethod, PageType } from "./models";
import { classifyByUrl, normalizePrice } from "./crawler/extract";
import { formatDate } from "./format";
import { siteHost } from "./crawler/url";

/** Fields of a crawled page that the comparison needs (matches PageDoc and CrawledPage). */
export interface ComparablePage {
  url: string;
  finalUrl: string;
  statusCode: number;
  pageType?: PageType;
  title?: string;
  metaDescription?: string;
  h1?: string[];
  h2?: string[];
  content?: string;
  wordCount?: number;
  contentHash?: string;
  images?: string[];
  internalLinks?: string[];
  prices?: string[];
  publishedAt?: Date | null;
  robotsMeta?: string;
  canonical?: string;
  hreflang?: string[];
}

export interface CrawlState {
  method: DiscoveryMethod;
  discoveredUrls: string[];
  pages: ComparablePage[];
}

export interface ChangeDraft {
  type: ChangeType;
  url: string;
  summary: string;
  oldValue?: string;
  newValue?: string;
  added?: string[];
  removed?: string[];
  count?: number;
}

const MAX_PER_TYPE = 300;
const MAX_LIST = 20;

const hasContent = (p: ComparablePage) => p.statusCode > 0 && p.statusCode < 400 && !!p.contentHash;
/** Identity ignoring protocol and www, used to spot redirects to a different page. */
const pageKey = (url: string) => {
  const u = new URL(url);
  return `${siteHost(u.hostname)}${u.pathname}${u.search}`;
};
const redirectsAway = (p: ComparablePage) => pageKey(p.finalUrl || p.url) !== pageKey(p.url);
const truncate = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function setDiff(before: string[] = [], after: string[] = []) {
  const a = new Set(before);
  const b = new Set(after);
  return {
    added: [...b].filter((x) => !a.has(x)),
    removed: [...a].filter((x) => !b.has(x)),
  };
}

function newPageType(type: PageType | undefined): ChangeType {
  return type === "blog" ? "new_blog" : type === "product" ? "new_product" : "new_page";
}

/** "New Blog / New Product / New Page" change for a URL, with title and publish date when crawled. */
export function newPageChange(url: string, page?: ComparablePage): ChangeDraft {
  return {
    type: newPageType(page?.pageType ?? classifyByUrl(url)),
    url,
    summary: [
      page?.title || "Discovered (not crawled yet)",
      page?.publishedAt ? `published ${formatDate(page.publishedAt)}` : "",
    ]
      .filter(Boolean)
      .join(" · "),
    newValue: page?.title,
  };
}

/**
 * Compare the previous snapshot with the new crawl. Pure function: no I/O.
 * Deletions are only reported when confirmed (404/410 or redirect elsewhere),
 * so pages skipped because of the page limit never show up as "deleted".
 */
export function detectChanges(prev: CrawlState, curr: CrawlState): ChangeDraft[] {
  const changes: ChangeDraft[] = [];
  const prevByUrl = new Map(prev.pages.map((p) => [p.url, p]));
  const currByUrl = new Map(curr.pages.map((p) => [p.url, p]));
  const prevKnown = new Set([...prev.discoveredUrls, ...prev.pages.map((p) => p.url)]);
  const prevKnownKeys = new Set([...prevKnown].map(pageKey));

  // ---- New pages (blogs / products classified separately) ----
  // When discovery switched between sitemap and link-following, the URL sets aren't comparable.
  if (prev.method === curr.method) {
    const candidates = new Set([...curr.discoveredUrls, ...curr.pages.filter(hasContent).map((p) => p.url)]);
    for (const url of candidates) {
      if (prevKnown.has(url)) continue;
      const page = currByUrl.get(url);
      if (page && (!hasContent(page) || (redirectsAway(page) && prevKnownKeys.has(pageKey(page.finalUrl))))) {
        continue; // broken link, or just an alias of a page we already know
      }
      changes.push(newPageChange(url, page));
    }
  }

  // ---- Deleted pages (confirmed) ----
  for (const page of curr.pages) {
    if (!prevKnown.has(page.url)) continue;
    const before = prevByUrl.get(page.url);
    if (before && !hasContent(before)) continue; // was already broken
    if (before && redirectsAway(before)) continue; // was already a redirect
    if (page.statusCode === 404 || page.statusCode === 410) {
      changes.push({ type: "deleted_page", url: page.url, summary: `Returns HTTP ${page.statusCode}`, oldValue: before?.title });
    } else if (hasContent(page) && redirectsAway(page)) {
      changes.push({
        type: "deleted_page",
        url: page.url,
        summary: `Now redirects to ${page.finalUrl}`,
        oldValue: before?.title,
        newValue: page.finalUrl,
      });
    }
  }

  // ---- Changes on pages present in both crawls ----
  const linkAdded = new Map<string, string[]>(); // link -> pages it appeared on
  const linkRemoved = new Map<string, string[]>();

  for (const after of curr.pages) {
    const before = prevByUrl.get(after.url);
    if (!before || !hasContent(before) || !hasContent(after) || redirectsAway(after)) continue;
    const url = after.url;

    if ((before.title ?? "") !== (after.title ?? "")) {
      changes.push({ type: "title_change", url, summary: `“${truncate(before.title ?? "", 80)}” → “${truncate(after.title ?? "", 80)}”`, oldValue: before.title, newValue: after.title });
    }
    if ((before.metaDescription ?? "") !== (after.metaDescription ?? "")) {
      changes.push({ type: "meta_change", url, summary: "Meta description updated", oldValue: before.metaDescription, newValue: after.metaDescription });
    }

    const headings = setDiff(
      [...(before.h1 ?? []).map((h) => `H1: ${h}`), ...(before.h2 ?? []).map((h) => `H2: ${h}`)],
      [...(after.h1 ?? []).map((h) => `H1: ${h}`), ...(after.h2 ?? []).map((h) => `H2: ${h}`)],
    );
    if (headings.added.length || headings.removed.length) {
      changes.push({
        type: "heading_change",
        url,
        summary: `${headings.added.length} added, ${headings.removed.length} removed`,
        added: headings.added.slice(0, MAX_LIST),
        removed: headings.removed.slice(0, MAX_LIST),
      });
    }

    // Re-normalize stored prices so snapshots saved by older versions compare cleanly.
    const beforePrices = [...new Set((before.prices ?? []).map(normalizePrice).filter((p): p is string => !!p))].sort();
    const prices = setDiff(beforePrices, after.prices);
    if (prices.added.length || prices.removed.length) {
      changes.push({
        type: "price_change",
        url,
        summary: `${beforePrices.join(", ") || "no price"} → ${(after.prices ?? []).join(", ") || "no price"}`,
        oldValue: beforePrices.join(", "),
        newValue: (after.prices ?? []).join(", "),
        added: prices.added.slice(0, MAX_LIST),
        removed: prices.removed.slice(0, MAX_LIST),
      });
    }

    if (before.contentHash !== after.contentHash) {
      const lines = setDiff(before.content?.split("\n"), after.content?.split("\n"));
      const meaningful = (l: string) => l.split(" ").length >= 3;
      changes.push({
        type: "content_change",
        url,
        summary: `Word count ${before.wordCount ?? 0} → ${after.wordCount ?? 0}`,
        added: lines.added.filter(meaningful).slice(0, MAX_LIST).map((l) => truncate(l)),
        removed: lines.removed.filter(meaningful).slice(0, MAX_LIST).map((l) => truncate(l)),
      });
    }

    changes.push(...seoChanges(before, after));

    const images = setDiff(before.images, after.images);
    if (images.added.length || images.removed.length) {
      changes.push({
        type: "image_change",
        url,
        summary: `${images.added.length} added, ${images.removed.length} removed`,
        added: images.added.slice(0, MAX_LIST),
        removed: images.removed.slice(0, MAX_LIST),
      });
    }

    const links = setDiff(before.internalLinks, after.internalLinks);
    for (const link of links.added) linkAdded.set(link, [...(linkAdded.get(link) ?? []), url]);
    for (const link of links.removed) linkRemoved.set(link, [...(linkRemoved.get(link) ?? []), url]);
  }

  // One change per link (not per page), so a new menu item doesn't show up 50 times.
  for (const [type, map] of [
    ["internal_link_added", linkAdded],
    ["internal_link_removed", linkRemoved],
  ] as const) {
    for (const [link, pages] of map) {
      changes.push({
        type,
        url: link,
        summary: `${type === "internal_link_added" ? "Linked from" : "Removed from"} ${pages.length} page${pages.length === 1 ? "" : "s"}`,
        added: type === "internal_link_added" ? pages.slice(0, MAX_LIST) : [],
        removed: type === "internal_link_removed" ? pages.slice(0, MAX_LIST) : [],
      });
    }
  }

  // Cap each type so one noisy check can't flood the database.
  const perType = new Map<ChangeType, number>();
  return changes.filter((c) => {
    const n = (perType.get(c.type) ?? 0) + 1;
    perType.set(c.type, n);
    return n <= MAX_PER_TYPE;
  });
}

// ---------- SEO ----------

const isNoindex = (robots = "") => /\bnoindex\b|\bnone\b/.test(robots);

/** noindex/nofollow, canonical and hreflang changes on one page. Skips fields an older crawl didn't record. */
function seoChanges(before: ComparablePage, after: ComparablePage): ChangeDraft[] {
  const out: ChangeDraft[] = [];
  const url = after.url;

  if (before.robotsMeta !== undefined && after.robotsMeta !== undefined && before.robotsMeta !== after.robotsMeta) {
    const was = isNoindex(before.robotsMeta);
    const now = isNoindex(after.robotsMeta);
    out.push({
      type: "seo_change",
      url,
      summary:
        !was && now
          ? "Page set to NOINDEX (removed from Google)"
          : was && !now
            ? "Page made indexable again (noindex removed)"
            : `Robots meta: “${before.robotsMeta || "none"}” → “${after.robotsMeta || "none"}”`,
      oldValue: before.robotsMeta || "(none)",
      newValue: after.robotsMeta || "(none)",
    });
  }

  if (before.canonical !== undefined && after.canonical !== undefined && before.canonical !== after.canonical) {
    out.push({
      type: "seo_change",
      url,
      summary: after.canonical
        ? `Canonical now points to ${after.canonical === url ? "itself" : after.canonical}`
        : "Canonical tag removed",
      oldValue: before.canonical || "(none)",
      newValue: after.canonical || "(none)",
    });
  }

  if (before.hreflang !== undefined && after.hreflang !== undefined) {
    const langs = setDiff(before.hreflang, after.hreflang);
    if (langs.added.length || langs.removed.length) {
      out.push({
        type: "seo_change",
        url,
        summary: `hreflang: ${langs.added.length} added, ${langs.removed.length} removed`,
        added: langs.added.slice(0, MAX_LIST),
        removed: langs.removed.slice(0, MAX_LIST),
      });
    }
  }
  return out;
}

const robotsRules = (text: string) =>
  text
    .split(/\r?\n/)
    .map((l) => l.replace(/#.*/, "").trim())
    .filter(Boolean);

/** Site-level robots.txt change. `prev` undefined = snapshot from an older version: nothing to compare. */
export function robotsTxtChange(
  prev: string | null | undefined,
  curr: string | null,
  origin: string,
): ChangeDraft | null {
  if (prev === undefined) return null;
  const rules = setDiff(robotsRules(prev ?? ""), robotsRules(curr ?? ""));
  if (!rules.added.length && !rules.removed.length) return null; // only comments/whitespace changed
  return {
    type: "seo_change",
    url: `${origin}/robots.txt`,
    summary:
      prev && !curr
        ? "robots.txt removed"
        : !prev && curr
          ? "robots.txt added"
          : `robots.txt rules changed: ${rules.added.length} added, ${rules.removed.length} removed`,
    added: rules.added.slice(0, MAX_LIST),
    removed: rules.removed.slice(0, MAX_LIST),
  };
}
