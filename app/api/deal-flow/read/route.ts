import { NextRequest, NextResponse } from "next/server";
import { getDealFlow, saveDealFlow } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { computeBadgeCount } from "@/lib/badge";
import { pushBadgeUpdate } from "@/lib/push";

/** Mark Activity (deal-flow) items as read. The badge's "unread
 * notifications" are status="new" items Ethan hasn't seen yet; the
 * Activity page posts the ids it renders ({ ids: [...] }) and "Mark
 * all as read" posts { all: true }. After marking, a badge-only push
 * refreshes the count on Ethan's other devices. Returns the fresh
 * server-computed badge breakdown. */
export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const all = (body as { all?: unknown })?.all === true;
  const ids = new Set(
    Array.isArray((body as { ids?: unknown })?.ids)
      ? ((body as { ids: unknown[] }).ids.map((x) => String(x)))
      : []
  );
  if (!all && ids.size === 0) {
    return NextResponse.json({ error: "ids or all required" }, { status: 400 });
  }
  const items = await getDealFlow();
  const now = new Date().toISOString();
  let marked = 0;
  for (const it of items) {
    if (it.status === "new" && !it.readAt && (all || ids.has(it.id))) {
      it.readAt = now;
      marked += 1;
    }
  }
  if (marked > 0) {
    await saveDealFlow(items);
    pushBadgeUpdate(user.email).catch(() => undefined);
  }
  const badge = await computeBadgeCount();
  return NextResponse.json({ ok: true, marked, ...badge });
}
