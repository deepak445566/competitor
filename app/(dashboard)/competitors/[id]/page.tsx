import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChangeList } from "@/components/change-list";
import { AutoRefresh, CheckNowButton } from "@/components/client";
import { CompetitorMenu } from "@/components/competitor-directory";
import { IconActivity, IconAlert, IconFile, IconLayers, IconTag } from "@/components/icons";
import { Card, CardHeader, EmptyState, KpiCard, Skeleton } from "@/components/ui";
import { CHANGE_META, CHANGE_ORDER } from "@/lib/change-meta";
import { config } from "@/lib/config";
import { displayUrl, formatDate, formatDateTime, timeAgo } from "@/lib/format";
import type { ChangeType } from "@/lib/models";
import { RECENT_WINDOWS, getCompetitorDetail, type RecentUpdate } from "@/lib/queries";
import type { Term, TopicReport } from "@/lib/topics";

// Server Actions on this page start checks; on serverless hosts they may run up to this many seconds.
export const maxDuration = 300;

export default function CompetitorPage(props: PageProps<"/competitors/[id]">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <Skeleton className="h-20" />
          <Skeleton className="h-10 w-96" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
          <Skeleton className="h-96" />
        </div>
      }
    >
      <CompetitorDetail params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "changes", label: "Changes" },
  { key: "pages", label: "Pages" },
  { key: "checks", label: "Check history" },
] as const;
type Tab = (typeof TABS)[number]["key"];

