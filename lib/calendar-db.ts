import { neon } from "@neondatabase/serverless";
import { bumpDatasets } from "./platform/versions";

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
  /** Reminder state on the Graph event itself, when the last Graph read
   * carried it: graphReminderOn false = Outlook reminder off;
   * graphReminderMinutes = minutes before start when on. */
  graphReminderOn?: boolean;
  graphReminderMinutes?: number | null;
  /** Resolved per-event reminder choice for display/editing:
   * an explicit portal choice wins, then the Graph state, else "default"
   * (no explicit choice — the portal's standard meeting alert applies). */
  reminderChoice?: "default" | "off" | number;
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
  // Per-event reminder choices (Ethan, Oct 16, 2026). The Graph reminder
  // state last read from Outlook is mirrored on calendar_events; the
  // portal-side explicit choice lives in its own table so it survives
  // mirror prunes/re-syncs: a row with minutes = the choice, minutes NULL
  // = explicitly Off, and NO row = no explicit choice (portal default).
  await q`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS graph_reminder_on BOOLEAN`;
  await q`ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS graph_reminder_minutes INTEGER`;
  await q`CREATE TABLE IF NOT EXISTS calendar_event_reminders (
    event_id TEXT PRIMARY KEY,
    minutes INTEGER,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  // is_default marks rows written by the follow-up sync as the standing
  // default (vs an explicit per-event choice Ethan made): default rows
  // follow the CURRENT global default setting at fire time and never
  // suppress the generic meeting alert.
  await q`ALTER TABLE calendar_event_reminders ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false`;
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
  // Microsoft Graph direct connection (Ethan, Oct 9, 2026): OAuth tokens for
  // Ethan's Microsoft account live server-side only (Neon), scoped to
  // Calendars.ReadWrite + offline_access. ms_state holds the webhook
  // subscription id/expiry and its clientState secret.
  await q`CREATE TABLE IF NOT EXISTS ms_tokens (
    id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL DEFAULT '',
    refresh_token TEXT NOT NULL DEFAULT '',
    expires_at BIGINT NOT NULL DEFAULT 0,
    account_email TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await q`CREATE TABLE IF NOT EXISTS ms_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  )`;
  ensured = true;
}

const str = (v: unknown): string => String(v ?? "");

