import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChangeList } from "@/components/change-list";
import { AutoRefresh, CheckNowButton, DeleteCompetitorButton } from "@/components/client";
import { Card, CardHeader, EmptyState, ErrorNote, PageHeader, Skeleton, StatCard, StatusBadge } from "@/components/ui";
import { CHANGE_META, CHANGE_ORDER } from "@/lib/change-meta";
import { displayUrl, formatDate, formatDateTime, timeAgo } from "@/lib/format";
import { RECENT_WINDOWS, getCompetitorDetail, type RecentUpdate } from "@/lib/queries";
import type { Term, TopicReport } from "@/lib/topics";

// Server Actions on this page start checks; on serverless hosts they may run up to this many seconds.
export const maxDuration = 300;

export default function CompetitorPage(props: PageProps<"/competitors/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-16" />
          <Skeleton className="h-24" />
          <Skeleton className="h-96" />
        </div>
      }
    >
      <CompetitorDetail params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

async function CompetitorDetail({
  params,
  searchParams,
}: {
  params: PageProps<"/competitors/[id]">["params"];
  searchParams: PageProps<"/competitors/[id]">["searchParams"];
}) {
  const { id } = await params;
  const sp = await searchParams;
  const data = await getCompetitorDetail(id, {
    type: first(sp.type),
    page: Number(first(sp.page)) || 1,
    recent: Number(first(sp.recent)) || undefined,
  });
  if (!data) notFound();

  const { now, competitor: c, running, latest, snapshots, countsByType, changes, type, page, totalPages, pages, recent, recentDays, topics } =
    data;
  const totalChanges = Object.values(countsByType).reduce((a, b) => a + (b ?? 0), 0);
  const link = (params: { type?: string; page?: number; recent?: number }, anchor: string) => {
    const q = new URLSearchParams();
    if (params.type) q.set("type", params.type);
    if (params.page && params.page > 1) q.set("page", String(params.page));
    if (params.recent && params.recent !== 30) q.set("recent", String(params.recent));
    const s = q.toString();
    return `/competitors/${id}${s ? `?${s}` : ""}#${anchor}`;
  };
  const href = (t?: string, p = 1) => link({ type: t, page: p, recent: recentDays }, "history");
  const recentHref = (days: number) => link({ type, page, recent: days }, "recent");

  return (
    <div className="space-y-6">
      <AutoRefresh active={c.status === "crawling"} />
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <a href={c.url} target="_blank" rel="noreferrer noopener" className="hover:underline">
              {c.url}
            </a>
            <StatusBadge status={c.status} />
          </span>
        }
        action={
          <div className="flex gap-2">
            <CheckNowButton id={id} disabled={c.status === "crawling"} />
            <DeleteCompetitorButton id={id} name={c.name} redirectTo="/competitors" />
          </div>
        }
      />

      {running && (
        <Card className="flex items-center gap-3 px-5 py-4 text-sm">
          <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
          Check in progress — {running.pagesCrawled} pages crawled so far (started {timeAgo(running.startedAt, now)}).
        </Card>
      )}
      {c.lastError && c.status !== "crawling" && (
        <ErrorNote>
          <strong>{c.status === "error" ? "Last check failed: " : "Note: "}</strong>
          {c.lastError}
        </ErrorNote>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Pages Monitored" value={c.pagesMonitored} hint={`limit ${c.maxPages} per check`} />
        <StatCard label="Total Changes" value={totalChanges} />
        <StatCard label="Last Check" value={timeAgo(c.lastCheckedAt, now)} hint={formatDateTime(c.lastCheckedAt)} />
        <StatCard
          label="Discovery"
          value={latest ? (latest.discoveryMethod === "sitemap" ? "Sitemap" : "Links") : "—"}
          hint={
            latest
              ? `robots.txt ${latest.robotsFound ? "found" : "not found"} · ${latest.sitemapUrls.length} sitemap file(s) · ${c.feedUrls?.length ?? 0} RSS feed(s)`
              : undefined
          }
        />
      </div>

      <RecentUpdates items={recent} days={recentDays} hasSnapshot={!!latest} hrefFor={recentHref} />

      <TopicTrends report={topics} days={recentDays} />

      <Card>
        <div id="history" className="scroll-mt-6" />
        <CardHeader title="Change history" />
        <div className="flex flex-wrap gap-2 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <FilterChip href={href()} active={!type} label={`All (${totalChanges})`} />
          {CHANGE_ORDER.filter((t) => countsByType[t]).map((t) => (
            <FilterChip
              key={t}
              href={href(t)}
              active={type === t}
              label={`${CHANGE_META[t].icon} ${CHANGE_META[t].plural} (${countsByType[t]})`}
            />
          ))}
        </div>
        {changes.length === 0 && !type ? (
          <EmptyState>
            {latest
              ? "No changes detected yet. Changes appear here after the next check is compared with the baseline."
              : "Waiting for the first snapshot…"}
          </EmptyState>
        ) : (
          <ChangeList changes={changes} now={now} />
        )}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 text-sm dark:border-zinc-800">
            {page > 1 ? <Link href={href(type, page - 1)} className="hover:underline">← Newer</Link> : <span />}
            <span className="text-zinc-500">
              Page {page} of {totalPages}
            </span>
            {page < totalPages ? <Link href={href(type, page + 1)} className="hover:underline">Older →</Link> : <span />}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Snapshots" />
        {snapshots.length === 0 ? (
          <EmptyState>No snapshots yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-5 py-2 font-medium">Checked at</th>
                  <th className="px-3 py-2 font-medium">Result</th>
                  <th className="px-3 py-2 text-right font-medium">Pages</th>
                  <th className="px-3 py-2 text-right font-medium">Failed</th>
                  <th className="px-3 py-2 text-right font-medium">Changes</th>
                  <th className="px-5 py-2 font-medium">Crawler</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {snapshots.map((s) => (
                  <tr key={String(s._id)}>
                    <td className="whitespace-nowrap px-5 py-2.5">{formatDateTime(s.startedAt)}</td>
                    <td className="px-3 py-2.5">
                      {s.status === "failed" ? (
                        <span className="text-rose-600 dark:text-rose-400" title={s.error ?? ""}>
                          Failed{s.error ? `: ${s.error.slice(0, 80)}` : ""}
                        </span>
                      ) : s.isBaseline ? (
                        "Baseline"
                      ) : (
                        "Compared"
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{s.pagesCrawled}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{s.pagesFailed}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{s.changesCount}</td>
                    <td className="px-5 py-2.5 text-zinc-500">
                      {s.engine} · {s.discoveryMethod}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        {/* Collapsed by default: the page leads with recent updates and changes. */}
        <details>
          <summary className="flex cursor-pointer select-none items-center justify-between gap-4 px-5 py-3 text-sm font-semibold">
            <span>All monitored pages{latest ? ` (${pages.length})` : ""} · newest first</span>
            <span className="text-xs font-normal text-zinc-500">from the latest check</span>
          </summary>
        {pages.length === 0 ? (
          <EmptyState>Pages from the latest snapshot will be listed here.</EmptyState>
        ) : (
          <div className="max-h-[32rem] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
                <tr className="border-b border-zinc-200 dark:border-zinc-800">
                  <th className="px-5 py-2 font-medium">Page</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 text-right font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Words</th>
                  <th className="whitespace-nowrap px-3 py-2 font-medium">Published</th>
                  <th className="px-5 py-2 font-medium">Prices</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {pages.map((p) => (
                  <tr key={String(p._id)} className="align-top">
                    <td className="max-w-md px-5 py-2">
                      <a href={p.url} target="_blank" rel="noreferrer noopener" className="block truncate font-medium hover:underline" title={p.url}>
                        {p.title || displayUrl(p.url)}
                      </a>
                      <span className="block truncate text-xs text-zinc-500">
                        {/noindex|\bnone\b/.test(p.robotsMeta ?? "") && (
                          <span className="mr-1.5 rounded bg-rose-50 px-1 font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300">
                            noindex
                          </span>
                        )}
                        {displayUrl(p.url)}
                      </span>
                    </td>
                    <td className="px-3 py-2 capitalize text-zinc-600 dark:text-zinc-400">{p.pageType}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${p.statusCode >= 400 || p.statusCode === 0 ? "text-rose-600" : ""}`} title={p.error ?? ""}>
                      {p.statusCode || "ERR"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.wordCount}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <PublishedDate published={p.publishedAt} modified={p.modifiedAt ?? p.sitemapLastmod} />
                    </td>
                    <td className="max-w-xs truncate px-5 py-2 text-zinc-600 dark:text-zinc-400" title={p.prices.join(", ")}>
                      {p.prices.slice(0, 4).join(", ") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </details>
      </Card>
    </div>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${
        active
          ? "bg-zinc-900 text-white ring-zinc-900 dark:bg-white dark:text-zinc-900 dark:ring-white"
          : "text-zinc-600 ring-zinc-200 hover:bg-zinc-50 dark:text-zinc-400 dark:ring-zinc-700 dark:hover:bg-zinc-800"
      }`}
    >
      {label}
    </Link>
  );
}

/** Publish date from the page itself; "updated" from the page or its sitemap <lastmod>. */
function PublishedDate({ published, modified }: { published?: Date | null; modified?: Date | null }) {
  const updated = modified && formatDate(modified) !== formatDate(published) ? formatDate(modified) : null;
  if (!published && !updated) return <span className="text-zinc-400">—</span>;
  return (
    <>
      {published && <span className="block tabular-nums">{formatDate(published)}</span>}
      {updated && <span className="block text-xs text-zinc-500">updated {updated}</span>}
    </>
  );
}

const RECENT_GROUPS = [
  { type: "blog", icon: "✍️", label: "Blogs" },
  { type: "product", icon: "📦", label: "Products / Packages" },
  { type: "page", icon: "📄", label: "Other pages" },
] as const;
const RECENT_PER_GROUP = 25;

/** Blogs/products/pages the competitor published or updated in the selected window. */
function RecentUpdates({
  items,
  days,
  hasSnapshot,
  hrefFor,
}: {
  items: RecentUpdate[];
  days: number;
  hasSnapshot: boolean;
  hrefFor: (days: number) => string;
}) {
  const groups = RECENT_GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.type === g.type) }));
  return (
    <Card>
      <div id="recent" className="scroll-mt-6" />
      <CardHeader
        title={`Recent updates — last ${days} days`}
        action={
          <div className="flex gap-1">
            {RECENT_WINDOWS.map((d) => (
              <FilterChip key={d} href={hrefFor(d)} active={d === days} label={`${d}d`} />
            ))}
          </div>
        }
      />
      {!hasSnapshot ? (
        <EmptyState>Waiting for the first snapshot…</EmptyState>
      ) : items.length === 0 ? (
        <EmptyState>
          Nothing published or updated in the last {days} days (based on publish dates and sitemap dates the site exposes).
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-zinc-200 px-5 py-3 text-sm dark:border-zinc-800">
            {groups.map((g) => {
              const published = g.items.filter((i) => i.kind === "published").length;
              return (
                <span key={g.type}>
                  {g.icon} <strong>{g.items.length}</strong> {g.label}
                  {published > 0 && <span className="text-zinc-500"> ({published} newly published)</span>}
                </span>
              );
            })}
          </div>
          <div className="grid divide-y divide-zinc-100 lg:grid-cols-3 lg:divide-x lg:divide-y-0 dark:divide-zinc-800">
            {groups.map((g) => (
              <div key={g.type} className="min-w-0">
                <h3 className="px-5 pt-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  {g.icon} {g.label}
                </h3>
                {g.items.length === 0 ? (
                  <p className="px-5 py-3 text-sm text-zinc-400">None</p>
                ) : (
                  <ul className="max-h-96 overflow-auto py-1">
                    {g.items.slice(0, RECENT_PER_GROUP).map((i) => (
                      <li key={i.url} className="px-5 py-2">
                        <a href={i.url} target="_blank" rel="noreferrer noopener" className="block truncate text-sm font-medium hover:underline" title={i.url}>
                          {i.title || displayUrl(i.url)}
                        </a>
                        <span className="flex items-center gap-2 text-xs text-zinc-500">
                          <span
                            className={`rounded px-1.5 py-px font-medium ${
                              i.kind === "published"
                                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                                : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"
                            }`}
                          >
                            {i.kind === "published" ? "Published" : "Updated"}
                          </span>
                          <span className="tabular-nums">{formatDate(i.at)}</span>
                          {i.title && <span className="truncate">{displayUrl(i.url)}</span>}
                        </span>
                      </li>
                    ))}
                    {g.items.length > RECENT_PER_GROUP && (
                      <li className="px-5 py-2 text-xs text-zinc-500">+{g.items.length - RECENT_PER_GROUP} more</li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}

/** Most-used words/phrases in the competitor's new content (no AI: plain counting). */
function TopicTrends({ report, days }: { report: TopicReport; days: number }) {
  const empty = report.docs === 0;
  return (
    <Card>
      <CardHeader
        title={`Topic trends — last ${days} days`}
        action={
          <span className="text-xs text-zinc-500">
            {report.docs} new post/page{report.docs === 1 ? "" : "s"} · previous {days} days: {report.prevDocs}
          </span>
        }
      />
      {empty ? (
        <EmptyState>
          No new posts or pages with a known date in this period yet. Trends fill in from RSS feeds, publish dates and
          new pages found by checks.
        </EmptyState>
      ) : (
        <div className="space-y-4 px-5 py-4">
          <TermRow label="Phrases" terms={report.phrases} />
          <TermRow label="Keywords" terms={report.words} />
          {report.categories.length > 0 && <TermRow label="RSS categories" terms={report.categories} />}
        </div>
      )}
    </Card>
  );
}

function TermRow({ label, terms }: { label: string; terms: Term[] }) {
  if (terms.length === 0) return null;
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</h3>
      <div className="flex flex-wrap gap-2">
        {terms.map((t) => {
          const isNew = t.prevCount === 0;
          const delta = t.count - t.prevCount;
          return (
            <span
              key={t.term}
              title={`${t.count} in this period, ${t.prevCount} in the previous one`}
              className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-3 py-1 text-sm dark:bg-zinc-800"
            >
              {t.term}
              <span className="text-xs font-semibold tabular-nums text-zinc-500">×{t.count}</span>
              {isNew ? (
                <span className="text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">new</span>
              ) : delta > 0 ? (
                <span className="text-xs text-emerald-600 dark:text-emerald-400">↑{delta}</span>
              ) : delta < 0 ? (
                <span className="text-xs text-rose-600 dark:text-rose-400">↓{-delta}</span>
              ) : null}
            </span>
          );
        })}
      </div>
    </div>
  );
}
