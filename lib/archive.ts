import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { Types } from "mongoose";
import { config } from "./config";
import { CHANGES_CSV_HEADER, CHANGE_CSV_FIELDS, changeCsvRow, slug } from "./csv";
import { connectDB } from "./db";
import { Archive, Change, Competitor, Group, Notification, Page, Snapshot, type ChangeDoc } from "./models";
import { FULL_LIST, buildReport } from "./report";

const DAY = 86400_000;
const globalForArchive = globalThis as unknown as { __cmArchiving?: boolean };

export const archiveRoot = () => path.resolve(process.cwd(), config.archiveDir);

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** Why archiving can't run here, or null when it can. */
export function archiveUnavailable(): string | null {
  if (config.retentionDays <= 0) return "Archiving is off (RETENTION_DAYS=0).";
  // Serverless disks are wiped between requests: deleting after writing there would lose the data.
  if (process.env.VERCEL) return "Archiving needs a lasting disk; it is disabled on Vercel.";
  return null;
}

/** When the next automatic archive is due (null = as soon as some data is older than RETENTION_DAYS). */
export async function nextArchiveAt(): Promise<Date | null> {
  const last = await Archive.findOne().sort({ createdAt: -1 }).select("createdAt").lean();
  return last ? new Date(last.createdAt.getTime() + config.retentionDays * DAY) : null;
}

/**
 * Every RETENTION_DAYS days: write each parent's changes older than RETENTION_DAYS to a CSV in ARCHIVE_DIR,
 * then delete them (plus old notifications and snapshot records) from MongoDB.
 * A group's changes are deleted only after its file is completely written. `force` skips the 7-day wait.
 * Returns the number of changes archived.
 */
export async function runArchive({ force = false } = {}): Promise<number> {
  if (archiveUnavailable() || globalForArchive.__cmArchiving) return 0;
  globalForArchive.__cmArchiving = true;
  try {
    await connectDB();
    const now = Date.now();
    if (!force) {
      const next = await nextArchiveAt();
      if (next && next.getTime() > now) return 0;
    }
    const cutoff = new Date(now - config.retentionDays * DAY);

    const [groups, competitors] = await Promise.all([
      Group.find().select("name").lean(),
      Competitor.find().select("name host groupId lastSnapshotId").lean(),
    ]);
    const known = new Set(groups.map((g) => String(g._id)));
    const buckets = [
      ...groups.map((g) => ({ id: g._id as Types.ObjectId | null, name: g.name })),
      { id: null, name: "Without a parent" },
    ];

    let archived = 0;
    for (const bucket of buckets) {
      const members = competitors.filter((c) =>
        bucket.id ? String(c.groupId) === String(bucket.id) : !c.groupId || !known.has(String(c.groupId)),
      );
      if (members.length) archived += await archiveGroup(bucket, members, cutoff);
    }

    await pruneOldRecords(competitors, cutoff);
    if (archived) console.log(`[archive] moved ${archived} changes older than ${isoDay(cutoff)} to ${archiveRoot()}`);
    return archived;
  } finally {
    globalForArchive.__cmArchiving = false;
  }
}

async function archiveGroup(
  group: { id: Types.ObjectId | null; name: string },
  members: { _id: Types.ObjectId; name: string; host: string }[],
  cutoff: Date,
): Promise<number> {
  const filter = { competitorId: { $in: members.map((m) => m._id) }, createdAt: { $lt: cutoff } };
  const oldest = await Change.findOne(filter).sort({ createdAt: 1 }).select("createdAt").lean();
  if (!oldest) return 0;

  const byId = new Map(members.map((m) => [String(m._id), m]));
  const dir = `${slug(group.name)}-${group.id ?? "none"}`;
  let file = `${dir}/${isoDay(oldest.createdAt)}_to_${isoDay(cutoff)}.csv`;
  await mkdir(path.join(archiveRoot(), dir), { recursive: true });
  if (await stat(path.join(archiveRoot(), file)).catch(() => null)) file = file.replace(/\.csv$/, `_${Date.now()}.csv`);
  const target = path.join(archiveRoot(), file);
  const temp = `${target}.part`;

  // Same index order as the export: one competitor at a time, newest first, read in small batches.
  const cursor = Change.find(filter)
    .sort({ competitorId: 1, createdAt: -1 })
    .select(CHANGE_CSV_FIELDS)
    .lean<ChangeDoc[]>()
    .cursor({ batchSize: 500 });
  let rows = 0;
  async function* lines() {
    yield CHANGES_CSV_HEADER;
    for await (const ch of cursor as AsyncIterable<ChangeDoc>) {
      rows++;
      yield changeCsvRow(ch, byId.get(String(ch.competitorId)));
    }
  }
  try {
    await pipeline(Readable.from(lines()), createWriteStream(temp));
    await rename(temp, target);
  } catch (err) {
    await unlink(temp).catch(() => {});
    throw err; // nothing is deleted when the file couldn't be written
  }

  // The readable report of the same period, saved before its changes leave the database.
  const report = await buildReport(group, oldest.createdAt, cutoff, FULL_LIST);
  const reportFile = file.replace(/\.csv$/, ".report.json");
  await writeFile(path.join(archiveRoot(), reportFile), JSON.stringify(report));

  const { size } = await stat(target);
  await Archive.create({ groupId: group.id, groupName: group.name, file, reportFile, rows, bytes: size, from: oldest.createdAt, to: cutoff });
  await Change.deleteMany(filter);
  return rows;
}

/** Old notifications, and snapshot records no check or page still needs. */
async function pruneOldRecords(
  competitors: { _id: Types.ObjectId; lastSnapshotId?: Types.ObjectId | null }[],
  cutoff: Date,
) {
  await Notification.deleteMany({ createdAt: { $lt: cutoff } });
  for (const c of competitors) {
    // Keep the snapshots with page data (the next check compares against them) and the latest one.
    const keep = await Snapshot.find({ competitorId: c._id, status: "completed" })
      .sort({ startedAt: -1 })
      .limit(config.snapshotRetention)
      .select("_id")
      .lean();
    const keepIds = [...keep.map((s) => s._id), ...(c.lastSnapshotId ? [c.lastSnapshotId] : [])];
    const old = await Snapshot.find({
      competitorId: c._id,
      status: { $ne: "running" },
      startedAt: { $lt: cutoff },
      _id: { $nin: keepIds },
    })
      .select("_id")
      .lean();
    if (!old.length) continue;
    const ids = old.map((s) => s._id);
    await Page.deleteMany({ snapshotId: { $in: ids } });
    await Snapshot.deleteMany({ _id: { $in: ids } });
  }
}
