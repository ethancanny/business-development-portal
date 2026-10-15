import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { flushDigest, sendToUser, type SendResult } from "@/lib/push";
import {
  getRecentFitSignalCompanies,
  hasRecentLog,
  logPush,
  phoenixDate,
} from "@/lib/push-db";
import { getContacts, getDealFlow, getDeals, getExecutives, getTasks } from "@/lib/db";
import { getInvestors } from "@/lib/investors-db";
import { getCalendarEvents } from "@/lib/calendar-db";
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

  let candidates = 0;
  let sent = 0;
  for (const ev of events) {
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

/* b. Follow-ups due today or overdue — one bundled notification/day. */
async function evalFollowups(now: Date): Promise<EvalOutcome> {
  const today = phoenixDate(now);
  const tasks = await getTasks();
  const due = tasks.filter((t) => !t.done && t.dueDate !== "" && t.dueDate <= today);
  if (!due.length) return { candidates: 0, sent: 0 };
  const entityKey = `followups-${today}`;
  if (await alreadySent("followups", entityKey, 2)) return { candidates: due.length, sent: 0 };
  const res = await sendToUser(USER, {
    type: "followups",
    entityKey,
    genericTitle: "Follow-ups due today",
    genericBody: "You have follow-ups due or overdue.",
    detailTitle: "Follow-ups due today",
    detailBody: `${due.length} follow-up${due.length === 1 ? "" : "s"} due or overdue`,
    url: "/overview",
  });
  return { candidates: due.length, sent: res.status === "sent" ? 1 : 0 };
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

/* h. Data feeds whose latest sync-log run is more than 48h old —
 * one alert per job per day. */
async function evalFeeds(now: Date): Promise<EvalOutcome> {
  const rows = await getSyncLogLatestByJob();
  const today = phoenixDate(now);
  let candidates = 0;
  let sent = 0;
  for (const row of rows) {
    const age = now.getTime() - Date.parse(row.ranAt);
    if (!(age > 48 * 3600 * 1000)) continue;
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
  await run("followups", () => evalFollowups(now));
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
