"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useActionState, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import {
  addCompetitorAction,
  checkNowAction,
  deleteCompetitorAction,
  loginAction,
  type FormState,
} from "@/app/actions";

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

export function AddCompetitorForm({ defaultMaxPages }: { defaultMaxPages: number }) {
  const [state, action] = useActionState(addCompetitorAction, undefined);
  const fields = state?.fields;

  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.5fr_8rem_auto] sm:items-end">
        <label className="space-y-1.5">
          <span className="text-xs font-medium text-zinc-500">Name</span>
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

export function DeleteCompetitorButton({ id, name, redirectTo }: { id: string; name: string; redirectTo?: string }) {
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
        className={`${buttonSecondary} text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950`}
      >
        Delete
      </SubmitButton>
    </form>
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
export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Suspense fallback={<NavLinkView href={href} active={false}>{children}</NavLinkView>}>
      <ActiveNavLink href={href}>{children}</ActiveNavLink>
    </Suspense>
  );
}

function ActiveNavLink({ href, children }: { href: string; children: ReactNode }) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return <NavLinkView href={href} active={active}>{children}</NavLinkView>;
}

function NavLinkView({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
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
