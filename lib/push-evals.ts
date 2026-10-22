import { flushDigest, sendToUser, type SendResult } from "./push";
import {
  getPreferences,
  getRecentFitSignalCompanies,
  getReminderSnooze,
  hasRecentLog,
  logPush,
  markReminderSnoozeFired,
  phoenixDate,
  phoenixMinutes,
  savePreferences,
  type PushPreferences,
} from "./push-db";
import { getContacts, getDealFlow, getDeals, getExecutives, getTasks } from "./db";
import { getInvestors } from "./investors-db";
import {
  getCalendarEventById,
  getCalendarEvents,
  getEventReminderChoices,
  getGraphReminderStates,
  getReminderArmedEvents,
} from "./calendar-db";
import {
  buildEventReminder,
  buildMorningDigest,
  buildTaskReminder,
  taskDueInstant,
} from "./reminder-content";
import { getAcquisitions, getCompetingBuyers, getSyncLogLatestByJob } from "./market-db";
import { dealFocusSector } from "./valuation";
import { shouldAutoDismiss } from "./az-location";
import { listCandidates } from "./candidates-db";
import type { DealFlowItem } from "./types";

/**
 * Push notification evaluators (extracted from /api/push/check in the
 * Oct 21, 2026 event-driven rework). Production notifications no
 * longer run on a scanning loop:
 * - time-based evaluators (meeting60, follow-up/event reminders) are
 *   scheduled as core.jobs at the exact fire time (lib/push-schedule)
 *   and fire through the scoped entry points below;
 * - data-change evaluators run inline at the write that creates the
 *   state (deal-flow POST -> evalNewListingItem; ingest completion ->
 *   evalFitSignals / evalCompetingBuyers / evalFeeds; candidate
 *   writes -> evalCandidatesByIds);
 * - slow-burn evaluators (stalled, quiet contacts, feed silence) run
 *   once daily inside runMorningDigestBundle (the 8:00 AM Phoenix
 *   push_morning_digest job).
 * The full-scan exports remain for the manual/diagnostic
 * POST /api/push/check trigger. Every candidate goes through
 * sendToUser, which enforces toggles / quiet hours / caps / digest
 * bundling; evaluators handle candidate detection and dedupe against
 * push_log.
 */

const USER = "ethan@cannycapitalpartners.com";
const DAY = 864e5;

async function alreadySent(type: string, entityKey: string, windowDays: number): Promise<boolean> {
  return hasRecentLog(USER, type, entityKey, ["sent", "digested"], new Date(Date.now() - windowDays * DAY));
}

/* Single-notification ownership (Ethan, Oct 16, 2026): when Outlook
 * already carries a native reminder for an event, Outlook is the ONLY
 * notifier — the portal push is suppressed and the skip is written to
 * push_log (once per key per window) so the decision stays auditable. */
async function logCoveredOnce(
  type: string,
  entityKey: string,
  title: string,
  windowDays: number
): Promise<void> {
  const seen = await hasRecentLog(
    USER,
    type,
    entityKey,
    ["skipped-covered"],
    new Date(Date.now() - windowDays * DAY)
  ).catch(() => true);
  if (seen) return;
  await logPush({
    userEmail: USER,
    type,
    entityKey,
    title: "(skipped — covered by Outlook reminder)",
    body: title,
    url: "",
    status: "skipped-covered",
  }).catch(() => undefined);
}

export interface EvalOutcome {
  candidates: number;
  sent: number;
}

/* a. Meeting in ~60 minutes with a Directory contact. */
/** Directory-contact attendee matcher, shared by the full meeting60
 * scan and the scoped scheduled-job firing (fireMeetingForEvent). */
async function buildAttendeeMatcher(): Promise<
  (attendees: string[]) => string | null
> {
  const [execs, investors, contacts] = await Promise.all([
    getExecutives(),
    getInvestors(),
    getContacts(),
  ]);
  const byKey = new Map<string, string>(); // lowercase name/email → display name
  for (const e of execs) if (e.name) byKey.set(e.name.toLowerCase(), e.name);
  for (const i of investors) {
    if (i.name) byKey.set(i.name.toLowerCase(), i.name);
    if (i.email) byKey.set(i.email.toLowerCase(), i.name);
  }
  for (const c of contacts) {
    if (c.email && c.execId) {
      const ex = execs.find((e) => e.id === c.execId);
      if (ex) byKey.set(c.email.toLowerCase(), ex.name);
    }
  }
  return (attendees: string[]): string | null => {
    const entries = Array.from(byKey.entries());
    for (const a of attendees) {
      const low = a.toLowerCase().trim();
      if (byKey.has(low)) return byKey.get(low) ?? null;
      for (const [key, name] of entries) {
        if (key.length >= 4 && (low.includes(key) || key.includes(low))) return name;
      }
    }
    return null;
  };
}

