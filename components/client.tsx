"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useActionState, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  addCompetitorAction,
  addGroupAction,
  archiveNowAction,
  checkNowAction,
  deleteCompetitorAction,
  deleteGroupAction,
  loginAction,
  moveCompetitorAction,
  updateCompetitorAction,
  type FormState,
} from "@/app/actions";
import { IconRefresh } from "./icons";

const input =
  "w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-950 dark:focus:border-zinc-300";
export const buttonPrimary =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200";
export const buttonSecondary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800";

function SubmitButton({ children, pendingText, className = buttonPrimary }: { children: ReactNode; pendingText: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={className}>
      {pending ? pendingText : children}
    </button>
  );
}

function Message({ state }: { state: FormState }) {
  if (state?.error) return <p className="text-sm text-rose-600 dark:text-rose-400">{state.error}</p>;
  if (state?.ok) return <p className="text-sm text-emerald-700 dark:text-emerald-400">{state.ok}</p>;
  return null;
}

export function LoginForm() {
  const [state, action] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Username</span>
        <input name="username" autoComplete="username" required defaultValue={state?.fields?.username} className={input} />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={input} />
      </label>
      <Message state={state} />
      <SubmitButton pendingText="Signing in…" className={`${buttonPrimary} w-full`}>
        Sign in
      </SubmitButton>
    </form>
  );
}

/** Add form: the parent group comes first (pick one or type a new one), then the competitor's site. */
export function AddCompetitorForm({
  defaultMaxPages,
  groups,
  defaultGroupId,
}: {
  defaultMaxPages: number;
  groups: { id: string; name: string }[];
  defaultGroupId?: string;
}) {
  const [state, action] = useActionState(addCompetitorAction, undefined);
  const fields = state?.fields;
  const [groupId, setGroupId] = useState(fields?.groupId || defaultGroupId || (groups.length ? "" : "new"));
  // After a successful add, keep the parent that was just used (it may have been created by that add).
  const [lastState, setLastState] = useState(state);
  if (state !== lastState) {
    setLastState(state);
    if (state?.fields?.groupId) setGroupId(state.fields.groupId);
  }

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-500">Parent</span>
          <select name="groupId" required value={groupId} onChange={(e) => setGroupId(e.target.value)} className={input}>
            <option value="" disabled>
              Choose a parent…
            </option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            <option value="new">+ Add new parent</option>
          </select>
        </label>
        {groupId === "new" && (
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-zinc-500">New parent name</span>
            <input name="newGroup" placeholder="CourseUnbox" required maxLength={100} defaultValue={fields?.newGroup} className={input} autoFocus />
          </label>
        )}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_8rem_auto] sm:items-end">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-500">Competitor name</span>
          <input name="name" placeholder="ABC Travel" required maxLength={100} defaultValue={fields?.name} className={input} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-500">Website URL</span>
          <input name="url" placeholder="https://abctravel.com" required defaultValue={fields?.url} className={input} />
        </label>
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-500">Max pages</span>
          <input name="maxPages" type="number" min={1} max={1000} defaultValue={fields?.maxPages || defaultMaxPages} className={input} />
        </label>
        <SubmitButton pendingText="Adding…">Add competitor</SubmitButton>
      </div>
      <Message state={state} />
    </form>
  );
}

export function AddGroupForm() {
  const [state, action] = useActionState(addGroupAction, undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 space-y-1.5">
          <span className="text-xs font-medium text-zinc-500">Parent name</span>
          <input name="name" placeholder="CourseUnbox" required maxLength={100} defaultValue={state?.fields?.name} className={input} autoFocus />
        </label>
        <SubmitButton pendingText="Creating…">Create parent</SubmitButton>
      </div>
      <Message state={state} />
    </form>
  );
}

