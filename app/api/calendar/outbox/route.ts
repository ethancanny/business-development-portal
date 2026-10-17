import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { addOutboxItem, completeOutbox, listOutbox } from "@/lib/calendar-db";
import { applyReminderChoice, parseReminderInput } from "@/lib/reminder";

/**
 * Calendar edit outbox (Ethan, Oct 9, 2026). The Calendar page queues
 * create/update/delete intents here; the agent-side sync (every 15 min)
 * applies them to Outlook via the outlook-calendar CLI and marks them
 * complete. Session auth only — the sync logs in with the portal session.
 */

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  try {
    const items = await listOutbox(status);
    return NextResponse.json({ items });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  try {
    if (typeof body.complete === "string") {
      const status = body.status === "failed" ? "failed" : "done";
      await completeOutbox(body.complete, status, String(body.error ?? ""));
      return NextResponse.json({ ok: true });
    }
    const action = String(body.action ?? "");
    if (action !== "create" && action !== "update" && action !== "delete") {
      return NextResponse.json({ error: "action must be create|update|delete" }, { status: 400 });
    }
    const eventId = String(body.eventId ?? "");
    if (action !== "create" && !eventId) {
      return NextResponse.json({ error: "eventId required for update/delete" }, { status: 400 });
    }
    const payload =
      body.payload && typeof body.payload === "object"
        ? (body.payload as Record<string, unknown>)
        : {};
    if (action !== "delete" && !String(payload.title ?? "").trim()) {
      return NextResponse.json({ error: "payload.title required" }, { status: 400 });
    }
    const id = await addOutboxItem(action, eventId, payload);
    // Reminder choices ride in the payload for the sync to apply to
    // Outlook; record them portal-side NOW (update/delete carry the
    // event id) so the push checker honors the choice even before the
    // sync runs. A queued create has no event id yet — its choice is
    // applied when the created event is next edited in the portal.
    if (action === "delete" && eventId) {
      await applyReminderChoice(eventId, { present: true, choice: "default" }).catch(
        () => undefined
      );
    } else if (action === "update" && eventId) {
      await applyReminderChoice(eventId, parseReminderInput(payload.reminder)).catch(
        () => undefined
      );
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