export async function evalMeetings(now: Date): Promise<EvalOutcome> {
  const from = `${phoenixDate(new Date(now.getTime() - DAY))}T00:00:00`;
  const to = `${phoenixDate(new Date(now.getTime() + DAY))}T23:59:59`;
  const events = await getCalendarEvents(from, to);
  const matchAttendee = await buildAttendeeMatcher();

  // An explicit per-event reminder choice (including Off) governs the
  // event's alerting — the generic meeting alert must not double-fire.
  const explicitChoices = await getEventReminderChoices(events.map((e) => e.eventId));

  let candidates = 0;
  let sent = 0;
  for (const ev of events) {
    if (explicitChoices.has(ev.eventId)) continue;
    if (ev.dismissed || ev.allDay) continue;
    const start = Date.parse(ev.startsAt);
    if (Number.isNaN(start)) continue;
    const diffMin = (start - now.getTime()) / 60000;
    if (diffMin < 45 || diffMin > 75) continue;
    const person = matchAttendee(ev.attendees);
    if (!person) continue;
    candidates += 1;
    const entityKey = `${ev.eventId}-${phoenixDate(new Date(start))}`;
    if (await alreadySent("meeting60", entityKey, 2)) continue;
    // Ownership: an Outlook native reminder already covers this event —
    // meeting60 must not ring a second bell.
    if (ev.graphReminderOn === true) {
      await logCoveredOnce("meeting60", entityKey, ev.title, 2);
      continue;
    }
    const timeStr = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Phoenix",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(start));
    const res = await sendToUser(USER, {
      type: "meeting60",
      entityKey,
      genericTitle: "Meeting in about an hour",
      genericBody: "You have a meeting with a Directory contact soon.",
      detailTitle: "Meeting in about an hour",
      detailBody: `${person} — ${ev.title} at ${timeStr}`,
      url: `/directory?q=${encodeURIComponent(person)}`,
    });
    if (res.status === "sent") sent += 1;
  }
  return { candidates, sent };
}

/* a2 + b. Reminder alarms — follow-ups and calendar events (Ethan,
 * Oct 16, 2026, incl. the rich-content amendment). One unified system:
 *
 * - FOLLOW-UPS fire per item at due − lead. The lead is the explicit
 *   per-event choice stored on the follow-up's calendar event when one
 *   exists (Off = never), else the global default in Settings
 *   (reminderLeadMinutes, initial 15). Timed items anchor at their due
 *   time; all-day items at 8:00 AM Phoenix on the due date, minus the
 *   lead. Overdue items still fire (48h catch-up) with lateness stated.
 * - EVENTS fire per item at start − offset for events carrying an
 *   explicit choice. Follow-up events are EXCLUDED here — they fire
 *   through their follow-up, once. All-day events anchor at 8:00 AM
 *   Phoenix on the day, minus the offset, firing until 8 PM that day.
 * - Every firing's dedupe key encodes id + offset + start instant, so
 *   reschedule / snooze (due-date) / choice-change re-arms under a new
 *   key and a stale firing is impossible; completed follow-ups and
 *   deleted items are never collected, so they never fire.
 * - Content is built per item from the live record (lib/reminder-
 *   content) — rich text is used for BOTH the generic and detail slots:
 *   reminder notifications are never generic.
 * - Items sharing a fire minute are sent as ONE grouped notification
 *   (per-item dedupe markers are still written); a notification-action
 *   snooze defers a firing to a one-off re-fire (singles only).
 * - Explicit alarms skip the daily feed cap but honor the type toggle
 *   and quiet hours; a quiet-hours suppression is not marked fired, so
 *   the firing retries on the next sweep inside its window.
 * - OWNERSHIP (single notification): any item whose Outlook event
 *   carries a native Graph reminder is notified by Outlook ONLY — the
 *   portal firing is suppressed and the skip logged to push_log as
 *   "skipped-covered" (see logCoveredOnce). The portal push is the
 *   fallback channel: it fires only when no Outlook reminder covers
 *   the item (not synced, or the Graph reminder is off/unknown). The
 *   same rule suppresses meeting60 for covered events. */

interface Firing {
  kind: "task" | "event";
  id: string;
  key: string; // dedupe key actually checked/logged
  origKey: string; // standard key (snooze rows key off this)
  fireAt: number;
  type: string;
  title: string;
  body: string;
  url: string;
  tag: string;
  actions?: { action: string; title: string }[];
  snoozed?: boolean;
}

const TASK_ACTIONS = [
  { action: "complete", title: "Complete" },
  { action: "snooze1h", title: "Snooze 1 hour" },
  { action: "snoozeTomorrow", title: "Snooze tomorrow" },
];
const EVENT_ACTIONS = [
  { action: "snooze1h", title: "Snooze 1 hour" },
  { action: "snoozeTomorrow", title: "Snooze tomorrow" },
];

async function snoozeGate(
  kind: "task" | "event",
  id: string,
  key: string,
  now: Date
): Promise<"standard" | "deferred" | "snoozed"> {
  const s = await getReminderSnooze(kind, id, key).catch(() => null);
  if (!s || s.fired) return "standard";
  return now.getTime() >= Date.parse(s.fireAt) ? "snoozed" : "deferred";
}