/** Rename a competitor or change how many pages each check reads. */
export function EditCompetitorForm({
  id,
  name,
  maxPages,
  onDone,
}: {
  id: string;
  name: string;
  maxPages: number;
  onDone?: () => void;
}) {
  const [state, action] = useActionState(updateCompetitorAction, undefined);
  const fields = state?.fields;
  return (
    <form action={action} className="space-y-2.5 p-2.5">
      <input type="hidden" name="id" value={id} />
      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-500">Name</span>
        <input name="name" required maxLength={100} defaultValue={fields?.name ?? name} className={input} autoFocus />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-zinc-500">Max pages per check</span>
        <input name="maxPages" type="number" min={1} max={1000} required defaultValue={fields?.maxPages ?? maxPages} className={input} />
        <span className="block text-[11px] leading-snug text-zinc-400">More pages = more prices and content watched, but slower checks.</span>
      </label>
      <Message state={state} />
      <div className="flex gap-2">
        <SubmitButton pendingText="Saving…" className={`${buttonPrimary} flex-1 py-1.5`}>
          Save
        </SubmitButton>
        {onDone && (
          <button type="button" onClick={onDone} className={buttonSecondary}>
            {state?.ok ? "Close" : "Cancel"}
          </button>
        )}
      </div>
    </form>
  );
}

/** Menu row that moves a competitor under another parent. */
export function MoveCompetitorSelect({ id, groupId, groups }: { id: string; groupId: string | null; groups: { id: string; name: string }[] }) {
  return (
    <form action={moveCompetitorAction} className="px-2.5 py-1.5">
      <input type="hidden" name="id" value={id} />
      <label className="block space-y-1">
        <span className="text-xs text-zinc-500">Move to parent</span>
        <select
          name="groupId"
          defaultValue={groupId ?? ""}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-950"
        >
          <option value="" disabled>
            Choose…
          </option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}

export function DeleteGroupButton({ id, name }: { id: string; name: string }) {
  return (
    <form
      action={deleteGroupAction}
      onSubmit={(e) => {
        if (!confirm(`Delete the empty parent ${name}?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      <SubmitButton pendingText="Deleting…" className={`${buttonSecondary} text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950`}>
        Delete parent
      </SubmitButton>
    </form>
  );
}

function CompactCheckSubmit({ name }: { name: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      title={`Check ${name} now`}
      aria-label={`Check ${name} now`}
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
    >
      <IconRefresh className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} />
    </button>
  );
}

/** Icon-only "Check now" for dense lists; spins while a check is starting or running. */
export function CompactCheckButton({ id, name, running }: { id: string; name: string; running?: boolean }) {
  if (running) {
    return (
      <span title={`Checking ${name}…`} className="inline-flex h-8 w-8 items-center justify-center text-sky-500">
        <IconRefresh className="h-4 w-4 animate-spin" />
      </span>
    );
  }
  return (
    <form action={checkNowAction}>
      <input type="hidden" name="id" value={id} />
      <CompactCheckSubmit name={name} />
    </form>
  );
}

export function CheckNowButton({ id, disabled }: { id: string; disabled?: boolean }) {
  return (
    <form action={checkNowAction}>
      <input type="hidden" name="id" value={id} />
      {disabled ? (
        <button type="button" disabled className={buttonSecondary}>
          Checking…
        </button>
      ) : (
        <SubmitButton pendingText="Starting…" className={buttonSecondary}>
          ↻ Check now
        </SubmitButton>
      )}
    </form>
  );
}

export function DeleteCompetitorButton({
  id,
  name,
  redirectTo,
  variant = "button",
}: {
  id: string;
  name: string;
  redirectTo?: string;
  /** "menu": full-width item for a dropdown menu. */
  variant?: "button" | "menu";
}) {
  return (
    <form
      action={deleteCompetitorAction}
      onSubmit={(e) => {
        if (!confirm(`Delete ${name} and all of its snapshots and change history?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="id" value={id} />
      {redirectTo && <input type="hidden" name="redirectTo" value={redirectTo} />}
      <SubmitButton
        pendingText="Deleting…"
        className={
          variant === "menu"
            ? "flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50 disabled:opacity-50 dark:text-rose-400 dark:hover:bg-rose-950"
            : `${buttonSecondary} text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950`
        }
      >
        {variant === "menu" ? "Delete competitor…" : "Delete"}
      </SubmitButton>
    </form>
  );
}

export function ArchiveNowButton({ days }: { days: number }) {
  return (
    <form
      action={archiveNowAction}
      onSubmit={(e) => {
        if (!confirm(`Save all data older than ${days} days to CSV files and delete it from the database now?`)) e.preventDefault();
      }}
    >
      <SubmitButton pendingText="Archiving…" className={buttonSecondary}>
        Archive now
      </SubmitButton>
    </form>
  );
}

/** Opens the browser's print dialog, where "Save as PDF" turns the report into a file. */
export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={buttonPrimary}>
      Download PDF
    </button>
  );
}

/** Re-fetches server data every few seconds while a check is running. */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [active, intervalMs, router]);
  return null;
}

// usePathname suspends on dynamic routes (e.g. /competitors/[id]) under Cache Components,
// so render an inactive link as the fallback.
type NavLinkProps = { href: string; icon?: ReactNode; children: ReactNode };

export function NavLink(props: NavLinkProps) {
  return (
    <Suspense fallback={<NavLinkView {...props} active={false} />}>
      <ActiveNavLink {...props} />
    </Suspense>
  );
}

function ActiveNavLink(props: NavLinkProps) {
  const pathname = usePathname();
  const active = props.href === "/" ? pathname === "/" : pathname.startsWith(props.href);
  return <NavLinkView {...props} active={active} />;
}

function NavLinkView({ href, icon, active, children }: NavLinkProps & { active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`group flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white shadow-sm dark:bg-white dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
      }`}
    >
      {icon && (
        <span className={active ? "" : "text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300"}>{icon}</span>
      )}
      <span className="flex flex-1 items-center justify-between gap-2">{children}</span>
    </Link>
  );
}

