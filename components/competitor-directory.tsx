"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CHANGE_META } from "@/lib/change-meta";
import { displayUrl, formatDateTime, timeAgo } from "@/lib/format";
import type { CompetitorRow, GroupRow } from "@/lib/queries";
import { AddCompetitorForm, AddGroupForm, CompactCheckButton, DeleteCompetitorButton, EditCompetitorForm, MoveCompetitorSelect } from "./client";
import { IconArrowRight, IconGlobe, IconPlus } from "./icons";
import { Card, EmptyState, PageHeader } from "./ui";

// ---------- Header + add panels ----------

type GroupOption = { id: string; name: string };

const headerButton = (active: boolean) =>
  `inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium shadow-sm transition-colors ${
    active
      ? "border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
      : "bg-zinc-900 text-white hover:bg-zinc-700 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
  }`;
const headerButtonSecondary =
  "inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";

/**
 * Page header with "Add competitor" (and, on the parents overview, "Add parent") buttons that open their form in place.
 * Inside a parent, the add form preselects that parent.
 */
export function CompetitorsHeader({
  title,
  subtitle,
  defaultMaxPages,
  groups,
  groupId,
  showAddGroup = false,
  startOpen = false,
  back,
  extra,
}: {
  title: string;
  subtitle: string;
  defaultMaxPages: number;
  groups: GroupOption[];
  groupId?: string;
  showAddGroup?: boolean;
  startOpen?: boolean;
  back?: { href: string; label: string };
  extra?: ReactNode;
}) {
  const [open, setOpen] = useState<"competitor" | "group" | null>(startOpen ? "competitor" : null);
  const toggle = (panel: "competitor" | "group") => setOpen((o) => (o === panel ? null : panel));
  return (
    <>
      {back && (
        <Link href={back.href} className="mb-2 inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100">
          <span aria-hidden>←</span> {back.label}
        </Link>
      )}
      <PageHeader
        title={title}
        subtitle={subtitle}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {extra}
            {showAddGroup && (
              <button type="button" onClick={() => toggle("group")} aria-expanded={open === "group"} className={headerButtonSecondary}>
                <IconPlus className={`h-4 w-4 transition-transform ${open === "group" ? "rotate-45" : ""}`} />
                {open === "group" ? "Close" : "Add parent"}
              </button>
            )}
            <button
              type="button"
              onClick={() => toggle("competitor")}
              aria-expanded={open === "competitor"}
              aria-controls="add-competitor"
              className={headerButton(open === "competitor")}
            >
              <IconPlus className={`h-4 w-4 transition-transform ${open === "competitor" ? "rotate-45" : ""}`} />
              {open === "competitor" ? "Close" : "Add competitor"}
            </button>
          </div>
        }
      />
      {open === "group" && (
        <Card className="mb-6 overflow-hidden">
          <div className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">Add a parent</h2>
            <p className="text-xs text-zinc-500">A parent is your own brand or project, e.g. CourseUnbox. Its competitors are listed under it.</p>
          </div>
          <div className="p-5">
            <AddGroupForm />
          </div>
        </Card>
      )}
      {open === "competitor" && (
        <Card className="mb-6 overflow-hidden">
          <div id="add-competitor" className="border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold">Add a competitor</h2>
            <p className="text-xs text-zinc-500">
              Choose its parent first. We read its sitemap and up to “Max pages” pages on every check, then alert you about what changed.
            </p>
          </div>
          <div className="p-5">
            <AddCompetitorForm defaultMaxPages={defaultMaxPages} groups={groups} defaultGroupId={groupId} />
          </div>
        </Card>
      )}
    </>
  );
}

// ---------- Parents overview ----------

