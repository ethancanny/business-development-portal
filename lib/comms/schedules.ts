import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { enqueueJobAt } from "../platform/jobs";
import { ensureNotificationsSchema } from "../platform/collab";
import { getCompanyFinancials } from "../financials/service";
import { getIntegrityLive } from "../finanalysis/service";
import { ensureComms } from "./schema";
import { routineAllowed } from "./types";
import {
  createReport,
  generateReportNow,
  getTemplate,
  transitionReport,
  type TemplateRow,
} from "./service";
import { assembleReport } from "./assemble";
import { deliverReport, type DeliveryRecipientInput } from "./delivery";

/**
 * Report schedules (Part 12) — monthly/quarterly routine reports.
 *
 * Safety model: a schedule only sends unattended after a ONE-TIME
 * partner approval (approveSchedule) AND its template is routine
 * (routineAllowed — never a memo purpose, never a narrative block).
 * Every run re-checks the subject's data first; any check failure
 * pauses the schedule, notifies Ethan, and stops the chain (no report,
 * no send, no next run enqueued).
 */

const ETHAN_EMAIL = "ethan@cannycapitalpartners.com";

export interface ScheduleRow {
  id: string;
  templateId: string;
  templateName: string;
  subjectKind: string;
  companyId: string | null;
  dealId: string | null;
  personId: string | null;
  cadence: string;
  dayOfMonth: number;
  recipients: DeliveryRecipientInput[];
  routineApproved: boolean;
  approvedBy: string;
  approvedAt: string | null;
  status: string;
  pauseReason: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastReportId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleSubject {
  kind: string;
  companyId?: string | null;
  dealId?: string | null;
  personId?: string | null;
}

const SCHEDULE_COLS = `
  s.id, s.template_id, coalesce(t.name, '') AS template_name,
  s.subject_kind, s.company_id, s.deal_id, s.person_id, s.cadence,
  s.day_of_month, s.recipients, s.routine_approved, s.approved_by,
  s.approved_at, s.status, s.pause_reason, s.next_run_at, s.last_run_at,
  s.last_report_id, s.created_by, s.created_at, s.updated_at`;

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function rowToSchedule(r: Record<string, unknown>): ScheduleRow {
  return {
    id: str(r.id),
    templateId: str(r.template_id),
    templateName: str(r.template_name),
    subjectKind: str(r.subject_kind),
    companyId: r.company_id ? str(r.company_id) : null,
    dealId: r.deal_id ? str(r.deal_id) : null,
    personId: r.person_id ? str(r.person_id) : null,
    cadence: str(r.cadence) || "monthly",
    dayOfMonth: num(r.day_of_month) || 1,
    recipients: parseJson<DeliveryRecipientInput[]>(r.recipients, []),
    routineApproved: Boolean(r.routine_approved),
    approvedBy: str(r.approved_by),
    approvedAt: isoOrNull(r.approved_at),
    status: str(r.status) || "active",
    pauseReason: str(r.pause_reason),
    nextRunAt: isoOrNull(r.next_run_at),
    lastRunAt: isoOrNull(r.last_run_at),
    lastReportId: r.last_report_id ? str(r.last_report_id) : null,
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

async function notifyEthan(
  kind: string,
  title: string,
  body: string,
  href: string,
  entityId: string
): Promise<void> {
  try {
    await ensureNotificationsSchema();
    const db = sql();
    await db`
      INSERT INTO core.notifications
        (id, user_email, kind, title, body, href, entity_kind, entity_id)
      VALUES (${newId()}, ${ETHAN_EMAIL}, ${kind}, ${title},
        ${body.slice(0, 300)}, ${href}, 'comms_schedule', ${entityId})`;
  } catch (err) {
    console.error(
      "[comms:schedules] notification write failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/* ------------------------------ next run ------------------------------- */

/**
 * Next occurrence strictly after `from`, on dayOfMonth (clamped to the
 * month's length). Quarterly steps in 3-month increments from the
 * monthly anchor.
 */
export function nextRun(from: Date, cadence: string, dayOfMonth: number): Date {
  const stepMonths = cadence === "quarterly" ? 3 : 1;
  const day = Math.min(28, Math.max(1, Math.floor(dayOfMonth) || 1));
  const candidate = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), day, 13, 0, 0)
  );
  while (candidate.getTime() <= from.getTime()) {
    candidate.setUTCMonth(candidate.getUTCMonth() + stepMonths);
  }
  return candidate;
}

/* -------------------------------- CRUD --------------------------------- */

export interface ScheduleInput {
  templateId?: string;
  subjectKind?: string;
  companyId?: string | null;
  dealId?: string | null;
  personId?: string | null;
  cadence?: string;
  dayOfMonth?: number;
  recipients?: DeliveryRecipientInput[];
}

export async function listSchedules(): Promise<ScheduleRow[]> {
  await ensureComms();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SCHEDULE_COLS)}
    FROM comms.schedules s
    LEFT JOIN comms.templates t ON t.id = s.template_id
    WHERE s.deleted_at IS NULL
    ORDER BY s.created_at DESC
    LIMIT 100`;
  return rows.map((r) => rowToSchedule(r as Record<string, unknown>));
}

export async function getSchedule(id: string): Promise<ScheduleRow | null> {
  await ensureComms();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SCHEDULE_COLS)}
    FROM comms.schedules s
    LEFT JOIN comms.templates t ON t.id = s.template_id
    WHERE s.id = ${id} AND s.deleted_at IS NULL LIMIT 1`;
  return rows.length
    ? rowToSchedule(rows[0] as Record<string, unknown>)
    : null;
}

export async function createSchedule(
  input: ScheduleInput,
  actor: string
): Promise<ScheduleRow> {
  await ensureComms();
  if (!input.templateId) throw new Error("template_not_found");
  const template = await getTemplate(input.templateId);
  if (!template) throw new Error("template_not_found");
  const cadence = input.cadence === "quarterly" ? "quarterly" : "monthly";
  const dayOfMonth = Math.min(28, Math.max(1, Math.floor(input.dayOfMonth ?? 1) || 1));
  const id = newId();
  const firstRun = nextRun(new Date(), cadence, dayOfMonth);
  const db = sql();
  await db`
    INSERT INTO comms.schedules
      (id, template_id, subject_kind, company_id, deal_id, person_id,
       cadence, day_of_month, recipients, status, next_run_at, created_by)
    VALUES (${id}, ${template.id},
      ${(input.subjectKind ?? "").trim() || template.subjectKinds[0] || "company"},
      ${input.companyId ?? null}, ${input.dealId ?? null},
      ${input.personId ?? null}, ${cadence}, ${dayOfMonth},
      ${JSON.stringify(input.recipients ?? [])}::jsonb, 'active',
      ${firstRun.toISOString()}, ${actor})`;
  await enqueueJobAt(
    "comms_schedule_run",
    { scheduleId: id },
    firstRun
  );
  const created = await getSchedule(id);
  if (!created) throw new Error("schedule_not_found");
  return created;
}

export async function updateSchedule(
  id: string,
  input: ScheduleInput,
  actor: string
): Promise<ScheduleRow> {
  await ensureComms();
  const existing = await getSchedule(id);
  if (!existing) throw new Error("schedule_not_found");
  const cadence =
    input.cadence !== undefined
      ? input.cadence === "quarterly"
        ? "quarterly"
        : "monthly"
      : existing.cadence;
  const dayOfMonth =
    input.dayOfMonth !== undefined
      ? Math.min(28, Math.max(1, Math.floor(input.dayOfMonth) || 1))
      : existing.dayOfMonth;
  const db = sql();
  await db`
    UPDATE comms.schedules SET
      subject_kind = ${input.subjectKind ?? existing.subjectKind},
      company_id = ${input.companyId !== undefined ? input.companyId : existing.companyId},
      deal_id = ${input.dealId !== undefined ? input.dealId : existing.dealId},
      person_id = ${input.personId !== undefined ? input.personId : existing.personId},
      cadence = ${cadence},
      day_of_month = ${dayOfMonth},
      recipients = ${JSON.stringify(input.recipients ?? existing.recipients)}::jsonb,
      updated_at = now()
    WHERE id = ${id}`;
  void actor;
  const updated = await getSchedule(id);
  if (!updated) throw new Error("schedule_not_found");
  return updated;
}

export async function deleteSchedule(
  id: string,
  actor = ""
): Promise<boolean> {
  await ensureComms();
  const db = sql();
  const rows = await db`
    UPDATE comms.schedules
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  void actor;
  return rows.length > 0;
}

/**
 * One-time routine approval. Requires the schedule's template to be
 * routine-eligible (template.routine AND routineAllowed) — memos and
 * narrative-bearing templates can never be approved for unattended
 * sending ('routine_not_allowed').
 */
export async function approveSchedule(
  id: string,
  actor: string
): Promise<ScheduleRow> {
  await ensureComms();
  const schedule = await getSchedule(id);
  if (!schedule) throw new Error("schedule_not_found");
  const template = await getTemplate(schedule.templateId);
  if (!template) throw new Error("template_not_found");
  if (!template.routine || !routineAllowed(template)) {
    throw new Error("routine_not_allowed");
  }
  const db = sql();
  await db`
    UPDATE comms.schedules
    SET routine_approved = true, approved_by = ${actor},
        approved_at = now(), updated_at = now()
    WHERE id = ${id}`;
  const updated = await getSchedule(id);
  if (!updated) throw new Error("schedule_not_found");
  return updated;
}

export async function pauseSchedule(
  id: string,
  reason = "Paused manually"
): Promise<ScheduleRow> {
  await ensureComms();
  const db = sql();
  await db`
    UPDATE comms.schedules
    SET status = 'paused', pause_reason = ${reason.slice(0, 300)},
        updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL`;
  const updated = await getSchedule(id);
  if (!updated) throw new Error("schedule_not_found");
  return updated;
}

export async function resumeSchedule(
  id: string,
  actor: string
): Promise<ScheduleRow> {
  await ensureComms();
  const schedule = await getSchedule(id);
  if (!schedule) throw new Error("schedule_not_found");
  const db = sql();
  const upcoming = nextRun(new Date(), schedule.cadence, schedule.dayOfMonth);
  await db`
    UPDATE comms.schedules
    SET status = 'active', pause_reason = '', next_run_at = ${upcoming.toISOString()},
        updated_at = now()
    WHERE id = ${id}`;
  await enqueueJobAt("comms_schedule_run", { scheduleId: id }, upcoming);
  void actor;
  const updated = await getSchedule(id);
  if (!updated) throw new Error("schedule_not_found");
  return updated;
}

/* ----------------------------- data checks ------------------------------ */

/**
 * Pre-flight data checks for one scheduled run. Returns failure CODES
 * (never figures): missing_period, tie_out_failure, low_confidence.
 */
export async function runDataChecks(
  subject: ScheduleSubject,
  template: TemplateRow
): Promise<string[]> {
  const failures: string[] = [];
  const companyId = subject.companyId ?? null;

  if (companyId) {
    // missing_period: no posted financial statements for the subject.
    try {
      const fin = await getCompanyFinancials(companyId);
      const sets = (fin.sets ?? []) as { status?: string }[];
      const hasPosted = sets.some((s) => s.status === "posted");
      const hasLatest = Boolean(
        (fin.summary as { latest?: unknown } | undefined)?.latest
      );
      if (!hasPosted && !hasLatest) failures.push("missing_period");
    } catch {
      failures.push("missing_period");
    }
    // tie_out_failure: any integrity check failing on live data.
    try {
      const checks = await getIntegrityLive(companyId);
      if ((checks ?? []).some((c) => c.status === "fail")) {
        failures.push("tie_out_failure");
      }
    } catch {
      /* integrity unavailable is not itself a tie-out failure */
    }
  }

  // low_confidence: assemble the report and inspect appendix figure
  // confidence (extraction-sourced figures carry confidence < 1).
  try {
    const assembled = await assembleReport({
      template,
      subject: {
        subjectKind: subject.kind,
        companyId: subject.companyId ?? null,
        dealId: subject.dealId ?? null,
        personId: subject.personId ?? null,
        subjectLabel: "",
      },
      sample: false,
      actor: "schedule",
    });
    const low = assembled.appendix.some(
      (f) => f.confidence !== null && f.confidence !== undefined && f.confidence < 0.6
    );
    if (low) failures.push("low_confidence");
  } catch {
    if (!failures.includes("missing_period")) failures.push("missing_period");
  }
  return failures;
}

/* ------------------------------- run job -------------------------------- */

export async function runScheduleJob(payload: {
  scheduleId: string;
}): Promise<{ status: string; failures?: string[]; reportId?: string }> {
  await ensureComms();
  const schedule = await getSchedule(payload.scheduleId);
  if (!schedule) return { status: "skipped" };
  if (schedule.status !== "active") return { status: "skipped" };
  const template = await getTemplate(schedule.templateId);
  if (!template) return { status: "skipped" };

  const subject: ScheduleSubject = {
    kind: schedule.subjectKind,
    companyId: schedule.companyId,
    dealId: schedule.dealId,
    personId: schedule.personId,
  };
  const failures = await runDataChecks(subject, template);
  const db = sql();
  if (failures.length) {
    const reason = failures.join(",");
    await db`
      UPDATE comms.schedules
      SET status = 'paused', pause_reason = ${reason}, updated_at = now()
      WHERE id = ${schedule.id}`;
    await notifyEthan(
      "comms_schedule_paused",
      "Scheduled report paused",
      `A scheduled report was paused after data checks failed (${reason}). No report was generated or sent.`,
      "/communications",
      schedule.id
    );
    console.log(
      `[comms:schedules] schedule ${schedule.id} paused: ${reason}`
    );
    return { status: "paused", failures };
  }

  const report = await createReport(
    {
      templateId: schedule.templateId,
      subjectKind: schedule.subjectKind,
      companyId: schedule.companyId,
      dealId: schedule.dealId,
      personId: schedule.personId,
      scheduleId: schedule.id,
    },
    "schedule"
  );
  const generated = await generateReportNow(report.id, "schedule");
  await db`
    UPDATE comms.schedules
    SET last_run_at = now(), last_report_id = ${report.id}, updated_at = now()
    WHERE id = ${schedule.id}`;

  let outcome = "draft_ready";
  if (schedule.routineApproved && template.routine) {
    await transitionReport(report.id, "submit", "schedule");
    await transitionReport(report.id, "approve", "schedule");
    await deliverReport(
      report.id,
      { recipients: schedule.recipients },
      "schedule"
    );
    outcome = "sent";
  } else {
    await notifyEthan(
      "comms_draft_ready",
      "Scheduled report draft ready",
      `A scheduled report draft is ready for review: ${generated.title}`,
      `/communications/reports/${report.id}`,
      schedule.id
    );
  }

  // Refresh the generated-events calendar layer (best-effort, literal
  // specifier) and chain the next occurrence while still active.
  try {
    const { requestGeneratedEventsRefresh } = await import(
      "../calgen/service"
    );
    await requestGeneratedEventsRefresh();
  } catch {
    /* calendar refresh is best-effort */
  }
  const fresh = await getSchedule(schedule.id);
  if (fresh && fresh.status === "active") {
    const upcoming = nextRun(new Date(), fresh.cadence, fresh.dayOfMonth);
    await db`
      UPDATE comms.schedules SET next_run_at = ${upcoming.toISOString()}
      WHERE id = ${schedule.id}`;
    await enqueueJobAt(
      "comms_schedule_run",
      { scheduleId: schedule.id },
      upcoming
    );
  }
  return { status: outcome, reportId: report.id };
}

/* --------------------------- calendar items ----------------------------- */

/**
 * Items for the calgen report generator (coordinator wires it):
 * recent schedule-generated reports + upcoming schedule next-runs.
 */
export async function listReportCalendarItems(): Promise<
  {
    reportId?: string;
    scheduleId?: string;
    title: string;
    date: string;
    createdAt?: string;
    status?: string;
    href: string;
  }[]
> {
  await ensureComms();
  const db = sql();
  const items: {
    reportId?: string;
    scheduleId?: string;
    title: string;
    date: string;
    createdAt?: string;
    status?: string;
    href: string;
  }[] = [];
  const reportRows = await db`
    SELECT id, title, status, created_at FROM comms.reports
    WHERE schedule_id IS NOT NULL AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 40`;
  for (const r of reportRows) {
    const rec = r as Record<string, unknown>;
    const createdAt = isoOrNull(rec.created_at) ?? "";
    items.push({
      reportId: str(rec.id),
      title: str(rec.title),
      date: createdAt.slice(0, 10),
      createdAt,
      status: str(rec.status),
      href: `/communications/reports/${str(rec.id)}`,
    });
  }
  const schedules = await listSchedules();
  for (const s of schedules) {
    if (s.status !== "active" || !s.nextRunAt) continue;
    items.push({
      scheduleId: s.id,
      title: `Scheduled report: ${s.templateName || "report"}`,
      date: s.nextRunAt.slice(0, 10),
      href: "/communications",
    });
  }
  return items;
}
