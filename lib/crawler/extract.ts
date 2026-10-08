import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import type { PageType } from "../models";
import { extractSeo, type SeoSignals } from "./seo";
import { isSameSite, normalizeUrl } from "./url";

export interface ExtractedPage extends SeoSignals {
  title: string;
  metaDescription: string;
  h1: string[];
  h2: string[];
  /** Visible text, one block per line. */
  content: string;
  wordCount: number;
  contentHash: string;
  images: string[];
  internalLinks: string[];
  externalLinks: string[];
  prices: string[];
  pageType: PageType;
  /** When the page/blog was first published, if the site exposes it. */
  publishedAt: Date | null;
  modifiedAt: Date | null;
}

const MAX_CONTENT_CHARS = 60_000;
const MAX_LINKS = 1000;
const MAX_IMAGES = 300;
const MAX_PRICES = 50;

const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "dd", "div", "dl", "dt", "fieldset",
  "figcaption", "figure", "footer", "form", "h1", "h2", "h3", "h4", "h5", "h6", "header",
  "hr", "li", "main", "nav", "ol", "p", "pre", "section", "table", "td", "th", "tr", "ul",
  "option", "label", "button",
]);

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

function visibleText($: cheerio.CheerioAPI): string {
  $("script, style, noscript, template, svg, iframe, canvas, [hidden]").remove();
  const root = $("body")[0] ?? $.root()[0];

  const parts: string[] = [];
  const walk = (nodes: AnyNode[]) => {
    for (const node of nodes) {
      if (node.type === "text") parts.push(node.data);
      else if (node.type === "tag") {
        const block = BLOCK_TAGS.has(node.name);
        if (block) parts.push("\n");
        walk(node.children);
        if (block) parts.push("\n");
      }
    }
  };
  walk(root.children);

  return parts
    .join("")
    .split("\n")
    .map(clean)
    .filter(Boolean)
    .join("\n");
}

// ---------- Prices ----------

const CURRENCY = String.raw`₹|rs\.?|inr|us\$|usd|\$|€|eur|£|gbp|aed|sar|sgd`;
const AMOUNT = String.raw`\d[\d,]*(?:\.\d{1,2})?`;
// Amounts followed by a unit are salaries/statistics ("₹10 LPA", "$39.1 billion"), not prices.
// (?![\d,]|\.\d) also stops the regex from backtracking "₹10 lakh" into a match of "₹1".
const NOT_A_PRICE = String.raw`(?![\d,]|\.\d|\s?(?:lpa|lakhs?|lacs?|l|cr|crores?|k|thousand|million|billion|trillion|mn|bn)\b|\s?[%+])`;
// "₹12,999", "Rs. 12,999", "USD 99"
const PRICE_PREFIX = new RegExp(String.raw`(?<![\p{L}\d])(?:${CURRENCY})\s?${AMOUNT}${NOT_A_PRICE}`, "giu");
// "12,999 INR", "12,999/-" — but not the "14,376 ₹" inside "₹14,376 ₹20,174"
const PRICE_SUFFIX = new RegExp(
  String.raw`(?<![\p{L}\d.,]|(?:${CURRENCY})\s?)${AMOUNT}\s?(?:₹|inr|usd|eur|aed|\/-)(?![\p{L}]|\s?\d)`,
  "giu",
);

const CURRENCY_SYMBOL: Record<string, string> = {
  "₹": "₹", rs: "₹", "rs.": "₹", inr: "₹", "/-": "₹",
  $: "$", usd: "$", us$: "$",
  "€": "€", eur: "€",
  "£": "£", gbp: "£",
  aed: "AED ", sar: "SAR ", sgd: "SGD ",
};

/** Canonical form, so "Rs. 12,999", "12,999 INR" and "₹12,999" compare equal. */
export function normalizePrice(raw: string): string | null {
  const text = clean(raw);
  const amount = text.match(/\d[\d,]*(?:\.\d{1,2})?/)?.[0].replace(/,+$/, "");
  if (!amount || /^[0,.]+$/.test(amount)) return null;
  // Keep only the currency token ("Rs.," → "rs", "/-" stays) so stray punctuation can't create variants.
  const code = text.replace(amount, "").toLowerCase().replace(/[^a-z₹$€£/-]/g, "");
  const symbol = CURRENCY_SYMBOL[code] ?? (code ? `${code.toUpperCase()} ` : "");
  // Re-group digits so JSON-LD "14376" and page text "14,376" match.
  const value = Number(amount.replace(/,/g, "")).toLocaleString(symbol === "₹" ? "en-IN" : "en-US", {
    maximumFractionDigits: 2,
  });
  return `${symbol}${value}`;
}

