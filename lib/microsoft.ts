import {
  clearEventReminder,
  clearMsTokens,
  deleteCalendarEvent,
  getCalendarEventById,
  getCalendarEvents,
  getEventReminder,
  getMsState,
  getMsTokens,
  importCalendarEvents,
  saveMsTokens,
  setEventReminder,
  setMsState,
  upsertCalendarEvent,
  type CalendarEvent,
} from "./calendar-db";
import { getPreferences } from "./push-db";
import {
  getDeals,
  getExecutives,
  getInteractions,
  newId,
  saveExecutives,
  saveDeals,
  saveInteractions,
} from "./db";
import { cancelPushJobs, scheduleEventPushJobs } from "./push-schedule";
import type { Deal, Executive, Interaction } from "./types";

/**
 * Microsoft Graph direct integration (Ethan, Oct 9, 2026 — "build the true
 * real-time Microsoft integration"). The portal holds Ethan's Microsoft
 * OAuth tokens server-side only (Neon), scoped to Calendars.ReadWrite +
 * offline_access (no mail). Env: MS_CLIENT_ID, MS_CLIENT_SECRET.
 * Redirect URI: https://portal.cannycapitalpartners.com/api/calendar/microsoft/callback
 */

const SITE = "https://portal.cannycapitalpartners.com";
export const MS_REDIRECT_URI = `${SITE}/api/calendar/microsoft/callback`;
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0";
const SCOPES = "offline_access Calendars.ReadWrite User.Read Mail.Read Mail.Send Files.ReadWrite.All Sites.ReadWrite.All";
const TZ = "America/Phoenix";

export function msConfigured(): boolean {
  return Boolean(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

export function msAuthorizeUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID ?? "",
    response_type: "code",
    redirect_uri: MS_REDIRECT_URI,
    response_mode: "query",
    scope: SCOPES,
    state,
  });
  return `${AUTHORITY}/authorize?${p.toString()}`;
}

async function tokenRequest(params: Record<string, string>): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}> {
  const body = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID ?? "",
    client_secret: process.env.MS_CLIENT_SECRET ?? "",
    ...params,
  });
  const r = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || !d.access_token) {
    throw new Error(
      `Microsoft token request failed (${r.status}): ${String(d.error_description ?? d.error ?? "unknown")}`
    );
  }
  return {
    accessToken: String(d.access_token),
    refreshToken: String(d.refresh_token ?? ""),
    expiresAt: Date.now() + Number(d.expires_in ?? 3600) * 1000,
  };
}

export async function msExchangeCode(code: string): Promise<void> {
  const t = await tokenRequest({
    code,
    redirect_uri: MS_REDIRECT_URI,
    grant_type: "authorization_code",
    scope: SCOPES,
  });
  let email = "";
  try {
    const me = (await graph("/me?$select=mail,userPrincipalName", t.accessToken)) as Record<string, unknown>;
    email = String(me.mail ?? me.userPrincipalName ?? "");
  } catch {
    /* account email is informational only */
  }
  await saveMsTokens({
    accessToken: t.accessToken,
    refreshToken: t.refreshToken,
    expiresAt: t.expiresAt,
    accountEmail: email,
  });
}

async function validAccessToken(): Promise<string | null> {
  const t = await getMsTokens();
  if (!t || !t.refreshToken) return null;
  if (t.accessToken && t.expiresAt > Date.now() + 60000) return t.accessToken;
  try {
    const fresh = await tokenRequest({
      grant_type: "refresh_token",
      refresh_token: t.refreshToken,
      scope: SCOPES,
    });
    await saveMsTokens({
      accessToken: fresh.accessToken,
      refreshToken: fresh.refreshToken || t.refreshToken,
      expiresAt: fresh.expiresAt,
      accountEmail: t.accountEmail,
    });
    return fresh.accessToken;
  } catch {
    return null;
  }
}

export async function msConnected(): Promise<boolean> {
  return (await validAccessToken()) !== null;
}