// ---------- Desktop notifications ----------

const POLL_MS = 60_000;
const noopSubscribe = () => () => {};
const readPermission = (): NotificationPermission | "unsupported" =>
  "Notification" in window ? Notification.permission : "unsupported";

type LatestResponse = { now: string; items: { id: string; title: string; competitor: string; body: string }[] };

/** Shows a browser popup for every new alert while the dashboard is open (in any tab). */
export function DesktopNotifier() {
  const router = useRouter();
  const current = useSyncExternalStore(noopSubscribe, readPermission, () => "default" as const);
  const [requested, setRequested] = useState<NotificationPermission | null>(null);
  const permission = requested ?? current;
  const enabled = permission === "granted";

  useEffect(() => {
    if (!enabled) return;
    let since: string | null = null; // server time, so client clock skew can't skip alerts
    const poll = async () => {
      try {
        const res = await fetch(`/api/notifications/latest${since ? `?since=${encodeURIComponent(since)}` : ""}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as LatestResponse;
        if (since) {
          for (const n of [...data.items].reverse()) {
            const popup = new Notification(`${n.title} — ${n.competitor}`, { body: n.body, tag: n.id });
            popup.onclick = () => {
              window.focus();
              router.push("/notifications");
              popup.close();
            };
          }
          if (data.items.length) router.refresh();
        }
        since = data.now;
      } catch {
        // Offline or server restarting: try again next tick.
      }
    };
    void poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, router]);

  if (permission === "unsupported") return null;
  if (permission === "denied") {
    return <p className="px-3 text-xs text-zinc-500">🔕 Desktop alerts blocked in browser settings</p>;
  }
  if (enabled) return <p className="px-3 text-xs text-zinc-500">🔔 Desktop alerts on</p>;
  return (
    <button
      type="button"
      onClick={async () => setRequested(await Notification.requestPermission())}
      className="rounded-lg px-3 py-2 text-left text-sm text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
    >
      🔔 Enable desktop alerts
    </button>
  );
}
