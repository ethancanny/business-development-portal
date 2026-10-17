import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { flushDigest, sendToUser, type SendResult } from "@/lib/push";
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
} from "@/lib/push-db";
import { getContacts, getDealFlow, getDeals, getExecutives, getTasks } from "@/lib/db";
import { getInvestors } from "@/lib/investors-db";
import {
  getCalendarEvents,
  getEventReminderChoices,
  getReminderArmedEvents,
} from "@/lib/calendar-db";
import {
  buildEventReminder,
  buildMorningDigest,
  buildTaskReminder,
  taskDueInstant,
} from "@/lib/reminder-content";
import { getAcquisitions, getCompetingBuyers, getSyncLogLatestByJob } from "@/lib/market-db";
import { dealFocusSector } from "@/lib/valuation";
import { shouldAutoDismiss } from "@/lib/az-location";

/**
 * Push evaluator sweep (CRM Phase 2, Oct 14, 2026). Runs the eight
 * notification evaluators for the single portal user and flushes the
 * morning digest. Triggered by cron (Bearer CRON_SECRET, same pattern
 * as /api/market/ingest) or an authenticated session. Every candidate
 * goes through sendToUser, which enforces toggles / quiet hours / caps
 * / digest bundling; evaluators only handle candidate detection and
 * dedupe against push_log.
 */

export const maxDuration = 60;

const USER = "ethan@cannycapitalpartners.com";
const DAY = 864e5;

function authorized(req: NextRequest): boolean {
  if (getSessionUser()) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev without CRON_SECRET
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function alreadySent(type: string, entityKey: string, windowDays: number): Promise<boolean> {
  return hasRecentLog(USER, type, entityKey, ["sent", "digested"], new Date(Date.now() - windowDays * DAY));
}

interface EvalOutcome {
  candidates: number;
  sent: number;
}

/* a. Meeting in ~60 minutes with a Directory contact. */
async function evalMeetings(now: Date): Promise<EvalOutcome> {
  const from = `${phoenixDate(new Date(now.getTime() - DAY))}T00:00:00`;
  const to = `${phoenixDate(new Date(now.getTime() + DAY))}T23:59:59`;
  const [events, execs, investors, contacts] = await Promise.all([
    getCalendarEvents(from, to),
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
  const matchAttendee = (attendees: string[]): string | null => {
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
 *   the firing retries on the next sweep inside its window. */

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
  prefs: PushPreferences
): Promise<{ firings: Firing[]; taskEventIds: Set<string> }> {
  const tasks = await getTasks();
  const open = tasks.filter((t) => !t.done && t.dueDate !== "");
  const taskEventIds = new Set(
    open.map((t) => t.calendarEventId).filter((x): x is string => Boolean(x))
  );
  const choices = await getEventReminderChoices(Array.from(taskEventIds));
  const firings: Firing[] = [];
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
  return { firings, taskEventIds };
}

async function collectEventFirings(
  now: Date,
  taskEventIds: Set<string>
): Promise<Firing[]> {
  const from = `${phoenixDate(new Date(now.getTime() - 2 * DAY))}T00:00:00`;
  const to = `${phoenixDate(new Date(now.getTime() + 3 * DAY))}T23:59:59`;
  const armed = await getReminderArmedEvents(from, to);
  const firings: Firing[] = [];
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
  return firings;
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

async function evalReminders(
  now: Date
): Promise<{ taskCandidates: number; eventCandidates: number; sent: number }> {
  const prefs = await getPreferences(USER);
  const { firings: taskFirings, taskEventIds } = await collectTaskFirings(now, prefs);
  const eventFirings = await collectEventFirings(now, taskEventIds);
  const out = await sendFirings([...taskFirings, ...eventFirings]);
  return {
    taskCandidates: taskFirings.length,
    eventCandidates: eventFirings.length,
    sent: out.sent,
  };
}

/* b2. Morning digest — one 8:00 AM Phoenix notification listing
 * today's follow-ups (Settings toggle, default ON; extends the push
 * digest family rather than duplicating it — this one is computed
 * from the follow-up list itself, not the queued-item digest). */
async function evalMorningDigest(now: Date): Promise<EvalOutcome> {
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
async function evalFitSignals(now: Date): Promise<EvalOutcome> {
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
async function evalNewListings(now: Date): Promise<EvalOutcome> {
  const items = await getDealFlow();
  let candidates = 0;
  let sent = 0;
  for (const item of items) {
    if (item.kind !== "business_for_sale" || item.status !== "new") continue;
    if (Date.parse(item.createdAt) < now.getTime() - DAY) continue;
    if (shouldAutoDismiss(item.kind, item.location || "")) continue;
    const sector = dealFocusSector(item.industry || "");
    if (!sector) continue;
    candidates += 1;
    if (await alreadySent("newListing", item.id, 7)) continue;
    const res = await sendToUser(USER, {
      type: "newListing",
      entityKey: item.id,
      genericTitle: "New business for sale",
      genericBody: `New business for sale in ${sector}`,
      detailTitle: "New business for sale",
      detailBody: `${item.title} — ${sector}${item.location ? ` · ${item.location}` : ""}`,
      url: "/activity",
    });
    if (res.status === "sent") sent += 1;
  }
  return { candidates, sent };
}

/* e. Deals stalled in an active stage for 30+ days — one per deal,
 * re-alerted at most every 7 days. */
async function evalStalled(now: Date): Promise<EvalOutcome> {
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
async function evalQuietContacts(now: Date): Promise<EvalOutcome> {
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
async function evalCompetingBuyers(now: Date): Promise<EvalOutcome> {
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
async function evalFeeds(now: Date): Promise<EvalOutcome> {
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

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const evaluated: Record<string, number> = {};
  const errors: Record<string, string> = {};
  let sent = 0;
  const run = async (name: string, fn: () => Promise<EvalOutcome>) => {
    try {
      const out = await fn();
      evaluated[name] = out.candidates;
      sent += out.sent;
    } catch (err) {
      errors[name] = err instanceof Error ? err.message : String(err);
      evaluated[name] = 0;
    }
  };

  await run("meeting60", () => evalMeetings(now));
  try {
    const rem = await evalReminders(now);
    evaluated.followups = rem.taskCandidates;
    evaluated.eventReminder = rem.eventCandidates;
    sent += rem.sent;
  } catch (err) {
    errors.reminders = err instanceof Error ? err.message : String(err);
    evaluated.followups = 0;
    evaluated.eventReminder = 0;
  }
  await run("morningDigest", () => evalMorningDigest(now));
  await run("fitSignals", () => evalFitSignals(now));
  await run("newListing", () => evalNewListings(now));
  await run("stalled", () => evalStalled(now));
  await run("quiet60_90", () => evalQuietContacts(now));
  await run("competingBuyer", () => evalCompetingBuyers(now));
  await run("feedDown", () => evalFeeds(now));

  // Morning digest flush runs after the evaluators so anything queued
  // this sweep can go out in the same run.
  try {
    const digest = await flushDigest(USER);
    if (digest?.status === "sent") sent += 1;
  } catch (err) {
    errors.digest = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({ ok: true, evaluated, sent, ...(Object.keys(errors).length ? { errors } : {}) });
}