export async function graph(
  path: string,
  accessToken?: string,
  init?: RequestInit
): Promise<unknown> {
  const token = accessToken ?? (await validAccessToken());
  if (!token) throw new Error("Microsoft account is not connected");
  const doFetch = async (tok: string) =>
    fetch(`${GRAPH}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tok}`,
        "Content-Type": "application/json",
        Prefer: `outlook.timezone="${TZ}"`,
        ...(init?.headers ?? {}),
      },
    });
  let r = await doFetch(token);
  if (r.status === 401 && !accessToken) {
    // Force one refresh + retry.
    const t = await getMsTokens();
    if (t?.refreshToken) {
      const fresh = await tokenRequest({
        grant_type: "refresh_token",
        refresh_token: t.refreshToken,
        scope: SCOPES,
      });
      await saveMsTokens({
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken || t.refreshToken,
        expiresAt: fresh.expiresAt,
        accountEmail: t.accountEmail,
      });
      r = await doFetch(fresh.accessToken);
    }
  }
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`Graph ${init?.method ?? "GET"} ${path} failed (${r.status}): ${text.slice(0, 200)}`);
  }
  if (r.status === 204) return null;
  return r.json().catch(() => null);
}

/* ---------------- Event mapping ---------------- */

interface GraphEvent {
  id?: string;
  subject?: string;
  isAllDay?: boolean;
  isReminderOn?: boolean;
  reminderMinutesBeforeStart?: number;
  webLink?: string;
  start?: { dateTime?: string };
  end?: { dateTime?: string };
  location?: { displayName?: string };
  attendees?: { emailAddress?: { name?: string; address?: string } }[];
}

function toCalendarEvent(g: GraphEvent): CalendarEvent | null {
  if (!g.id || !g.subject || !g.start?.dateTime) return null;
  const startRaw = g.start.dateTime;
  const endRaw = g.end?.dateTime ?? "";
  const startsAt = startRaw.includes("T") ? `${startRaw.slice(0, 19)}-07:00` : `${startRaw}T00:00:00-07:00`;
  const endsAt = endRaw
    ? endRaw.includes("T")
      ? `${endRaw.slice(0, 19)}-07:00`
      : `${endRaw}T00:00:00-07:00`
    : "";
  const attendees = (g.attendees ?? [])
    .map((a) => a.emailAddress?.name || a.emailAddress?.address || "")
    .filter(Boolean);
  return {
    eventId: g.id,
    title: g.subject.trim(),
    startsAt,
    endsAt,
    location: g.location?.displayName ?? "",
    attendees,
    allDay: Boolean(g.isAllDay),
    webUrl: g.webLink ?? "",
    dismissed: false,
    graphReminderOn:
      typeof g.isReminderOn === "boolean" ? g.isReminderOn : undefined,
    graphReminderMinutes: g.isReminderOn
      ? typeof g.reminderMinutesBeforeStart === "number"
        ? g.reminderMinutesBeforeStart
        : null
      : null,
  };
}

/* ---------------- Pull (window sync + cross-logging) ---------------- */

function fmtWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: TZ,
  });
  const time = d.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: TZ,
  });
  return `${day} · ${time}`;
}

function locText(loc: string): string {
  if (!loc) return "";
  if (/^https?:\/\//i.test(loc)) {
    const l = loc.toLowerCase();
    return l.includes("zoom") ? "Zoom" : l.includes("teams") ? "Microsoft Teams" : "Online";
  }
  return loc;
}

function matchProfile(
  title: string,
  execs: Executive[],
  deals: Deal[]
): { kind: "executive"; obj: Executive } | { kind: "deal"; obj: Deal } | null {
  const t = title.toLowerCase();
  for (const e of execs) {
    const name = (e.name || "").trim();
    if (!name) continue;
    const parts = name.toLowerCase().split(" ");
    const first = parts[0];
    const last = parts[parts.length - 1];
    if (
      t.includes(name.toLowerCase()) ||
      (last.length > 2 && t.includes(last)) ||
      (first.length > 2 && t.includes(first))
    ) {
      return { kind: "executive", obj: e };
    }
  }
  for (const d of deals) {
    const name = (d.companyName || "").trim();
    if (name.length > 3 && t.includes(name.toLowerCase())) {
      return { kind: "deal", obj: d };
    }
  }
  return null;
}

async function appendProfileNote(
  kind: "executive" | "deal",
  id: string,
  line: string
): Promise<void> {
  if (kind === "executive") {
    const execs = await getExecutives();
    const ex = execs.find((e) => e.id === id);
    if (!ex) return;
    ex.notes = ex.notes?.trim() ? `${ex.notes.trim()}\n\n${line}` : line;
    ex.updatedAt = new Date().toISOString();
    await saveExecutives(execs);
  } else {
    const deals = await getDeals();
    const dl = deals.find((d) => d.id === id);
    if (!dl) return;
    dl.notes = dl.notes?.trim() ? `${dl.notes.trim()}\n\n${line}` : line;
    dl.updatedAt = new Date().toISOString();
    await saveDeals(deals);
  }
}