export async function importCalendarEvents(
  events: CalendarEvent[],
  windowStart: string,
  windowEnd: string
): Promise<{ imported: number; pruned: number; newIds: string[] }> {
  await ensure();
  const q = sql();
  const incomingIds = events.map((e) => e.eventId);
  let newIds: string[] = [];
  if (incomingIds.length > 0) {
    const existing = await q`SELECT event_id FROM calendar_events WHERE event_id = ANY(${incomingIds})`;
    const existingSet = new Set(existing.map((r) => str(r.event_id)));
    newIds = incomingIds.filter((id) => !existingSet.has(id));
  }
  for (const e of events) {
    await q`INSERT INTO calendar_events (event_id, title, starts_at, ends_at, location, attendees, all_day, web_url, graph_reminder_on, graph_reminder_minutes, updated_at)
      VALUES (${e.eventId}, ${e.title}, ${e.startsAt}, ${e.endsAt}, ${e.location}, ${JSON.stringify(e.attendees)}, ${e.allDay}, ${e.webUrl}, ${e.graphReminderOn ?? null}, ${e.graphReminderMinutes ?? null}, now())
      ON CONFLICT (event_id) DO UPDATE SET
        title = EXCLUDED.title,
        starts_at = EXCLUDED.starts_at,
        ends_at = EXCLUDED.ends_at,
        location = EXCLUDED.location,
        attendees = EXCLUDED.attendees,
        all_day = EXCLUDED.all_day,
        web_url = EXCLUDED.web_url,
        graph_reminder_on = COALESCE(EXCLUDED.graph_reminder_on, calendar_events.graph_reminder_on),
        graph_reminder_minutes = CASE WHEN EXCLUDED.graph_reminder_on IS NULL THEN calendar_events.graph_reminder_minutes ELSE EXCLUDED.graph_reminder_minutes END,
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
  const pruned = Number(before[0]?.n ?? 0) - Number(after[0]?.n ?? 0) + 0;
  // Performance Fix Pass (DESIGN.md §2): bump only when the mirror
  // actually changed — imported counts the upserted (inserted/updated)
  // rows, pruned the rows deleted from the window.
  if (events.length > 0 || pruned > 0) await bumpDatasets("calendar");
  return { imported: events.length, pruned, newIds };
}

/** Single-event upsert (Graph writes) — never prunes, preserves dismissed. */
export async function upsertCalendarEvent(e: CalendarEvent): Promise<boolean> {
  await ensure();
  const q = sql();
  const existing = await q`SELECT event_id FROM calendar_events WHERE event_id = ${e.eventId}`;
  const isNew = existing.length === 0;
  await q`INSERT INTO calendar_events (event_id, title, starts_at, ends_at, location, attendees, all_day, web_url, graph_reminder_on, graph_reminder_minutes, updated_at)
    VALUES (${e.eventId}, ${e.title}, ${e.startsAt}, ${e.endsAt}, ${e.location}, ${JSON.stringify(e.attendees)}, ${e.allDay}, ${e.webUrl}, ${e.graphReminderOn ?? null}, ${e.graphReminderMinutes ?? null}, now())
    ON CONFLICT (event_id) DO UPDATE SET
      title = EXCLUDED.title,
      starts_at = EXCLUDED.starts_at,
      ends_at = EXCLUDED.ends_at,
      location = EXCLUDED.location,
      attendees = EXCLUDED.attendees,
      all_day = EXCLUDED.all_day,
      web_url = EXCLUDED.web_url,
      graph_reminder_on = COALESCE(EXCLUDED.graph_reminder_on, calendar_events.graph_reminder_on),
      graph_reminder_minutes = CASE WHEN EXCLUDED.graph_reminder_on IS NULL THEN calendar_events.graph_reminder_minutes ELSE EXCLUDED.graph_reminder_minutes END,
      updated_at = now()`;
  await bumpDatasets("calendar");
  return isNew;
}

export async function deleteCalendarEvent(eventId: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`DELETE FROM calendar_events WHERE event_id = ${eventId}`;
  await q`DELETE FROM calendar_event_reminders WHERE event_id = ${eventId}`;
  await bumpDatasets("calendar");
}

/** Resolve the reminder choice an event should display: an explicit
 * portal choice wins; otherwise the Graph state (events created in
 * Outlook); otherwise "default" — no explicit choice anywhere. */
export function resolveReminderChoice(
  choiceSet: boolean,
  choiceMinutes: number | null,
  graphOn: boolean | null,
  graphMinutes: number | null
): "default" | "off" | number {
  if (choiceSet) return choiceMinutes === null ? "off" : choiceMinutes;
  if (graphOn === true && typeof graphMinutes === "number") return graphMinutes;
  if (graphOn === false) return "off";
  return "default";
}

const EVENT_COLS = `e.event_id, e.title, e.starts_at, e.ends_at, e.location, e.attendees, e.all_day, e.web_url, e.dismissed, e.graph_reminder_on, e.graph_reminder_minutes, r.minutes AS choice_minutes, (r.event_id IS NOT NULL AND COALESCE(r.is_default, false) = false) AS choice_set`;

function rowToEvent(r: Record<string, unknown>): CalendarEvent {
  let attendees: string[] = [];
  try {
    const parsed = JSON.parse(str(r.attendees));
    if (Array.isArray(parsed)) attendees = parsed.map((a) => String(a));
  } catch {
    attendees = [];
  }
  const graphOn =
    r.graph_reminder_on === null || r.graph_reminder_on === undefined
      ? undefined
      : Boolean(r.graph_reminder_on);
  const graphMinutes =
    r.graph_reminder_minutes === null || r.graph_reminder_minutes === undefined
      ? null
      : Number(r.graph_reminder_minutes);
  const choiceSet = Boolean(r.choice_set);
  const choiceMinutes =
    r.choice_minutes === null || r.choice_minutes === undefined
      ? null
      : Number(r.choice_minutes);
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
    graphReminderOn: graphOn,
    graphReminderMinutes: graphMinutes,
    reminderChoice: resolveReminderChoice(
      choiceSet,
      choiceMinutes,
      graphOn ?? null,
      graphMinutes
    ),
  };
}

export async function getCalendarEventById(eventId: string): Promise<CalendarEvent | null> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT ${q.unsafe(EVENT_COLS)} FROM calendar_events e
    LEFT JOIN calendar_event_reminders r ON r.event_id = e.event_id
    WHERE e.event_id = ${eventId}`;
  if (rows.length === 0) return null;
  return rowToEvent(rows[0] as Record<string, unknown>);
}

/* ---------------- Per-event reminder choices ---------------- */

/** The portal reminder row for one event. `set` means an EXPLICIT
 * choice (Ethan picked it); a default row (written by the follow-up
 * sync) reports set:false + isDefault:true. minutes null = Off. */
export async function getEventReminder(
  eventId: string
): Promise<{ set: boolean; minutes: number | null; isDefault: boolean }> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT minutes, is_default FROM calendar_event_reminders WHERE event_id = ${eventId}`;
  if (rows.length === 0) return { set: false, minutes: null, isDefault: false };
  const m = rows[0].minutes;
  const isDefault = Boolean(rows[0].is_default);
  return {
    set: !isDefault,
    minutes: m === null || m === undefined ? null : Number(m),
    isDefault,
  };
}

/** Record a reminder row. minutes null = Off. Pass isDefault:true for
 * rows written as the standing follow-up default (they follow the
 * global setting rather than pinning a choice). */
export async function setEventReminder(
  eventId: string,
  minutes: number | null,
  opts?: { isDefault?: boolean }
): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO calendar_event_reminders (event_id, minutes, is_default, updated_at)
    VALUES (${eventId}, ${minutes}, ${opts?.isDefault ?? false}, now())
    ON CONFLICT (event_id) DO UPDATE SET minutes = EXCLUDED.minutes, is_default = EXCLUDED.is_default, updated_at = now()`;
}

