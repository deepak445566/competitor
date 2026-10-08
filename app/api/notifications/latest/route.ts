import { connection } from "next/server";
import { isAuthenticated } from "@/lib/auth/dal";
import { connectDB } from "@/lib/db";
import { Notification } from "@/lib/models";

/** Notifications created after `?since=<ISO date>`, polled by the desktop notifier. */
export async function GET(request: Request) {
  await connection();
  if (!(await isAuthenticated())) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const sinceParam = new URL(request.url).searchParams.get("since");
  const since = sinceParam && !Number.isNaN(Date.parse(sinceParam)) ? new Date(sinceParam) : new Date();
  await connectDB();
  const items = await Notification.find({ createdAt: { $gt: since } })
    .sort({ createdAt: -1 })
    .limit(5)
    .select("title competitorName lines items createdAt")
    .lean();

  return Response.json({
    now: new Date().toISOString(),
    items: items.map((n) => ({
      id: String(n._id),
      title: n.title,
      competitor: n.competitorName,
      // Name the upload itself when there's one ("New Blog: SEO Executive Meaning…").
      body: (n.items?.length ? n.items.slice(0, 3).map((i) => i.text) : n.lines).join("\n"),
      createdAt: n.createdAt,
    })),
  });
}
