import { Suspense } from "react";
import { logoutAction } from "@/app/actions";
import { DesktopNotifier, NavLink } from "@/components/client";
import { IconBell, IconDashboard, IconGlobe, IconLogout, IconRadar } from "@/components/icons";
import { getUnreadCount } from "@/lib/queries";

async function UnreadBadge() {
  const unread = await getUnreadCount();
  if (!unread) return null;
  return (
    <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white tabular-nums">
      {unread > 99 ? "99+" : unread}
    </span>
  );
}

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="z-20 print:hidden md:sticky md:top-0 border-b border-zinc-200 bg-white/90 backdrop-blur md:h-screen md:w-64 md:shrink-0 md:border-b-0 md:border-r md:bg-white dark:border-zinc-800 dark:bg-zinc-900/90 md:dark:bg-zinc-900">
        <div className="flex flex-col gap-3 px-3 py-3 md:h-full md:gap-6 md:px-4 md:py-5">
          <div className="flex items-center gap-2.5 px-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-linear-to-br from-zinc-800 to-zinc-950 text-white shadow-sm dark:from-white dark:to-zinc-300 dark:text-zinc-900">
              <IconRadar className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Competitor Monitor</div>
              <div className="hidden text-xs text-zinc-500 md:block">Track · Compare · Act</div>
            </div>
          </div>

          <nav aria-label="Main" className="-mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:flex-col md:px-0">
            <p className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400 md:block">Workspace</p>
            <NavLink href="/" icon={<IconDashboard />}>
              Dashboard
            </NavLink>
            <NavLink href="/competitors" icon={<IconGlobe />}>
              Competitors
            </NavLink>
            <NavLink href="/notifications" icon={<IconBell />}>
              <span>Notifications</span>
              <Suspense>
                <UnreadBadge />
              </Suspense>
            </NavLink>
          </nav>

          <div className="flex items-center justify-between gap-1 border-zinc-200 md:mt-auto md:block md:space-y-1 md:border-t md:pt-4 dark:border-zinc-800">
            <DesktopNotifier />
            <form action={logoutAction}>
              <button className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
                <IconLogout />
                Sign out
              </button>
            </form>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
        <div className="mx-auto max-w-7xl">{children}</div>
      </main>
    </div>
  );
}
