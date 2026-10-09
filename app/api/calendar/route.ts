import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getCalendarEvents,
  importCalendarEvents,
  type CalendarEvent,
} from "@/lib/calendar-db";

/**
 * Outlook Calendar mirror (Ethan, Oct 9, 2026).
 * GET  — session required; ?from=<ISO>&to=<ISO> window (defaults: -14d … +28d).
 * POST — session OR Bearer CRON_SECRET; body {windowStart, windowEnd, events}
 *        upserts the synced window and prunes events that vanished upstream.
 */

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const sp = req.nextUrl.searchParams;
  const now = Date.now();
  const from = sp.get("from") ?? new Date(now - 14 * 86400000).toISOString();
  const to = sp.get("to") ?? new Date(now + 28 * 86400000).toISOString();
  try {
    const events = await getCalendarEvents(from, to);
    return NextResponse.json({ events });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!getSessionUser() && !cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const rawEvents: unknown[] = Array.isArray(body.events) ? body.events : [];
  const events: CalendarEvent[] = rawEvents
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        eventId: String(o.eventId ?? ""),
        title: String(o.title ?? "").trim(),
        startsAt: String(o.startsAt ?? ""),
        endsAt: String(o.endsAt ?? ""),
        location: String(o.location ?? ""),
        attendees: Array.isArray(o.attendees) ? o.attendees.map((a) => String(a)) : [],
        allDay: Boolean(o.allDay),
      };
    })
    .filter((e) => e.eventId && e.title && e.startsAt);
  const windowStart = String(body.windowStart ?? "");
  const windowEnd = String(body.windowEnd ?? "");
  if (!windowStart || !windowEnd) {
    return NextResponse.json(
      { error: "windowStart and windowEnd are required" },
      { status: 400 }
    );
  }
  try {
    const res = await importCalendarEvents(events, windowStart, windowEnd);
    return NextResponse.json({ ok: true, ...res });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
