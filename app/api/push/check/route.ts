import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { flushDigest } from "@/lib/push";
import { runDueJobs } from "@/lib/platform/jobs";
import {
  evalCandidateHighScores,
  evalCompetingBuyers,
  evalFeeds,
  evalFitSignals,
  evalMeetings,
  evalMorningDigest,
  evalNewListings,
  evalQuietContacts,
  evalReminders,
  evalStalled,
  type EvalOutcome,
} from "@/lib/push-evals";

/**
 * MANUAL / DIAGNOSTIC push trigger only (Oct 21, 2026). Production
 * notifications are event-driven and nothing scheduled calls this
 * endpoint anymore:
 * - time-based alerts are core.jobs scheduled at the exact fire time
 *   (lib/push-schedule.ts: push_reminder / push_meeting60), drained
 *   opportunistically by platform API activity, the calendar webhook
 *   and watchdog ensure endpoint, ingest calls and deal-flow writes;
 * - data-change evaluators run inline at the write that creates the
 *   state (deal-flow POST, market ingest completion, candidate
 *   writes);
 * - slow-burn evaluators (stalled, quiet contacts, feed silence) run
 *   once daily inside the 8:00 AM Phoenix push_morning_digest job.
 * This endpoint still runs the full evaluator set on demand (and
 * drains due jobs first) so the whole system can be exercised and
 * audited from one call. Auth: session or Bearer CRON_SECRET.
 */

export const maxDuration = 60;

const USER = "ethan@cannycapitalpartners.com";

function authorized(req: NextRequest): boolean {
  if (getSessionUser()) return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // dev without CRON_SECRET
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Exercise the event-driven queue first — any due scheduled
  // notifications fire here too.
  await runDueJobs(10).catch(() => 0);

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
    evaluated.remindersCovered = rem.covered;
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
  await run("candidateHighScore", () => evalCandidateHighScores());

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
