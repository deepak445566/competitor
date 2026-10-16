"use server";

import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { Types } from "mongoose";
import { requireAdmin } from "@/lib/auth/dal";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  checkCredentials,
  createSessionToken,
} from "@/lib/auth/session-token";
import { runArchive } from "@/lib/archive";
import { config } from "@/lib/config";
import { parseSiteUrl, siteHost } from "@/lib/crawler/url";
import { connectDB } from "@/lib/db";
import { Change, Competitor, FeedItem, Group, Notification, Page, Snapshot } from "@/lib/models";
import { startCheck } from "@/lib/monitor";
import { runUploadWatch } from "@/lib/scheduler";

// React resets a form after its action runs; `fields` echoes input back so errors don't wipe it.
/**
 * Let background work finish after the response is sent. On a normal Node server it would anyway;
 * on serverless hosts (Vercel) after() keeps the function alive until it does, up to maxDuration.
 */
function keepAlive(work: Promise<void> | null | undefined) {
  if (work) after(() => work.catch((err) => console.error("[background]", err)));
}

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

/** Finds a group by name (case-insensitive) or creates it, so "courseunbox" and "CourseUnbox" stay one parent. */
async function findOrCreateGroup(name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existing = await Group.findOne({ name: { $regex: `^${escaped}$`, $options: "i" } });
  return existing ?? (await Group.create({ name }));
}

export async function addGroupAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Parent name is required" };
  if (name.length > 100) return { error: "Name is too long", fields: { name } };
  await connectDB();
  const group = await findOrCreateGroup(name);
  redirect(`/competitors?group=${group._id}`);
}

export async function deleteGroupAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!Types.ObjectId.isValid(id)) return;
  await connectDB();
  // Only empty parents can be deleted; competitors are never removed as a side effect.
  if (await Competitor.exists({ groupId: id })) return;
  await Group.deleteOne({ _id: id });
  redirect("/competitors");
}

export async function moveCompetitorAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const groupId = String(formData.get("groupId") ?? "");
  if (!Types.ObjectId.isValid(id) || !Types.ObjectId.isValid(groupId)) return;
  await connectDB();
  if (!(await Group.exists({ _id: groupId }))) return;
  await Competitor.updateOne({ _id: id }, { $set: { groupId } });
  refresh();
}

export async function addCompetitorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const groupId = String(formData.get("groupId") ?? "");
  const newGroup = String(formData.get("newGroup") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const rawUrl = String(formData.get("url") ?? "");
  const url = parseSiteUrl(rawUrl);
  const maxPagesRaw = Number(formData.get("maxPages") || config.crawlMaxPages);
  const fail = (error: string): FormState => ({
    error,
    fields: { groupId, newGroup, name, url: rawUrl, maxPages: String(formData.get("maxPages") ?? "") },
  });

  const creatingGroup = groupId === "new";
  if (creatingGroup ? !newGroup : !Types.ObjectId.isValid(groupId)) return fail("Choose a parent or add a new one");
  if (newGroup.length > 100) return fail("Parent name is too long");
  if (!name) return fail("Name is required");
  if (name.length > 100) return fail("Name is too long");
  if (!url) return fail("Enter a valid website URL, e.g. https://abctravel.com");
  if (!Number.isInteger(maxPagesRaw) || maxPagesRaw < 1 || maxPagesRaw > 1000) {
    return fail("Max pages must be between 1 and 1000");
  }

  await connectDB();
  const host = siteHost(url.hostname);
  if (await Competitor.exists({ host })) return fail(`${host} is already being monitored`);
  const group = creatingGroup ? await findOrCreateGroup(newGroup) : await Group.findById(groupId);
  if (!group) return fail("That parent no longer exists");

  const competitor = await Competitor.create({ groupId: group._id, name, url: url.toString(), host, maxPages: maxPagesRaw });
  // First check runs right away and becomes the baseline snapshot.
  keepAlive((await startCheck(String(competitor._id)))?.run);
  refresh();
  return { ok: `${name} added to ${group.name}. Capturing the first snapshot…`, fields: { groupId: String(group._id) } };
}

export async function updateCompetitorAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const maxPagesRaw = Number(formData.get("maxPages"));
  const fail = (error: string): FormState => ({ error, fields: { name, maxPages: String(formData.get("maxPages") ?? "") } });

  if (!Types.ObjectId.isValid(id)) return fail("Competitor not found");
  if (!name) return fail("Name is required");
  if (name.length > 100) return fail("Name is too long");
  if (!Number.isInteger(maxPagesRaw) || maxPagesRaw < 1 || maxPagesRaw > 1000) return fail("Max pages must be between 1 and 1000");

  await connectDB();
  const res = await Competitor.updateOne({ _id: id }, { $set: { name, maxPages: maxPagesRaw } });
  if (!res.matchedCount) return fail("Competitor not found");
  refresh();
  return { ok: "Saved. A new page limit applies from the next check.", fields: { name, maxPages: String(maxPagesRaw) } };
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
    FeedItem.deleteMany({ competitorId: id }),
  ]);
  await Competitor.deleteOne({ _id: id });
  const redirectTo = String(formData.get("redirectTo") ?? "");
  if (/^\/competitors(\?group=[0-9a-f]{24})?$/.test(redirectTo)) redirect(redirectTo);
  refresh();
}

export async function checkNowAction(formData: FormData) {
  await requireAdmin();
  keepAlive((await startCheck(String(formData.get("id") ?? "")))?.run);
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
  keepAlive(runUploadWatch().then(() => {}));
  refresh();
}

// ---------- Storage ----------

/** Archive now instead of waiting for the 7-day schedule: old data goes to CSV, then out of the database. */
export async function archiveNowAction() {
  await requireAdmin();
  await runArchive({ force: true });
  refresh();
}
