import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getDealFlow, saveDealFlow } from "@/lib/db";
import { dismissCurrentlyDueFollowups } from "@/lib/badge";
import { pushBadgeUpdate } from "@/lib/push";
import { ensurePlatform } from "@/lib/platform/service";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/platform/collab";

/**
 * Notification center data: core.notifications for the session user
 * MERGED with unread deal_flow (Activity) items — see collab.ts for
 * the merge rules. Marking read touches whichever store the item came
 * from (Ethan, Oct 23, 2026: notifications must be clearable from the
 * bell itself, without clicking through to /activity first) — for
 * deal_flow items that is the same readAt stamp the Activity page's
 * own read flow writes.
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
    source?: unknown;
  };
  // Stamp readAt on unread deal_flow items — the exact write the
  // /api/deal-flow/read route performs for the Activity page.
  const stampActivity = async (ids: Set<string> | null): Promise<number> => {
    const items = await getDealFlow();
    const now = new Date().toISOString();
    let marked = 0;
    for (const it of items) {
      if (it.status === "new" && !it.readAt && (ids === null || ids.has(it.id))) {
        it.readAt = now;
        marked += 1;
      }
    }
    if (marked > 0) {
      await saveDealFlow(items);
      pushBadgeUpdate(user.email).catch(() => undefined);
    }
    return marked;
  };
  if (body.all === true) {
    const platform = await markAllNotificationsRead(user.email);
    const activity = await stampActivity(null);
    // The badge also counts open follow-ups due today/overdue, which
    // neither store above touches — dismiss the ones counted right
    // now (durably, per due state; see lib/badge) so "clear" can
    // actually reach an empty list AND a zero badge, then push the
    // refreshed badge so other devices drop it too.
    const dismissedFollowups = await dismissCurrentlyDueFollowups().catch(
      () => 0
    );
    if (dismissedFollowups > 0) {
      pushBadgeUpdate(user.email).catch(() => undefined);
    }
    return NextResponse.json({
      ok: true,
      marked: platform + activity,
      dismissedFollowups,
    });
  }
  const id = String(body.id ?? "").trim();
  if (!id) {
    return NextResponse.json({ error: "id or all required" }, { status: 400 });
  }
  if (body.source === "activity") {
    const marked = await stampActivity(new Set([id]));
    return NextResponse.json({ ok: true, marked });
  }
  const marked = await markNotificationRead(id, user.email);
  return NextResponse.json({ ok: true, marked: marked ? 1 : 0 });
}
