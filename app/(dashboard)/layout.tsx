import { Suspense } from "react";
import { logoutAction } from "@/app/actions";
import { DesktopNotifier, NavLink } from "@/components/client";
import { getUnreadCount } from "@/lib/queries";

async function UnreadBadge() {
  const unread = await getUnreadCount();
  if (!unread) return null;
  return (
    <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
      {unread > 99 ? "99+" : unread}
    </span>
  );
}

export default function DashboardLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-full flex-1 flex-col md:flex-row">
      <aside className="border-b border-zinc-200 bg-white md:sticky md:top-0 md:h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex h-full flex-col gap-4 p-4">
          <div className="flex items-center gap-2 px-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
              ◎
            </div>
            <span className="font-semibold">Competitor Monitor</span>
          </div>
          <nav className="flex gap-1 overflow-x-auto md:flex-col">
            <NavLink href="/">Dashboard</NavLink>
            <NavLink href="/competitors">Competitors</NavLink>
            <NavLink href="/notifications">
              <span>Notifications</span>
              <Suspense>
                <UnreadBadge />
              </Suspense>
            </NavLink>
          </nav>
          <DesktopNotifier />
          <form action={logoutAction} className="md:mt-auto">
            <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
