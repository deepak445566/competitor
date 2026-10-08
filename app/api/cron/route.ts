import { timingSafeEqual } from "node:crypto";
import { connection } from "next/server";
import { config } from "@/lib/config";
import { runDueChecks } from "@/lib/monitor";

/**
 * Optional external trigger (e.g. system cron / Task Scheduler) for hosts where
 * the in-process scheduler isn't reliable:
 *   curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron
 */
export async function GET(request: Request) {
  await connection(); // never prerender: the response depends on the request's secret
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const expected = config.cronSecret;
  const ok =
    !!expected &&
    provided.length === expected.length &&
    timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  if (!ok) return Response.json({ error: "Unauthorized" }, { status: 401 });

  // Checks can take minutes; run them in the background and answer right away.
  void runDueChecks().catch((err) => console.error("[cron]", err));
  return Response.json({ started: true });
}
