import { neon } from "@neondatabase/serverless";

/**
 * Outlook Calendar events mirrored into the portal (Ethan, Oct 9, 2026).
 * Events are synced agent-side from Ethan's Outlook calendar (the
 * outlook-calendar connector) via POST /api/calendar and read back by the
 * Overview weekly summary for activity highlights + important dates.
 */

export interface CalendarEvent {
  eventId: string;
  title: string;
  startsAt: string; // ISO 8601 with offset (user local)
  endsAt: string;
  location: string;
  attendees: string[];
  allDay: boolean;
}

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (calendar requires Postgres)");
  return neon(url);
}

let ensured = false;
async function ensure() {
  if (ensured) return;
  const q = sql();
  await q`CREATE TABLE IF NOT EXISTS calendar_events (
    event_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL DEFAULT '',
    location TEXT NOT NULL DEFAULT '',
    attendees TEXT NOT NULL DEFAULT '[]',
    all_day BOOLEAN NOT NULL DEFAULT false,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  ensured = true;
}

const str = (v: unknown): string => String(v ?? "");

export async function importCalendarEvents(
  events: CalendarEvent[],
  windowStart: string,
  windowEnd: string
): Promise<{ imported: number; pruned: number }> {
  await ensure();
  const q = sql();
  for (const e of events) {
    await q`INSERT INTO calendar_events (event_id, title, starts_at, ends_at, location, attendees, all_day, updated_at)
      VALUES (${e.eventId}, ${e.title}, ${e.startsAt}, ${e.endsAt}, ${e.location}, ${JSON.stringify(e.attendees)}, ${e.allDay}, now())
      ON CONFLICT (event_id) DO UPDATE SET
        title = EXCLUDED.title,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        location = EXCLUDED.location,
        attendees = EXCLUDED.attendees,
        all_day = EXCLUDED.all_day,
        updated_at = now()`;
  }
  // Prune events inside the synced window that no longer exist upstream
  // (deleted or moved out of the window in Outlook).
  const ids = events.map((e) => e.eventId);
  const before = await q`SELECT COUNT(*)::int AS n FROM calendar_events WHERE starts_at >= ${windowStart} AND starts_at < ${windowEnd}`;
  if (ids.length === 0) {
    await q`DELETE FROM calendar_events WHERE starts_at >= ${windowStart} AND starts_at < ${windowEnd}`;
  } else {
    await q`DELETE FROM calendar_events WHERE starts_at >= ${windowStart} AND starts_at < ${windowEnd} AND NOT (event_id = ANY(${ids}))`;
  }
  const after = await q`SELECT COUNT(*)::int AS n FROM calendar_events WHERE starts_at >= ${windowStart} AND starts_at < ${windowEnd}`;
  return { imported: events.length, pruned: Number(before[0]?.n ?? 0) - Number(after[0]?.n ?? 0) + 0 };
}

export async function getCalendarEvents(from: string, to: string): Promise<CalendarEvent[]> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT event_id, title, starts_at, ends_at, location, attendees, all_day
    FROM calendar_events
    WHERE starts_at >= ${from} AND starts_at < ${to}
    ORDER BY starts_at ASC`;
  return rows.map((r) => {
    let attendees: string[] = [];
    try {
      const parsed = JSON.parse(str(r.attendees));
      if (Array.isArray(parsed)) attendees = parsed.map((a) => String(a));
    } catch {
      attendees = [];
    }
    return {
      eventId: str(r.event_id),
      title: str(r.title),
      startsAt: str(r.starts_at),
      endsAt: str(r.ends_at),
      location: str(r.location),
      attendees,
      allDay: Boolean(r.all_day),
    };
  });
}
