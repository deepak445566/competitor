import { timingSafeEqual } from "node:crypto";
import { after, connection } from "next/server";
import { config } from "@/lib/config";
import { runDueChecks } from "@/lib/monitor";

/** Seconds this function may run on serverless hosts (Vercel Hobby max with Fluid compute). */
export const maxDuration = 300;

/**
 * External trigger for hosts where the in-process scheduler can't run (e.g. Vercel Cron,
 * which sends "Authorization: Bearer $CRON_SECRET" automatically), or system cron:
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

  // Checks can take minutes: answer right away, keep the function alive until they finish.
  after(() => runDueChecks().catch((err) => console.error("[cron]", err)));
  return Response.json({ started: true });
}