interface LdDate {
  type: string;
  published?: string;
  modified?: string;
}

function collectJsonLd($: cheerio.CheerioAPI): { types: string[]; prices: string[]; dates: LdDate[] } {
  const types: string[] = [];
  const prices: string[] = [];
  const dates: LdDate[] = [];
  const visit = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const t = obj["@type"];
    if (typeof t === "string") types.push(t);
    else if (Array.isArray(t)) types.push(...t.filter((x): x is string => typeof x === "string"));
    if (typeof obj.datePublished === "string" || typeof obj.dateModified === "string") {
      dates.push({
        type: Array.isArray(t) ? String(t[0]) : String(t ?? ""),
        published: typeof obj.datePublished === "string" ? obj.datePublished : undefined,
        modified: typeof obj.dateModified === "string" ? obj.dateModified : undefined,
      });
    }
    for (const key of ["price", "lowPrice", "highPrice"]) {
      const v = obj[key];
      if (typeof v === "number" || (typeof v === "string" && /\d/.test(v))) {
        const currency = typeof obj.priceCurrency === "string" ? obj.priceCurrency : "";
        prices.push(clean(`${currency} ${v}`));
      }
    }
    for (const value of Object.values(obj)) if (value && typeof value === "object") visit(value);
  };
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      visit(JSON.parse($(el).text()));
    } catch {
      // Malformed JSON-LD is common; ignore it.
    }
  });
  return { types, prices, dates };
}

// ---------- Publish date ----------

/** Accepts ISO-ish dates; rejects junk and dates outside a sane range. */
export function parseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const date = new Date(value.trim());
  const time = date.getTime();
  if (Number.isNaN(time) || time < Date.UTC(1995, 0, 1) || time > Date.now() + 2 * 86400_000) return null;
  return date;
}

/** JSON-LD (article node first) → Open Graph article meta → itemprop → <time datetime>. */
function extractDates($: cheerio.CheerioAPI, ldDates: LdDate[]): { publishedAt: Date | null; modifiedAt: Date | null } {
  const ordered = [...ldDates.filter((d) => BLOG_LD.test(d.type)), ...ldDates.filter((d) => !BLOG_LD.test(d.type))];
  const first = (...candidates: (string | undefined)[]) => {
    for (const c of candidates) {
      const date = parseDate(c);
      if (date) return date;
    }
    return null;
  };
  const meta = (name: string) =>
    $(`meta[property="${name}"]`).attr("content") ?? $(`meta[name="${name}"]`).attr("content");

  return {
    publishedAt: first(
      ...ordered.map((d) => d.published),
      meta("article:published_time"),
      meta("og:published_time"),
      $('[itemprop="datePublished"]').attr("content") ?? $('[itemprop="datePublished"]').attr("datetime"),
      $("article time[datetime]").first().attr("datetime"),
      $("time[datetime]").first().attr("datetime"),
    ),
    modifiedAt: first(
      ...ordered.map((d) => d.modified),
      meta("article:modified_time"),
      meta("og:updated_time"),
      $('[itemprop="dateModified"]').attr("content") ?? $('[itemprop="dateModified"]').attr("datetime"),
    ),
  };
}

function extractPrices($: cheerio.CheerioAPI, text: string, jsonLdPrices: string[]): string[] {
  const found = new Set<string>(jsonLdPrices);
  $('meta[property="product:price:amount"], meta[property="og:price:amount"]').each((_, el) => {
    const amount = $(el).attr("content");
    const currency =
      $('meta[property="product:price:currency"], meta[property="og:price:currency"]').attr("content") ?? "";
    if (amount) found.add(clean(`${currency} ${amount}`));
  });
  for (const m of text.matchAll(PRICE_PREFIX)) found.add(m[0]);
  for (const m of text.matchAll(PRICE_SUFFIX)) found.add(m[0]);
  return [...new Set([...found].map(normalizePrice).filter((p): p is string => !!p))]
    .sort()
    .slice(0, MAX_PRICES);
}