async function collectTaskFirings(
  now: Date,
  prefs: PushPreferences,
  onlyTaskId?: string
): Promise<{ firings: Firing[]; taskEventIds: Set<string>; covered: number }> {
  const tasks = await getTasks();
  const open = tasks.filter(
    (t) => !t.done && t.dueDate !== "" && (!onlyTaskId || t.id === onlyTaskId)
  );
  const taskEventIds = new Set(
    open.map((t) => t.calendarEventId).filter((x): x is string => Boolean(x))
  );
  const choices = await getEventReminderChoices(Array.from(taskEventIds));
  const graphStates = await getGraphReminderStates(Array.from(taskEventIds));
  const firings: Firing[] = [];
  let covered = 0;
  for (const t of open) {
    let lead: number | null;
    if (t.calendarEventId && choices.has(t.calendarEventId)) {
      lead = choices.get(t.calendarEventId) ?? null; // explicit; null = Off
    } else {
      lead = prefs.reminderLeadMinutes; // global default; null = none
    }
    if (lead === null) continue;
    const due = taskDueInstant(t);
    const fireAt = due.getTime() - lead * 60000;
    if (now.getTime() < fireAt) continue;
    if (now.getTime() - fireAt > 48 * 3600 * 1000) continue; // catch-up bound
    const key = `rem:task:${t.id}:${lead}:${t.dueDate}T${t.dueTime ?? "allday"}`;
    const gate = await snoozeGate("task", t.id, key, now);
    if (gate === "deferred") continue;
    if (gate === "standard") {
      if (await alreadySent("followups", key, 30)) continue;
      // Ownership: the follow-up's Outlook event carries a native
      // reminder — Outlook notifies; the portal stays silent.
      if (t.calendarEventId && graphStates.get(t.calendarEventId) === true) {
        covered += 1;
        await logCoveredOnce("followups", key, t.title, 30);
        continue;
      }
    }
    const built = buildTaskReminder(t, now);
    firings.push({
      kind: "task",
      id: t.id,
      key: gate === "snoozed" ? `remz:task:${t.id}:${key}` : key,
      origKey: key,
      fireAt,
      type: "followups",
      title: built.title,
      body: built.body,
      url: built.url,
      tag: `rem:task:${t.id}`,
      actions: TASK_ACTIONS,
      snoozed: gate === "snoozed",
    });
  }
  return { firings, taskEventIds, covered };
}

async function collectEventFirings(
  now: Date,
  taskEventIds: Set<string>,
  onlyEventId?: string
): Promise<{ firings: Firing[]; covered: number }> {
  const from = `${phoenixDate(new Date(now.getTime() - 2 * DAY))}T00:00:00`;
  const to = `${phoenixDate(new Date(now.getTime() + 3 * DAY))}T23:59:59`;
  const armedAll = await getReminderArmedEvents(from, to);
  const armed = onlyEventId
    ? armedAll.filter((a) => a.event.eventId === onlyEventId)
    : armedAll;
  const firings: Firing[] = [];
  let covered = 0;
  for (const { event: ev, minutes } of armed) {
    if (taskEventIds.has(ev.eventId)) continue; // fires via its follow-up
    const start = Date.parse(ev.startsAt);
    if (Number.isNaN(start)) continue;
    let fireAt: number;
    let until: number;
    if (ev.allDay) {
      const anchor = Date.parse(`${ev.startsAt.slice(0, 10)}T08:00:00-07:00`);
      if (Number.isNaN(anchor)) continue;
      fireAt = anchor - minutes * 60000;
      until = anchor + 12 * 3600 * 1000;
    } else {
      fireAt = start - minutes * 60000;
      until = start;
    }
    if (now.getTime() < fireAt || now.getTime() >= until) continue;
    const key = `rem:event:${ev.eventId}:${minutes}:${ev.startsAt}`;
    const gate = await snoozeGate("event", ev.eventId, key, now);
    if (gate === "deferred") continue;
    if (gate === "standard") {
      if (await alreadySent("eventReminder", key, 30)) continue;
      // Ownership: a native Outlook reminder covers this event — the
      // portal push is suppressed; the skip is logged, once per key.
      if (ev.graphReminderOn === true) {
        covered += 1;
        await logCoveredOnce("eventReminder", key, ev.title, 30);
        continue;
      }
    }
    const built = buildEventReminder(ev, now);
    firings.push({
      kind: "event",
      id: ev.eventId,
      key: gate === "snoozed" ? `remz:event:${ev.eventId}:${key}` : key,
      origKey: key,
      fireAt,
      type: "eventReminder",
      title: built.title,
      body: built.body,
      url: built.url,
      tag: `rem:event:${ev.eventId}`,
      actions: EVENT_ACTIONS,
      snoozed: gate === "snoozed",
    });
  }
  return { firings, covered };
}

