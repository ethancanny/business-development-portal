import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { setReminderSnooze } from "@/lib/push-db";

/**
 * Notification-action snooze (Ethan, Oct 16, 2026): the service worker
 * posts here when Ethan taps "Snooze 1 hour" / "Snooze tomorrow" on a
 * reminder notification. This defers the ALERT only — the follow-up's
 * due date and the event's start are untouched (the follow-up list's
 * own Snooze menu is what moves due dates). "Tomorrow" re-fires at
 * 8:00 AM Phoenix tomorrow. The row is keyed by the firing's standard
 * dedupe key (start + offset), so a later reschedule makes it inert.
 */
export async function POST(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const kind = body.kind === "event" ? "event" : body.kind === "task" ? "task" : "";
  const id = String(body.id ?? "");
  const key = String(body.key ?? "");
  const mode = body.mode === "tomorrow" ? "tomorrow" : body.mode === "1h" ? "1h" : "";
  if (!kind || !id || !key || !mode) {
    return NextResponse.json(
      { error: "kind, id, key and mode (1h|tomorrow) are required" },
      { status: 400 }
    );
  }
  let fireAt: Date;
  if (mode === "1h") {
    fireAt = new Date(Date.now() + 3600 * 1000);
  } else {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Phoenix",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(Date.now() + 864e5));
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    fireAt = new Date(`${p.year}-${p.month}-${p.day}T08:00:00-07:00`);
  }
  try {
    await setReminderSnooze(kind, id, key, fireAt.toISOString());
    return NextResponse.json({ ok: true, fireAt: fireAt.toISOString() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
