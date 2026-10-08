"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { Types } from "mongoose";
import { requireAdmin } from "@/lib/auth/dal";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  checkCredentials,
  createSessionToken,
} from "@/lib/auth/session-token";
import { config } from "@/lib/config";
import { parseSiteUrl, siteHost } from "@/lib/crawler/url";
import { connectDB } from "@/lib/db";
import { Change, Competitor, Notification, Page, Snapshot } from "@/lib/models";
import { startCheck } from "@/lib/monitor";
import { runUploadWatch } from "@/lib/scheduler";

// React resets a form after its action runs; `fields` echoes input back so errors don't wipe it.
export type FormState = { error?: string; ok?: string; fields?: Record<string, string> } | undefined;

// ---------- Auth ----------

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  if (!config.adminUsername || !config.adminPassword) {
    return { error: "ADMIN_USERNAME and ADMIN_PASSWORD are not set in .env" };
  }
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  if (!checkCredentials(username, password)) {
    await new Promise((r) => setTimeout(r, 500)); // slow down guessing
    return { error: "Invalid username or password", fields: { username } };
  }
  (await cookies()).set(SESSION_COOKIE, createSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && config.appUrl.startsWith("https://"),
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  redirect("/");
}

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---------- Competitors ----------

export async function addCompetitorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  const rawUrl = String(formData.get("url") ?? "");
  const url = parseSiteUrl(rawUrl);
  const maxPagesRaw = Number(formData.get("maxPages") || config.crawlMaxPages);
  const fail = (error: string): FormState => ({
    error,
    fields: { name, url: rawUrl, maxPages: String(formData.get("maxPages") ?? "") },
  });

  if (!name) return fail("Name is required");
  if (name.length > 100) return fail("Name is too long");
  if (!url) return fail("Enter a valid website URL, e.g. https://abctravel.com");
  if (!Number.isInteger(maxPagesRaw) || maxPagesRaw < 1 || maxPagesRaw > 1000) {
    return fail("Max pages must be between 1 and 1000");
  }

  await connectDB();
  const host = siteHost(url.hostname);
  if (await Competitor.exists({ host })) return fail(`${host} is already being monitored`);

  const competitor = await Competitor.create({ name, url: url.toString(), host, maxPages: maxPagesRaw });
  // First check runs right away and becomes the baseline snapshot.
  await startCheck(String(competitor._id));
  refresh();
  return { ok: `${name} added. Capturing the first snapshot…` };
}

export async function deleteCompetitorAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!Types.ObjectId.isValid(id)) return;
  await connectDB();
  await Promise.all([
    Page.deleteMany({ competitorId: id }),
    Change.deleteMany({ competitorId: id }),
    Snapshot.deleteMany({ competitorId: id }),
    Notification.deleteMany({ competitorId: id }),
  ]);
  await Competitor.deleteOne({ _id: id });
  if (formData.get("redirectTo") === "/competitors") redirect("/competitors");
  refresh();
}

export async function checkNowAction(formData: FormData) {
  await requireAdmin();
  await startCheck(String(formData.get("id") ?? ""));
  refresh();
}

// ---------- Notifications ----------

export async function markAllReadAction() {
  await requireAdmin();
  await connectDB();
  await Notification.updateMany({ read: false }, { $set: { read: true } });
  refresh();
}

/** Run the new-upload watch (RSS feeds + sitemap) right away; it normally runs every WATCH_INTERVAL_MINUTES. */
export async function watchNowAction() {
  await requireAdmin();
  void runUploadWatch().catch((err) => console.error("[watch]", err));
  refresh();
}
