import "server-only";
import ExcelJS from "exceljs";
import { formatDate, formatDateTime } from "./format";
import type { ChangeType } from "./models";
import type { CompetitorReport, Report, ReportDetail, ReportItem } from "./report";

// The report as an Excel workbook: a Summary sheet, then one sheet per kind of change with every entry.

const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18181B" } };
const BAND_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
const LINK_FONT: Partial<ExcelJS.Font> = { color: { argb: "FF1D4ED8" }, underline: true };

/** Excel refuses cells longer than 32,767 characters. */
const clip = (s: string) => (s.length > 32_000 ? `${s.slice(0, 32_000)}…` : s);
/** One entry per line, so lists stay readable inside a cell. */
const lines = (list: string[]) => clip(list.map((x) => `• ${x}`).join("\n"));

const seo = (c: Partial<Record<ChangeType, number>>) =>
  (c.title_change ?? 0) + (c.meta_change ?? 0) + (c.seo_change ?? 0) + (c.heading_change ?? 0);

interface Column<T> {
  header: string;
  width: number;
  value: (row: T, c: CompetitorReport) => string | number;
  /** Makes the cell a clickable link to this URL. */
  link?: (row: T) => string;
  wrap?: boolean;
}

/** A sheet with a dark frozen header row, filters, readable widths and wrapped long text. */
function listSheet<T>(wb: ExcelJS.Workbook, name: string, report: Report, pick: (c: CompetitorReport) => T[], columns: Column<T>[]) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [{ header: "Competitor", width: 16 }, ...columns.map((c) => ({ header: c.header, width: c.width }))];
  styleHeader(ws.getRow(1));
  let rows = 0;
  for (const comp of report.competitors) {
    for (const item of pick(comp)) {
      const row = ws.addRow([comp.name, ...columns.map((col) => { const v = col.value(item, comp); return typeof v === "string" ? clip(v) : v; })]);
      columns.forEach((col, i) => {
        const cell = row.getCell(i + 2);
        if (col.link) {
          cell.value = { text: String(col.value(item, comp)), hyperlink: col.link(item) };
          cell.font = LINK_FONT;
        }
        cell.alignment = { vertical: "top", wrapText: !!col.wrap };
      });
      row.getCell(1).alignment = { vertical: "top" };
      row.getCell(1).font = { bold: true };
      rows++;
    }
  }
  if (rows === 0) ws.addRow(["Nothing in this period."]).font = { italic: true, color: { argb: "FF71717A" } };
  else ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length + 1 } };
  return rows;
}

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.height = 20;
  row.alignment = { vertical: "middle" };
}