/** Remove the explicit choice — the event returns to the portal default. */
export async function clearEventReminder(eventId: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`DELETE FROM calendar_event_reminders WHERE event_id = ${eventId}`;
}

/** Explicit choices for a set of events, keyed by event id (only events
 * WITH an explicit choice appear — default rows are excluded).
 * minutes null = Off. */
export async function getEventReminderChoices(
  eventIds: string[]
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (eventIds.length === 0) return out;
  await ensure();
  const q = sql();
  const rows = await q`SELECT event_id, minutes FROM calendar_event_reminders WHERE event_id = ANY(${eventIds}) AND is_default = false`;
  for (const r of rows) {
    const m = (r as Record<string, unknown>).minutes;
    out.set(str((r as Record<string, unknown>).event_id), m === null || m === undefined ? null : Number(m));
  }
  return out;
}

/** Mirrored Graph reminder state for a set of events: true = an
 * Outlook reminder is set (Outlook will notify — the portal must not
 * double-alert), false = reminder off, null = never read from Graph
 * (portal push stays armed as the fallback). Missing ids are absent. */
export async function getGraphReminderStates(
  eventIds: string[]
): Promise<Map<string, boolean | null>> {
  const out = new Map<string, boolean | null>();
  if (eventIds.length === 0) return out;
  await ensure();
  const q = sql();
  const rows = await q`SELECT event_id, graph_reminder_on FROM calendar_events WHERE event_id = ANY(${eventIds})`;
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    out.set(
      str(rec.event_id),
      rec.graph_reminder_on === null || rec.graph_reminder_on === undefined
        ? null
        : Boolean(rec.graph_reminder_on)
    );
  }
  return out;
}

/** Events in [from, to) carrying an explicit TIMED reminder choice
 * (minutes set — Off rows and follow-up default rows excluded), for the
 * push evaluator. */
export async function getReminderArmedEvents(
  from: string,
  to: string
): Promise<{ event: CalendarEvent; minutes: number }[]> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT ${q.unsafe(EVENT_COLS)} FROM calendar_events e
    JOIN calendar_event_reminders r ON r.event_id = e.event_id
    WHERE r.minutes IS NOT NULL AND r.is_default = false AND e.starts_at >= ${from} AND e.starts_at < ${to}
    ORDER BY e.starts_at ASC`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return { event: rowToEvent(rec), minutes: Number(rec.choice_minutes) };
  });
}

/* ---------------- Microsoft Graph token/state store ---------------- */

export interface MsTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  accountEmail: string;
}

export async function getMsTokens(): Promise<MsTokens | null> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT access_token, refresh_token, expires_at, account_email FROM ms_tokens WHERE id = 'ethan'`;
  if (rows.length === 0) return null;
  return {
    accessToken: str(rows[0].access_token),
    refreshToken: str(rows[0].refresh_token),
    expiresAt: Number(rows[0].expires_at ?? 0),
    accountEmail: str(rows[0].account_email),
  };
}

export async function saveMsTokens(t: MsTokens): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO ms_tokens (id, access_token, refresh_token, expires_at, account_email, updated_at)
    VALUES ('ethan', ${t.accessToken}, ${t.refreshToken}, ${t.expiresAt}, ${t.accountEmail}, now())
    ON CONFLICT (id) DO UPDATE SET
      access_token = EXCLUDED.access_token,
      refresh_token = EXCLUDED.refresh_token,
      expires_at = EXCLUDED.expires_at,
      account_email = EXCLUDED.account_email,
      updated_at = now()`;
}

export async function clearMsTokens(): Promise<void> {
  await ensure();
  const q = sql();
  await q`DELETE FROM ms_tokens WHERE id = 'ethan'`;
}

export async function getMsState(key: string): Promise<string> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT value FROM ms_state WHERE key = ${key}`;
  return rows.length ? str(rows[0].value) : "";
}

export async function setMsState(key: string, value: string): Promise<void> {
  await ensure();
  const q = sql();
  await q`INSERT INTO ms_state (key, value) VALUES (${key}, ${value})
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

export async function getCalendarEvents(from: string, to: string): Promise<CalendarEvent[]> {
  await ensure();
  const q = sql();
  const rows = await q`SELECT ${q.unsafe(EVENT_COLS)}
    FROM calendar_events e
    LEFT JOIN calendar_event_reminders r ON r.event_id = e.event_id
    WHERE e.starts_at >= ${from} AND e.starts_at < ${to}
    ORDER BY e.starts_at ASC`;
  return rows.map((r) => rowToEvent(r as Record<string, unknown>));
}

export async function setCalendarEventDismissed(
  eventId: string,
  dismissed: boolean
): Promise<void> {
  await ensure();
  const q = sql();
  await q`UPDATE calendar_events SET dismissed = ${dismissed}, updated_at = now() WHERE event_id = ${eventId}`;
  await bumpDatasets("calendar");
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
