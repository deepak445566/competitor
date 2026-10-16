import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { PrintButton } from "@/components/client";
import { Card, ErrorNote, Skeleton } from "@/components/ui";
import { displayUrl, formatDate, formatDateTime } from "@/lib/format";
import type { ChangeType } from "@/lib/models";
import { REPORT_WINDOWS, getReport } from "@/lib/queries";
import type { CompetitorReport, Report } from "@/lib/report";
import type { Term } from "@/lib/topics";

export const metadata: Metadata = { title: "Competitor report" };

export default function ReportPage(props: PageProps<"/competitors/report">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-40" />
          <Skeleton className="h-96" />
        </div>
      }
    >
      <ReportView searchParams={props.searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
/** Entries shown per list; the counts always cover everything. */
const SHOW = 25;

async function ReportView({ searchParams }: { searchParams: PageProps<"/competitors/report">["searchParams"] }) {
  const sp = await searchParams;
  const result = await getReport({ group: first(sp.group), days: Number(first(sp.days)) || undefined, archive: first(sp.archive) });
  if (!result) notFound();
  if ("error" in result) return <ErrorNote>{result.error}</ErrorNote>;
  const { report } = result;
  const groupParam = report.group.id ?? "none";
  const totals = sumCounts(report.competitors);
  const n = (t: ChangeType) => totals[t] ?? 0;

  return (
    <div className="print-light mx-auto max-w-5xl space-y-6">
      {/* Toolbar (not printed) */}
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <Link href={`/competitors?group=${groupParam}`} className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          <span aria-hidden>←</span> {report.group.name}
        </Link>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {result.source === "live" &&
            REPORT_WINDOWS.map((d) => (
              <Link
                key={d}
                href={`/competitors/report?group=${groupParam}&days=${d}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
                  d === result.days
                    ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900 dark:ring-white"
                    : "text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800"
                }`}
              >
                Last {d} days
              </Link>
            ))}
          <a
            href={result.source === "live" ? `/api/report?group=${groupParam}&days=${result.days}` : `/api/report?archive=${result.archiveId}`}
            download
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Download Excel
          </a>
          <PrintButton />
        </div>
      </div>

      {/* Title */}
      <header className="border-b border-zinc-200 pb-5 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Competitor report</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{report.group.name}</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          <strong className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatDate(report.from)} – {formatDate(report.to)}
          </strong>{" "}
          · {report.competitors.length} competitor{report.competitors.length === 1 ? "" : "s"} · generated {formatDateTime(report.generatedAt)}
          {result.source === "archive" && " · from the archive"}
        </p>
      </header>

      {/* Key takeaways */}
      <Card className="p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">Key takeaways</h2>
        <ul className="space-y-2">
          {report.highlights.map((h) => (
            <li key={h} className="flex gap-2.5 text-[15px] leading-relaxed">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-zinc-400" />
              {h}
            </li>
          ))}
        </ul>
      </Card>

      {/* Totals */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Total label="New blogs" value={n("new_blog")} />
        <Total label="New products" value={n("new_product")} />
        <Total label="New pages" value={n("new_page")} />
        <Total label="Price changes" value={n("price_change")} />
        <Total label="Pages removed" value={n("deleted_page")} />
        <Total label="SEO changes" value={seoCount(totals)} />
      </div>

      {/* Side-by-side comparison */}
      <Card className="overflow-hidden">
        <h2 className="border-b border-zinc-200 px-5 py-3 text-sm font-semibold dark:border-zinc-800">Who did what</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-5 py-2 font-medium">Competitor</th>
                {COLUMNS.map((c) => (
                  <th key={c.label} className="px-3 py-2 text-right font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {report.competitors.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-2.5">
                    <a href={`#c-${c.id}`} className="font-medium hover:underline">
                      {c.name}
                    </a>
                    <span className="block text-xs text-zinc-500">{c.host}</span>
                  </td>
                  {COLUMNS.map((col) => {
                    const v = col.value(c);
                    return (
                      <td key={col.label} className={`px-3 py-2.5 text-right tabular-nums ${v ? "font-semibold" : "text-zinc-300 dark:text-zinc-600"}`}>
                        {v.toLocaleString("en-IN")}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {report.topics.length > 0 && (
        <Card className="p-5">
          <h2 className="mb-1 text-sm font-semibold">Topics they are writing about</h2>
          <p className="mb-3 text-xs text-zinc-500">Most common words and phrases in the titles of all new content.</p>
          <Terms terms={report.topics} />
        </Card>
      )}

      {/* One section per competitor */}
      {report.competitors.map((c) => (
        <CompetitorSection key={c.id} c={c} />
      ))}

      <p className="pb-4 text-center text-xs text-zinc-400">
        Every entry is in the Excel download. Content, link and image edits are counted here, not listed.
      </p>
    </div>
  );
}

const seoCount = (counts: Partial<Record<ChangeType, number>>) =>
  (counts.title_change ?? 0) + (counts.meta_change ?? 0) + (counts.seo_change ?? 0) + (counts.heading_change ?? 0);

const COLUMNS: { label: string; value: (c: CompetitorReport) => number }[] = [
  { label: "Blogs", value: (c) => c.counts.new_blog ?? 0 },
  { label: "Products", value: (c) => c.counts.new_product ?? 0 },
  { label: "Pages", value: (c) => c.counts.new_page ?? 0 },
  { label: "Prices", value: (c) => c.counts.price_change ?? 0 },
  { label: "Removed", value: (c) => c.counts.deleted_page ?? 0 },
  { label: "SEO", value: (c) => seoCount(c.counts) },
  { label: "Content edits", value: (c) => c.counts.content_change ?? 0 },
  { label: "Total", value: (c) => c.total },
];

function sumCounts(list: CompetitorReport[]) {
  const out: Partial<Record<ChangeType, number>> = {};
  for (const c of list) for (const [t, v] of Object.entries(c.counts)) out[t as ChangeType] = (out[t as ChangeType] ?? 0) + (v ?? 0);
  return out;
}

function Total({ label, value }: { label: string; value: number }) {
  return (
    <Card className="px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums">{value.toLocaleString("en-IN")}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </Card>
  );
}

function CompetitorSection({ c }: { c: CompetitorReport }) {
  const other = [
    [c.counts.content_change, "pages with edited content"],
    [c.counts.heading_change, "heading changes"],
    [c.counts.meta_change, "meta description changes"],
    [c.counts.internal_link_added, "new internal links"],
    [c.counts.internal_link_removed, "removed internal links"],
    [c.counts.image_change, "image changes"],
  ].filter((x): x is [number, string] => !!x[0]);

  return (
    <Card className="break-inside-avoid-page overflow-hidden">
      <div id={`c-${c.id}`} className="flex scroll-mt-6 flex-wrap items-baseline justify-between gap-2 border-b border-zinc-200 bg-zinc-50/70 px-5 py-3 dark:border-zinc-800 dark:bg-zinc-900/60">
        <h2 className="text-lg font-semibold">
          {c.name} <span className="text-sm font-normal text-zinc-500">{c.host}</span>
        </h2>
        <span className="text-sm text-zinc-500">{c.total.toLocaleString("en-IN")} changes</span>
      </div>
      {c.total === 0 ? (
        <p className="px-5 py-4 text-sm text-zinc-500">No activity in this period.</p>
      ) : (
        <div className="space-y-5 px-5 py-4">
          <ItemList title="New blogs" count={c.counts.new_blog} items={c.newBlogs} />
          <ItemList title="New products / packages" count={c.counts.new_product} items={c.newProducts} />
          {c.prices.length > 0 && (
            <Section title="Price changes" count={c.counts.price_change}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-zinc-500">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Page</th>
                      <th className="py-1 pr-3 font-medium">Prices removed</th>
                      <th className="py-1 pr-3 font-medium">Prices added</th>
                      <th className="py-1 font-medium">Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                    {c.prices.slice(0, SHOW).map((p, idx) => (
                      <tr key={`${idx}-${p.url}`} className="align-top">
                        <td className="max-w-xs py-1.5 pr-3">
                          <a href={p.url} target="_blank" rel="noreferrer noopener" className="block truncate hover:underline" title={p.url}>
                            {displayUrl(p.url)}
                          </a>
                        </td>
                        <td className="py-1.5 pr-3 text-zinc-500 line-through decoration-zinc-300">{p.before}</td>
                        <td className="py-1.5 pr-3 font-medium">{p.after}</td>
                        <td className="whitespace-nowrap py-1.5 text-zinc-500">{formatDate(p.at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <More shown={Math.min(SHOW, c.prices.length)} total={c.counts.price_change} />
            </Section>
          )}
          {c.removed.length > 0 && (
            <Section title="Pages removed" count={c.counts.deleted_page}>
              <ul className="space-y-1 text-sm">
                {c.removed.slice(0, SHOW).map((r, idx) => (
                  <li key={`${idx}-${r.url}`}>
                    <span className="font-medium">{displayUrl(r.url)}</span>
                    {r.text && <span className="text-zinc-500"> — {r.text}</span>}
                  </li>
                ))}
              </ul>
              <More shown={Math.min(SHOW, c.removed.length)} total={c.counts.deleted_page} />
            </Section>
          )}
          {c.titles.length > 0 && (
            <Section title="Page titles changed" count={c.counts.title_change}>
              <ul className="space-y-2 text-sm">
                {c.titles.slice(0, SHOW).map((t, idx) => (
                  <li key={`${idx}-${t.url}`}>
                    <a href={t.url} target="_blank" rel="noreferrer noopener" className="text-xs text-zinc-500 hover:underline">
                      {displayUrl(t.url)}
                    </a>
                    <span className="block">
                      <span className="text-zinc-500 line-through decoration-zinc-300">{t.before || "(no title)"}</span>
                      <span aria-hidden className="px-1.5 text-zinc-400">→</span>
                      <span className="font-medium">{t.after || "(no title)"}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <More shown={Math.min(SHOW, c.titles.length)} total={c.counts.title_change} />
            </Section>
          )}
          {c.seo.length > 0 && (
            <Section title="Technical SEO changes" count={c.counts.seo_change}>
              <ul className="space-y-1 text-sm">
                {c.seo.slice(0, SHOW).map((s, idx) => (
                  <li key={`${idx}-${s.url}`}>
                    {s.text} <span className="text-xs text-zinc-500">· {displayUrl(s.url)}</span>
                  </li>
                ))}
              </ul>
              <More shown={Math.min(SHOW, c.seo.length)} total={c.counts.seo_change} />
            </Section>
          )}
          <ItemList title="Other new pages" count={c.counts.new_page} items={c.newPages} />
          {c.topics.length > 0 && (
            <Section title="Topics in their new content">
              <Terms terms={c.topics} />
            </Section>
          )}
          {other.length > 0 && (
            <p className="rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-400">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">Also: </span>
              {other.map(([v, label]) => `${v.toLocaleString("en-IN")} ${label}`).join(" · ")}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return (
    <section className="break-inside-avoid">
      <h3 className="mb-2 text-sm font-semibold">
        {title}
        {count !== undefined && <span className="ml-1.5 font-normal tabular-nums text-zinc-500">{count.toLocaleString("en-IN")}</span>}
      </h3>
      {children}
    </section>
  );
}

function ItemList({ title, count, items }: { title: string; count?: number; items: Report["competitors"][number]["newBlogs"] }) {
  if (!items.length) return null;
  return (
    <Section title={title} count={count}>
      <ol className="space-y-1 text-sm">
        {items.slice(0, SHOW).map((i, idx) => (
          <li key={`${idx}-${i.url}`} className="flex gap-3">
            <span className="w-14 shrink-0 tabular-nums text-xs leading-5 text-zinc-500">{formatDate(i.at).replace(/ \d{4}$/, "")}</span>
            <a href={i.url} target="_blank" rel="noreferrer noopener" className="min-w-0 hover:underline" title={i.url}>
              {i.title}
            </a>
          </li>
        ))}
      </ol>
      <More shown={Math.min(SHOW, items.length)} total={count} />
    </Section>
  );
}

function More({ shown, total }: { shown: number; total?: number }) {
  if (!total || total <= shown) return null;
  return <p className="mt-1.5 text-xs text-zinc-500">+{(total - shown).toLocaleString("en-IN")} more in the Excel download</p>;
}

function Terms({ terms }: { terms: Term[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {terms.map((t) => (
        <span key={t.term} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2.5 py-0.5 text-sm dark:bg-zinc-800">
          {t.term}
          <span className="text-xs tabular-nums text-zinc-500">×{t.count}</span>
        </span>
      ))}
    </div>
  );
}
