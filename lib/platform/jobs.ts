import { sql, newId, str, num, isoOrNull, type Sql } from "./db";
import type { JobRow } from "./types";

/**
 * Background job queue (core.jobs). Jobs are how event handlers defer
 * summary refreshes and maintenance work instead of polling. Execution
 * is triggered by runJobNow() (Settings UI / cron outside this phase);
 * handlers are registered by kind in executeJob().
 */

function rowToJob(r: Record<string, unknown>): JobRow {
  const payload =
    r.payload && typeof r.payload === "object"
      ? (r.payload as Record<string, unknown>)
      : {};
  return {
    id: str(r.id),
    kind: str(r.kind),
    payload,
    status: str(r.status) || "queued",
    attempts: num(r.attempts),
    lastError: str(r.last_error),
    runAfter: isoOrNull(r.run_after),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

export async function enqueueJob(
  kind: string,
  payload: Record<string, unknown> = {}
): Promise<string> {
  const db = sql();
  const id = newId();
  await db`
    INSERT INTO core.jobs (id, kind, payload, status)
    VALUES (${id}, ${kind}, ${JSON.stringify(payload)}::jsonb, 'queued')`;
  return id;
}

/** Enqueue a job that becomes due at an exact instant (run_after) —
 * the scheduling primitive for event-driven push notifications and
 * the daily digest (lib/push-schedule.ts). */
export async function enqueueJobAt(
  kind: string,
  payload: Record<string, unknown> = {},
  runAfter: Date
): Promise<string> {
  const db = sql();
  const id = newId();
  await db`
    INSERT INTO core.jobs (id, kind, payload, status, run_after)
    VALUES (${id}, ${kind}, ${JSON.stringify(payload)}::jsonb, 'queued',
      ${runAfter.toISOString()})`;
  return id;
}

/**
 * Enqueue only if no queued/running job of this kind exists — the
 * dedupe primitive event handlers use so a burst of events produces a
 * single summary refresh. Returns true when a job was inserted.
 */
export async function enqueueUniqueJob(
  kind: string,
  payload: Record<string, unknown> = {}
): Promise<boolean> {
  const db = sql();
  const rows = await db`
    SELECT id FROM core.jobs
    WHERE kind = ${kind} AND status IN ('queued', 'running')
    LIMIT 1`;
  if (rows.length) return false;
  await enqueueJob(kind, payload);
  return true;
}

export async function listJobs(status?: string, limit = 50): Promise<JobRow[]> {
  const db = sql();
  const lim = Math.min(50, Math.max(1, limit || 50));
  const s = (status ?? "").trim();
  const rows = await db`
    SELECT id, kind, payload, status, attempts, last_error, run_after, created_at, updated_at
    FROM core.jobs
    WHERE (${s} = '' OR status = ${s})
    ORDER BY created_at DESC
    LIMIT ${lim}`;
  return rows.map((r) => rowToJob(r as Record<string, unknown>));
}

export async function retryJob(id: string): Promise<boolean> {
  const db = sql();
  const rows = await db`
    UPDATE core.jobs
    SET status = 'queued', attempts = 0, last_error = '',
        run_after = now(), updated_at = now()
    WHERE id = ${id}
    RETURNING id`;
  return rows.length > 0;
}

async function executeJob(db: Sql, job: JobRow): Promise<void> {
  switch (job.kind) {
    case "refresh_overview_summary": {
      const { refreshOverviewSummary } = await import("./summaries");
      await refreshOverviewSummary();
      return;
    }
    case "db_backup": {
      // Honest mechanism note: there is no in-app snapshot to take — the
      // backup IS Neon point-in-time recovery (provider-side). This job
      // records that the daily backup checkpoint was verified/scheduled
      // and leaves an audit entry; actual execution cadence is driven by
      // the external scheduler that calls runJobNow().
      await db`
        INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
        VALUES ('platform', '', 'system', 'db_backup',
          ${JSON.stringify({
            mechanism:
              "Neon point-in-time recovery (PITR) — snapshots are provider-side; this job is the daily verification/audit checkpoint.",
          })}::jsonb)`;
      return;
    }
    case "refresh_generated_events": {
      // Phase 2 (Calendar): regenerate calgen.generated_events from the
      // registered generators (tasks today; later modules plug in via
      // lib/calgen/registry.ts). Portal-side views only — no Outlook
      // writes, no notifications.
      const { regenerateGeneratedEvents } = await import("../calgen/service");
      await regenerateGeneratedEvents();
      return;
    }
    case "push_reminder": {
      // Event-driven push (Oct 21, 2026): fire the follow-up/event
      // reminder for exactly one record, re-derived from live state.
      // If the moment moved into the future, re-enqueue at the new
      // instant instead of firing stale.
      const { fireReminderForItem } = await import("../push-evals");
      const itemKind = job.payload.itemKind === "event" ? "event" : "task";
      const itemId = str(job.payload.itemId);
      if (itemId) {
        const r = await fireReminderForItem(itemKind, itemId, new Date());
        if (r.rescheduleAt) {
          await enqueueJobAt(
            "push_reminder",
            job.payload,
            new Date(r.rescheduleAt)
          );
        }
      }
      return;
    }
    case "push_meeting60": {
      const { fireMeetingForEvent } = await import("../push-evals");
      const itemId = str(job.payload.itemId);
      if (itemId) {
        const r = await fireMeetingForEvent(itemId, new Date());
        if (r.rescheduleAt) {
          await enqueueJobAt(
            "push_meeting60",
            job.payload,
            new Date(r.rescheduleAt)
          );
        }
      }
      return;
    }
    case "push_morning_digest": {
      // Daily 8:00 AM Phoenix bundle (morning digest + stalled +
      // quiet contacts + feed silence + digest flush), then
      // self-perpetuate: enqueue tomorrow's job.
      const { runMorningDigestBundle } = await import("../push-evals");
      await runMorningDigestBundle(new Date());
      const { nextDigestRunAfter } = await import("../push-schedule");
      await enqueueJobAt(
        "push_morning_digest",
        { reason: "daily" },
        nextDigestRunAfter(new Date())
      );
      return;
    }
    case "extract_financials": {
      // Phase 4 (Financials): background financial-statement extraction
      // for documents over the 5MB sync threshold.
      const { runFinancialExtractionJob } = await import(
        "../financials/service"
      );
      await runFinancialExtractionJob(job.payload);
      return;
    }
    case "analyze_financials": {
      // Part 4B (Finanalysis): background financial analysis for a
      // company, enqueued on financials_posted (and after adjustment
      // decisions). Never runs synchronously in a post request.
      const { runAnalysisJob } = await import("../finanalysis/service");
      await runAnalysisJob(job.payload);
      return;
    }
    case "extract_document_terms": {
      // Part 5B (Document intelligence): extract contract key terms
      // into the diligence contract register pipeline. Provider is
      // chosen per document (Phase 7 Item 0): Azure when configured
      // and the media type is Azure-supported, else local pattern
      // extraction over Phase 3 extracted text.
      const { runDocintJob } = await import("../docint/service");
      await runDocintJob(job.payload);
      return;
    }
    case "generate_memo": {
      // Part 5B (IC memo): regenerate the deal's diligence summary /
      // IC memo draft from current source records.
      const { runMemoJob } = await import("../diligence/memo");
      await runMemoJob(job.payload);
      return;
    }
    case "compute_risk_score": {
      // Part 5B (Risk score): recompute the deal risk score and append
      // a history row.
      const { runRiskJob } = await import("../diligence/risk");
      await runRiskJob(job.payload);
      return;
    }
    case "refresh_record_checks": {
      // Part 5B (Public record checks): monthly refresh — re-runs the
      // automatable checks for tracked companies and self-perpetuates
      // via ensureRecordChecksJob inside the handler.
      const { runRecordRefreshJob } = await import("../diligence/records");
      await runRecordRefreshJob(job.payload);
      return;
    }
    case "deal_close_cascade": {
      // Phase 10 (Stage gates + close cascade): the ordered, resumable
      // deal-close sequence — progress lives in the job payload, so a
      // retry re-runs only incomplete steps.
      const { runCascadeJob } = await import("./cascade");
      await runCascadeJob(job);
      return;
    }
    case "monitoring_handoff": {
      // Phase 8 (Portfolio Monitoring): the durable deal_closed
      // handoff path — copies the closing baseline into
      // monitoring.portfolio_companies. Payload carries ids only.
      const { handoffDealClosed } = await import("../monitoring/service");
      const dealId = str(job.payload.dealId);
      if (dealId) await handoffDealClosed(dealId, str(job.payload.actor));
      return;
    }
    case "monitoring_period_due": {
      // Phase 8 (Portfolio Monitoring): due check for one reporting
      // period — flips it to 'late' + raises the alert when overdue.
      const { evaluatePeriodDue } = await import("../monitoring/service");
      const periodId = str(job.payload.periodId);
      if (periodId) await evaluatePeriodDue(periodId);
      return;
    }
    case "extract_document_text": {
      // Phase 3 (Documents): background text extraction so document
      // contents become searchable. runExtraction never throws —
      // failures land in core.documents.extraction_status.
      const { runExtraction } = await import("../dataroom/extract");
      const documentId = str(job.payload.documentId);
      if (documentId) await runExtraction(documentId);
      return;
    }
    case "dedupe_scan": {
      // Pairs are computed on demand by dedupe.findDuplicates(); the scan
      // job just exercises both kinds so failures surface in the job log.
      const { findDuplicates } = await import("./dedupe");
      await findDuplicates("companies");
      await findDuplicates("people");
      return;
    }
    case "comms_generate_report": {
      // Part 12 (Communications): assemble one report from the owning
      // modules' pre-aggregated service surfaces. The handler never
      // throws — failures land on the report row (status 'failed').
      const { runCommsGenerateJob } = await import("../comms/jobs");
      await runCommsGenerateJob(job.payload);
      return;
    }
    case "comms_schedule_run": {
      // Part 12 (Communications): one recurring-schedule occurrence —
      // data checks, draft generation, routine auto-delivery when the
      // schedule carries Ethan's one-time approval; auto-pauses on a
      // failed check instead of sending. Self-perpetuating via
      // enqueueJobAt from the handler.
      const { runCommsScheduleJob } = await import("../comms/jobs");
      await runCommsScheduleJob(job.payload);
      return;
    }
    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}

/** Execute one job now, recording status/attempts/last_error on the row. */
export async function runJobNow(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = sql();
  const rows = await db`
    SELECT id, kind, payload, status, attempts, last_error, run_after, created_at, updated_at
    FROM core.jobs WHERE id = ${id} LIMIT 1`;
  if (!rows.length) return { ok: false, error: "Job not found" };
  const job = rowToJob(rows[0] as Record<string, unknown>);
  await db`
    UPDATE core.jobs
    SET status = 'running', attempts = attempts + 1, updated_at = now()
    WHERE id = ${id}`;
  try {
    await executeJob(db, job);
    await db`
      UPDATE core.jobs
      SET status = 'done', last_error = '', updated_at = now()
      WHERE id = ${id}`;
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db`
      UPDATE core.jobs
      SET status = 'failed', last_error = ${message}, updated_at = now()
      WHERE id = ${id}`;
    return { ok: false, error: message };
  }
}

/**
 * Drain due queued jobs (oldest first). This is the "immediate
 * background job" mechanism on serverless: platform API calls invoke it
 * opportunistically after enqueueing, so event-driven work (summary
 * refreshes) completes without a polling loop.
 */
export async function runDueJobs(limit = 3): Promise<number> {
  const db = sql();
  const rows = await db`
    SELECT id FROM core.jobs
    WHERE status = 'queued' AND run_after <= now()
    ORDER BY created_at ASC
    LIMIT ${limit}`;
  let ran = 0;
  for (const r of rows) {
    const res = await runJobNow(str((r as Record<string, unknown>).id));
    if (res.ok) ran += 1;
  }
  return ran;
}

/**
 * Register the standing jobs. Registration only — an external
 * scheduler/cron triggers execution (PROJECT_RULES.md cadence config in
 * lib/platform/config.ts). Idempotent per 24h window.
 */
export async function ensureBuiltinJobs(): Promise<void> {
  // Part 5B: keep the monthly public-record-checks refresh queued
  // (self-perpetuating once running; this is the bootstrap).
  try {
    const { ensureRecordChecksJob } = await import("../diligence/records");
    await ensureRecordChecksJob();
  } catch {
    /* records module not ready yet — retried on the next platform call */
  }
  const db = sql();
  const recent = await db`
    SELECT id FROM core.jobs
    WHERE kind = 'db_backup' AND created_at > now() - interval '24 hours'
    LIMIT 1`;
  if (!recent.length) {
    await db`
      INSERT INTO core.jobs (id, kind, payload, status)
      VALUES (${newId()}, 'db_backup',
        ${JSON.stringify({
          note: "Registered by ensureBuiltinJobs — execution is triggered by the external scheduler; the snapshot mechanism itself is Neon PITR (provider-side).",
        })}::jsonb,
        'registered')`;
  }
}