/** Log a note + meeting interaction for each genuinely new event. */
export async function crossLogNewEvents(newIds: string[]): Promise<number> {
  if (newIds.length === 0) return 0;
  const execs = await getExecutives();
  const deals = await getDeals();
  let logged = 0;
  for (const id of newIds) {
    const ev = await getCalendarEventById(id);
    if (!ev || ev.dismissed) continue;
    const m = matchProfile(ev.title, execs, deals);
    if (!m) continue;
    const loc = locText(ev.location);
    const when = fmtWhen(ev.startsAt);
    const evDate = ev.startsAt.slice(0, 10);
    const line = `[${evDate}] 📅 ${ev.title} — ${when}${loc ? ` · ${loc}` : ""}. Auto-logged from Outlook calendar.`;
    await appendProfileNote(m.kind, m.obj.id, line);
    const items: Interaction[] = await getInteractions();
    items.push({
      id: newId(),
      dealId: m.kind === "deal" ? m.obj.id : null,
      execId: m.kind === "executive" ? m.obj.id : null,
      kind: "meeting",
      occurredAt: evDate,
      summary: `${ev.title} — ${when}${loc ? ` · ${loc}` : ""}`,
      createdAt: new Date().toISOString(),
    });
    await saveInteractions(items);
    logged++;
  }
  return logged;
}

/** Pull the −16d/+28d window from Graph into the mirror; cross-log new events. */
export async function pullGraphWindow(): Promise<{ imported: number; pruned: number; logged: number }> {
  const now = Date.now();
  const from = new Date(now - 16 * 86400000).toISOString();
  const to = new Date(now + 28 * 86400000).toISOString();
  return pullGraphRange(from, to);
}

/** Pull an arbitrary range (calendar month view) into the mirror. */
export async function pullGraphRange(
  from: string,
  to: string
): Promise<{ imported: number; pruned: number; logged: number }> {
  const events: CalendarEvent[] = [];
  let path: string | null =
    `/me/calendarview?startDateTime=${encodeURIComponent(from)}&endDateTime=${encodeURIComponent(to)}` +
    `&$select=subject,start,end,location,attendees,webLink,isAllDay,isReminderOn,reminderMinutesBeforeStart&$top=200`;
  for (let page = 0; page < 4 && path; page++) {
    const res = (await graph(path)) as { value?: GraphEvent[]; "@odata.nextLink"?: string };
    for (const g of res.value ?? []) {
      const ev = toCalendarEvent(g);
      if (ev) events.push(ev);
    }
    const next = res["@odata.nextLink"];
    path = next ? next.replace(GRAPH, "") : null;
  }
  const result = await importCalendarEvents(events, from, to);
  const logged = await crossLogNewEvents(result.newIds);
  return { imported: result.imported, pruned: result.pruned, logged };
}

/* ---------------- Writes ---------------- */

export interface EventDraft {
  title: string;
  startsAt: string; // ISO with -07:00 offset
  endsAt: string;
  location: string;
  description?: string; // event body (plain text)
  allDay?: boolean; // Graph all-day event (start/end at Phoenix midnights)
  attendeeEmails?: string[]; // create: full attendee list (emails)
  /** Per-event reminder (Ethan, Oct 16, 2026): minutes before start, or
   * null = reminder Off. Undefined = leave the Graph reminder untouched
   * (updates) / Outlook's own default (creates). */
  reminderMinutes?: number | null;
}

interface GraphAttendee {
  emailAddress: { address: string; name?: string };
  type: string;
}

function toGraphAttendees(emails: string[]): GraphAttendee[] {
  return emails
    .map((e) => e.trim())
    .filter((e) => e.includes("@"))
    .map((address) => ({ emailAddress: { address }, type: "required" }));
}