export async function reportToXlsx(report: Report): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Competitor Monitor";
  wb.created = new Date(report.generatedAt);

  // ---------- Summary ----------
  const ws = wb.addWorksheet("Summary", { views: [{ showGridLines: false }] });
  ws.columns = [{ width: 22 }, ...Array.from({ length: 9 }, () => ({ width: 12 }))];
  ws.addRow([`${report.group.name} — Competitor report`]).font = { bold: true, size: 18 };
  ws.addRow([
    `${formatDate(report.from)} – ${formatDate(report.to)}  ·  ${report.competitors.length} competitors  ·  generated ${formatDateTime(report.generatedAt)}`,
  ]).font = { color: { argb: "FF52525B" } };
  ws.addRow([]);
  ws.addRow(["Key takeaways"]).font = { bold: true, size: 13 };
  for (const h of report.highlights) {
    const r = ws.addRow([`•  ${h}`]);
    ws.mergeCells(r.number, 1, r.number, 10);
    r.alignment = { wrapText: true, vertical: "top" };
    r.height = Math.max(18, Math.ceil(h.length / 110) * 16);
  }
  ws.addRow([]);
  ws.addRow(["Who did what"]).font = { bold: true, size: 13 };
  const head = ws.addRow(["Competitor", "Blogs", "Products", "Pages", "Prices", "Removed", "SEO", "Content edits", "Links & images", "Total"]);
  styleHeader(head);
  report.competitors.forEach((c, i) => {
    const n = (t: ChangeType) => c.counts[t] ?? 0;
    const r = ws.addRow([
      `${c.name} (${c.host})`,
      n("new_blog"),
      n("new_product"),
      n("new_page"),
      n("price_change"),
      n("deleted_page"),
      seo(c.counts),
      n("content_change"),
      n("internal_link_added") + n("internal_link_removed") + n("image_change"),
      c.total,
    ]);
    r.getCell(1).font = { bold: true };
    r.getCell(10).font = { bold: true };
    if (i % 2) r.fill = BAND_FILL;
  });
  ws.getColumn(1).width = 34;
  if (report.topics.length) {
    ws.addRow([]);
    ws.addRow(["Topics they are writing about"]).font = { bold: true, size: 13 };
    const r = ws.addRow([report.topics.map((t) => `${t.term} (${t.count})`).join(",  ")]);
    ws.mergeCells(r.number, 1, r.number, 10);
    r.alignment = { wrapText: true, vertical: "top" };
    r.height = 48;
  }

  // ---------- One sheet per kind of change ----------
  const date = { header: "Date", width: 13, value: (i: { at: string }) => formatDate(i.at) };
  const item = (header: string): Column<ReportItem>[] => [
    date,
    { header, width: 70, wrap: true, value: (i) => i.title, link: (i) => i.url },
    { header: "URL", width: 50, value: (i) => i.url },
  ];
  listSheet(wb, "New Blogs", report, (c) => c.newBlogs, item("Blog title"));
  listSheet(wb, "New Products", report, (c) => c.newProducts, item("Product / package"));
  listSheet(wb, "Price Changes", report, (c) => c.prices, [
    date,
    { header: "Page", width: 55, wrap: true, value: (p) => p.url, link: (p) => p.url },
    { header: "Prices removed", width: 32, wrap: true, value: (p) => p.before },
    { header: "Prices added", width: 32, wrap: true, value: (p) => p.after },
  ]);
  listSheet(wb, "Pages Removed", report, (c) => c.removed, [
    date,
    { header: "Page", width: 55, wrap: true, value: (r) => r.url, link: (r) => r.url },
    { header: "Details", width: 60, wrap: true, value: (r) => r.text },
  ]);
  listSheet(wb, "Title Changes", report, (c) => c.titles, [
    date,
    { header: "Page", width: 40, wrap: true, value: (t) => t.url, link: (t) => t.url },
    { header: "Old title", width: 45, wrap: true, value: (t) => t.before },
    { header: "New title", width: 45, wrap: true, value: (t) => t.after },
  ]);
  listSheet(wb, "SEO Changes", report, (c) => c.seo, [
    date,
    { header: "Change", width: 60, wrap: true, value: (s) => s.text },
    { header: "Page", width: 50, value: (s) => s.url, link: (s) => s.url },
  ]);
  listSheet(wb, "Other New Pages", report, (c) => c.newPages, item("Page title"));

  // ---------- Smaller edits, every one of them ----------
  const of = (...types: ReportDetail["type"][]) => (c: CompetitorReport) => (c.details ?? []).filter((d) => types.includes(d.type));
  const page = (header = "Page"): Column<ReportDetail> => ({ header, width: 45, wrap: true, value: (d) => d.url, link: (d) => d.url });
  listSheet(wb, "Content Edits", report, of("content_change"), [
    date,
    page(),
    { header: "Change", width: 24, wrap: true, value: (d) => d.summary },
    { header: "Text added", width: 60, wrap: true, value: (d) => lines(d.added) },
    { header: "Text removed", width: 60, wrap: true, value: (d) => lines(d.removed) },
  ]);
  listSheet(wb, "Headings", report, of("heading_change"), [
    date,
    page(),
    { header: "Headings added", width: 50, wrap: true, value: (d) => lines(d.added) },
    { header: "Headings removed", width: 50, wrap: true, value: (d) => lines(d.removed) },
  ]);
  listSheet(wb, "Meta Descriptions", report, of("meta_change"), [
    date,
    page(),
    { header: "Old description", width: 55, wrap: true, value: (d) => d.oldValue },
    { header: "New description", width: 55, wrap: true, value: (d) => d.newValue },
  ]);
  listSheet(wb, "Internal Links", report, of("internal_link_added", "internal_link_removed"), [
    date,
    page("Linked page"),
    { header: "Link", width: 10, value: (d) => (d.type === "internal_link_added" ? "Added" : "Removed") },
    { header: "Summary", width: 22, value: (d) => d.summary },
    { header: "On these pages", width: 60, wrap: true, value: (d) => lines(d.added.length ? d.added : d.removed) },
  ]);
  listSheet(wb, "Images", report, of("image_change"), [
    date,
    page(),
    { header: "Summary", width: 20, value: (d) => d.summary },
    { header: "Images added", width: 55, wrap: true, value: (d) => lines(d.added) },
    { header: "Images removed", width: 55, wrap: true, value: (d) => lines(d.removed) },
  ]);

  return Buffer.from(await wb.xlsx.writeBuffer());
}
