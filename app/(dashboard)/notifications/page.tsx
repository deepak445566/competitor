import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { markAllReadAction, watchNowAction } from "@/app/actions";
import { buttonSecondary } from "@/components/client";
import { Card, ChangeBadge, EmptyState, PageHeader, Skeleton } from "@/components/ui";
import { displayUrl, formatDateTime, timeAgo } from "@/lib/format";
import { emailConfigured } from "@/lib/notify";
import { getNotifications } from "@/lib/queries";

export const metadata: Metadata = { title: "Notifications" };

export default function NotificationsPage() {
  return (
    <>
      <PageHeader
        title="Notifications"
        subtitle="Alerts sent after each check that found changes."
        action={
          <div className="flex flex-wrap gap-2">
            <form action={watchNowAction}>
              <button className={buttonSecondary} title="Reads every competitor's sitemap for brand-new pages">
                🔎 Check for new uploads now
              </button>
            </form>
            <form action={markAllReadAction}>
              <button className={buttonSecondary}>Mark all as read</button>
            </form>
          </div>
        }
      />
      <Suspense fallback={<Skeleton className="h-96" />}>
        <NotificationList />
      </Suspense>
    </>
  );
}

const EMAIL_LABEL = { sent: "📧 Email sent", failed: "📧 Email failed", skipped: "" } as const;

async function NotificationList() {
  const { now, notifications } = await getNotifications();

  return (
    <div className="space-y-4">
      {!emailConfigured() && (
        <p className="text-xs text-zinc-500">
          Email alerts are off. Set SMTP_HOST, SMTP_USER, SMTP_PASS, EMAIL_FROM and NOTIFY_EMAIL in .env to enable them.
        </p>
      )}
      <Card>
        {notifications.length === 0 ? (
          <EmptyState>No notifications yet.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {notifications.map((n) => (
              <li key={String(n._id)} className={`flex gap-4 px-5 py-4 ${n.read ? "" : "bg-sky-50/60 dark:bg-sky-950/30"}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-sky-500"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <span className="font-semibold">{n.title}</span>
                    <Link href={`/competitors/${n.competitorId}`} className="text-sm font-medium text-zinc-600 hover:underline dark:text-zinc-300">
                      {n.competitorName}
                    </Link>
                    <time className="ml-auto text-xs text-zinc-400" title={formatDateTime(n.createdAt)}>
                      {timeAgo(n.createdAt, now)}
                    </time>
                  </div>
                  <ul className="mt-1.5 space-y-0.5 text-sm text-zinc-700 dark:text-zinc-300">
                    {n.lines.map((line, i) => (
                      <li key={i}>{line}</li>
                    ))}
                  </ul>
                  {n.items?.length > 0 && (
                    <ul className="mt-2 space-y-1.5">
                      {n.items.map((item, i) => (
                        <li key={i} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                          <ChangeBadge type={item.type} />
                          <a href={item.url} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate font-medium hover:underline" title={item.url}>
                            {item.text}
                          </a>
                          <span className="truncate text-xs text-zinc-500">{displayUrl(item.url)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {EMAIL_LABEL[n.emailStatus] && (
                    <p
                      className={`mt-1.5 text-xs ${n.emailStatus === "failed" ? "text-rose-600" : "text-zinc-400"}`}
                      title={n.emailError ?? ""}
                    >
                      {EMAIL_LABEL[n.emailStatus]}
                      {n.emailStatus === "failed" && n.emailError ? `: ${n.emailError}` : ""}
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
