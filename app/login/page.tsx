import type { Metadata } from "next";
import { LoginForm } from "@/components/client";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-900 text-lg text-white dark:bg-white dark:text-zinc-900">
            ◎
          </div>
          <h1 className="text-xl font-semibold">Competitor Monitor</h1>
          <p className="mt-1 text-sm text-zinc-500">Admin sign in</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
