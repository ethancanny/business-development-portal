import { sql, str } from "../platform/db";
import { ensureComms } from "./schema";
import { generateReportNow } from "./service";
import { runScheduleJob } from "./schedules";

/**
 * Background job handlers (Part 12) — invoked by the platform job
 * runner's dispatch cases for 'comms_generate_report' and
 * 'comms_schedule_run' (coordinator wiring in lib/platform/jobs.ts).
 *
 * Job-runner pattern: handlers NEVER throw. Generation failures mark
 * the report 'failed' (only from 'generating', so a manual draft is
 * never clobbered) and are logged with ids only — never figures.
 */

export async function runCommsGenerateJob(
  payload: Record<string, unknown>
): Promise<void> {
  const reportId = str(payload.reportId);
  if (!reportId) return;
  try {
    await generateReportNow(reportId, "system");
  } catch (err) {
    console.error(
      "[comms:jobs] generate failed for report",
      reportId,
      err instanceof Error ? err.message : String(err)
    );
    try {
      await ensureComms();
      const db = sql();
      await db`
        UPDATE comms.reports
        SET status = 'failed', updated_at = now()
        WHERE id = ${reportId} AND status = 'generating'`;
    } catch {
      /* status write is best-effort; the job row carries the error */
    }
  }
}

export async function runCommsScheduleJob(
  payload: Record<string, unknown>
): Promise<void> {
  const scheduleId = str(payload.scheduleId);
  if (!scheduleId) return;
  try {
    await runScheduleJob({ scheduleId });
  } catch (err) {
    console.error(
      "[comms:jobs] schedule run failed for schedule",
      scheduleId,
      err instanceof Error ? err.message : String(err)
    );
  }
}
