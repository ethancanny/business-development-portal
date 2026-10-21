import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/platform/collab";

/**
 * Notification center data: core.notifications for the session user
 * MERGED with unread deal_flow (Activity) items — see collab.ts for
 * the merge rules. Marking read here only touches core.notifications;
 * deal_flow items keep their existing read flow on /activity.
 */
export async function GET(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const raw = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Math.min(50, Math.max(1, isFinite(raw) ? raw : 50));
  const data = await listNotifications(user.email, limit);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as {
    id?: unknown;
    all?: unknown;
  };
  if (body.all === true) {
    const marked = await markAllNotificationsRead(user.email);
    return NextResponse.json({ ok: true, marked });
  }
  const id = String(body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id or all required" }, { status: 400 });
  }
  const marked = await markNotificationRead(id, user.email);
  return NextResponse.json({ ok: true, marked: marked ? 1 : 0 });
}