function graphBody(
  d: EventDraft,
  attendees?: GraphAttendee[]
): Record<string, unknown> {
  const strip = (iso: string) => iso.replace(/-07:00$/, "").replace(/Z$/, "");
  const body: Record<string, unknown> = {
    subject: d.title,
    start: { dateTime: strip(d.startsAt), timeZone: TZ },
    end: { dateTime: strip(d.endsAt || d.startsAt), timeZone: TZ },
    location: { displayName: d.location ?? "" },
  };
  if (d.allDay) body.isAllDay = true;
  if (d.reminderMinutes !== undefined) {
    if (d.reminderMinutes === null) {
      body.isReminderOn = false;
    } else {
      body.isReminderOn = true;
      body.reminderMinutesBeforeStart = d.reminderMinutes;
    }
  }
  if (d.description !== undefined) {
    body.body = { contentType: "text", content: d.description };
  }
  if (attendees !== undefined) body.attendees = attendees;
  return body;
}

export async function createGraphEvent(d: EventDraft): Promise<CalendarEvent | null> {
  const g = (await graph("/me/events", undefined, {
    method: "POST",
    body: JSON.stringify(graphBody(d, toGraphAttendees(d.attendeeEmails ?? []))),
  })) as GraphEvent;
  const ev = toCalendarEvent(g);
  if (ev) {
    const isNew = await upsertCalendarEvent(ev);
    if (isNew) await crossLogNewEvents([ev.eventId]);
    await scheduleEventPushJobs(ev.eventId).catch(() => undefined);
  }
  return ev;
}

export async function updateGraphEvent(
  eventId: string,
  d: EventDraft,
  opts?: { addAttendees?: string[]; removeAttendees?: string[] }
): Promise<void> {
  let attendees: GraphAttendee[] | undefined;
  const adds = opts?.addAttendees ?? [];
  const removes = (opts?.removeAttendees ?? []).map((s) => s.toLowerCase());
  if (adds.length > 0 || removes.length > 0) {
    // PATCH replaces the attendee list, so merge against the live event.
    const current = (await graph(
      `/me/events/${encodeURIComponent(eventId)}?$select=attendees`
    )) as GraphEvent;
    const kept: GraphAttendee[] = (current.attendees ?? [])
      .filter((a) => {
        const addr = (a.emailAddress?.address ?? "").toLowerCase();
        const name = (a.emailAddress?.name ?? "").toLowerCase();
        return !removes.includes(addr) && !removes.includes(name);
      })
      .map((a) => ({
        emailAddress: {
          address: a.emailAddress?.address ?? "",
          name: a.emailAddress?.name,
        },
        type: "required",
      }));
    const seen = new Set(kept.map((a) => a.emailAddress.address.toLowerCase()));
    for (const extra of toGraphAttendees(adds)) {
      if (!seen.has(extra.emailAddress.address.toLowerCase())) kept.push(extra);
    }
    attendees = kept;
  }
  await graph(`/me/events/${encodeURIComponent(eventId)}`, undefined, {
    method: "PATCH",
    body: JSON.stringify(graphBody(d, attendees)),
  });
  const g = (await graph(`/me/events/${encodeURIComponent(eventId)}?$select=subject,start,end,location,attendees,webLink,isAllDay,isReminderOn,reminderMinutesBeforeStart`)) as GraphEvent;
  const ev = toCalendarEvent(g);
  if (ev) await upsertCalendarEvent(ev);
  await scheduleEventPushJobs(eventId).catch(() => undefined);
}

export async function deleteGraphEvent(eventId: string): Promise<void> {
  await graph(`/me/events/${encodeURIComponent(eventId)}`, undefined, { method: "DELETE" });
  await deleteCalendarEvent(eventId);
  await cancelPushJobs("event", eventId).catch(() => undefined);
}

/* ---------------- Follow-up ⇄ calendar sync ----------------
 * Storage convention (Ethan, Oct 16, 2026): a follow-up's dueDate is an
 * America/Phoenix calendar date ("YYYY-MM-DD") and its dueTime a Phoenix
 * wall-clock "HH:MM" (null = all-day). Phoenix never observes DST, so
 * instants are built with the fixed -07:00 offset the rest of this module
 * uses. Timed events run 30 minutes (the integration's standing default).
 * COMPLETE convention: completing a follow-up REMOVES its calendar event;
 * reopening recreates it. Deleting a follow-up removes it too. */

export interface TaskEventSyncInput {
  title: string;
  dueDate: string; // YYYY-MM-DD or ""
  dueTime: string | null; // "HH:MM" or null (all-day)
  type?: string;
  notes?: string;
  done: boolean;
  relatedKind: "deal" | "executive" | "person" | "organization" | null;
  relatedId: string | null;
  relatedName: string;
  calendarEventId: string | null;
}

