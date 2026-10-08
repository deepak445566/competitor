import "server-only";
import nodemailer from "nodemailer";
import type { Types } from "mongoose";
import { CHANGE_META, CHANGE_ORDER, summaryLines } from "./change-meta";
import { config } from "./config";
import type { ChangeDraft } from "./diff";
import { Notification, type ChangeType } from "./models";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function emailConfigured(): boolean {
  return !!(config.smtp.host && config.smtp.from && config.notifyEmail);
}

async function sendEmail(subject: string, text: string, html: string): Promise<void> {
  const transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.port === 465,
    auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined,
  });
  await transport.sendMail({ from: config.smtp.from, to: config.notifyEmail, subject, text, html });
}

interface NotifyTarget {
  _id: Types.ObjectId;
  name: string;
}

// Changes worth naming one by one in an alert, most important first.
const ITEM_TYPES: ChangeType[] = [
  "new_blog",
  "new_product",
  "new_page",
  "price_change",
  "deleted_page",
  "seo_change",
  "title_change",
];
const MAX_ITEMS = 20;

/** In-app notification + email for changes (from a full check or the new-upload watch). */
export async function notifyChanges(
  competitor: NotifyTarget,
  snapshotId: Types.ObjectId,
  changes: ChangeDraft[],
  title = "🚨 Competitor Update",
) {
  const counts: Partial<Record<ChangeType, number>> = {};
  for (const c of changes) counts[c.type] = (counts[c.type] ?? 0) + (c.count ?? 1);
  const lines = summaryLines(counts);
  const items = changes
    .filter((c) => ITEM_TYPES.includes(c.type))
    .sort((a, b) => ITEM_TYPES.indexOf(a.type) - ITEM_TYPES.indexOf(b.type))
    .slice(0, MAX_ITEMS)
    .map((c) => ({ type: c.type, url: c.url, text: c.summary }));
  const detailUrl = `${config.appUrl.replace(/\/$/, "")}/competitors/${competitor._id}`;

  let emailStatus: "sent" | "skipped" | "failed" = "skipped";
  let emailError: string | null = emailConfigured() ? null : "Email not configured (SMTP_HOST / EMAIL_FROM / NOTIFY_EMAIL)";

  if (emailConfigured()) {
    const top = [...changes]
      .sort((a, b) => CHANGE_ORDER.indexOf(a.type) - CHANGE_ORDER.indexOf(b.type))
      .slice(0, 25);
    const text = [
      title,
      "",
      competitor.name,
      "",
      ...lines,
      "",
      ...top.map((c) => `${CHANGE_META[c.type].label}: ${c.url} — ${c.summary}`),
      "",
      `View details: ${detailUrl}`,
    ].join("\n");
    const html = `
      <div style="font-family:system-ui,Arial,sans-serif;max-width:640px">
        <h2 style="margin:0 0 4px">${title}</h2>
        <h3 style="margin:0 0 16px;color:#444">${escapeHtml(competitor.name)}</h3>
        <ul style="padding-left:18px;font-size:15px">${lines.map((l) => `<li><strong>${escapeHtml(l)}</strong></li>`).join("")}</ul>
        <table style="border-collapse:collapse;font-size:13px;width:100%">
          ${top
            .map(
              (c) => `<tr style="border-top:1px solid #eee">
                <td style="padding:6px 8px;white-space:nowrap">${CHANGE_META[c.type].icon} ${CHANGE_META[c.type].label}</td>
                <td style="padding:6px 8px"><a href="${escapeHtml(c.url)}">${escapeHtml(c.url)}</a><br><span style="color:#666">${escapeHtml(c.summary)}</span></td>
              </tr>`,
            )
            .join("")}
        </table>
        <p><a href="${escapeHtml(detailUrl)}">View full change history →</a></p>
      </div>`;
    try {
      const headline =
        items.length === 1
          ? `${CHANGE_META[items[0].type].label}: ${items[0].text}`
          : lines.slice(0, 3).join(", ");
      await sendEmail(`${title}: ${competitor.name} — ${headline}`, text, html);
      emailStatus = "sent";
    } catch (err) {
      emailStatus = "failed";
      emailError = err instanceof Error ? err.message : String(err);
      console.error(`[notify] email failed for ${competitor.name}:`, emailError);
    }
  }

  await Notification.create({
    competitorId: competitor._id,
    competitorName: competitor.name,
    snapshotId,
    title,
    lines,
    items,
    emailStatus,
    emailError,
  });
}

/** In-app only: first successful crawl of a competitor. */
export async function notifyBaseline(competitor: NotifyTarget, snapshotId: Types.ObjectId, pages: number) {
  await Notification.create({
    competitorId: competitor._id,
    competitorName: competitor.name,
    snapshotId,
    title: "✅ Baseline captured",
    lines: [`${pages} pages saved. Changes will be detected from the next check.`],
    emailStatus: "skipped",
  });
}

export async function notifyFailure(competitor: NotifyTarget, snapshotId: Types.ObjectId, error: string) {
  await Notification.create({
    competitorId: competitor._id,
    competitorName: competitor.name,
    snapshotId,
    title: "⚠️ Check failed",
    lines: [error.slice(0, 300)],
    emailStatus: "skipped",
  });
}