/** One card per parent; clicking opens that parent's competitors. */
export function GroupGrid({ groups, ungrouped }: { groups: GroupRow[]; ungrouped: number }) {
  if (groups.length === 0 && ungrouped === 0) {
    return (
      <Card>
        <EmptyState>
          <IconGlobe className="mx-auto mb-3 h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          <span className="block font-medium text-zinc-700 dark:text-zinc-300">No parents yet</span>
          <span className="mt-1 block">Add a parent like CourseUnbox, then add its competitors.</span>
        </EmptyState>
      </Card>
    );
  }
  return (
    <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {groups.map((g) => (
        <li key={g.id}>
          <GroupCard
            href={`/competitors?group=${g.id}`}
            name={g.name}
            count={g.count}
            detail={
              g.count === 0
                ? "No competitors yet — open to add one"
                : `${g.members.join(", ")}${g.count > g.members.length ? ` +${g.count - g.members.length} more` : ""}`
            }
            stats={[
              { label: "changes · 7d", value: g.changesThisWeek },
              { label: "pages tracked", value: g.pagesMonitored },
            ]}
            crawling={g.crawling}
            failing={g.failing}
          />
        </li>
      ))}
      {ungrouped > 0 && (
        <li>
          <GroupCard
            href="/competitors?group=none"
            name="Without a parent"
            count={ungrouped}
            detail="Added before parents existed. Open and use ⋯ → Move to parent."
            muted
          />
        </li>
      )}
    </ul>
  );
}