function phxDatePlus(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00-07:00`);
  d.setTime(d.getTime() + days * 86400000);
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

function phxInstantPlusMinutes(iso: string, minutes: number): string {
  const d = new Date(iso);
  d.setTime(d.getTime() + minutes * 60000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}:${p.second}-07:00`;
}

function taskEventDraft(task: TaskEventSyncInput): EventDraft {
  const desc: string[] = [];
  if (task.notes && task.notes.trim()) desc.push(task.notes.trim());
  if (task.relatedName) desc.push(`Linked account: ${task.relatedName}`);
  desc.push(
    `Follow-up${task.type ? ` · ${task.type}` : ""} — Canny Capital Partners portal`
  );
  if (task.dueTime) {
    const startsAt = `${task.dueDate}T${task.dueTime}:00-07:00`;
    return {
      title: task.title,
      startsAt,
      endsAt: phxInstantPlusMinutes(startsAt, 30),
      location: "",
      description: desc.join("\n"),
    };
  }
  // All-day: Graph convention is midnight → next midnight (end exclusive).
  return {
    title: task.title,
    startsAt: `${task.dueDate}T00:00:00-07:00`,
    endsAt: `${phxDatePlus(task.dueDate, 1)}T00:00:00-07:00`,
    location: "",
    description: desc.join("\n"),
    allDay: true,
  };
}

/**
 * Reconcile a follow-up with its calendar event and return the event id the
 * task should carry afterward (null when no event should exist). Best-effort
 * by design: when Microsoft is unreachable the previous id is returned
 * unchanged so a later sync can finish the job — task and calendar never
 * silently drift. Legacy events (created before calendar_event_id existed,
 * at 9:00 AM by the bridge or the old create path) are adopted by matching
 * title + due date in the local mirror instead of duplicated.
 */
export async function syncTaskEvent(
  task: TaskEventSyncInput
): Promise<string | null> {
  const prevId = task.calendarEventId || null;

  // Done or undated: no event should exist.
  if (task.done || !task.dueDate) {
    if (!prevId) return null;
    if (!(await msConnected())) return prevId;
    try {
      await deleteGraphEvent(prevId);
      return null;
    } catch {
      return prevId;
    }
  }

  if (!(await msConnected())) return prevId;
  const draft = taskEventDraft(task);

  // Follow-up events carry the Settings → "Default reminder lead time"
  // by default (initial value 15 minutes; Ethan, Oct 16, 2026) — in the
  // portal store AND on the Graph event — unless an explicit per-event
  // choice was made on the event itself, which always wins and is left
  // untouched here. A default of null means no reminder at all.
  const PORTAL_USER = "ethan@cannycapitalpartners.com";
  const defaultLead = async (): Promise<number | null> => {
    try {
      return (await getPreferences(PORTAL_USER)).reminderLeadMinutes;
    } catch {
      return 15;
    }
  };
  const reminderFor = async (
    eventId: string
  ): Promise<number | null | undefined> => {
    const existing = await getEventReminder(eventId).catch(() => null);
    if (!existing || existing.set) return undefined; // explicit choice governs
    return defaultLead();
  };
  const persistDefault = async (eventId: string): Promise<void> => {
    const existing = await getEventReminder(eventId).catch(() => null);
    if (!existing || existing.set) return;
    const lead = await defaultLead();
    if (lead === null) {
      if (existing.isDefault) await clearEventReminder(eventId).catch(() => undefined);
    } else {
      await setEventReminder(eventId, lead, { isDefault: true }).catch(() => undefined);
    }
  };

  if (prevId) {
    try {
      draft.reminderMinutes = await reminderFor(prevId);
      await updateGraphEvent(prevId, draft);
      await persistDefault(prevId);
      return prevId;
    } catch {
      /* event vanished upstream — recreate below */
    }
  } else {
    // Adopt a pre-existing mirror event for this follow-up (legacy 9 AM
    // bridge events carry the task's exact title on its due date).
    try {
      const day = await getCalendarEvents(
        `${task.dueDate}T00:00:00-07:00`,
        `${phxDatePlus(task.dueDate, 1)}T00:00:00-07:00`
      );
      const hit = day.find((e) => e.title === task.title);
      if (hit) {
        draft.reminderMinutes = await reminderFor(hit.eventId);
        await updateGraphEvent(hit.eventId, draft);
        await persistDefault(hit.eventId);
        return hit.eventId;
      }
    } catch {
      /* adoption is an optimization — creation below still applies */
    }
  }

  draft.reminderMinutes = await defaultLead();
  const ev = await createGraphEvent(draft);
  if (ev) await persistDefault(ev.eventId);
  if (!ev) return prevId;

  // A genuinely new event for a linked follow-up keeps the standing
  // behavior: a dated note on the account's profile.
  if (
    (task.relatedKind === "deal" || task.relatedKind === "executive") &&
    task.relatedId
  ) {
    const execs = await getExecutives();
    const deals = await getDeals();
    const hit =
      task.relatedKind === "executive"
        ? execs.find((e) => e.id === task.relatedId)
        : deals.find((d) => d.id === task.relatedId);
    if (hit) {
      const today = new Date().toLocaleDateString("en-CA", { timeZone: TZ });
      const when = task.dueTime
        ? `${task.dueDate} ${task.dueTime}`
        : `${task.dueDate} (all day)`;
      await appendProfileNote(
        task.relatedKind,
        task.relatedId,
        `[${today}] 📅 Calendar event created from follow-up "${task.title}" — ${when}. Auto-logged from the portal.`
      );
    }
  }
  return ev.eventId;
}

