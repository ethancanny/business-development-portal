import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { completeOutbox, listOutbox } from "@/lib/calendar-db";
import {
  createGraphEvent,
  deleteGraphEvent,
  ensureSubscription,
  msConnected,
  pullGraphWindow,
  updateGraphEvent,
  type EventDraft,
} from "@/lib/microsoft";

/**
 * Watchdog endpoint (called by the portal-calendar-sync cron in Graph mode):
 * keeps the webhook subscription alive, drains any outbox intents queued
 * while disconnected (applying them via Graph), and does a catch-up pull so
 * missed notifications self-heal. Session or Bearer CRON_SECRET.
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const cronOk = secret && req.headers.get("authorization") === `Bearer ${secret}`;
  if (!getSessionUser() && !cronOk) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const sub = await ensureSubscription();
    let drained = 0;
    if (await msConnected()) {
      const pending = await listOutbox("pending");
      for (const item of pending) {
        const p = item.payload as Record<string, unknown>;
        const draft: EventDraft = {
          title: String(p.title ?? ""),
          startsAt: String(p.startsAt ?? ""),
          endsAt: String(p.endsAt ?? ""),
          location: String(p.location ?? ""),
        };
        try {
          if (item.action === "create") await createGraphEvent(draft);
          else if (item.action === "update") await updateGraphEvent(item.eventId, draft);
          else if (item.action === "delete") await deleteGraphEvent(item.eventId);
          await completeOutbox(item.id, "done", "");
          drained++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await completeOutbox(item.id, "failed", msg.slice(0, 300));
        }
      }
    }
    let pull: unknown = null;
    if (sub.active) {
      pull = await pullGraphWindow().catch((e: Error) => ({ error: e.message }));
    }
    return NextResponse.json({ ok: true, subscription: sub, drained, pull });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