async function sendOne(f: Firing): Promise<SendResult> {
  const res = await sendToUser(USER, {
    type: f.type,
    entityKey: f.key,
    genericTitle: f.title,
    genericBody: f.body,
    detailTitle: f.title,
    detailBody: f.body,
    url: f.url,
    tag: f.tag,
    actions: f.actions,
    data: { kind: f.kind, id: f.id, key: f.origKey },
    skipDailyCap: true,
  });
  if (f.snoozed && (res.status === "sent" || res.status === "digested")) {
    await markReminderSnoozeFired(f.kind, f.id, f.origKey).catch(() => undefined);
  }
  return res;
}

async function sendFirings(firings: Firing[]): Promise<{ candidates: number; sent: number }> {
  let sent = 0;
  const singles: Firing[] = [];
  const groups = new Map<string, Firing[]>();
  for (const f of firings) {
    if (f.snoozed) {
      singles.push(f);
      continue;
    }
    const minute = new Date(f.fireAt).toISOString().slice(0, 16);
    const g = groups.get(minute);
    if (g) g.push(f);
    else groups.set(minute, [f]);
  }
  for (const f of singles) {
    if (await alreadySent(f.type, f.key, 30)) continue;
    const res = await sendOne(f);
    if (res.status === "sent") sent += 1;
  }
  for (const [minute, group] of Array.from(groups.entries())) {
    if (group.length === 1) {
      const f = group[0];
      if (await alreadySent(f.type, f.key, 30)) continue;
      const res = await sendOne(f);
      if (res.status === "sent") sent += 1;
      continue;
    }
    // Simultaneous reminders: ONE grouped notification. Items already
    // fired under their own key are excluded; per-item markers are
    // written on success so nothing double-fires next sweep.
    const pending: Firing[] = [];
    for (const f of group) {
      if (!(await alreadySent(f.type, f.key, 30))) pending.push(f);
    }
    if (!pending.length) continue;
    const lines = pending
      .slice(0, 4)
      .map((f) => {
        const timing =
          f.body.split("\n").find((l) => l.trim() && !l.startsWith("🔴")) ?? "";
        return `${f.title} · ${timing}`;
      });
    const body =
      lines.join("\n") + (pending.length > 4 ? `\n+${pending.length - 4} more` : "");
    const anyTask = pending.some((f) => f.kind === "task");
    const res = await sendToUser(USER, {
      type: anyTask ? "followups" : "eventReminder",
      entityKey: `rembatch:${minute}:${pending.map((f) => f.id).join(",")}`,
      genericTitle: `${pending.length} reminders`,
      genericBody: body,
      detailTitle: `${pending.length} reminders`,
      detailBody: body,
      url: anyTask ? "/overview#overview-tasks" : "/calendar",
      tag: `rem:batch:${minute}`,
      skipDailyCap: true,
    });
    if (res.status === "sent") sent += 1;
    if (res.status === "sent" || res.status === "digested") {
      for (const f of pending) {
        await logPush({
          userEmail: USER,
          type: f.type,
          entityKey: f.key,
          title: f.title,
          body: f.body,
          url: f.url,
          status: res.status,
        }).catch(() => undefined);
      }
    }
  }
  return { candidates: firings.length, sent };
}

export async function evalReminders(
  now: Date
): Promise<{ taskCandidates: number; eventCandidates: number; covered: number; sent: number }> {
  const prefs = await getPreferences(USER);
  const {
    firings: taskFirings,
    taskEventIds,
    covered: coveredTasks,
  } = await collectTaskFirings(now, prefs);
  const { firings: eventFirings, covered: coveredEvents } = await collectEventFirings(
    now,
    taskEventIds
  );
  const out = await sendFirings([...taskFirings, ...eventFirings]);
  return {
    taskCandidates: taskFirings.length,
    eventCandidates: eventFirings.length,
    covered: coveredTasks + coveredEvents,
    sent: out.sent,
  };
}

/* b2. Morning digest — one 8:00 AM Phoenix notification listing
 * today's follow-ups (Settings toggle, default ON; extends the push
 * digest family rather than duplicating it — this one is computed
 * from the follow-up list itself, not the queued-item digest). */
export async function evalMorningDigest(now: Date): Promise<EvalOutcome> {
  const prefs = await getPreferences(USER);
  if (!prefs.reminderDigest) return { candidates: 0, sent: 0 };
  const today = phoenixDate(now);
  if (prefs.reminderDigestDate === today) return { candidates: 0, sent: 0 };
  if (phoenixMinutes(now) < 8 * 60) return { candidates: 0, sent: 0 };
  const tasks = await getTasks();
  const dueToday = tasks
    .filter((t) => !t.done && t.dueDate === today)
    .sort((a, b) => (a.dueTime ?? "").localeCompare(b.dueTime ?? ""));
  // Mark the day evaluated either way — the digest is a morning
  // snapshot; follow-ups added later get their own reminders.
  await savePreferences(USER, { ...prefs, reminderDigestDate: today }).catch(() => undefined);
  if (!dueToday.length) return { candidates: 0, sent: 0 };
  const built = buildMorningDigest(dueToday);
  const res = await sendToUser(USER, {
    type: "morningDigest",
    entityKey: `morning-digest-${today}`,
    genericTitle: built.title,
    genericBody: built.body,
    detailTitle: built.title,
    detailBody: built.body,
    url: built.url,
    tag: `morning-digest-${today}`,
  });
  return { candidates: 1, sent: res.status === "sent" ? 1 : 0 };
}

