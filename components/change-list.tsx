import Link from "next/link";
import { displayUrl, formatDateTime, timeAgo } from "@/lib/format";
import type { ChangeWithCompetitor } from "@/lib/queries";
import { ChangeBadge, EmptyState } from "./ui";

function DiffList({ items, kind }: { items: string[]; kind: "added" | "removed" }) {
  if (!items.length) return null;
  const add = kind === "added";
  return (
    <ul className="space-y-1">
      {items.map((item, i) => (
        <li
          key={i}
          className={`break-words rounded px-2 py-1 font-mono text-xs ${
            add
              ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
              : "bg-rose-50 text-rose-800 line-through decoration-rose-300 dark:bg-rose-950/60 dark:text-rose-300"
          }`}
        >
          {add ? "+ " : "− "}
          {item}
        </li>
      ))}
    </ul>
  );
}

export function ChangeList({
  changes,
  now,
  showCompetitor = false,
}: {
  changes: ChangeWithCompetitor[];
  /** Request time, so relative dates stay consistent within one render. */
  now: number;
  showCompetitor?: boolean;
}) {
  if (!changes.length) return <EmptyState>No changes detected yet.</EmptyState>;

  return (
    <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
      {changes.map((c) => {
        const hasDetails =
          c.added.length > 0 || c.removed.length > 0 || (c.oldValue != null && c.newValue != null && c.type !== "price_change");
        return (
          <li key={String(c._id)} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <ChangeBadge type={c.type} />
              {showCompetitor && c.competitorName && (
                <Link href={`/competitors/${c.competitorId}`} className="text-sm font-medium hover:underline">
                  {c.competitorName}
                </Link>
              )}
              <a
                href={c.url}
                target="_blank"
                rel="noreferrer noopener"
                className="min-w-0 truncate text-sm text-zinc-600 hover:underline dark:text-zinc-400"
                title={c.url}
              >
                {displayUrl(c.url)}
              </a>
              <time className="ml-auto text-xs text-zinc-400" title={formatDateTime(c.createdAt)}>
                {timeAgo(c.createdAt, now)}
              </time>
            </div>
            <p className="mt-1 break-words text-sm text-zinc-700 dark:text-zinc-300">{c.summary}</p>
            {hasDetails && (
              <details className="group mt-2">
                <summary className="cursor-pointer select-none text-xs font-medium text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200">
                  Show details
                </summary>
                <div className="mt-2 space-y-2">
                  {c.oldValue != null && c.newValue != null && c.type !== "price_change" && (
                    <>
                      <DiffList items={[c.oldValue || "(empty)"]} kind="removed" />
                      <DiffList items={[c.newValue || "(empty)"]} kind="added" />
                    </>
                  )}
                  <DiffList items={c.removed} kind="removed" />
                  <DiffList items={c.added} kind="added" />
                </div>
              </details>
            )}
          </li>
        );
      })}
    </ul>
  );
}
