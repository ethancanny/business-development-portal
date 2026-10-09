import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import {
  getCalendarEvents,
  importCalendarEvents,
  setCalendarEventDismissed,
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
    // ?live=1 (Calendar month view): pull the requested range straight from
    // Graph first so any browsable month is fresh, then read the mirror.
    if (sp.get("live") === "1") {
      const spanMs = new Date(to).getTime() - new Date(from).getTime();
      if (spanMs > 0 && spanMs <= 370 * 86400000) {
        const { msConnected, pullGraphRange } = await import("@/lib/microsoft");
        if (await msConnected()) {
          await pullGraphRange(from, to).catch(() => null);
        }
      }
    }
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
  if (body.action === "dismiss") {
    // Weekly-summary dismissal (Ethan, Oct 9, 2026): hide an event from the
    // summary without touching the Outlook calendar; survives re-syncs.
    const eventId = String(body.eventId ?? "");
    if (!eventId) {
      return NextResponse.json({ error: "eventId required" }, { status: 400 });
    }
    try {
      await setCalendarEventDismissed(eventId, Boolean(body.dismissed));
      return NextResponse.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }
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
        webUrl: String(o.webUrl ?? ""),
        dismissed: false,
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