/* c. New fit targets carrying 2+ owner-transition signals. */
export async function evalFitSignals(now: Date): Promise<EvalOutcome> {
  const since = new Date(now.getTime() - 7 * DAY).toISOString().slice(0, 10);
  const companies = await getRecentFitSignalCompanies(since);
  let sent = 0;
  for (const c of companies) {
    if (await alreadySent("fitSignals", c.dedupKey, 7)) continue;
    const res = await sendToUser(USER, {
      type: "fitSignals",
      entityKey: c.dedupKey,
      genericTitle: "New fit target",
      genericBody: `New fit target in ${c.sector}`,
      detailTitle: "New fit target",
      detailBody: `${c.name} — new fit target in ${c.sector} with ${c.signalCount} owner-transition signals`,
      url: "/market-intel#fit-targets",
    });
    if (res.status === "sent") sent += 1;
  }
  return { candidates: companies.length, sent };
}

/* d. New businesses for sale passing the AZ + focus-sector screens.
 * DealFlowItem stores no numeric size fields, so the $500K-earnings /
 * $1M-ask size screen cannot be re-applied here — the morning sweep
 * already applied it before posting the item. */
export async function evalNewListingItem(
  item: DealFlowItem,
  now: Date
): Promise<EvalOutcome> {
  if (item.kind !== "business_for_sale" || item.status !== "new")
    return { candidates: 0, sent: 0 };
  if (Date.parse(item.createdAt) < now.getTime() - DAY)
    return { candidates: 0, sent: 0 };
  if (shouldAutoDismiss(item.kind, item.location || ""))
    return { candidates: 0, sent: 0 };
  const sector = dealFocusSector(item.industry || "");
  if (!sector) return { candidates: 0, sent: 0 };
  if (await alreadySent("newListing", item.id, 7))
    return { candidates: 1, sent: 0 };
  const res = await sendToUser(USER, {
    type: "newListing",
    entityKey: item.id,
    genericTitle: "New business for sale",
    genericBody: `New business for sale in ${sector}`,
    detailTitle: "New business for sale",
    detailBody: `${item.title} — ${sector}${item.location ? ` · ${item.location}` : ""}`,
    url: "/activity",
  });
  return { candidates: 1, sent: res.status === "sent" ? 1 : 0 };
}

export async function evalNewListings(now: Date): Promise<EvalOutcome> {
  const items = await getDealFlow();
  let candidates = 0;
  let sent = 0;
  for (const item of items) {
    const out = await evalNewListingItem(item, now);
    candidates += out.candidates;
    sent += out.sent;
  }
  return { candidates, sent };
}

/* e. Deals stalled in an active stage for 30+ days — one per deal,
 * re-alerted at most every 7 days. */
export async function evalStalled(now: Date): Promise<EvalOutcome> {
  const deals = await getDeals();
  const cutoff = now.getTime() - 30 * DAY;
  const stalled = deals.filter(
    (d) => d.stage !== "Closed Won" && d.stage !== "Passed" && Date.parse(d.updatedAt) <= cutoff
  );
  let sent = 0;
  for (const d of stalled) {
    if (await alreadySent("stalled", d.id, 7)) continue;
    const res = await sendToUser(USER, {
      type: "stalled",
      entityKey: d.id,
      genericTitle: "A deal has stalled",
      genericBody: "A deal has had no movement in over 30 days.",
      detailTitle: "A deal has stalled",
      detailBody: `${d.companyName} — no movement in ${d.stage} for 30+ days`,
      url: `/deals/${d.id}`,
    });
    if (res.status === "sent") sent += 1;
  }
  return { candidates: stalled.length, sent };
}

/* f. Contacts going quiet — executives + investors whose record has
 * not been touched (updatedAt) in 60 / 90 days. One bundled alert per
 * threshold per day; per-contact marker rows in push_log prevent the
 * same contact being re-alerted at the same threshold. */
