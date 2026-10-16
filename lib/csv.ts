import "server-only";
import { CHANGE_META } from "./change-meta";
import { config } from "./config";
import type { ChangeDoc } from "./models";

/** Quotes a CSV cell; a leading = + - @ is neutralised so Excel doesn't run it as a formula. */
function cell(value: unknown): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const row = (values: unknown[]) => values.map(cell).join(",") + "\r\n";

export const csvDate = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: config.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(",", "");

/** First line of a changes CSV; the BOM makes Excel read it as UTF-8 (Hindi text, ₹ signs). */
export const CHANGES_CSV_HEADER =
  "﻿" + row(["Date", "Competitor", "Website", "Change", "URL", "Summary", "Old value", "New value", "Added", "Removed"]);

export const CHANGE_CSV_FIELDS = "competitorId type url summary oldValue newValue added removed createdAt";

export function changeCsvRow(ch: ChangeDoc, competitor?: { name: string; host: string }): string {
  return row([
    csvDate(ch.createdAt),
    competitor?.name,
    competitor?.host,
    CHANGE_META[ch.type]?.label ?? ch.type,
    ch.url,
    ch.summary,
    ch.oldValue,
    ch.newValue,
    ch.added?.join(" | "),
    ch.removed?.join(" | "),
  ]);
}

/** File-name-safe version of a group name. */
export const slug = (name: string) => name.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "group";
