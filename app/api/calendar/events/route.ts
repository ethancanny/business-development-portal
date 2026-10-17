import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { createGraphEvent, msConnected, type EventDraft } from "@/lib/microsoft";
import {
  applyReminderChoice,
  parseReminderInput,
  reminderDraftMinutes,
  type ReminderInput,
} from "@/lib/reminder";

function draftOf(body: Record<string, unknown>): { draft: EventDraft; reminder: ReminderInput } {
  const p = (body.payload ?? body) as Record<string, unknown>;
  const rawAtt = p.attendees;
  const attendeeEmails = Array.isArray(rawAtt)
    ? rawAtt.map((a) => String(a))
    : typeof rawAtt === "string"
      ? rawAtt.split(/[,;]/)
      : [];
  const reminder = parseReminderInput(p.reminder);
  return {
    reminder,
    draft: {
      title: String(p.title ?? "").trim(),
      startsAt: String(p.startsAt ?? ""),
      endsAt: String(p.endsAt ?? ""),
      location: String(p.location ?? ""),
      attendeeEmails,
      reminderMinutes: reminderDraftMinutes(reminder),
    },
  };
}

/** Create an event directly in Outlook via Graph (real-time path). */
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
  const { draft, reminder } = draftOf(body as Record<string, unknown>);
  if (!draft.title || !draft.startsAt) {
    return NextResponse.json({ error: "title and startsAt required" }, { status: 400 });
  }
  try {
    const ev = await createGraphEvent(draft);
    if (ev) {
      // Portal-side store for the push checker (best-effort: the Graph
      // event already carries the reminder natively).
      await applyReminderChoice(ev.eventId, reminder).catch(() => undefined);
    }
    return NextResponse.json({ ok: true, event: ev });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
