import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { msConnected, updateGraphEvent, type EventDraft } from "@/lib/microsoft";
import { scheduleEventPushJobs } from "@/lib/push-schedule";
import {
  applyReminderChoice,
  parseReminderInput,
  reminderDraftMinutes,
} from "@/lib/reminder";

/** Update an event directly in Outlook via Graph (real-time path). */
export async function POST(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!(await msConnected())) {
    return NextResponse.json(
      { error: "Microsoft account not connected", code: "not_connected" },
      { status: 409 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const eventId = String(body.eventId ?? "");
  const p = (body.payload ?? {}) as Record<string, unknown>;
  const reminder = parseReminderInput(p.reminder);
  const draft: EventDraft = {
    title: String(p.title ?? "").trim(),
    startsAt: String(p.startsAt ?? ""),
    endsAt: String(p.endsAt ?? ""),
    location: String(p.location ?? ""),
    reminderMinutes: reminderDraftMinutes(reminder),
  };
  const addAttendees = Array.isArray(p.addAttendees)
    ? p.addAttendees.map((a) => String(a))
    : [];
  const removeAttendees = Array.isArray(p.removeAttendees)
    ? p.removeAttendees.map((a) => String(a))
    : [];
  if (!eventId || !draft.title || !draft.startsAt) {
    return NextResponse.json(
      { error: "eventId, title and startsAt required" },
      { status: 400 }
    );
  }
  try {
    await updateGraphEvent(eventId, draft, { addAttendees, removeAttendees });
    // Persist the choice portal-side for the push checker (best-effort).
    await applyReminderChoice(eventId, reminder).catch(() => undefined);
    await scheduleEventPushJobs(eventId).catch(() => undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
