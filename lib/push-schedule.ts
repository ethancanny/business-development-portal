import { sql } from "./platform/db";
import { enqueueJobAt, runDueJobs } from "./platform/jobs";
import { computeEventFireTimes, computeTaskFireAt } from "./push-evals";
import { getCalendarEvents } from "./calendar-db";
import { phoenixDate } from "./push-db";

/**
 * Event-driven push scheduling (Oct 21, 2026 — replaces the
 * push-notifications-check scanning loop). Time-based notifications
 * are core.jobs rows scheduled at the EXACT fire time when the
 * underlying record is created or edited:
 *
 *   push_reminder      {itemKind: "task"|"event", itemId} — follow-up
 *                      and explicit-choice event reminders, incl.
 *                      snooze re-fires (payload carries snoozeKey).
 *   push_meeting60     {itemKind: "event", itemId} — the generic
 *                      meeting-in-an-hour alert at start - 60m.
 *   push_morning_digest {} — 8:00 AM Phoenix daily bundle
 *                      (self-perpetuating: the handler enqueues the
 *                      next day's job; ensureMorningDigestJob
 *                      bootstraps it from platform activity).
 *
 * Scheduling is SUPERSEDING: (re)scheduling an item first cancels its
 * queued push jobs, then enqueues fresh ones computed from the live
 * record — edits can never leave a stale firing behind, and the job
 * handlers re-derive state at fire time anyway (lib/push-evals
 * fire* entry points), rescheduling again if the moment moved.
 *
 * Drain triggers (no polling loop): platform API activity
 * (ensurePlatform), the calendar webhook + watchdog ensure endpoint
 * (Graph change notifications are near-real-time), the market ingest
 * endpoint (hit by the existing 6am + twice-daily crons) and the
 * deal-flow POST (the ~8:12 morning sweep) all drain due jobs
 * opportunistically. Worst case a firing lands a few minutes after
 * its scheduled instant; handlers tolerate lateness (the meeting60
 * scoped window runs to the meeting start, reminders carry a 48h
 * catch-up window). Every function here is best-effort: scheduling
 * must never fail the write that triggered it.
 */

const DAY = 864e5;

async function cancelQueued(
  itemKind: "task" | "event",
  itemId: string
): Promise<void> {
  const db = sql();
  await db`
    UPDATE core.jobs
    SET status = 'cancelled', updated_at = now()
    WHERE kind IN ('push_reminder', 'push_meeting60')
      AND status = 'queued'
      AND payload->>'itemId' = ${itemId}
      AND payload->>'itemKind' = ${itemKind}`;
}

export async function cancelPushJobs(
  itemKind: "task" | "event",
  itemId: string
): Promise<void> {
  try {
    await cancelQueued(itemKind, itemId);
  } catch {
    /* best-effort */
  }
}

/** (Re)schedule the reminder job for one follow-up from its live
 * state. No job is enqueued when the follow-up should never fire
 * (done / no due date / lead Off). A fire time already past (inside
 * the 48h catch-up) is enqueued for immediate drain. */
export async function scheduleTaskPushJobs(taskId: string): Promise<void> {
  try {
    await cancelQueued("task", taskId);
    const fireAt = await computeTaskFireAt(taskId);
    if (fireAt === null) return;
    await enqueueJobAt(
      "push_reminder",
      { itemKind: "task", itemId: taskId },
      new Date(Math.max(fireAt, Date.now()))
    );
  } catch {
    /* best-effort */
  }
}

/** (Re)schedule the meeting60 and/or explicit-reminder jobs for one
 * calendar event from its live state. */
export async function scheduleEventPushJobs(eventId: string): Promise<void> {
  try {
    await cancelQueued("event", eventId);
    const times = await computeEventFireTimes(eventId);
    if (times.meeting60At !== null) {
      await enqueueJobAt(
        "push_meeting60",
        { itemKind: "event", itemId: eventId },
        new Date(Math.max(times.meeting60At, Date.now()))
      );
    }
    if (times.reminderAt !== null) {
      await enqueueJobAt(
        "push_reminder",
        { itemKind: "event", itemId: eventId },
        new Date(Math.max(times.reminderAt, Date.now()))
      );
    }
  } catch {
    /* best-effort */
  }
}

/** Snooze re-fire: a one-off reminder job at the snooze instant. The
 * scoped collector's snooze gate decides at fire time whether the
 * snoozed firing is due; the payload's snoozeKey is informational
 * (the gate keys off the reminder_snooze row). Does not cancel the
 * item's other jobs. */
export async function scheduleSnoozePushJob(
  kind: "task" | "event",
  id: string,
  key: string,
  fireAtIso: string
): Promise<void> {
  try {
    await enqueueJobAt(
      "push_reminder",
      { itemKind: kind, itemId: id, snoozeKey: key },
      new Date(fireAtIso)
    );
  } catch {
    /* best-effort */
  }
}

/** Next 8:00 AM Phoenix strictly after `from` (Phoenix is UTC-7,
 * no DST). */
export function nextDigestRunAfter(from: Date): Date {
  const today = phoenixDate(from);
  const candidate = new Date(`${today}T08:00:00-07:00`);
  if (candidate.getTime() > from.getTime()) return candidate;
  const tomorrow = phoenixDate(new Date(from.getTime() + DAY));
  return new Date(`${tomorrow}T08:00:00-07:00`);
}

/** Bootstrap/keep-alive for the daily digest job: enqueue one for the
 * next 8:00 AM Phoenix when none is queued or running. */
export async function ensureMorningDigestJob(): Promise<void> {
  try {
    const db = sql();
    const rows = await db`
      SELECT id FROM core.jobs
      WHERE kind = 'push_morning_digest' AND status IN ('queued', 'running')
      LIMIT 1`;
    if (rows.length) return;
    await enqueueJobAt(
      "push_morning_digest",
      { reason: "ensure" },
      nextDigestRunAfter(new Date())
    );
  } catch {
    /* best-effort */
  }
}

/** After a Graph pull (webhook / watchdog ensure), (re)schedule push
 * jobs for events starting in the next `hoursAhead` hours.
 * Idempotent via the superseding scheduler; triggered by the change
 * notification, not a timer. */
export async function scheduleUpcomingEventPushJobs(
  hoursAhead = 48
): Promise<void> {
  try {
    const now = new Date();
    const horizon = now.getTime() + hoursAhead * 3600 * 1000;
    const from = `${phoenixDate(new Date(now.getTime() - DAY))}T00:00:00`;
    const to = `${phoenixDate(new Date(horizon))}T23:59:59`;
    const events = await getCalendarEvents(from, to);
    for (const ev of events) {
      const start = Date.parse(ev.startsAt);
      if (Number.isNaN(start)) continue;
      if (start <= now.getTime() || start > horizon) continue;
      await scheduleEventPushJobs(ev.eventId);
    }
  } catch {
    /* best-effort */
  }
}

/** Drain due jobs (the queue's execution trigger — see the module
 * header for the call sites). Never throws. */
export async function drainPushJobs(limit = 5): Promise<void> {
  try {
    await runDueJobs(limit);
  } catch {
    /* best-effort */
  }
}
