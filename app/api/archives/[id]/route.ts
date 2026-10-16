import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { Types } from "mongoose";
import { connection } from "next/server";
import { archiveRoot } from "@/lib/archive";
import { isAuthenticated } from "@/lib/auth/dal";
import { connectDB } from "@/lib/db";
import { Archive } from "@/lib/models";

/** Downloads one CSV archive written by the retention job. */
export async function GET(_request: Request, ctx: RouteContext<"/api/archives/[id]">) {
  await connection();
  if (!(await isAuthenticated())) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  if (!Types.ObjectId.isValid(id)) return Response.json({ error: "Not found" }, { status: 404 });

  await connectDB();
  const archive = await Archive.findById(id).lean();
  if (!archive) return Response.json({ error: "Not found" }, { status: 404 });
  const root = archiveRoot();
  const file = path.resolve(root, archive.file);
  if (!file.startsWith(root + path.sep)) return Response.json({ error: "Not found" }, { status: 404 });
  const info = await stat(file).catch(() => null);
  if (!info) return Response.json({ error: `File is missing on the server: ${archive.file}` }, { status: 410 });

  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="${path.basename(path.dirname(file))}_${path.basename(file)}"`,
      "Cache-Control": "no-store",
    },
  });
}