export async function evalQuietContacts(now: Date): Promise<EvalOutcome> {
  const today = phoenixDate(now);
  const [execs, investors] = await Promise.all([getExecutives(), getInvestors()]);
  interface QC {
    markerKey: string;
    name: string;
    threshold: 60 | 90;
  }
  const fresh: QC[] = [];
  const consider = async (kind: "exec" | "investor", id: string, name: string, updatedAt: string) => {
    const ageDays = (now.getTime() - Date.parse(updatedAt)) / DAY;
    if (!(ageDays >= 60)) return;
    const threshold = (ageDays >= 90 ? 90 : 60) as 60 | 90;
    const markerKey = `quiet:${kind}:${id}:${threshold}`;
    if (await alreadySent("quiet60_90", markerKey, 365)) return;
    fresh.push({ markerKey, name, threshold });
  };
  for (const e of execs) await consider("exec", e.id, e.name, e.updatedAt);
  for (const i of investors) await consider("investor", i.id, i.name, i.updatedAt);

  let sent = 0;
  for (const threshold of [60, 90] as const) {
    const group = fresh.filter((c) => c.threshold === threshold);
    if (!group.length) continue;
    const entityKey = `quiet${threshold}-${today}`;
    if (await alreadySent("quiet60_90", entityKey, 2)) continue;
    const names = group.slice(0, 3).map((c) => c.name).join(", ") + (group.length > 3 ? ` +${group.length - 3} more` : "");
    const res: SendResult = await sendToUser(USER, {
      type: "quiet60_90",
      entityKey,
      genericTitle: "A contact is going quiet",
      genericBody: `${group.length} contact${group.length === 1 ? "" : "s"} with no touch in ${threshold}+ days`,
      detailTitle: "A contact is going quiet",
      detailBody: `${names} — no touch in ${threshold}+ days`,
      url: "/directory",
    });
    if (res.status === "sent" || res.status === "digested") {
      if (res.status === "sent") sent += 1;
      for (const c of group) {
        await logPush({
          userEmail: USER,
          type: "quiet60_90",
          entityKey: c.markerKey,
          title: "(bundled quiet-contact alert)",
          body: c.name,
          url: "/directory",
          status: res.status,
        }).catch(() => undefined);
      }
    }
  }
  return { candidates: fresh.length, sent };
}

/* g. A known competing buyer (2+ AZ deals in the last 12 months) with
 * a fresh acquisition in the feed. */
export async function evalCompetingBuyers(now: Date): Promise<EvalOutcome> {
  const [buyers, acqs] = await Promise.all([getCompetingBuyers(), getAcquisitions()]);
  const names = buyers.map((b) => b.acquirer.toUpperCase()).filter(Boolean);
  if (!names.length) return { candidates: 0, sent: 0 };
  const earliest = phoenixDate(new Date(now.getTime() - 2 * DAY));
  const today = phoenixDate(now);
  let candidates = 0;
  let sent = 0;
  for (const a of acqs) {
    if (a.eventType !== "acquisition" || a.status === "dismissed" || !a.acquirer) continue;
    if (a.announcedDate < earliest || a.announcedDate > today) continue;
    const acq = a.acquirer.toUpperCase();
    if (!names.some((n) => acq.includes(n) || n.includes(acq))) continue;
    candidates += 1;
    if (await alreadySent("competingBuyer", a.id, 30)) continue;
    const res = await sendToUser(USER, {
      type: "competingBuyer",
      entityKey: a.id,
      genericTitle: "Competing buyer acquisition",
      genericBody: "A known repeat acquirer just made another acquisition in our sectors",
      detailTitle: "Competing buyer acquisition",
      detailBody: `${a.acquirer} acquired ${a.target}${a.targetLocation ? ` (${a.targetLocation})` : ""}`,
      url: "/market-intel#acquisitions",
    });
    if (res.status === "sent") sent += 1;
  }
  return { candidates, sent };
}

/* h. Data feeds silent past their expected cadence — one alert per job
 * per day. Thresholds are per job: event/daily feeds 48h, the weekly
 * SAM entities pull 9 days, monthly/annual reference feeds (Census
 * govfin + tracts, CBP sector counts, county permits) 40 days. A flat
 * 48h rule would false-alarm on every slow-cadence feed. */
const FEED_SILENCE_HOURS: Record<string, number> = {
  entities: 9 * 24,
  census: 40 * 24,
  "census-fin": 40 * 24,
  susb_sizes: 40 * 24,
  sector_counts: 40 * 24,
  "sector-xcheck": 40 * 24,
  county_permits: 40 * 24,
  "permits-xcheck": 40 * 24,
};
export async function evalFeeds(now: Date): Promise<EvalOutcome> {
  const rows = await getSyncLogLatestByJob();
  const today = phoenixDate(now);
  let candidates = 0;
  let sent = 0;
  for (const row of rows) {
    const age = now.getTime() - Date.parse(row.ranAt);
    const limit = (FEED_SILENCE_HOURS[row.job] ?? 48) * 3600 * 1000;
    if (!(age > limit)) continue;
    candidates += 1;
    const entityKey = `feed-${row.job}-${today}`;
    if (await alreadySent("feedDown", entityKey, 2)) continue;
    const res = await sendToUser(USER, {
      type: "feedDown",
      entityKey,
      genericTitle: "A data feed needs attention",
      genericBody: "One of the portal's data feeds has stopped updating.",
      detailTitle: "A data feed needs attention",
      detailBody: `${row.job} last ran ${row.ranAt}${row.status !== "ok" ? ` (${row.status})` : ""}`,
      url: "/market-intel",
    });
    if (res.status === "sent") sent += 1;
  }
  return { candidates, sent };
}

/* i. Operator candidates scoring 80+ (Operator Discovery spec §5 —
 * OPT-IN, default OFF in preferences). One notification per candidate,
 * ever: the dedupe key is the candidate id with a very long window,
 * so a candidate is announced once when they first clear 80; a
 * Passed candidate is never announced. When the toggle is off,
 * sendToUser logs skipped-pref and nothing is delivered. */