// ---------- Page type ----------

const BLOG_PATH =
  /\/(?:blog|blogs|news|article|articles|post|posts|insights|stories|journal|magazine|guides?)\/[^/]+/i;
const PRODUCT_PATH =
  /\/(?:product|products|package|packages|tour|tours|trip|trips|holiday|holidays|holiday-packages|tour-packages|shop|store|item|items|deal|deals|itinerary|itineraries|activity|activities|p)\/[^/]+/i;
const BLOG_LD = /^(?:BlogPosting|Article|NewsArticle|BlogPost|TechArticle)$/i;
const PRODUCT_LD = /^(?:Product|ProductGroup|IndividualProduct|TouristTrip|Trip|Offer|AggregateOffer)$/i;

/** Classify from the URL alone (used for discovered-but-not-crawled pages). */
export function classifyByUrl(url: string): PageType {
  const path = new URL(url).pathname;
  if (PRODUCT_PATH.test(path)) return "product";
  if (BLOG_PATH.test(path)) return "blog";
  return "page";
}

function classify(url: string, $: cheerio.CheerioAPI, ldTypes: string[]): PageType {
  if (ldTypes.some((t) => PRODUCT_LD.test(t))) return "product";
  if (ldTypes.some((t) => BLOG_LD.test(t))) return "blog";
  const og = ($('meta[property="og:type"]').attr("content") ?? "").toLowerCase();
  if (og.startsWith("product")) return "product";
  if (og === "article") return "blog";
  return classifyByUrl(url);
}

// ---------- Main ----------

export function extractPage(html: string, pageUrl: string, rootHost: string): ExtractedPage {
  const $ = cheerio.load(html);
  const baseHref = $("base[href]").attr("href");
  const base = (baseHref && normalizeUrl(baseHref, pageUrl)) || pageUrl;

  // head > title first: inline <svg><title> elements must not count as the page title.
  const title = clean(
    $("head > title").first().text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").first().text(),
  );
  const metaDescription = clean(
    $('meta[name="description" i]').attr("content") ??
      $('meta[property="og:description"]').attr("content") ??
      "",
  );
  const h1 = $("h1").map((_, el) => clean($(el).text())).get().filter(Boolean);
  const h2 = $("h2").map((_, el) => clean($(el).text())).get().filter(Boolean);

  const internal = new Set<string>();
  const external = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || /^(?:#|mailto:|tel:|javascript:|sms:|whatsapp:)/i.test(href)) return;
    const url = normalizeUrl(href, base);
    if (!url) return;
    if (isSameSite(url, rootHost)) {
      if (internal.size < MAX_LINKS) internal.add(url);
    } else if (external.size < MAX_LINKS) external.add(url);
  });

  const images = new Set<string>();
  $("img").each((_, el) => {
    if (images.size >= MAX_IMAGES) return false;
    const img = $(el);
    const src =
      img.attr("src") ||
      img.attr("data-src") ||
      img.attr("data-lazy-src") ||
      (img.attr("srcset") ?? "").split(",")[0]?.trim().split(/\s+/)[0];
    if (!src || src.startsWith("data:")) return;
    const url = normalizeUrl(src, base);
    if (url) images.add(url);
  });

  const ld = collectJsonLd($); // before visibleText() strips <script>
  const pageType = classify(pageUrl, $, ld.types);
  const fullText = visibleText($);
  // Blog posts mention lots of amounts in passing; price tracking is for product/package pages.
  const prices = pageType === "blog" ? [] : extractPrices($, fullText, ld.prices);
  const dates = extractDates($, ld.dates);
  const seo = extractSeo($, base);

  return {
    title,
    metaDescription,
    h1,
    h2,
    content: fullText.slice(0, MAX_CONTENT_CHARS),
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    contentHash: createHash("sha1").update(fullText).digest("hex"),
    images: [...images],
    internalLinks: [...internal].sort(),
    externalLinks: [...external].sort(),
    prices,
    pageType,
    ...dates,
    ...seo,
  };
}