type Data = NonNullable<Awaited<ReturnType<typeof getCompetitorDetail>>>;

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

  const { now, competitor: c, group, running, latest, countsByType, type, page, recentDays, nextCheckAt } = data;
  const groupHref = `/competitors?group=${group?.id ?? "none"}`;
  // A change-type filter (e.g. from a dashboard link) opens the Changes tab.
  const requested = first(sp.tab);
  const tab: Tab = TABS.some((t) => t.key === requested) ? (requested as Tab) : type ? "changes" : "overview";
  const totalChanges = Object.values(countsByType).reduce((a, b) => a + (b ?? 0), 0);

  const link = (p: { tab?: Tab; type?: string; page?: number; recent?: number }) => {
    const q = new URLSearchParams();
    if (p.tab && p.tab !== "overview") q.set("tab", p.tab);
    if (p.type) q.set("type", p.type);
    if (p.page && p.page > 1) q.set("page", String(p.page));
    if (p.recent && p.recent !== 30) q.set("recent", String(p.recent));
    const s = q.toString();
    return `/competitors/${id}${s ? `?${s}` : ""}`;
  };
  const tabCounts: Partial<Record<Tab, number>> = {
    changes: totalChanges,
    pages: latest ? data.pages.length : undefined,
  };

  return (
    <div className="space-y-6">
      <AutoRefresh active={c.status === "crawling"} />

      <nav aria-label="Breadcrumb" className="-mb-3 flex items-center gap-1.5 text-sm text-zinc-500">
        <Link href="/competitors" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
          Competitors
        </Link>
        <span aria-hidden>/</span>
        <Link href={groupHref} className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
          {group?.name ?? "Without a parent"}
        </Link>
      </nav>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <Avatar name={c.name} />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h1 className="truncate text-2xl font-semibold tracking-tight">{c.name}</h1>
              <StatusPill status={c.status} />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-zinc-500">
              <a href={c.url} target="_blank" rel="noreferrer noopener" className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100">
                {c.host}
              </a>
              <span aria-hidden>·</span>
              <span title={formatDateTime(c.lastCheckedAt)}>checked {timeAgo(c.lastCheckedAt, now)}</span>
              {nextCheckAt && c.status !== "crawling" && (
                <>
                  <span aria-hidden>·</span>
                  <span title={formatDateTime(nextCheckAt)}>next {timeUntil(nextCheckAt, now)}</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <CheckNowButton id={id} disabled={c.status === "crawling"} />
          <CompetitorMenu id={id} name={c.name} url={c.url} maxPages={c.maxPages} redirectTo={groupHref} showOpen={false} />
        </div>
      </div>

      {running && (
        <Card className="flex items-center gap-3 border-sky-200 bg-sky-50/60 px-5 py-3 text-sm dark:border-sky-900/60 dark:bg-sky-950/30">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-sky-500" />
          <span>
            Check in progress — <strong className="tabular-nums">{running.pagesCrawled}</strong> pages read so far (started{" "}
            {timeAgo(running.startedAt, now)}). This page refreshes by itself.
          </span>
        </Card>
      )}
      {c.lastError && c.status !== "crawling" && <Notice failed={c.status === "error"} message={c.lastError} />}

      {/* Tabs */}
      <nav aria-label="Sections" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800">
          {TABS.map((t) => {
            const active = tab === t.key;
            return (
              <Link
                key={t.key}
                href={link({ tab: t.key, recent: recentDays })}
                scroll={false}
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "border-zinc-900 text-zinc-900 dark:border-zinc-100 dark:text-zinc-100"
                    : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-800 dark:hover:border-zinc-600 dark:hover:text-zinc-200"
                }`}
              >
                {t.label}
                {tabCounts[t.key] !== undefined && (
                  <span className="rounded-full bg-zinc-100 px-1.5 py-0.5 text-[11px] tabular-nums text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                    {tabCounts[t.key]!.toLocaleString("en-IN")}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </nav>

      {tab === "overview" && <OverviewTab data={data} link={link} />}
      {tab === "changes" && <ChangesTab data={data} link={(t, p) => link({ tab: "changes", type: t, page: p, recent: recentDays })} type={type} page={page} total={totalChanges} />}
      {tab === "pages" && <PagesTab data={data} />}
      {tab === "checks" && <ChecksTab data={data} />}
    </div>
  );
}

// ---------- Header pieces ----------

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-zinc-100 text-lg font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
      {initials || "?"}
    </div>
  );
}

function StatusPill({ status }: { status: "idle" | "crawling" | "error" }) {
  const s = {
    idle: { label: "Monitoring", cls: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900", dot: "bg-emerald-500" },
    crawling: { label: "Checking now", cls: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900", dot: "bg-sky-500 animate-pulse" },
    error: { label: "Check failed", cls: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900", dot: "bg-amber-500" },
  }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

/** Compact notice: one readable line, technical details on demand. */
function Notice({ failed, message }: { failed: boolean; message: string }) {
  const [headline, ...rest] = message.split(/(?<=\.)\s+|\s+\(/);
  const hasMore = rest.length > 0 || message.length > 140;
  return (
    <div
      className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${
        failed
          ? "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200"
          : "border-zinc-200 bg-white text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300"
      }`}
    >
      <IconAlert className={`mt-0.5 h-4 w-4 shrink-0 ${failed ? "text-amber-600 dark:text-amber-400" : "text-zinc-400"}`} />
      <div className="min-w-0 flex-1">
        <p>
          <strong className="font-medium">{failed ? "Last check failed. " : "Note from the last check: "}</strong>
          {headline.slice(0, 140)}
          {failed && " Use “Check now” to retry."}
        </p>
        {hasMore && (
          <details className="mt-1">
            <summary className="cursor-pointer select-none text-xs opacity-70 hover:opacity-100">Technical details</summary>
            <p className="mt-1 break-words font-mono text-xs opacity-80">{message}</p>
          </details>
        )}
      </div>
    </div>
  );
}

function timeUntil(date: Date, now: number): string {
  const ms = date.getTime() - now;
  if (ms <= 0) return "due now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `in ${hours} h` : `in ${Math.round(hours / 24)} d`;
}

// ---------- Overview ----------

type LinkFn = (p: { tab?: Tab; type?: string; page?: number; recent?: number }) => string;

function OverviewTab({ data, link }: { data: Data; link: LinkFn }) {
  const { competitor: c, latest, activity, recent, recentDays, topics } = data;
  const { last7, prev7, counts30 } = activity;
  const diff = last7 - prev7;
  const newContent = (counts30.new_page ?? 0) + (counts30.new_blog ?? 0) + (counts30.new_product ?? 0);
  const byType = CHANGE_ORDER.filter((t) => counts30[t]).map((t) => ({ type: t, n: counts30[t]! }));
  const maxType = Math.max(1, ...byType.map((t) => t.n));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Changes · 7 days"
          value={last7}
          icon={<IconActivity />}
          delta={{ text: `${diff > 0 ? "+" : ""}${diff} vs previous 7 days`, direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat" }}
        />
        <KpiCard
          label="New pages & posts"
          value={newContent}
          icon={<IconFile />}
          hint={`last 30 days · ${counts30.new_blog ?? 0} blogs, ${counts30.new_product ?? 0} products`}
        />
        <KpiCard label="Price changes" value={counts30.price_change ?? 0} icon={<IconTag />} hint="last 30 days" />
        <KpiCard
          label="Pages tracked"
          value={c.pagesMonitored}
          icon={<IconLayers />}
          hint={
            latest
              ? `limit ${c.maxPages} · found via ${latest.discoveryMethod === "sitemap" ? "sitemap" : "links"}${c.feedUrls?.length ? ` · ${c.feedUrls.length} RSS` : ""}`
              : "waiting for the first check"
          }
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="self-start lg:col-span-1">
          <CardHeader title="What they changed · 30 days" />
          {byType.length === 0 ? (
            <EmptyState>{latest ? "No changes in the last 30 days." : "Waiting for the first check…"}</EmptyState>
          ) : (
            <ul className="space-y-1 p-3">
              {byType.map(({ type, n }) => (
                <li key={type}>
                  <Link
                    href={link({ tab: "changes", type })}
                    className="group grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-lg px-2 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                  >
                    <span aria-hidden className="text-center">{CHANGE_META[type].icon}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{CHANGE_META[type].plural}</span>
                      <span className="mt-1 block h-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <span className="block h-full rounded-full bg-magnitude" style={{ width: `${Math.max(3, (n / maxType) * 100)}%` }} />
                      </span>
                    </span>
                    <span className="text-sm font-semibold tabular-nums text-zinc-700 group-hover:text-zinc-900 dark:text-zinc-300 dark:group-hover:text-zinc-100">
                      {n}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <div className="lg:col-span-2">
          <TopicTrends report={topics} days={recentDays} />
        </div>
      </div>

      <RecentUpdates items={recent} days={recentDays} hasSnapshot={!!latest} hrefFor={(days) => link({ recent: days })} />
    </div>
  );
}

// ---------- Changes ----------

const dayKey = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

function ChangesTab({
  data,
  link,
  type,
  page,
  total,
}: {
  data: Data;
  link: (type?: string, page?: number) => string;
  type?: ChangeType;
  page: number;
  total: number;
}) {
  const { now, changes, countsByType, totalPages, latest } = data;
  const today = dayKey(new Date(now));
  const yesterday = dayKey(new Date(now - 86400_000));
  const groups = new Map<string, typeof changes>();
  for (const ch of changes) {
    const key = dayKey(new Date(ch.createdAt));
    groups.set(key, [...(groups.get(key) ?? []), ch]);
  }
  const label = (key: string) =>
    key === today
      ? "Today"
      : key === yesterday
        ? "Yesterday"
        : new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${key}T00:00:00Z`));

  return (
    <Card>
      <div className="flex gap-2 overflow-x-auto border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
        <FilterChip href={link()} active={!type} label={`All ${total.toLocaleString("en-IN")}`} />
        {CHANGE_ORDER.filter((t) => countsByType[t]).map((t) => (
          <FilterChip key={t} href={link(t)} active={type === t} label={`${CHANGE_META[t].icon} ${CHANGE_META[t].plural} ${countsByType[t]}`} />
        ))}
      </div>
      {changes.length === 0 ? (
        <EmptyState>
          {type
            ? "No changes of this type."
            : latest
              ? "No changes detected yet. Changes appear here after the next check is compared with the baseline."
              : "Waiting for the first snapshot…"}
        </EmptyState>
      ) : (
        [...groups.entries()].map(([key, items]) => (
          <section key={key}>
            <h3 className="border-b border-zinc-100 bg-zinc-50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
              {label(key)}
              <span className="ml-2 font-normal normal-case tracking-normal text-zinc-400">{items.length} on this page</span>
            </h3>
            <ChangeList changes={items} now={now} />
          </section>
        ))
      )}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 text-sm dark:border-zinc-800">
          {page > 1 ? (
            <Link href={link(type, page - 1)} className="font-medium hover:underline">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-zinc-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link href={link(type, page + 1)} className="font-medium hover:underline">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </Card>
  );
}

// ---------- Pages ----------

function PagesTab({ data }: { data: Data }) {
  const { pages, latest } = data;
  const counts = { blog: 0, product: 0, page: 0 } as Record<string, number>;
  for (const p of pages) counts[p.pageType] = (counts[p.pageType] ?? 0) + 1;
  return (
    <Card>
      <CardHeader
        title={latest ? `${pages.length} pages from the latest check` : "Pages"}
        action={
          latest ? (
            <span className="hidden text-xs text-zinc-500 sm:inline">
              {counts.blog} blogs · {counts.product} products · {counts.page} other · newest first
            </span>
          ) : undefined
        }
      />
      {pages.length === 0 ? (
        <EmptyState>Pages from the latest check will be listed here.</EmptyState>
      ) : (
        <div className="max-h-[40rem] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-1 bg-white text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-5 py-2 font-medium">Page</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Words</th>
                <th className="whitespace-nowrap px-3 py-2 font-medium">Published</th>
                <th className="hidden px-5 py-2 font-medium md:table-cell">Prices</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {pages.map((p) => {
                const broken = p.statusCode >= 400 || p.statusCode === 0;
                return (
                  <tr key={String(p._id)} className="align-top hover:bg-zinc-50/70 dark:hover:bg-zinc-800/30">
                    <td className="max-w-md px-5 py-2.5">
                      <a href={p.url} target="_blank" rel="noreferrer noopener" className="block truncate font-medium hover:underline" title={p.url}>
                        {p.title || displayUrl(p.url)}
                      </a>
                      <span className="flex min-w-0 items-center gap-1.5 text-xs text-zinc-500">
                        {broken && (
                          <span className="shrink-0 rounded bg-rose-50 px-1 font-medium text-rose-700 dark:bg-rose-950 dark:text-rose-300" title={p.error ?? ""}>
                            {p.statusCode || "error"}
                          </span>
                        )}
                        {/noindex|\bnone\b/.test(p.robotsMeta ?? "") && (
                          <span className="shrink-0 rounded bg-amber-50 px-1 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">noindex</span>
                        )}
                        <span className="truncate">{displayUrl(p.url)}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 text-xs capitalize text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
                        {p.pageType}
                      </span>
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums sm:table-cell">{p.wordCount.toLocaleString("en-IN")}</td>
                    <td className="whitespace-nowrap px-3 py-2.5">
                      <PublishedDate published={p.publishedAt} modified={p.modifiedAt ?? p.sitemapLastmod} />
                    </td>
                    <td className="hidden max-w-xs truncate px-5 py-2.5 text-zinc-600 md:table-cell dark:text-zinc-400" title={p.prices.join(", ")}>
                      {p.prices.slice(0, 4).join(", ") || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------- Check history ----------

function ChecksTab({ data }: { data: Data }) {
  const { snapshots } = data;
  const result = (s: Data["snapshots"][number]): { label: string; cls: string } =>
    s.status === "failed"
      ? { label: "Failed", cls: "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" }
      : s.isBaseline
        ? { label: "Baseline", cls: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300" }
        : { label: "Compared", cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" };
  const duration = (s: Data["snapshots"][number]) => {
    if (!s.finishedAt) return "—";
    const sec = Math.round((new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime()) / 1000);
    return sec < 60 ? `${sec}s` : `${Math.round(sec / 60)} min`;
  };
  return (
    <Card>
      <CardHeader title="Check history" action={<span className="text-xs text-zinc-500">last {snapshots.length} checks</span>} />
      {snapshots.length === 0 ? (
        <EmptyState>No checks yet.</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-5 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 text-right font-medium">Pages</th>
                <th className="px-3 py-2 text-right font-medium">Changes</th>
                <th className="hidden px-3 py-2 text-right font-medium sm:table-cell">Took</th>
                <th className="hidden px-5 py-2 font-medium md:table-cell">Crawler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {snapshots.map((s) => {
                const r = result(s);
                return (
                  <tr key={String(s._id)} className="align-top">
                    <td className="whitespace-nowrap px-5 py-2.5">{formatDateTime(s.startedAt)}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${r.cls}`}>{r.label}</span>
                      {s.status === "failed" && s.error && (
                        <span className="mt-1 block max-w-sm truncate text-xs text-zinc-500" title={s.error}>
                          {s.error}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {s.pagesCrawled}
                      {s.pagesFailed > 0 && <span className="block text-xs text-zinc-400">{s.pagesFailed} failed</span>}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{s.changesCount}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-zinc-500 sm:table-cell">{duration(s)}</td>
                    <td className="hidden px-5 py-2.5 text-zinc-500 md:table-cell">
                      {s.engine} · {s.discoveryMethod}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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
                          <span className="whitespace-nowrap tabular-nums">{formatDate(i.at)}</span>
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
