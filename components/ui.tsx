import type { ReactNode } from "react";
import { CHANGE_META } from "@/lib/change-meta";
import type { ChangeType } from "@/lib/models";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
      <h2 className="text-sm font-semibold">{title}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: ReactNode; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-zinc-500">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card className="px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </Card>
  );
}

const TONE: Record<string, string> = {
  add: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-900",
  remove: "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-900",
  edit: "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-900",
  price: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-900",
};

export function ChangeBadge({ type }: { type: ChangeType }) {
  const meta = CHANGE_META[type];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[meta.tone]}`}>
      <span aria-hidden>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

export function StatusBadge({ status }: { status: "idle" | "crawling" | "error" }) {
  const styles = {
    idle: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    crawling: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    error: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  }[status];
  const label = { idle: "Monitoring", crawling: "Checking…", error: "Error" }[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${styles}`}>
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "crawling" ? "animate-pulse" : ""}`} />
      {label}
    </span>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-zinc-500">{children}</div>;
}

export function Skeleton({ className = "h-32" }: { className?: string }) {
  return <div className={`animate-pulse rounded-xl bg-zinc-200/70 dark:bg-zinc-800/70 ${className}`} />;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
      {children}
    </div>
  );
}
