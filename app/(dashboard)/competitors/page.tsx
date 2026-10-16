import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ArchiveNowButton, AutoRefresh, DeleteGroupButton } from "@/components/client";
import { CompetitorDirectory, CompetitorsHeader, GroupGrid } from "@/components/competitor-directory";
import { Card, CardHeader, EmptyState, Skeleton } from "@/components/ui";
import { config } from "@/lib/config";
import { formatDate, formatDateTime } from "@/lib/format";
import { getArchives, getCompetitors } from "@/lib/queries";

// Server Actions on this page start checks; on serverless hosts they may run up to this many seconds.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Competitors" };

export default function CompetitorsPage(props: PageProps<"/competitors">) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4">
          <Skeleton className="h-14 w-72" />
          <Skeleton className="h-10" />
          <Skeleton className="h-96" />
        </div>
      }
    >
      <Competitors searchParams={props.searchParams} />
    </Suspense>
  );
}

/** Without ?group: the parents (e.g. CourseUnbox, Tourist). With ?group=<id>: that parent's competitors. */
async function Competitors({ searchParams }: { searchParams: PageProps<"/competitors">["searchParams"] }) {
  const sp = await searchParams;
  const selected = Array.isArray(sp.group) ? sp.group[0] : sp.group;
  const [{ now, competitors, groups }, storage] = await Promise.all([getCompetitors(), getArchives(selected)]);
  const options = groups.map((g) => ({ id: g.id, name: g.name }));
  const ungrouped = competitors.filter((c) => !c.groupId);

  if (!selected) {
    return (
      <>
        <AutoRefresh active={competitors.some((c) => c.status === "crawling")} />
        <CompetitorsHeader
          title="Competitors"
          subtitle={
            groups.length === 0
              ? "Add a parent (your brand, e.g. CourseUnbox), then add its competitors."
              : `${groups.length} parent${groups.length === 1 ? "" : "s"} · ${competitors.length} website${competitors.length === 1 ? "" : "s"} monitored`
          }
          defaultMaxPages={config.crawlMaxPages}
          groups={options}
          showAddGroup
        />
        <GroupGrid groups={groups} ungrouped={ungrouped.length} />
        <StorageNote storage={storage} now={now} />
      </>
    );
  }

  const group = selected === "none" ? null : groups.find((g) => g.id === selected);
  if (selected !== "none" && !group) notFound();
  const rows = group ? competitors.filter((c) => c.groupId === group.id) : ungrouped;

  return (
    <>
      <AutoRefresh active={rows.some((c) => c.status === "crawling")} />
      <CompetitorsHeader
        key={selected}
        title={group ? group.name : "Without a parent"}
        subtitle={
          rows.length === 0
            ? `Add ${group ? `${group.name}'s` : "a"} first competitor to start monitoring it.`
            : `${rows.length} competitor${rows.length === 1 ? "" : "s"} monitored · the first check of a new site saves its baseline`
        }
        defaultMaxPages={config.crawlMaxPages}
        groups={options}
        groupId={group?.id}
        startOpen={rows.length === 0 && !!group}
        back={{ href: "/competitors", label: "All parents" }}
        extra={
          group && rows.length === 0 ? (
            <DeleteGroupButton id={group.id} name={group.name} />
          ) : (
            <>
              <Link
                href={`/competitors/report?group=${selected}`}
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                View report
              </Link>
              <ExportExcel group={selected} />
            </>
          )
        }
      />
      <CompetitorDirectory
        competitors={rows}
        now={now}
        groups={options}
        emptyText={group ? `Add one above, e.g. a site competing with ${group.name}.` : "Every competitor has a parent."}
      />
      <ArchiveList storage={storage} />
    </>
  );
}

/** Downloads the parent's report as an Excel file (built by /api/report). */
function ExportExcel({ group }: { group: string }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-zinc-300 bg-white text-sm font-medium shadow-sm dark:border-zinc-700 dark:bg-zinc-900">
      <span className="flex items-center gap-1.5 border-r border-zinc-300 px-3 py-2 text-zinc-500 dark:border-zinc-700">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
          <path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Excel
      </span>
      {[7, 14].map((d) => (
        <a
          key={d}
          href={`/api/report?group=${group}&days=${d}`}
          download
          title={`Download the report of the last ${d} days as an Excel file`}
          className="px-3 py-2 text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
        >
          {d}d
        </a>
      ))}
    </div>
  );
}

type Storage = Awaited<ReturnType<typeof getArchives>>;

/** How old data leaves the database, with a manual trigger. */
function StorageNote({ storage, now }: { storage: Storage; now: number }) {
  const { retentionDays, unavailable, nextAt } = storage;
  const next = nextAt ? new Date(nextAt).getTime() : null;
  return (
    <Card className="mt-6 flex flex-col gap-3 px-5 py-4 text-sm sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="font-medium">Database storage</p>
        <p className="text-zinc-500">
          {unavailable ??
            `Every ${retentionDays} days, changes older than ${retentionDays} days are saved as a report + backup file (open a parent to see them) and removed from the database. ${
              next === null
                ? "First archive runs as soon as some data is older than that."
                : next <= now
                  ? "Next archive: within the hour."
                  : `Next archive: ${formatDateTime(new Date(next))}.`
            }`}
        </p>
      </div>
      {!unavailable && <ArchiveNowButton days={retentionDays} />}
    </Card>
  );
}

const fileSize = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** CSV files of this parent's changes that were moved out of the database. */
function ArchiveList({ storage }: { storage: Storage }) {
  const { archives, retentionDays, unavailable } = storage;
  return (
    <Card className="mt-6">
      <CardHeader
        title="Archived reports"
        action={<span className="text-xs text-zinc-500">{unavailable ?? `older than ${retentionDays} days`}</span>}
      />
      {archives.length === 0 ? (
        <EmptyState>
          No archives yet. Every {retentionDays} days, changes older than {retentionDays} days are saved here as a report (view online or
          as Excel) plus a raw backup, and removed from the database.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {archives.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
              <span className="min-w-0 flex-1 font-medium">
                {formatDate(a.from)} – {formatDate(a.to)}
              </span>
              <span className="tabular-nums text-zinc-500">
                {a.rows.toLocaleString("en-IN")} changes · {fileSize(a.bytes)}
              </span>
              {a.hasReport && (
                <>
                  <Link href={`/competitors/report?archive=${a.id}`} className="font-medium hover:underline">
                    View report
                  </Link>
                  <a href={`/api/report?archive=${a.id}`} download className="font-medium hover:underline">
                    Excel
                  </a>
                </>
              )}
              <a
                href={`/api/archives/${a.id}`}
                download
                title="Every change, unformatted (backup)"
                className="text-zinc-500 hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
              >
                Raw CSV
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