function GroupCard({
  href,
  name,
  count,
  detail,
  stats,
  crawling = 0,
  failing = 0,
  muted = false,
}: {
  href: string;
  name: string;
  count: number;
  detail: string;
  stats?: { label: string; value: number }[];
  crawling?: number;
  failing?: number;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex h-full flex-col rounded-xl border bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md dark:bg-zinc-900 ${
        muted ? "border-dashed border-zinc-300 dark:border-zinc-700" : "border-zinc-200 dark:border-zinc-800"
      }`}
    >
      <div className="flex items-center gap-3">
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold group-hover:underline">{name}</h2>
          <p className="text-xs text-zinc-500">
            {count} competitor{count === 1 ? "" : "s"}
            {crawling > 0 && <span className="text-sky-600 dark:text-sky-400"> · {crawling} checking</span>}
            {failing > 0 && <span className="text-amber-600 dark:text-amber-400"> · {failing} failed</span>}
          </p>
        </div>
        <IconArrowRight className="h-4 w-4 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="mt-3 line-clamp-2 flex-1 text-sm text-zinc-600 dark:text-zinc-400">{detail}</p>
      {stats && (
        <div className="mt-4 flex gap-6 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {stats.map((st) => (
            <div key={st.label}>
              <div className="text-lg font-semibold tabular-nums">{st.value.toLocaleString("en-IN")}</div>
              <div className="text-xs text-zinc-500">{st.label}</div>
            </div>
          ))}
        </div>
      )}
    </Link>
  );
}

// ---------- Directory ----------

type StatusFilter = "all" | "idle" | "crawling" | "error";
type SortKey = "activity" | "name" | "checked" | "added";

const STATUS = {
  idle: { label: "Monitoring", dot: "bg-emerald-500", text: "text-emerald-700 dark:text-emerald-400" },
  crawling: { label: "Checking now", dot: "bg-sky-500 animate-pulse", text: "text-sky-700 dark:text-sky-400" },
  error: { label: "Check failed", dot: "bg-amber-500", text: "text-amber-700 dark:text-amber-400" },
} as const;

const SORTS: { key: SortKey; label: string }[] = [
  { key: "activity", label: "Most active" },
  { key: "name", label: "Name (A–Z)" },
  { key: "checked", label: "Recently checked" },
  { key: "added", label: "Recently added" },
];

const time = (iso: string | null) => (iso ? new Date(iso).getTime() : 0);

export function CompetitorDirectory({
  competitors,
  now,
  groups,
  emptyText = "Add one above, e.g. ABC Travel — https://abctravel.com",
}: {
  competitors: CompetitorRow[];
  now: number;
  groups: GroupOption[];
  emptyText?: string;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sort, setSort] = useState<SortKey>("activity");

  const counts = useMemo(
    () => ({
      all: competitors.length,
      idle: competitors.filter((c) => c.status === "idle").length,
      crawling: competitors.filter((c) => c.status === "crawling").length,
      error: competitors.filter((c) => c.status === "error").length,
    }),
    [competitors],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = competitors.filter(
      (c) => (status === "all" || c.status === status) && (!q || c.name.toLowerCase().includes(q) || c.host.includes(q)),
    );
    const by: Record<SortKey, (a: CompetitorRow, b: CompetitorRow) => number> = {
      activity: (a, b) => b.changesThisWeek - a.changesThisWeek || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      checked: (a, b) => time(b.lastCheckedAt) - time(a.lastCheckedAt),
      added: (a, b) => time(b.createdAt) - time(a.createdAt),
    };
    return [...filtered].sort(by[sort]);
  }, [competitors, query, status, sort]);

  const maxActivity = Math.max(1, ...competitors.map((c) => c.changesThisWeek));

  if (competitors.length === 0) {
    return (
      <Card>
        <EmptyState>
          <IconGlobe className="mx-auto mb-3 h-8 w-8 text-zinc-300 dark:text-zinc-600" />
          <span className="block font-medium text-zinc-700 dark:text-zinc-300">No competitors yet</span>
          <span className="mt-1 block">{emptyText}</span>
        </EmptyState>
      </Card>
    );
  }

  const filters: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "idle", label: "Monitoring" },
    { key: "crawling", label: "Checking" },
    { key: "error", label: "Failed" },
  ];

  return (
    <div className="space-y-3">
      {/* Toolbar: search · status · sort, in one row. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <label className="relative flex-1 sm:max-w-xs">
          <span className="sr-only">Search competitors</span>
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or domain"
            className="w-full rounded-lg border border-zinc-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:focus:border-zinc-300"
          />
        </label>
        <div role="radiogroup" aria-label="Filter by status" className="flex gap-1 overflow-x-auto rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/70">
          {filters.map((f) => (
            <button
              key={f.key}
              type="button"
              role="radio"
              aria-checked={status === f.key}
              onClick={() => setStatus(f.key)}
              className={`flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors ${
                status === f.key
                  ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-950 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
              }`}
            >
              {f.label}
              <span className="text-xs tabular-nums text-zinc-400">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-zinc-500 sm:ml-auto">
          Sort
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <Card>
        {/* Column labels (wide screens only; rows become cards on phones). */}
        <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,2.4fr)_5.5rem] gap-4 border-b border-zinc-200 px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-zinc-500 lg:grid dark:border-zinc-800">
          <span>Competitor</span>
          <span>Status</span>
          <span>Activity · 7 days</span>
          <span>Latest notable change</span>
          <span className="sr-only">Actions</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState>No competitors match these filters.</EmptyState>
        ) : (
          <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {rows.map((c) => (
              <CompetitorItem key={c.id} c={c} now={now} maxActivity={maxActivity} groups={groups} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function CompetitorItem({ c, now, maxActivity, groups }: { c: CompetitorRow; now: number; maxActivity: number; groups: GroupOption[] }) {
  const s = STATUS[c.status];
  const href = `/competitors/${c.id}`;
  return (
    <li className="group relative grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 px-5 py-4 transition-colors hover:bg-zinc-50/80 lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1.3fr)_minmax(0,1.4fr)_minmax(0,2.4fr)_5.5rem] lg:items-center dark:hover:bg-zinc-800/30">
      {/* Identity */}
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={c.name} />
        <div className="min-w-0">
          <Link href={href} className="block truncate font-medium after:absolute after:inset-0 after:content-[''] hover:underline">
            {c.name}
          </Link>
          <a
            href={c.url}
            target="_blank"
            rel="noreferrer noopener"
            className="relative z-1 block truncate text-xs text-zinc-500 hover:text-zinc-800 hover:underline dark:hover:text-zinc-200"
          >
            {c.host}
          </a>
        </div>
      </div>

      {/* Actions (top-right on phones, last column on wide screens) */}
      <div className="relative z-1 flex items-center justify-end gap-0.5 lg:order-last">
        <CompactCheckButton id={c.id} name={c.name} running={c.status === "crawling"} />
        <CompetitorMenu
          id={c.id}
          name={c.name}
          url={c.url}
          maxPages={c.maxPages}
          groupId={c.groupId}
          groups={groups}
          redirectTo={`/competitors?group=${c.groupId ?? "none"}`}
        />
      </div>

      {/* Status */}
      <div className="col-span-2 min-w-0 text-sm lg:col-span-1">
        <div className={`flex items-center gap-1.5 font-medium ${s.text}`}>
          <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
          {s.label}
        </div>
        <div className="mt-0.5 text-xs text-zinc-500" title={formatDateTime(c.lastCheckedAt)}>
          {c.status === "crawling"
            ? "Started recently"
            : c.status === "error"
              ? <span className="line-clamp-1" title={c.lastError ?? ""}>{c.lastError ?? "Retry with the check button"}</span>
              : <span className="whitespace-nowrap">{timeAgo(c.lastCheckedAt, now)}{c.nextCheckAt && ` · next ${timeUntil(c.nextCheckAt, now)}`}</span>}
        </div>
      </div>

      {/* Activity: single-hue bar relative to the most active competitor + pages coverage */}
      <div className="col-span-2 min-w-0 lg:col-span-1">
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-magnitude"
              style={{ width: `${c.changesThisWeek ? Math.max(4, (c.changesThisWeek / maxActivity) * 100) : 0}%` }}
            />
          </div>
          <span className="w-10 text-right text-sm font-semibold tabular-nums">{c.changesThisWeek}</span>
        </div>
        <div className="mt-0.5 text-xs text-zinc-500">
          changes · <span title={`Page limit per check: ${c.maxPages}`}>{c.pagesMonitored} pages tracked</span>
        </div>
      </div>

      {/* Latest notable change */}
      <div className="col-span-2 min-w-0 lg:col-span-1">
        {c.highlight ? (
          <a
            href={c.highlight.url}
            target="_blank"
            rel="noreferrer noopener"
            className="relative z-1 block min-w-0 rounded-lg hover:underline"
            title={c.highlight.summary}
          >
            <span className="flex items-center gap-1.5 text-xs text-zinc-500">
              <span aria-hidden>{CHANGE_META[c.highlight.type].icon}</span>
              <span className="font-medium text-zinc-700 dark:text-zinc-300">{CHANGE_META[c.highlight.type].label}</span>
              <span>· {timeAgo(c.highlight.at, now)}</span>
            </span>
            <span className="mt-0.5 block truncate text-sm">{c.highlight.summary || displayUrl(c.highlight.url)}</span>
          </a>
        ) : (
          <span className="text-sm text-zinc-400">No new pages or price changes yet</span>
        )}
      </div>
    </li>
  );
}

function timeUntil(iso: string, now: number): string {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "due now";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `in ${hours} h` : `in ${Math.round(hours / 24)} d`;
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-sm font-semibold text-zinc-600 ring-1 ring-inset ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700">
      {initials || "?"}
    </div>
  );
}

/** "⋯" menu: secondary and destructive actions, kept out of the main line. */
export function CompetitorMenu({
  id,
  name,
  url,
  redirectTo,
  showOpen = true,
  maxPages,
  groupId = null,
  groups,
}: {
  id: string;
  name: string;
  url: string;
  /** When given, the menu offers "Edit name & page limit". */
  maxPages?: number;
  groupId?: string | null;
  /** When given, the menu offers "Move to parent". */
  groups?: GroupOption[];
  /** Where to go after deleting (the detail page sends you back to the list). */
  redirectTo?: string;
  showOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    setEditing(false);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) {
        setOpen(false);
        setEditing(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const item = "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800";
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${name}`}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="19" cy="12" r="1.75" />
        </svg>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute right-0 top-full z-20 mt-1 rounded-lg border border-zinc-200 bg-white p-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900 ${
            editing ? "w-72" : "w-56"
          }`}
        >
          {editing && maxPages !== undefined ? (
            <EditCompetitorForm id={id} name={name} maxPages={maxPages} onDone={close} />
          ) : (
            <>
            {showOpen && (
              <Link href={`/competitors/${id}`} role="menuitem" className={item}>
                <IconArrowRight className="h-4 w-4 text-zinc-400" />
                Open details
              </Link>
            )}
            <a href={url} target="_blank" rel="noreferrer noopener" role="menuitem" className={item}>
              <IconGlobe className="h-4 w-4 text-zinc-400" />
              Visit website
            </a>
            {groups && groups.length > 0 && (
              <>
                <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
                <MoveCompetitorSelect id={id} groupId={groupId} groups={groups} />
              </>
            )}
            <div className="my-1 border-t border-zinc-100 dark:border-zinc-800" />
            {maxPages !== undefined && (
              <button type="button" role="menuitem" onClick={() => setEditing(true)} className={item}>
                <svg viewBox="0 0 24 24" className="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" strokeWidth={1.75} aria-hidden>
                  <path d="M4 20h4L19 9l-4-4L4 16v4Z" strokeLinejoin="round" />
                </svg>
                Edit name & page limit
              </button>
            )}
            <DeleteCompetitorButton id={id} name={name} redirectTo={redirectTo} variant="menu" />
            </>
          )}
        </div>
      )}
    </div>
  );
}