type CandidateRow = Awaited<ReturnType<typeof listCandidates>>[number];

function isHighScoreCandidate(c: CandidateRow): boolean {
  return c.score !== null && c.score >= 80 && c.status !== "Passed";
}

async function evalCandidateHighScoreOne(c: CandidateRow): Promise<number> {
  if (await alreadySent("candidateHighScore", c.id, 3650)) return 0;
  const role = [c.currentTitle, c.company].filter(Boolean).join(", ");
  const res = await sendToUser(USER, {
    type: "candidateHighScore",
    entityKey: c.id,
    genericTitle: "High-scoring operator candidate",
    genericBody: "An operator candidate scored 80+ in sourcing.",
    detailTitle: "High-scoring operator candidate",
    detailBody: `${c.name} scored ${c.score}/100${role ? ` — ${role}` : ""}`,
    url: `/directory?q=${encodeURIComponent(c.name)}`,
  });
  return res.status === "sent" ? 1 : 0;
}

export async function evalCandidateHighScores(): Promise<EvalOutcome> {
  const all = await listCandidates();
  const top = all.filter(isHighScoreCandidate);
  // Opt-in gate read here (not only inside sendToUser) so an OFF
  // toggle doesn't write a skipped-pref log row.
  const prefs = await getPreferences(USER);
  if (!prefs.types.candidateHighScore) return { candidates: top.length, sent: 0 };
  let sent = 0;
  for (const c of top) sent += await evalCandidateHighScoreOne(c);
  return { candidates: top.length, sent };
}

/** Scoped variant used at candidate write points (create / update /
 * rescore of specific records): same opt-in gate and dedupe as the
 * full evaluator, restricted to the given candidate ids. */
export async function evalCandidatesByIds(ids: string[]): Promise<EvalOutcome> {
  if (!ids.length) return { candidates: 0, sent: 0 };
  const all = await listCandidates();
  const wanted = new Set(ids);
  const top = all.filter((c) => wanted.has(c.id) && isHighScoreCandidate(c));
  const prefs = await getPreferences(USER);
  if (!prefs.types.candidateHighScore) return { candidates: top.length, sent: 0 };
  let sent = 0;
  for (const c of top) sent += await evalCandidateHighScoreOne(c);
  return { candidates: top.length, sent };
}


/* ---------------- Scoped entry points for scheduled jobs ------------
 * Used by lib/push-schedule.ts jobs (push_reminder / push_meeting60 /
 * push_morning_digest). Each re-derives everything from the LIVE
 * record at fire time, so a schedule made stale by an edit is
 * harmless: the handler either fires the current truth, reschedules
 * (rescheduleAt), or no-ops (completed / deleted / Off / covered). */

/** Next firing instant (ms epoch) for one follow-up, or null when it
 * should never fire (done, no due date, lead Off). Mirrors the lead
 * resolution in collectTaskFirings exactly. */
export async function computeTaskFireAt(taskId: string): Promise<number | null> {
  const tasks = await getTasks();
  const t = tasks.find((x) => x.id === taskId);
  if (!t || t.done || t.dueDate === "") return null;
  let lead: number | null;
  if (t.calendarEventId) {
    const choices = await getEventReminderChoices([t.calendarEventId]);
    if (choices.has(t.calendarEventId)) {
      lead = choices.get(t.calendarEventId) ?? null; // explicit; null = Off
    } else {
      const prefs = await getPreferences(USER);
      lead = prefs.reminderLeadMinutes;
    }
  } else {
    const prefs = await getPreferences(USER);
    lead = prefs.reminderLeadMinutes;
  }
  if (lead === null) return null;
  return taskDueInstant(t).getTime() - lead * 60000;
}

/** Fire times for one calendar event: the generic meeting60 alert
 * (start - 60m, only when no explicit reminder choice governs the
 * event) and the explicit-choice reminder (start - offset; all-day
 * events anchor 8:00 AM Phoenix minus offset). A follow-up's synced
 * event gets reminderAt null — it fires through its follow-up. */
export async function computeEventFireTimes(
  eventId: string
): Promise<{ meeting60At: number | null; reminderAt: number | null }> {
  const ev = await getCalendarEventById(eventId);
  if (!ev) return { meeting60At: null, reminderAt: null };
  const start = Date.parse(ev.startsAt);
  if (Number.isNaN(start)) return { meeting60At: null, reminderAt: null };
  const choices = await getEventReminderChoices([eventId]);
  const hasChoice = choices.has(eventId);
  const meeting60At =
    !hasChoice && !ev.allDay && !ev.dismissed ? start - 60 * 60000 : null;
  let reminderAt: number | null = null;
  if (hasChoice) {
    const minutes = choices.get(eventId) ?? null;
    if (minutes !== null) {
      const tasks = await getTasks();
      const linkedToFollowUp = tasks.some(
        (t) => !t.done && t.dueDate !== "" && t.calendarEventId === eventId
      );
      if (!linkedToFollowUp) {
        const raw = ev.allDay
          ? Date.parse(`${ev.startsAt.slice(0, 10)}T08:00:00-07:00`) -
            minutes * 60000
          : start - minutes * 60000;
        reminderAt = Number.isNaN(raw) ? null : raw;
      }
    }
  }
  return { meeting60At, reminderAt };
}

