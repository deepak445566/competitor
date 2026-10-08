import Link from "next/link";
import { Suspense } from "react";
import { ChangeList } from "@/components/change-list";
import { AutoRefresh, CheckNowButton } from "@/components/client";
import { Card, CardHeader, EmptyState, PageHeader, Skeleton, StatCard, StatusBadge } from "@/components/ui";
import { timeAgo } from "@/lib/format";
import { getDashboardData } from "@/lib/queries";

// Server Actions on this page start checks; on serverless hosts they may run up to this many seconds.
export const maxDuration = 300;

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Dashboard" subtitle="What your competitors changed recently." />
      <Suspense fallback={<DashboardSkeleton />}>
        <Dashboard />
      </Suspense>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      <Skeleton className="h-80" />
    </div>
  );
}

async function Dashboard() {
  const { now, competitors, stats, recentChanges } = await getDashboardData();
  const week = (n: number | undefined) => `${n ?? 0} in last 7 days`;

  return (
    <div className="space-y-6">
      <AutoRefresh active={competitors.some((c) => c.status === "crawling")} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
        <StatCard label="Competitors" value={stats.competitors} />
        <StatCard label="Pages Monitored" value={stats.pagesMonitored} />
        <StatCard label="Changes Today" value={stats.changesToday} hint={week(stats.changesWeek)} />
        <StatCard label="New Pages" value={stats.today.new_page ?? 0} hint={week(stats.week.new_page)} />
        <StatCard label="New Blogs" value={stats.today.new_blog ?? 0} hint={week(stats.week.new_blog)} />
        <StatCard label="Price Changes" value={stats.today.price_change ?? 0} hint={week(stats.week.price_change)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader title="Recent changes" />
          <ChangeList changes={recentChanges} now={now} showCompetitor />
        </Card>

        <Card className="self-start">
          <CardHeader
            title="Competitors"
            action={
              <Link href="/competitors" className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
                Manage →
              </Link>
            }
          />
          {competitors.length === 0 ? (
            <EmptyState>
              No competitors yet.{" "}
              <Link href="/competitors" className="font-medium text-zinc-900 underline dark:text-zinc-100">
                Add your first one
              </Link>
              .
            </EmptyState>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {competitors.map((c) => (
                <li key={String(c._id)} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/competitors/${c._id}`} className="block truncate text-sm font-medium hover:underline">
                      {c.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                      <StatusBadge status={c.status} />
                      <span>{timeAgo(c.lastCheckedAt, now)}</span>
                    </div>
                  </div>
                  <CheckNowButton id={String(c._id)} disabled={c.status === "crawling"} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
