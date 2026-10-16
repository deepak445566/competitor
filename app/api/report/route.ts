import { connection } from "next/server";
import { isAuthenticated } from "@/lib/auth/dal";
import { slug } from "@/lib/csv";
import { reportToXlsx } from "@/lib/excel";
import { getReport } from "@/lib/queries";

/**
 * The competitor report as an Excel file: `/api/report?group=<id>&days=7`, or `?archive=<id>` for an archived period.
 * Built from the same summary as the report page, not from the raw rows.
 */
export async function GET(request: Request) {
  await connection();
  if (!(await isAuthenticated())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const result = await getReport({
    group: params.get("group") ?? undefined,
    days: Number(params.get("days")) || undefined,
    archive: params.get("archive") ?? undefined,
    full: true,
  });
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  if ("error" in result) return Response.json({ error: result.error }, { status: 410 });

  const { report } = result;
  const day = (iso: string) => iso.slice(0, 10);
  const file = `${slug(report.group.name)}-competitor-report-${day(report.from)}-to-${day(report.to)}.xlsx`;
  return new Response(new Uint8Array(await reportToXlsx(report)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "no-store",
    },
  });
}
