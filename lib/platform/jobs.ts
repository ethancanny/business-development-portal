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
    case "dedupe_scan": {
      // Pairs are computed on demand by dedupe.findDuplicates(); the scan
      // job just exercises both kinds so failures surface in the job log.
      const { findDuplicates } = await import("./dedupe");
      await findDuplicates("companies");
      await findDuplicates("people");
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
