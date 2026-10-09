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
  webUrl: string; // Outlook web link for the event
  dismissed: boolean; // hidden from the weekly summary (survives syncs)
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
  await q`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS web_url TEXT NOT NULL DEFAULT ''`;
  await q`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS dismissed BOOLEAN NOT NULL DEFAULT false`;
  await q`CREATE TABLE IF NOT EXISTS calendar_outbox (
    id TEXT PRIMARY KEY,
    action TEXT NOT NULL,
    event_id TEXT NOT NULL DEFAULT '',
    payload TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_at TIMESTAMPTZ
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
    await q`INSERT INTO calendar_events (event_id, title, starts_at, ends_at, location, attendees, all_day, web_url, updated_at)
      VALUES (${e.eventId}, ${e.title}, ${e.startsAt}, ${e.endsAt}, ${e.location}, ${JSON.stringify(e.attendees)}, ${e.allDay}, ${e.webUrl}, now())
      ON CONFLICT (event_id) DO UPDATE SET
        title = EXCLUDED.title,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        location = EXCLUDED.location,
        attendees = EXCLUDED.attendees,
        all_day = EXCLUDED.all_day,
        web_url = EXCLUDED.web_url,
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
  const rows = await q`SELECT event_id, title, starts_at, ends_at, location, attendees, all_day, web_url, dismissed
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
      webUrl: str(r.web_url),
      dismissed: Boolean(r.dismissed),
    };
  });
}

export async function setCalendarEventDismissed(
  eventId: string,
  dismissed: boolean
): Promise<void> {
  await ensure();
  const q = sql();
  await q`UPDATE calendar_events SET dismissed = ${dismissed}, updated_at = now() WHERE event_id = ${eventId}`;
}

/* ---------------- Two-way bridge outbox ----------------
 * The portal has no Microsoft Graph credentials of its own; Ethan's Outlook
 * connection lives agent-side. Edits made on the Calendar page are queued
 * here as intents, and the 15-minute sync applies them to Outlook via the
 * outlook-calendar CLI, then pulls the truth back. */

export interface CalendarOutboxItem {
  id: string;
  action: "create" | "update" | "delete";
  eventId: string;
  payload: Record<string, unknown>;
  status: "pending" | "done" | "failed";
  error: string;
  createdAt: string;
}

export async function addOutboxItem(
  action: CalendarOutboxItem["action"],
  eventId: string,
  payload: Record<string, unknown>
): Promise<string> {
  await ensure();
  const q = sql();
  const id = `ob-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  await q`INSERT INTO calendar_outbox (id, action, event_id, payload)
    VALUES (${id}, ${action}, ${eventId}, ${JSON.stringify(payload)})`;
  return id;
}

export async function listOutbox(status?: string): Promise<CalendarOutboxItem[]> {
  await ensure();
  const q = sql();
  const rows = status
    ? await q`SELECT id, action, event_id, payload, status, error, created_at FROM calendar_outbox WHERE status = ${status} ORDER BY created_at ASC LIMIT 100`
    : await q`SELECT id, action, event_id, payload, status, error, created_at FROM calendar_outbox ORDER BY created_at DESC LIMIT 100`;
  return rows.map((r) => {
    let payload: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(str(r.payload));
      if (parsed && typeof parsed === "object") payload = parsed as Record<string, unknown>;
    } catch {
      payload = {};
    }
    return {
      id: str(r.id),
      action: str(r.action) as CalendarOutboxItem["action"],
      eventId: str(r.event_id),
      payload,
      status: str(r.status) as CalendarOutboxItem["status"],
      error: str(r.error),
      createdAt: str(r.created_at),
    };
  });
}

export async function completeOutbox(
  id: string,
  status: "done" | "failed",
  error: string
): Promise<void> {
  await ensure();
  const q = sql();
  await q`UPDATE calendar_outbox SET status = ${status}, error = ${error}, applied_at = now() WHERE id = ${id}`;
}