/** Scoped meeting60 firing for one event (the push_meeting60 job).
 * Same skips, dedupe, ownership rule and payload as evalMeetings.
 * Window: the sweep fires at 45-75 min before start; the scheduled
 * job is enqueued for start-60m and may drain a few minutes late, so
 * the scoped path fires any time in the last 75 minutes before the
 * meeting starts. If the event moved later, rescheduleAt points at
 * the new start-60m. */
export async function fireMeetingForEvent(
  eventId: string,
  now: Date
): Promise<{ fired: boolean; rescheduleAt?: number }> {
  const ev = await getCalendarEventById(eventId);
  if (!ev || ev.dismissed || ev.allDay) return { fired: false };
  const start = Date.parse(ev.startsAt);
  if (Number.isNaN(start)) return { fired: false };
  const choices = await getEventReminderChoices([eventId]);
  if (choices.has(eventId)) return { fired: false };
  const diffMin = (start - now.getTime()) / 60000;
  if (diffMin > 75) return { fired: false, rescheduleAt: start - 60 * 60000 };
  if (diffMin < 0) return { fired: false };
  const matchAttendee = await buildAttendeeMatcher();
  const person = matchAttendee(ev.attendees);
  if (!person) return { fired: false };
  const entityKey = `${ev.eventId}-${phoenixDate(new Date(start))}`;
  if (await alreadySent("meeting60", entityKey, 2)) return { fired: false };
  if (ev.graphReminderOn === true) {
    await logCoveredOnce("meeting60", entityKey, ev.title, 2);
    return { fired: false };
  }
  const timeStr = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(start));
  const res = await sendToUser(USER, {
    type: "meeting60",
    entityKey,
    genericTitle: "Meeting in about an hour",
    genericBody: "You have a meeting with a Directory contact soon.",
    detailTitle: "Meeting in about an hour",
    detailBody: `${person} — ${ev.title} at ${timeStr}`,
    url: `/directory?q=${encodeURIComponent(person)}`,
  });
  return { fired: res.status === "sent" };
}

/** Scoped reminder firing for one follow-up or event (the
 * push_reminder job). Runs the existing collectors restricted to the
 * item, so snooze gates, grouping, ownership suppression and dedupe
 * keys all behave exactly as in the sweep. When nothing fires
 * because the moment moved into the future (reschedule / due-date
 * edit), rescheduleAt carries the recomputed fire time. */
export async function fireReminderForItem(
  itemKind: "task" | "event",
  itemId: string,
  now: Date
): Promise<{ fired: boolean; rescheduleAt?: number }> {
  const prefs = await getPreferences(USER);
  if (itemKind === "task") {
    const { firings } = await collectTaskFirings(now, prefs, itemId);
    if (firings.length) {
      const out = await sendFirings(firings);
      return { fired: out.sent > 0 };
    }
    const next = await computeTaskFireAt(itemId);
    if (next !== null && next > now.getTime() + 30000) {
      return { fired: false, rescheduleAt: next };
    }
    return { fired: false };
  }
  const allTasks = await getTasks();
  const taskEventIds = new Set(
    allTasks
      .filter((t) => !t.done && t.dueDate !== "")
      .map((t) => t.calendarEventId)
      .filter((x): x is string => Boolean(x))
  );
  const { firings } = await collectEventFirings(now, taskEventIds, itemId);
  if (firings.length) {
    const out = await sendFirings(firings);
    return { fired: out.sent > 0 };
  }
  const times = await computeEventFireTimes(itemId);
  if (times.reminderAt !== null && times.reminderAt > now.getTime() + 30000) {
    return { fired: false, rescheduleAt: times.reminderAt };
  }
  return { fired: false };
}

/** The daily bundle behind the push_morning_digest job (8:00 AM
 * Phoenix): the morning digest itself, the slow-burn evaluators
 * (stalled deals, quiet contacts, feed silence) and the queued-item
 * digest flush. Each part is isolated so one failure cannot starve
 * the others. */
export async function runMorningDigestBundle(now: Date): Promise<EvalOutcome> {
  let candidates = 0;
  let sent = 0;
  const parts: (() => Promise<EvalOutcome>)[] = [
    () => evalMorningDigest(now),
    () => evalStalled(now),
    () => evalQuietContacts(now),
    () => evalFeeds(now),
  ];
  for (const part of parts) {
    try {
      const out = await part();
      candidates += out.candidates;
      sent += out.sent;
    } catch {
      /* isolated — the remaining parts still run */
    }
  }
  try {
    const flushed = await flushDigest(USER);
    if (flushed?.status === "sent") sent += 1;
  } catch {
    /* isolated */
  }
  return { candidates, sent };
}
