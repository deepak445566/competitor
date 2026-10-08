import "server-only";
import { config } from "./config";
import { recoverInterruptedChecks, runDueChecks } from "./monitor";
import { watchFeeds } from "./feeds";
import { watchNewUploads } from "./watch";

const TICK_MS = 5 * 60 * 1000;
const globalForScheduler = globalThis as unknown as { __cmScheduler?: boolean };

/** RSS first (exact titles/dates, cheap), then the sitemap watch for sites without feeds. Sequential, so no double alerts. */
export async function runUploadWatch(): Promise<number> {
  return (await watchFeeds()) + (await watchNewUploads());
}

/** Run `job` every `intervalMs` (first run after `delayMs`), never overlapping itself. */
function every(name: string, intervalMs: number, delayMs: number, job: () => Promise<number>) {
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const n = await job();
      if (n) console.log(`[scheduler] ${name}: ${n}`);
    } catch (err) {
      console.error(`[scheduler] ${name} failed:`, err instanceof Error ? err.message : err);
    } finally {
      busy = false;
    }
  };
  setTimeout(tick, delayMs).unref();
  setInterval(tick, intervalMs).unref();
}

/** In-process scheduler (no Redis/queue): full checks when due + a frequent new-upload watch. */
export function startScheduler() {
  if (globalForScheduler.__cmScheduler) return;
  globalForScheduler.__cmScheduler = true;

  recoverInterruptedChecks().catch((err) =>
    console.error("[scheduler] could not reach MongoDB:", err instanceof Error ? err.message : err),
  );

  if (config.checkIntervalHours > 0) {
    console.log(`[scheduler] full checks every ${config.checkIntervalHours}h`);
    // Every 5 min, re-check competitors whose last check is older than the interval.
    every("scheduled checks completed", TICK_MS, 60_000, runDueChecks);
  } else {
    console.log("[scheduler] automatic full checks disabled (CHECK_INTERVAL_HOURS=0)");
  }

  if (config.watchIntervalMinutes > 0) {
    console.log(`[scheduler] new-upload watch (RSS + sitemap) every ${config.watchIntervalMinutes} min`);
    every("new uploads found", config.watchIntervalMinutes * 60_000, 3 * 60_000, runUploadWatch);
  }
}
