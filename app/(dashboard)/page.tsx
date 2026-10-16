import Link from "next/link";
import { Suspense } from "react";
import { AutoRefresh, CheckNowButton, CompactCheckButton } from "@/components/client";
import { IconActivity, IconAlert, IconArrowRight, IconFile, IconLayers, IconPlus, IconTag } from "@/components/icons";
import { Card, CardHeader, ChangeBadge, EmptyState, KpiCard, PageHeader, Skeleton } from "@/components/ui";
import { CHANGE_ORDER } from "@/lib/change-meta";
import type { ChangeType } from "@/lib/models";
import { config } from "@/lib/config";
import { displayUrl, formatDateTime, timeAgo } from "@/lib/format";
import { ACTIVITY_GROUPS, getDashboardData, type ActivityDay, type ActivityKey } from "@/lib/queries";

// Server Actions on this page start checks; on serverless hosts they may run up to this many seconds.
export const maxDuration = 300;

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>;
type CompetitorRow = DashboardData["competitors"][number];

export default function DashboardPage() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <Dashboard />
    </Suspense>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-14 w-80" />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-80 lg:col-span-2" />
        <Skeleton className="h-80" />
      </div>
      <Skeleton className="h-96" />
    </div>
  );
}

async function Dashboard() {
  const { now, competitors, lastCheckedAt, activity, stats, recentChanges } = await getDashboardData();
  const checking = competitors.filter((c) => c.status === "crawling");
  const failing = competitors.filter((c) => c.status === "error");

  const sumOf = (counts: Partial<Record<string, number>>, keys: string[]) => keys.reduce((a, k) => a + (counts[k] ?? 0), 0);
  const newContentWeek = sumOf(stats.week, ["new_page", "new_blog", "new_product"]);
  const newContentToday = sumOf(stats.today, ["new_page", "new_blog", "new_product"]);
  const diff = stats.changesToday - stats.changesYesterday;

  return (
    <div className="space-y-6">
      <AutoRefresh active={checking.length > 0} />

      <PageHeader
        title="Overview"
        subtitle={
          competitors.length === 0 ? (
            "Add a competitor to start tracking their website."
          ) : (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="inline-flex items-center gap-1.5">
                <span className={`h-2 w-2 rounded-full ${checking.length ? "animate-pulse bg-sky-500" : "bg-emerald-500"}`} />
                {checking.length ? `Checking ${checking.length} now` : "All monitors running"}
              </span>
              <span aria-hidden>·</span>
              <span>
                {competitors.length} competitor{competitors.length === 1 ? "" : "s"}
              </span>
              <span aria-hidden>·</span>
              <span title={formatDateTime(lastCheckedAt)}>last check {timeAgo(lastCheckedAt, now)}</span>
            </span>
          )
        }
        action={
          <Link
            href="/competitors"
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            <IconPlus />
            Add competitor
          </Link>
        }
      />

      {failing.length > 0 && <AttentionBanner failing={failing} now={now} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          label="Changes today"
          value={stats.changesToday}
          icon={<IconActivity />}
          delta={{
            text: `${diff > 0 ? "+" : ""}${diff} vs yesterday`,
            direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat",
          }}
        />
        <KpiCard
          label="New pages & posts"
          value={newContentWeek}
          icon={<IconFile />}
          hint={`last 7 days · ${newContentToday} today`}
        />
        <KpiCard
          label="Price changes"
          value={stats.week.price_change ?? 0}
          icon={<IconTag />}
          hint={`last 7 days · ${stats.today.price_change ?? 0} today`}
        />
        <KpiCard
          label="Pages monitored"
          value={stats.pagesMonitored}
          icon={<IconLayers />}
          hint={`across ${stats.competitors} competitor${stats.competitors === 1 ? "" : "s"}`}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <ActivityChart days={activity} />
        <CompetitorPanel competitors={competitors} now={now} />
      </div>

      <RecentChanges changes={recentChanges} now={now} dayTotals={new Map(activity.map((d) => [d.day, d.total]))} />
    </div>
  );
}

// ---------- Attention ----------

function AttentionBanner({ failing, now }: { failing: CompetitorRow[]; now: number }) {
  return (
    <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/30">
      <div className="flex items-start gap-3 px-5 py-4">
        <div className="mt-0.5 text-amber-600 dark:text-amber-400">
          <IconAlert className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
            {failing.length} check{failing.length === 1 ? "" : "s"} need{failing.length === 1 ? "s" : ""} attention
          </p>
          <ul className="mt-2 space-y-2">
            {failing.map((c) => (
              <li key={String(c._id)} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <Link href={`/competitors/${c._id}`} className="font-medium text-amber-950 hover:underline dark:text-amber-100">
                  {c.name}
                </Link>
                <span className="min-w-0 flex-1 truncate text-amber-800/80 dark:text-amber-300/80" title={c.lastError ?? ""}>
                  {c.lastError ?? "Last check failed"} · {timeAgo(c.lastCheckedAt, now)}
                </span>
                <CheckNowButton id={String(c._id)} />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

// ---------- Activity chart ----------

const SERIES: Record<ActivityKey, string> = {
  content: "bg-series-1",
  pricing: "bg-series-2",
  seo: "bg-series-3",
  links: "bg-series-4",
};
const PLOT_HEIGHT = 300;

const shortDate = (day: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" }) =>
  new Intl.DateTimeFormat("en-IN", { ...opts, timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`));

/** Round the axis maximum up to a clean number (1, 2, 5 × 10ⁿ). */
function niceMax(n: number): number {
  if (n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  return ([1, 2, 2.5, 5, 10].map((m) => m * pow).find((m) => m >= n) ?? 10 * pow);
}

function ActivityChart({ days }: { days: ActivityDay[] }) {
  const total = days.reduce((a, d) => a + d.total, 0);
  const max = niceMax(Math.max(...days.map((d) => d.total), 0));
  const ticks = [max, max / 2, 0];
  const groupTotals = Object.fromEntries(
    ACTIVITY_GROUPS.map((g) => [g.key, days.reduce((a, d) => a + d.counts[g.key], 0)]),
  ) as Record<ActivityKey, number>;
  const range = `${shortDate(days[0].day)} – ${shortDate(days[days.length - 1].day)}`;

  return (
    <Card className="flex flex-col lg:col-span-2">
      <CardHeader
        title="Competitor activity"
        action={<span className="text-xs text-zinc-500">Changes per day · {range}</span>}
      />
      <div className="flex flex-1 flex-col px-5 pb-4 pt-4">
        {/* Legend: always present for multiple series, with period totals. */}
        <ul className="mb-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          {ACTIVITY_GROUPS.map((g) => (
            <li key={g.key} className="flex items-center gap-2">
              <span className={`h-2.5 w-2.5 rounded-sm ${SERIES[g.key]}`} aria-hidden />
              <span className="text-zinc-600 dark:text-zinc-400">{g.label}</span>
              <span className="font-semibold tabular-nums">{groupTotals[g.key]}</span>
            </li>
          ))}
        </ul>

        {total === 0 ? (
          <div className="flex h-44 items-center justify-center rounded-lg border border-dashed border-zinc-200 text-sm text-zinc-500 dark:border-zinc-800">
            No changes in the last 14 days. Activity shows up here after checks find something new.
          </div>
        ) : (
          <div className="flex gap-3">
            {/* Y axis */}
            <div className="relative w-6 shrink-0 text-right text-[11px] tabular-nums text-zinc-400" style={{ height: PLOT_HEIGHT }}>
              {ticks.map((t, i) => (
                <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}>
                  {t}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div className="relative" style={{ height: PLOT_HEIGHT }}>
                {/* Gridlines */}
                {ticks.map((t, i) => (
                  <div
                    key={t}
                    className="absolute inset-x-0 border-t border-zinc-100 dark:border-zinc-800"
                    style={{ top: `${(i / (ticks.length - 1)) * 100}%` }}
                  />
                ))}
                <div className="absolute inset-0 flex items-end">
                  {days.map((d, i) => (
                    <DayColumn key={d.day} day={d} max={max} alignRight={i >= days.length - 4} />
                  ))}
                </div>
              </div>
              {/* X axis: every other day, so labels never collide. */}
              <div className="mt-2 flex text-[11px] text-zinc-400">
                {days.map((d, i) => {
                  const fromEnd = days.length - 1 - i;
                  // Every 2nd day on wide screens, every 4th on phones.
                  const show = fromEnd % 2 === 0 ? (fromEnd % 4 === 0 ? "" : "hidden sm:inline") : "hidden";
                  return (
                    <div key={d.day} className="min-w-0 flex-1 text-center">
                      <span className={`whitespace-nowrap ${show}`}>{shortDate(d.day)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <details className="mt-auto pt-4 text-sm">
          <summary className="cursor-pointer select-none text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
            View as table
          </summary>
          <div className="mt-2 max-h-72 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-zinc-50 text-left text-zinc-500 dark:bg-zinc-900">
                <tr>
                  <th className="px-3 py-2 font-medium">Day</th>
                  {ACTIVITY_GROUPS.map((g) => (
                    <th key={g.key} className="px-3 py-2 text-right font-medium">
                      {g.label}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 tabular-nums dark:divide-zinc-800">
                {[...days].reverse().map((d) => (
                  <tr key={d.day}>
                    <td className="px-3 py-1.5">{shortDate(d.day, { weekday: "short", day: "numeric", month: "short" })}</td>
                    {ACTIVITY_GROUPS.map((g) => (
                      <td key={g.key} className="px-3 py-1.5 text-right">
                        {d.counts[g.key]}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-semibold">{d.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </Card>
  );
}

/** One stacked column: bottom-up segments with 2px surface gaps, rounded top, hover tooltip. */
function DayColumn({ day, max, alignRight }: { day: ActivityDay; max: number; alignRight: boolean }) {
  const segments = ACTIVITY_GROUPS.filter((g) => day.counts[g.key] > 0);
  return (
    <div className="group relative flex h-full flex-1 items-end justify-center outline-none" tabIndex={0}>
      {/* Hover highlight spans the whole slot, so thin columns are easy to target. */}
      <div className="absolute inset-y-0 inset-x-0.5 rounded-md bg-zinc-100 opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100 dark:bg-zinc-800/60" />
      <div className="relative flex w-full max-w-6 flex-col-reverse gap-0.5" style={{ width: "60%" }}>
        {segments.map((g, i) => (
          <div
            key={g.key}
            className={`${SERIES[g.key]} ${i === segments.length - 1 ? "rounded-t" : ""}`}
            style={{ height: Math.max(3, Math.round((day.counts[g.key] / max) * PLOT_HEIGHT)) }}
          />
        ))}
      </div>
      <div
        role="tooltip"
        className={`pointer-events-none absolute top-0 z-10 hidden w-48 rounded-lg border border-zinc-200 bg-white p-3 text-xs shadow-lg group-hover:block group-focus:block dark:border-zinc-700 dark:bg-zinc-900 ${
          alignRight ? "right-full mr-1" : "left-full ml-1"
        }`}
      >
        <div className="mb-1.5 font-semibold">{shortDate(day.day, { weekday: "short", day: "numeric", month: "short" })}</div>
        <ul className="space-y-1">
          {ACTIVITY_GROUPS.map((g) => (
            <li key={g.key} className="flex items-center gap-2">
              <span className={`h-2 w-2 rounded-sm ${SERIES[g.key]}`} aria-hidden />
              <span className="flex-1 text-zinc-600 dark:text-zinc-400">{g.label}</span>
              <span className="font-medium tabular-nums">{day.counts[g.key]}</span>
            </li>
          ))}
        </ul>
        <div className="mt-1.5 flex justify-between border-t border-zinc-100 pt-1.5 font-semibold dark:border-zinc-800">
          <span>Total</span>
          <span className="tabular-nums">{day.total}</span>
        </div>
      </div>
    </div>
  );
}

// ---------- Competitors ----------

const STATUS_DOT = {
  idle: { dot: "bg-emerald-500", label: "Monitoring" },
  crawling: { dot: "animate-pulse bg-sky-500", label: "Checking…" },
  error: { dot: "bg-amber-500", label: "Last check failed" },
} as const;

function CompetitorPanel({ competitors, now }: { competitors: CompetitorRow[]; now: number }) {
  const sorted = [...competitors].sort((a, b) => b.changesThisWeek - a.changesThisWeek || a.name.localeCompare(b.name));
  const max = Math.max(1, ...sorted.map((c) => c.changesThisWeek));

  return (
    <Card className="flex flex-col">
      <CardHeader
        title="Most active this week"
        action={
          <Link href="/competitors" className="inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
            Manage
            <IconArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />
      {sorted.length === 0 ? (
        <EmptyState>
          No competitors yet.{" "}
          <Link href="/competitors" className="font-medium text-zinc-900 underline dark:text-zinc-100">
            Add your first one
          </Link>
          .
        </EmptyState>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {sorted.map((c) => {
            const status = STATUS_DOT[c.status];
            return (
              <li key={String(c._id)} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={c.name} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} title={status.label} />
                    <Link href={`/competitors/${c._id}`} className="truncate text-sm font-medium hover:underline">
                      {c.name}
                    </Link>
                  </div>
                  {/* Single-hue magnitude bar: changes in the last 7 days, relative to the most active competitor. */}
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-magnitude"
                        style={{ width: `${c.changesThisWeek ? Math.max(4, (c.changesThisWeek / max) * 100) : 0}%` }}
                      />
                    </div>
                    <span className="w-8 text-right text-xs font-semibold tabular-nums">{c.changesThisWeek}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-zinc-500" title={formatDateTime(c.lastCheckedAt)}>
                    {c.status === "crawling" ? "Checking now…" : `Checked ${timeAgo(c.lastCheckedAt, now)}`} · {c.pagesMonitored} pages
                  </div>
                </div>
                <CompactCheckButton id={String(c._id)} name={c.name} running={c.status === "crawling"} />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xs font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
      {initials || "?"}
    </div>
  );
}

// ---------- Recent changes ----------

const dayKey = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: config.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

/** Rows of the digest: one per competitor + change type, most important types first. */
function digest(changes: DashboardData["recentChanges"]) {
  const rows = new Map<
    string,
    { competitorId: string; competitorName?: string; type: ChangeType; items: DashboardData["recentChanges"]; latest: Date }
  >();
  for (const c of changes) {
    const key = `${c.competitorId}|${c.type}`;
    const row = rows.get(key) ?? {
      competitorId: String(c.competitorId),
      competitorName: c.competitorName,
      type: c.type,
      items: [],
      latest: c.createdAt,
    };
    row.items.push(c);
    rows.set(key, row);
  }
  return [...rows.values()].sort(
    (a, b) => CHANGE_ORDER.indexOf(a.type) - CHANGE_ORDER.indexOf(b.type) || b.items.length - a.items.length,
  );
}

const DIGEST_PREVIEW = 3;
const DIGEST_DAYS = 3;

/** Recent changes as a digest: per day, one row per competitor and change type. */
function RecentChanges({
  changes,
  now,
  dayTotals,
}: {
  changes: DashboardData["recentChanges"];
  now: number;
  /** Exact changes per day (the digest itself only holds the latest few hundred). */
  dayTotals: Map<string, number>;
}) {
  const today = dayKey(new Date(now));
  const yesterday = dayKey(new Date(now - 86400_000));
  const byDay = new Map<string, DashboardData["recentChanges"]>();
  for (const c of changes) {
    const key = dayKey(new Date(c.createdAt));
    byDay.set(key, [...(byDay.get(key) ?? []), c]);
  }
  const days = [...byDay.entries()].slice(0, DIGEST_DAYS);
  const label = (key: string) =>
    key === today ? "Today" : key === yesterday ? "Yesterday" : shortDate(key, { weekday: "long", day: "numeric", month: "short" });

  return (
    <Card>
      <CardHeader
        title="What changed"
        action={<span className="hidden text-xs text-zinc-500 sm:inline">Grouped by competitor · most important first</span>}
      />
      {changes.length === 0 ? (
        <EmptyState>No changes detected yet. They appear here after a check is compared with the previous one.</EmptyState>
      ) : (
        days.map(([key, items]) => (
          <section key={key}>
            <h3 className="border-b border-zinc-100 bg-zinc-50 px-5 py-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900/60">
              {label(key)}
              <span className="ml-2 font-normal normal-case tracking-normal text-zinc-400">
                {(() => {
                  const total = Math.max(dayTotals.get(key) ?? 0, items.length);
                  return total > items.length
                    ? `latest ${items.length} of ${total.toLocaleString("en-IN")} changes`
                    : `${total} change${total === 1 ? "" : "s"}`;
                })()}
              </span>
            </h3>
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {digest(items).map((row) => {
                const href = `/competitors/${row.competitorId}?type=${row.type}#history`;
                return (
                  <li key={`${row.competitorId}|${row.type}`} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <ChangeBadge type={row.type} />
                      <Link href={href} className="text-sm font-medium hover:underline">
                        {row.competitorName ?? "Unknown"}
                      </Link>
                      <span className="text-sm text-zinc-500">
                        {row.items.length} {row.items.length === 1 ? "page" : "pages"}
                      </span>
                      <time className="ml-auto text-xs text-zinc-400" title={formatDateTime(row.latest)}>
                        {timeAgo(row.latest, now)}
                      </time>
                    </div>
                    <ul className="mt-1.5 space-y-0.5">
                      {row.items.slice(0, DIGEST_PREVIEW).map((c) => (
                        <li key={String(c._id)} className="flex min-w-0 gap-2 text-sm">
                          <a
                            href={c.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="min-w-0 shrink-0 truncate text-zinc-700 hover:underline sm:max-w-[45%] dark:text-zinc-300"
                            title={c.url}
                          >
                            {displayUrl(c.url)}
                          </a>
                          <span className="hidden min-w-0 truncate text-zinc-500 sm:block" title={c.summary}>
                            {c.summary}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {row.items.length > DIGEST_PREVIEW && (
                      <Link
                        href={href}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                      >
                        +{row.items.length - DIGEST_PREVIEW} more
                        <IconArrowRight className="h-3 w-3" />
                      </Link>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </Card>
  );
}