/** Back-compat wrapper: a new dated follow-up creates its Outlook event. */
export async function createEventFromTask(task: {
  title: string;
  dueDate: string;
  relatedKind: "deal" | "executive" | null;
  relatedId: string | null;
}): Promise<boolean> {
  const id = await syncTaskEvent({
    title: task.title,
    dueDate: task.dueDate,
    dueTime: null,
    done: false,
    relatedKind: task.relatedKind,
    relatedId: task.relatedId,
    relatedName: "",
    calendarEventId: null,
  });
  return id !== null;
}

/* ---------------- Webhook subscription ---------------- */

const WEBHOOK_URL = `${SITE}/api/calendar/microsoft/webhook`;

export async function getClientState(): Promise<string> {
  let s = await getMsState("clientState");
  if (!s) {
    s = `ccp-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
    await setMsState("clientState", s);
  }
  return s;
}

export async function ensureSubscription(): Promise<{
  active: boolean;
  expiresAt: string;
}> {
  if (!(await msConnected())) return { active: false, expiresAt: "" };
  const existingId = await getMsState("subscriptionId");
  const existingExp = await getMsState("subscriptionExpiresAt");
  if (
    existingId &&
    existingExp &&
    new Date(existingExp).getTime() > Date.now() + 12 * 3600000
  ) {
    return { active: true, expiresAt: existingExp };
  }
  // Recreate: Graph event subscriptions cap at ~4230 minutes.
  const expires = new Date(Date.now() + 4200 * 60000).toISOString();
  const sub = (await graph("/subscriptions", undefined, {
    method: "POST",
    body: JSON.stringify({
      changeType: "created,updated,deleted",
      notificationUrl: WEBHOOK_URL,
      resource: "/me/events",
      expirationDateTime: expires,
      clientState: await getClientState(),
    }),
  })) as { id?: string; expirationDateTime?: string };
  if (sub?.id) {
    await setMsState("subscriptionId", sub.id);
    await setMsState("subscriptionExpiresAt", sub.expirationDateTime ?? expires);
    if (existingId && existingId !== sub.id) {
      await graph(`/subscriptions/${existingId}`, undefined, { method: "DELETE" }).catch(
        () => null
      );
    }
    return { active: true, expiresAt: sub.expirationDateTime ?? expires };
  }
  return { active: false, expiresAt: "" };
}

export async function msStatus(): Promise<{
  configured: boolean;
  connected: boolean;
  accountEmail: string;
  subscriptionActive: boolean;
  subscriptionExpiresAt: string;
}> {
  const configured = msConfigured();
  const tokens = await getMsTokens();
  const connected = configured && (await msConnected());
  return {
    configured,
    connected,
    accountEmail: tokens?.accountEmail ?? "",
    subscriptionActive: Boolean(await getMsState("subscriptionId")),
    subscriptionExpiresAt: await getMsState("subscriptionExpiresAt"),
  };
}

export async function msDisconnect(): Promise<void> {
  const subId = await getMsState("subscriptionId");
  if (subId && (await getMsTokens())) {
    await graph(`/subscriptions/${subId}`, undefined, { method: "DELETE" }).catch(() => null);
  }
  await setMsState("subscriptionId", "");
  await setMsState("subscriptionExpiresAt", "");
  await clearMsTokens();
}
