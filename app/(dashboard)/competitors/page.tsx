import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AddCompetitorForm, AutoRefresh, CheckNowButton, DeleteCompetitorButton } from "@/components/client";
import { Card, CardHeader, EmptyState, PageHeader, Skeleton, StatusBadge } from "@/components/ui";
import { config } from "@/lib/config";
import { formatDateTime, timeAgo } from "@/lib/format";
import { getCompetitors } from "@/lib/queries";

// Server Actions on this page start checks; on serverless hosts they may run up to this many seconds.
export const maxDuration = 300;

export const metadata: Metadata = { title: "Competitors" };

export default function CompetitorsPage() {
  return (
    <>
      <PageHeader title="Competitors" subtitle="Add a website to start monitoring it. The first check saves a baseline snapshot." />
      <Card className="mb-6 p-5">
        <AddCompetitorForm defaultMaxPages={config.crawlMaxPages} />
      </Card>
      <Suspense fallback={<Skeleton className="h-64" />}>
        <CompetitorTable />
      </Suspense>
    </>
  );
}

async function CompetitorTable() {
  const { now, competitors } = await getCompetitors();

  return (
    <Card>
      <AutoRefresh active={competitors.some((c) => c.status === "crawling")} />
      <CardHeader title={`${competitors.length} competitor${competitors.length === 1 ? "" : "s"}`} />
      {competitors.length === 0 ? (
        <EmptyState>No competitors yet. Add one above, e.g. ABC Travel — https://abctravel.com</EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-zinc-500">
              <tr className="border-b border-zinc-200 dark:border-zinc-800">
                <th className="px-5 py-2 font-medium">Competitor</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 text-right font-medium">Pages</th>
                <th className="px-3 py-2 text-right font-medium">Changes (7d)</th>
                <th className="px-3 py-2 font-medium">Last check</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {competitors.map((c) => (
                <tr key={String(c._id)} className="align-top">
                  <td className="px-5 py-3">
                    <Link href={`/competitors/${c._id}`} className="font-medium hover:underline">
                      {c.name}
                    </Link>
                    <a href={c.url} target="_blank" rel="noreferrer noopener" className="block text-xs text-zinc-500 hover:underline">
                      {c.url}
                    </a>
                    {c.status === "error" && c.lastError && (
                      <p className="mt-1 max-w-md text-xs text-rose-600 dark:text-rose-400">{c.lastError}</p>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums">{c.pagesMonitored}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{c.changesThisWeek}</td>
                  <td className="px-3 py-3 whitespace-nowrap text-zinc-500" title={formatDateTime(c.lastCheckedAt)}>
                    {timeAgo(c.lastCheckedAt, now)}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-2">
                      <Link
                        href={`/competitors/${c._id}`}
                        className="inline-flex items-center rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        View
                      </Link>
                      <CheckNowButton id={String(c._id)} disabled={c.status === "crawling"} />
                      <DeleteCompetitorButton id={String(c._id)} name={c.name} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
