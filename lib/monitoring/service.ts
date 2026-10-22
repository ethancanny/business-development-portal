import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import { publishEvent, onEvent } from "../platform/events";
import { enqueueJobAt } from "../platform/jobs";
import { ensureNotificationsSchema } from "../platform/collab";
import {
  getCompanyFinancials,
  extractFromDocument,
  postSet,
} from "../financials/service";
import { getValueCreationTargets } from "../valuecreation/service";
import {
  ensureMonitoring,
  PERIOD_CADENCES,
  PERIOD_STATUSES,
  ALERT_STATUSES,
} from "./schema";

export { ensureMonitoring };

/**
 * Portfolio Monitoring service (Phase 8, WS-A) — the deal_closed
 * handoff, reporting periods, report receipt, alerts, and the stored
 * portfolio rollup.
 *
 * Module boundaries (PROJECT_RULES.md):
 * - The handoff copies a baseline (company snapshot, financials
 *   summary, value-creation targets, deal participants) into
 *   monitoring.portfolio_companies at close; afterwards this module
 *   lives off its own tables + shared reference data only.
 * - Financial figures are read ONLY through lib/financials/service.ts
 *   and lib/valuecreation/service.ts — never their schemas.
 * - NO figures in event payloads, job payloads, or activity text:
 *   ids, statuses, and names only.
 */

export class MonitoringError extends Error {
  error: string;
  constructor(code: string) {
    super(code);
    this.name = "MonitoringError";
    this.error = code;
  }
}

/* ------------------------------ helpers ------------------------------ */

function jsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v))
    return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return p && typeof p === "object" && !Array.isArray(p) ? p : {};
    } catch {
      return {};
    }
  }
  return {};
}
function jsonArr<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? (p as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}
function dateOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s ? s.slice(0, 10) : null;
}
function cleanDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(s) ? s : null;
}
/** YYYY-MM-DD in America/Phoenix (no DST) for the given instant. */
function phoenixToday(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}
function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86400000);
  return dt.toISOString().slice(0, 10);
}

/** Figure-free activity row (house pattern, wrapped so it never throws). */
async function logActivity(opts: {
  entityKind: string;
  entityId: string;
  actor: string;
  kind: string;
  message: string;
}): Promise<void> {
  try {
    const db = sql();
    await db`
      INSERT INTO core.activity_log
        (id, entity_kind, entity_id, actor, kind, message, source)
      VALUES (${newId()}, ${opts.entityKind}, ${opts.entityId},
        ${opts.actor}, ${opts.kind}, ${opts.message}, 'manual')`;
  } catch (err) {
    console.error(
      "[monitoring] activity_log write failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function companyName(companyId: string): Promise<string> {
  const db = sql();
  const rows = await db`
    SELECT name FROM core.companies WHERE id = ${companyId} LIMIT 1`;
  return rows.length ? str((rows[0] as Record<string, unknown>).name) : "";
}

/* ------------------------------ row types ---------------------------- */

export interface PortfolioCompanyRow {
  id: string;
  companyId: string;
  dealId: string | null;
  status: string;
  closedAt: string | null;
  closedBy: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortfolioCompanyDetail extends PortfolioCompanyRow {
  baselineCompany: Record<string, unknown> | null;
  baselineFinancials: Record<string, unknown> | null;
  underwriting: Record<string, unknown> | null;
  vcTargets: unknown;
  vcPlanId: string | null;
  participants: unknown;
}

export interface PeriodRow {
  id: string;
  companyId: string;
  cadence: string;
  periodStart: string | null;
  periodEnd: string | null;
  dueDate: string | null;
  status: string;
  receivedAt: string | null;
  documentId: string | null;
  statementSetIds: string[];
  notes: string;
  source: string;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRow {
  id: string;
  companyId: string;
  ruleKey: string;
  severity: string;
  title: string;
  detail: string;
  status: string;
  taskId: string | null;
  dedupeKey: string;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToPortfolioCompany(
  r: Record<string, unknown>
): PortfolioCompanyRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    dealId: r.deal_id ? str(r.deal_id) : null,
    status: str(r.status) || "active",
    closedAt: isoOrNull(r.closed_at),
    closedBy: str(r.closed_by),
    source: str(r.source) || "deal_closed",
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToPeriod(r: Record<string, unknown>): PeriodRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    cadence: str(r.cadence) || "monthly",
    periodStart: dateOrNull(r.period_start),
    periodEnd: dateOrNull(r.period_end),
    dueDate: dateOrNull(r.due_date),
    status: str(r.status) || "pending",
    receivedAt: isoOrNull(r.received_at),
    documentId: r.document_id ? str(r.document_id) : null,
    statementSetIds: jsonArr<unknown>(r.statement_set_ids).map((x) =>
      String(x)
    ),
    notes: str(r.notes),
    source: str(r.source) || "manual",
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToAlert(r: Record<string, unknown>): AlertRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    ruleKey: str(r.rule_key),
    severity: str(r.severity) || "medium",
    title: str(r.title),
    detail: str(r.detail),
    status: str(r.status) || "open",
    taskId: r.task_id ? str(r.task_id) : null,
    dedupeKey: str(r.dedupe_key),
    resolvedAt: isoOrNull(r.resolved_at),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/** Human period label, e.g. "monthly period ending 2026-09-30". */
function periodLabel(p: Pick<PeriodRow, "cadence" | "periodEnd">): string {
  return p.periodEnd
    ? `${p.cadence} period ending ${p.periodEnd}`
    : `${p.cadence} period`;
}

/* ----------------------------- alert rules --------------------------- */

/**
 * Effective params for a rule: the company's own live rule wins,
 * else the seeded global rule (company_id NULL), else {}.
 */
export async function getAlertRuleParams(
  companyId: string | null,
  ruleKey: string
): Promise<Record<string, unknown>> {
  await ensureMonitoring();
  const db = sql();
  if (companyId) {
    const own = await db`
      SELECT params FROM monitoring.alert_rules
      WHERE company_id = ${companyId} AND rule_key = ${ruleKey}
        AND enabled = true AND deleted_at IS NULL
      LIMIT 1`;
    if (own.length) return jsonObj((own[0] as Record<string, unknown>).params);
  }
  const global = await db`
    SELECT params FROM monitoring.alert_rules
    WHERE company_id IS NULL AND rule_key = ${ruleKey}
      AND enabled = true AND deleted_at IS NULL
    LIMIT 1`;
  return global.length
    ? jsonObj((global[0] as Record<string, unknown>).params)
    : {};
}

async function lateReportingGraceDays(companyId: string): Promise<number> {
  const params = await getAlertRuleParams(companyId, "late_reporting");
  const g = Number(params.graceDays);
  return isFinite(g) && g > 0 ? Math.floor(g) : 0;
}

/* --------------------------- portfolio rows -------------------------- */

export async function getPortfolioCompanyRow(
  companyId: string
): Promise<PortfolioCompanyDetail | null> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.portfolio_companies
    WHERE company_id = ${companyId} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) return null;
  const rec = rows[0] as Record<string, unknown>;
  return {
    ...rowToPortfolioCompany(rec),
    baselineCompany:
      rec.baseline_company != null ? jsonObj(rec.baseline_company) : null,
    baselineFinancials:
      rec.baseline_financials != null
        ? jsonObj(rec.baseline_financials)
        : null,
    underwriting: rec.underwriting != null ? jsonObj(rec.underwriting) : null,
    vcTargets: rec.vc_targets ?? null,
    vcPlanId: rec.vc_plan_id ? str(rec.vc_plan_id) : null,
    participants: rec.participants ?? null,
  };
}

/** Detail read for WS-B/C: record + copied baseline + underwriting +
 * participants + value-creation targets. */
export async function getPortfolioCompany(
  companyId: string
): Promise<PortfolioCompanyDetail | null> {
  return getPortfolioCompanyRow(companyId);
}

/** Soft-delete a portfolio company (platform rule: soft delete with
 * restore — the row and its monitoring children remain as history).
 * Rollups refresh so the company leaves portfolio totals at once. */
export async function deletePortfolioCompany(
  companyId: string,
  actor = ""
): Promise<boolean> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    UPDATE monitoring.portfolio_companies
    SET deleted_at = now(), updated_at = now()
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    RETURNING id`;
  if (!rows.length) return false;
  void actor;
  await refreshRollups();
  return true;
}

/* ------------------------- deal_closed handoff ----------------------- */

/**
 * The deal_closed handoff (PROJECT_RULES.md separability): copy the
 * company's baseline into monitoring.portfolio_companies — company
 * snapshot, financials summary, value-creation targets + plan id,
 * and the deal's participants — so Portfolio Monitoring can later be
 * lifted into its own database. Idempotent on company_id: a second
 * call returns the existing row untouched.
 *
 * core.deals key shape (verified in lib/platform/migrate.ts +
 * lib/platform/db.ts): core.deals.id IS the legacy public.deals id,
 * and core.deals.company_id is the core.companies id (the backfill
 * sets it to 'co_'||legacy deal id). We resolve through the table —
 * never by constructing the 'co_' convention.
 */
export async function handoffDealClosed(
  dealId: string,
  actor = ""
): Promise<PortfolioCompanyRow> {
  await ensureMonitoring();
  const db = sql();
  const dealRows = await db`
    SELECT id, company_id, stage FROM core.deals WHERE id = ${dealId} LIMIT 1`;
  if (!dealRows.length) throw new MonitoringError("deal_not_found");
  const deal = dealRows[0] as Record<string, unknown>;
  const companyId = deal.company_id ? str(deal.company_id) : "";
  if (!companyId) throw new MonitoringError("company_not_found");

  const existing = await db`
    SELECT * FROM monitoring.portfolio_companies
    WHERE company_id = ${companyId} AND deleted_at IS NULL LIMIT 1`;
  if (existing.length) {
    return rowToPortfolioCompany(existing[0] as Record<string, unknown>);
  }

  // Baseline company snapshot — the full core.companies row, copied.
  const companyRows = await db`
    SELECT * FROM core.companies
    WHERE id = ${companyId} AND deleted_at IS NULL LIMIT 1`;
  if (!companyRows.length) throw new MonitoringError("company_not_found");
  const baselineCompany = companyRows[0] as Record<string, unknown>;

  // Baseline financials — the financials module's summary read model,
  // via its service only.
  let baselineFinancials: Record<string, unknown> | null = null;
  let underwriting: Record<string, unknown> | null = null;
  try {
    const { summary } = await getCompanyFinancials(companyId);
    baselineFinancials = summary as unknown as Record<string, unknown>;
    const periodEnd = summary.latest?.periodEnd ?? null;
    const kpi = periodEnd ? summary.kpis[periodEnd] : undefined;
    underwriting = {
      periodEnd,
      revenue: kpi?.revenue ?? null,
      ebitda: kpi?.ebitda ?? null,
      grossProfit: kpi?.grossProfit ?? null,
      grossMarginPct: kpi?.grossMarginPct ?? null,
      note: periodEnd
        ? "Derived from the latest posted period in the closing financials summary."
        : "No posted financials at close — underwriting figures unavailable.",
    };
  } catch (err) {
    console.error(
      "[monitoring] baseline financials copy failed for company",
      companyId,
      err instanceof Error ? err.message : String(err)
    );
    underwriting = {
      periodEnd: null,
      revenue: null,
      ebitda: null,
      grossProfit: null,
      grossMarginPct: null,
      note: "Financials summary unavailable at close.",
    };
  }

  // Value-creation targets + plan id, via the VC service only.
  let vcTargets: unknown = null;
  let vcPlanId: string | null = null;
  try {
    const vc = await getValueCreationTargets(companyId);
    vcTargets = vc.targets;
    vcPlanId = vc.planId;
  } catch (err) {
    console.error(
      "[monitoring] vc targets copy failed for company",
      companyId,
      err instanceof Error ? err.message : String(err)
    );
  }

  // Participants — shared reference data (core.deal_participants).
  const participantRows = await db`
    SELECT id, deal_id, entity_kind, entity_id, entity_name, role, status
    FROM core.deal_participants
    WHERE deal_id = ${dealId}
    ORDER BY created_at ASC`;
  const participants = participantRows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      id: str(rec.id),
      dealId: str(rec.deal_id),
      entityKind: str(rec.entity_kind),
      entityId: str(rec.entity_id),
      entityName: str(rec.entity_name),
      role: str(rec.role),
      status: str(rec.status),
    };
  });

  const id = `monpc_${newId()}`;
  const inserted = await db`
    INSERT INTO monitoring.portfolio_companies
      (id, company_id, deal_id, status, closed_at, closed_by,
       baseline_company, baseline_financials, underwriting,
       vc_targets, vc_plan_id, participants, source)
    VALUES (${id}, ${companyId}, ${dealId}, 'active', now(), ${actor},
      ${JSON.stringify(baselineCompany)}::jsonb,
      ${baselineFinancials ? JSON.stringify(baselineFinancials) : null}::jsonb,
      ${underwriting ? JSON.stringify(underwriting) : null}::jsonb,
      ${vcTargets ? JSON.stringify(vcTargets) : null}::jsonb,
      ${vcPlanId},
      ${JSON.stringify(participants)}::jsonb,
      'deal_closed')
    ON CONFLICT (company_id) DO NOTHING
    RETURNING *`;
  const row = inserted.length
    ? (inserted[0] as Record<string, unknown>)
    : (
        await db`
          SELECT * FROM monitoring.portfolio_companies
          WHERE company_id = ${companyId} LIMIT 1`
      )[0] as Record<string, unknown>;

  const name = str(baselineCompany.name) || companyId;
  await logActivity({
    entityKind: "company",
    entityId: companyId,
    actor,
    kind: "deal_closed",
    message: `${name} entered portfolio monitoring (deal closed)`,
  });
  await refreshRollups();
  return rowToPortfolioCompany(row);
}

/* ------------------------------- periods ----------------------------- */

/** Cancel any queued due-check job for one period (superseding). */
async function cancelPeriodDueJobs(periodId: string): Promise<void> {
  const db = sql();
  await db`
    UPDATE core.jobs
    SET status = 'cancelled', updated_at = now()
    WHERE kind = 'monitoring_period_due' AND status = 'queued'
      AND payload->>'periodId' = ${periodId}`;
}

/**
 * Schedule the period's due check: a core.jobs row kind
 * 'monitoring_period_due' with run_after = due_date + graceDays
 * (late_reporting rule) at 08:00 America/Phoenix — the same
 * run_after mechanism lib/push-schedule.ts uses. Deduped per period:
 * an already-queued job for this periodId is left in place.
 */
async function schedulePeriodDueJob(period: PeriodRow): Promise<void> {
  if (!period.dueDate) return;
  const db = sql();
  const existing = await db`
    SELECT id FROM core.jobs
    WHERE kind = 'monitoring_period_due' AND status IN ('queued', 'running')
      AND payload->>'periodId' = ${period.id}
    LIMIT 1`;
  if (existing.length) return;
  const grace = await lateReportingGraceDays(period.companyId);
  const fireDate = addDays(period.dueDate, grace);
  await enqueueJobAt(
    "monitoring_period_due",
    { periodId: period.id },
    new Date(`${fireDate}T08:00:00-07:00`)
  );
}

export interface CreatePeriodInput {
  cadence?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  dueDate?: string | null;
  notes?: string;
  source?: string;
}

export async function createPeriod(
  companyId: string,
  input: CreatePeriodInput,
  actor: string
): Promise<PeriodRow> {
  void actor;
  await ensureMonitoring();
  const pc = await getPortfolioCompanyRow(companyId);
  if (!pc) throw new MonitoringError("portfolio_company_not_found");
  const cadence = (input.cadence ?? "monthly").trim() || "monthly";
  if (!(PERIOD_CADENCES as readonly string[]).includes(cadence)) {
    throw new MonitoringError("invalid_cadence");
  }
  const periodStart = cleanDate(input.periodStart);
  const periodEnd = cleanDate(input.periodEnd);
  const dueDate = cleanDate(input.dueDate);
  if (
    (input.periodStart != null && input.periodStart !== "" && !periodStart) ||
    (input.periodEnd != null && input.periodEnd !== "" && !periodEnd) ||
    (input.dueDate != null && input.dueDate !== "" && !dueDate)
  ) {
    throw new MonitoringError("invalid_date");
  }
  const db = sql();
  const id = `monper_${newId()}`;
  await db`
    INSERT INTO monitoring.reporting_periods
      (id, company_id, cadence, period_start, period_end, due_date,
       status, notes, source)
    VALUES (${id}, ${companyId}, ${cadence}, ${periodStart}, ${periodEnd},
      ${dueDate}, 'pending', ${input.notes ?? ""},
      ${input.source ?? "manual"})`;
  const period = (await getPeriod(id)) as PeriodRow;
  await schedulePeriodDueJob(period);
  return period;
}

export async function getPeriod(id: string): Promise<PeriodRow | null> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.reporting_periods
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToPeriod(rows[0] as Record<string, unknown>) : null;
}

export async function listPeriods(companyId: string): Promise<PeriodRow[]> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.reporting_periods
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY period_end DESC NULLS LAST, created_at DESC
    LIMIT 100`;
  return rows.map((r) => rowToPeriod(r as Record<string, unknown>));
}

export interface UpdatePeriodInput {
  cadence?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  dueDate?: string | null;
  status?: string;
  notes?: string;
}

export async function updatePeriod(
  id: string,
  patch: UpdatePeriodInput,
  actor: string
): Promise<PeriodRow> {
  void actor;
  await ensureMonitoring();
  const cur = await getPeriod(id);
  if (!cur) throw new MonitoringError("period_not_found");
  const cadence =
    patch.cadence !== undefined ? patch.cadence.trim() : cur.cadence;
  if (!(PERIOD_CADENCES as readonly string[]).includes(cadence)) {
    throw new MonitoringError("invalid_cadence");
  }
  const status = patch.status !== undefined ? patch.status : cur.status;
  if (!(PERIOD_STATUSES as readonly string[]).includes(status)) {
    throw new MonitoringError("invalid_status");
  }
  const periodStart =
    patch.periodStart !== undefined
      ? cleanDate(patch.periodStart)
      : cur.periodStart;
  const periodEnd =
    patch.periodEnd !== undefined ? cleanDate(patch.periodEnd) : cur.periodEnd;
  const dueDate =
    patch.dueDate !== undefined ? cleanDate(patch.dueDate) : cur.dueDate;
  if (
    (patch.periodStart != null && patch.periodStart !== "" && !periodStart) ||
    (patch.periodEnd != null && patch.periodEnd !== "" && !periodEnd) ||
    (patch.dueDate != null && patch.dueDate !== "" && !dueDate)
  ) {
    throw new MonitoringError("invalid_date");
  }
  const receivedAt =
    status === "received" && cur.status !== "received"
      ? new Date().toISOString()
      : status !== "received"
        ? null
        : cur.receivedAt;
  const db = sql();
  await db`
    UPDATE monitoring.reporting_periods
    SET cadence = ${cadence},
        period_start = ${periodStart},
        period_end = ${periodEnd},
        due_date = ${dueDate},
        status = ${status},
        received_at = ${receivedAt}::timestamptz,
        notes = ${patch.notes !== undefined ? patch.notes : cur.notes},
        updated_at = now()
    WHERE id = ${id}`;
  const updated = (await getPeriod(id)) as PeriodRow;
  if (dueDate !== cur.dueDate) {
    // Superseding reschedule: the old fire time must not survive.
    await cancelPeriodDueJobs(id);
    if (updated.status === "pending") await schedulePeriodDueJob(updated);
  }
  return updated;
}

export async function deletePeriod(
  id: string,
  actor: string
): Promise<boolean> {
  void actor;
  await ensureMonitoring();
  const cur = await getPeriod(id);
  if (!cur) throw new MonitoringError("period_not_found");
  const db = sql();
  await db`
    UPDATE monitoring.reporting_periods
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL`;
  await cancelPeriodDueJobs(id);
  return true;
}

/**
 * Due check (job 'monitoring_period_due' + the check-due route): a
 * live period still 'pending' once Phoenix today is past its due date
 * flips to 'late' and raises a late_reporting alert (deduped per
 * period). Returns the outcome for the job log / ops route.
 */
export async function evaluatePeriodDue(
  periodId: string
): Promise<{ periodId: string; outcome: string; status?: string }> {
  await ensureMonitoring();
  const period = await getPeriod(periodId);
  if (!period) return { periodId, outcome: "not_found" };
  if (period.status !== "pending") {
    return { periodId, outcome: "not_pending", status: period.status };
  }
  if (!period.dueDate || phoenixToday() <= period.dueDate) {
    return { periodId, outcome: "not_due", status: period.status };
  }
  const db = sql();
  await db`
    UPDATE monitoring.reporting_periods
    SET status = 'late', updated_at = now()
    WHERE id = ${periodId} AND deleted_at IS NULL`;
  const name = (await companyName(period.companyId)) || period.companyId;
  await createAlert({
    companyId: period.companyId,
    ruleKey: "late_reporting",
    severity: "high",
    title: `Reporting late: ${name}`,
    detail: `The ${periodLabel(period)} was due ${period.dueDate} and has not been received.`,
    dedupeKey: `late:${periodId}`,
  });
  await logActivity({
    entityKind: "company",
    entityId: period.companyId,
    actor: "system",
    kind: "reporting_late",
    message: `Reporting late for ${name} (${periodLabel(period)})`,
  });
  return { periodId, outcome: "marked_late", status: "late" };
}

/* ---------------------------- receive report ------------------------- */

/**
 * Receive a reporting package: the document must exist in
 * core.documents; its statement sets are extracted through the
 * financials service and EVERY resulting draft is posted via postSet
 * (an ebitda_override_required error propagates honestly and the
 * period stays pending). On success the period is marked received,
 * reporting_received is published (ids only), KPI refresh is handed
 * to the analytics module when present, and rollups refresh.
 */
export async function receiveReport(
  companyId: string,
  periodId: string,
  input: { documentId: string },
  actor: string
): Promise<{ period: PeriodRow; setIds: string[] }> {
  await ensureMonitoring();
  const period = await getPeriod(periodId);
  if (!period || period.companyId !== companyId) {
    throw new MonitoringError("period_not_found");
  }
  const documentId = (input.documentId ?? "").trim();
  if (!documentId) throw new MonitoringError("document_required");
  const db = sql();
  const docRows = await db`
    SELECT id FROM core.documents
    WHERE id = ${documentId} AND deleted_at IS NULL LIMIT 1`;
  if (!docRows.length) throw new MonitoringError("document_not_found");

  const extracted = await extractFromDocument({
    documentId,
    companyId,
    actor,
  });
  if (extracted.status === "queued") {
    // Oversized document: extraction runs as a background job, so
    // there is nothing to post yet — the period honestly stays pending.
    throw new MonitoringError("extraction_queued");
  }
  if (!extracted.sets.length) {
    throw new MonitoringError("no_statement_sets_extracted");
  }
  const setIds: string[] = [];
  for (const set of extracted.sets) {
    if (set.status === "draft") {
      await postSet(set.id, {}, actor);
    }
    setIds.push(set.id);
  }

  await db`
    UPDATE monitoring.reporting_periods
    SET status = 'received', received_at = now(),
        document_id = ${documentId},
        statement_set_ids = ${JSON.stringify(setIds)}::jsonb,
        updated_at = now()
    WHERE id = ${periodId}`;
  const updated = (await getPeriod(periodId)) as PeriodRow;

  await publishEvent("reporting_received", {
    entityKind: "company",
    entityId: companyId,
    payload: { companyId, periodId, documentId },
    actor,
  });
  const name = (await companyName(companyId)) || companyId;
  await logActivity({
    entityKind: "company",
    entityId: companyId,
    actor,
    kind: "reporting_received",
    message: `Reporting received for ${name} (${periodLabel(updated)})`,
  });

  // KPI refresh + KPI-miss evaluation live in lib/monitoring/
  // analytics.ts (WS-B). Dynamic import with a computed specifier so
  // this module neither depends on nor blocks that workstream.
  try {
    const analyticsSpecifier = "./analytics";
    const analytics = (await import(analyticsSpecifier)) as {
      refreshKpisFromFinancials?: (cid: string) => Promise<unknown>;
      evaluateKpiAlerts?: (cid: string) => Promise<unknown>;
    };
    if (typeof analytics.refreshKpisFromFinancials === "function") {
      await analytics.refreshKpisFromFinancials(companyId);
    }
    if (typeof analytics.evaluateKpiAlerts === "function") {
      await analytics.evaluateKpiAlerts(companyId);
    }
  } catch {
    /* analytics module not present yet — KPI refresh is its job */
  }

  await refreshRollups();
  return { period: updated, setIds };
}

/* -------------------------------- alerts ----------------------------- */

/**
 * Create an alert unless a live OPEN alert with the same dedupe key
 * already exists for the company. A new alert also creates its
 * follow-up task and a core.notifications entry.
 *
 * Task creation: the tasks API (app/api/tasks/route.ts) has no
 * reusable single-task service — its canonical write is getTasks() +
 * saveTasks() whole-array replace, which is unsafe from a background
 * path. So this replicates that route's INSERT shape directly into
 * the public tasks table: type 'Other', priority 'high', due today
 * (Phoenix), related_kind 'company' with related_id / related_name
 * set to the portfolio company.
 */
export async function createAlert(input: {
  companyId: string;
  ruleKey: string;
  severity?: string;
  title: string;
  detail?: string;
  dedupeKey: string;
  actor?: string;
}): Promise<AlertRow> {
  await ensureMonitoring();
  const db = sql();
  const dedupeKey = (input.dedupeKey ?? "").trim();
  if (dedupeKey) {
    const existing = await db`
      SELECT * FROM monitoring.alerts
      WHERE company_id = ${input.companyId} AND dedupe_key = ${dedupeKey}
        AND status = 'open' AND deleted_at IS NULL
      LIMIT 1`;
    if (existing.length) {
      return rowToAlert(existing[0] as Record<string, unknown>);
    }
  }
  const name = (await companyName(input.companyId)) || input.companyId;
  const actor = input.actor ?? "";
  const today = phoenixToday();

  // Follow-up task (direct INSERT — see the header note). The id is
  // only stored on the alert when the insert actually succeeded.
  let taskId: string | null = null;
  try {
    const candidateId = newId();
    await db`
      INSERT INTO tasks
        (id, title, due_date, due_time, type, priority, notes, done,
         completed_at, owner, related_kind, related_id, related_name,
         calendar_event_id)
      VALUES (${candidateId}, ${input.title}, ${today}, NULL, 'Other', 'high',
        ${input.detail ?? ""}, false, NULL, ${actor}, 'company',
        ${input.companyId}, ${name}, NULL)`;
    taskId = candidateId;
    try {
      const { requestGeneratedEventsRefresh } = await import(
        "../calgen/service"
      );
      await requestGeneratedEventsRefresh();
    } catch {
      /* generated calendar layer refresh is best-effort */
    }
  } catch (err) {
    console.error(
      "[monitoring] alert task insert failed",
      err instanceof Error ? err.message : String(err)
    );
  }

  // Notification center entry (user_email '' = all internal users,
  // the collab.ts convention). Ids/titles only — never figures.
  try {
    await ensureNotificationsSchema();
    await db`
      INSERT INTO core.notifications
        (id, user_email, kind, title, body, href, entity_kind, entity_id)
      VALUES (${newId()}, '', 'monitoring_alert', ${input.title},
        ${input.detail ?? ""}, ${`/portfolio-monitoring/${input.companyId}`},
        'company', ${input.companyId})`;
  } catch (err) {
    console.error(
      "[monitoring] alert notification write failed",
      err instanceof Error ? err.message : String(err)
    );
  }

  const id = `monal_${newId()}`;
  await db`
    INSERT INTO monitoring.alerts
      (id, company_id, rule_key, severity, title, detail, status,
       task_id, dedupe_key)
    VALUES (${id}, ${input.companyId}, ${input.ruleKey},
      ${input.severity ?? "medium"}, ${input.title}, ${input.detail ?? ""},
      'open', ${taskId}, ${dedupeKey})`;
  const rows = await db`
    SELECT * FROM monitoring.alerts WHERE id = ${id} LIMIT 1`;
  return rowToAlert(rows[0] as Record<string, unknown>);
}

export async function listAlerts(
  companyId?: string,
  status?: string
): Promise<AlertRow[]> {
  await ensureMonitoring();
  const db = sql();
  const cid = (companyId ?? "").trim();
  const st = (status ?? "").trim();
  const rows = await db`
    SELECT * FROM monitoring.alerts
    WHERE deleted_at IS NULL
      AND (${cid} = '' OR company_id = ${cid})
      AND (${st} = '' OR status = ${st})
    ORDER BY created_at DESC
    LIMIT 100`;
  return rows.map((r) => rowToAlert(r as Record<string, unknown>));
}

export async function setAlertStatus(
  id: string,
  status: string,
  actor: string
): Promise<AlertRow> {
  void actor;
  await ensureMonitoring();
  if (!(ALERT_STATUSES as readonly string[]).includes(status)) {
    throw new MonitoringError("invalid_status");
  }
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.alerts
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new MonitoringError("alert_not_found");
  await db`
    UPDATE monitoring.alerts
    SET status = ${status},
        resolved_at = ${status === "resolved" ? new Date().toISOString() : null}::timestamptz,
        updated_at = now()
    WHERE id = ${id}`;
  const updated = await db`
    SELECT * FROM monitoring.alerts WHERE id = ${id} LIMIT 1`;
  return rowToAlert(updated[0] as Record<string, unknown>);
}

/* ------------------------------- rollups ----------------------------- */

export interface RollupPerCompany {
  companyId: string;
  periodEnd: string | null;
  revenue: number | null;
  ebitda: number | null;
}

export interface RollupPayload {
  companyCount: number;
  totalRevenue: number;
  totalEbitda: number;
  weightedGrossMarginPct: number | null;
  aggregateLeverage: number | null;
  totalCash: number;
  asOf: string;
  perCompany: RollupPerCompany[];
}

/**
 * Rebuild the stored portfolio rollup from monitoring's OWN tables
 * (latest kpi_values per company, latest cash_positions, live debt
 * tranche balances). weightedGrossMarginPct is gross-profit-weighted:
 * Σ gross profit / Σ revenue over companies reporting both.
 * aggregateLeverage = total debt / total EBITDA (null when EBITDA ≤ 0).
 */
export async function refreshRollups(): Promise<RollupPayload> {
  await ensureMonitoring();
  const db = sql();
  const companies = await db`
    SELECT company_id FROM monitoring.portfolio_companies
    WHERE deleted_at IS NULL AND status = 'active'`;
  const perCompany: RollupPerCompany[] = [];
  let totalRevenue = 0;
  let totalEbitda = 0;
  let totalGrossProfit = 0;
  let marginRevenueBase = 0;
  let totalCash = 0;
  let totalDebt = 0;

  for (const crow of companies) {
    const companyId = str((crow as Record<string, unknown>).company_id);
    const kpiRows = await db`
      SELECT DISTINCT ON (kpi_key) kpi_key, value, period_end
      FROM monitoring.kpi_values
      WHERE company_id = ${companyId} AND deleted_at IS NULL
        AND kpi_key IN ('revenue', 'ebitda', 'gross_profit', 'gross_margin_pct')
      ORDER BY kpi_key, period_end DESC NULLS LAST, updated_at DESC`;
    let revenue: number | null = null;
    let ebitda: number | null = null;
    let grossProfit: number | null = null;
    let periodEnd: string | null = null;
    for (const r of kpiRows) {
      const rec = r as Record<string, unknown>;
      const key = str(rec.kpi_key);
      const val = numOrNull(rec.value);
      const pe = dateOrNull(rec.period_end);
      if (pe && (!periodEnd || pe > periodEnd)) periodEnd = pe;
      if (key === "revenue") revenue = val;
      else if (key === "ebitda") ebitda = val;
      else if (key === "gross_profit") grossProfit = val;
    }
    if (revenue != null) totalRevenue += revenue;
    if (ebitda != null) totalEbitda += ebitda;
    if (grossProfit != null && revenue != null && revenue > 0) {
      totalGrossProfit += grossProfit;
      marginRevenueBase += revenue;
    }
    const cashRows = await db`
      SELECT cash_balance FROM monitoring.cash_positions
      WHERE company_id = ${companyId} AND deleted_at IS NULL
      ORDER BY as_of DESC NULLS LAST, created_at DESC
      LIMIT 1`;
    if (cashRows.length) {
      totalCash += num((cashRows[0] as Record<string, unknown>).cash_balance);
    }
    const debtRows = await db`
      SELECT coalesce(sum(current_balance), 0) AS total
      FROM monitoring.debt_tranches
      WHERE company_id = ${companyId} AND deleted_at IS NULL`;
    if (debtRows.length) {
      totalDebt += num((debtRows[0] as Record<string, unknown>).total);
    }
    perCompany.push({ companyId, periodEnd, revenue, ebitda });
  }

  const payload: RollupPayload = {
    companyCount: companies.length,
    totalRevenue,
    totalEbitda,
    weightedGrossMarginPct:
      marginRevenueBase > 0
        ? (totalGrossProfit / marginRevenueBase) * 100
        : null,
    aggregateLeverage: totalEbitda > 0 ? totalDebt / totalEbitda : null,
    totalCash,
    asOf: new Date().toISOString(),
    perCompany,
  };
  await db`
    INSERT INTO monitoring.rollup_summary (id, payload, updated_at)
    VALUES ('portfolio', ${JSON.stringify(payload)}::jsonb, now())
    ON CONFLICT (id) DO UPDATE SET
      payload = EXCLUDED.payload, updated_at = now()`;
  return payload;
}

/** Read the stored rollup row — never recomputes on read. */
export async function getRollups(): Promise<{
  payload: RollupPayload;
  updatedAt: string | null;
} | null> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT payload, updated_at FROM monitoring.rollup_summary
    WHERE id = 'portfolio' AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) return null;
  const rec = rows[0] as Record<string, unknown>;
  return {
    payload: jsonObj(rec.payload) as unknown as RollupPayload,
    updatedAt: isoOrNull(rec.updated_at),
  };
}

/* --------------------------- company summary ------------------------- */

export interface MonitoringCompanySummary {
  companyId: string;
  dealId: string | null;
  status: string;
  latestPeriodEnd: string | null;
  kpis: {
    revenue: number | null;
    ebitda: number | null;
    grossMarginPct: number | null;
    cash: number | null;
  };
  reportingStatus: string | null;
  openAlerts: number;
  covenantStatus: "pass" | "fail" | "none";
  updatedAt: string;
}

/**
 * Compact per-company monitoring summary — WS-C consumes this for
 * exports + the Phase 7 template wiring. Null when the company is
 * not a live portfolio company.
 */
export async function getMonitoringSummaryForCompany(
  companyId: string
): Promise<MonitoringCompanySummary | null> {
  await ensureMonitoring();
  const pc = await getPortfolioCompanyRow(companyId);
  if (!pc) return null;
  const db = sql();

  const kpiRows = await db`
    SELECT DISTINCT ON (kpi_key) kpi_key, value, period_end
    FROM monitoring.kpi_values
    WHERE company_id = ${companyId} AND deleted_at IS NULL
      AND kpi_key IN ('revenue', 'ebitda', 'gross_margin_pct')
    ORDER BY kpi_key, period_end DESC NULLS LAST, updated_at DESC`;
  let revenue: number | null = null;
  let ebitda: number | null = null;
  let grossMarginPct: number | null = null;
  let latestPeriodEnd: string | null = null;
  for (const r of kpiRows) {
    const rec = r as Record<string, unknown>;
    const pe = dateOrNull(rec.period_end);
    if (pe && (!latestPeriodEnd || pe > latestPeriodEnd)) {
      latestPeriodEnd = pe;
    }
    if (str(rec.kpi_key) === "revenue") revenue = numOrNull(rec.value);
    else if (str(rec.kpi_key) === "ebitda") ebitda = numOrNull(rec.value);
    else if (str(rec.kpi_key) === "gross_margin_pct") {
      grossMarginPct = numOrNull(rec.value);
    }
  }

  const cashRows = await db`
    SELECT value FROM monitoring.kpi_values
    WHERE company_id = ${companyId} AND kpi_key = 'cash'
      AND deleted_at IS NULL
    ORDER BY period_end DESC NULLS LAST, updated_at DESC
    LIMIT 1`;
  let cash: number | null = cashRows.length
    ? numOrNull((cashRows[0] as Record<string, unknown>).value)
    : null;
  if (cash == null) {
    const posRows = await db`
      SELECT cash_balance FROM monitoring.cash_positions
      WHERE company_id = ${companyId} AND deleted_at IS NULL
      ORDER BY as_of DESC NULLS LAST, created_at DESC
      LIMIT 1`;
    if (posRows.length) {
      cash = numOrNull(
        (posRows[0] as Record<string, unknown>).cash_balance
      );
    }
  }

  const periodRows = await db`
    SELECT status, period_end FROM monitoring.reporting_periods
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY period_end DESC NULLS LAST, created_at DESC
    LIMIT 1`;
  let reportingStatus: string | null = null;
  if (periodRows.length) {
    const rec = periodRows[0] as Record<string, unknown>;
    reportingStatus = str(rec.status) || null;
    const pe = dateOrNull(rec.period_end);
    if (pe && (!latestPeriodEnd || pe > latestPeriodEnd)) {
      latestPeriodEnd = pe;
    }
  }

  const alertRows = await db`
    SELECT count(*)::int AS n FROM monitoring.alerts
    WHERE company_id = ${companyId} AND status = 'open'
      AND deleted_at IS NULL`;
  const openAlerts = alertRows.length
    ? num((alertRows[0] as Record<string, unknown>).n)
    : 0;

  const testRows = await db`
    SELECT status FROM monitoring.covenant_tests
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY period_end DESC NULLS LAST, computed_at DESC NULLS LAST,
      created_at DESC
    LIMIT 1`;
  const covenantStatus: "pass" | "fail" | "none" = testRows.length
    ? str((testRows[0] as Record<string, unknown>).status) === "fail"
      ? "fail"
      : "pass"
    : "none";

  return {
    companyId,
    dealId: pc.dealId,
    status: pc.status,
    latestPeriodEnd,
    kpis: { revenue, ebitda, grossMarginPct, cash },
    reportingStatus,
    openAlerts,
    covenantStatus,
    updatedAt: pc.updatedAt,
  };
}

/* ------------------------------ companies ---------------------------- */

export interface PortfolioCompanyListItem extends PortfolioCompanyRow {
  companyName: string;
  latestPeriodEnd: string | null;
  revenue: number | null;
  ebitda: number | null;
  grossMarginPct: number | null;
  reportingStatus: string | null;
  openAlerts: number;
  covenantStatus: "pass" | "fail" | "none";
}

/** Column-lean list: portfolio rows + company name + each company's
 * summary block (latest KPIs / statuses) — no baseline blobs. */
export async function listPortfolioCompanies(): Promise<
  PortfolioCompanyListItem[]
> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT pc.id, pc.company_id, pc.deal_id, pc.status, pc.closed_at,
      pc.closed_by, pc.source, pc.created_at, pc.updated_at,
      coalesce(co.name, '') AS company_name
    FROM monitoring.portfolio_companies pc
    LEFT JOIN core.companies co ON co.id = pc.company_id
    WHERE pc.deleted_at IS NULL
    ORDER BY pc.closed_at DESC NULLS LAST, pc.created_at DESC
    LIMIT 100`;
  const out: PortfolioCompanyListItem[] = [];
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const base = rowToPortfolioCompany(rec);
    const summary = await getMonitoringSummaryForCompany(base.companyId);
    out.push({
      ...base,
      companyName: str(rec.company_name),
      latestPeriodEnd: summary?.latestPeriodEnd ?? null,
      revenue: summary?.kpis.revenue ?? null,
      ebitda: summary?.kpis.ebitda ?? null,
      grossMarginPct: summary?.kpis.grossMarginPct ?? null,
      reportingStatus: summary?.reportingStatus ?? null,
      openAlerts: summary?.openAlerts ?? 0,
      covenantStatus: summary?.covenantStatus ?? "none",
    });
  }
  return out;
}

/* --------------------------- calendar items -------------------------- */

export interface ReportingCalendarItem {
  periodId: string;
  companyId: string;
  companyName: string;
  cadence: string;
  periodEnd: string | null;
  dueDate: string;
  status: string;
}

export async function listReportingCalendarItems(): Promise<
  ReportingCalendarItem[]
> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT p.id, p.company_id, p.cadence, p.period_end, p.due_date,
      p.status, coalesce(co.name, '') AS company_name
    FROM monitoring.reporting_periods p
    JOIN monitoring.portfolio_companies pc
      ON pc.company_id = p.company_id AND pc.deleted_at IS NULL
    LEFT JOIN core.companies co ON co.id = p.company_id
    WHERE p.deleted_at IS NULL AND p.due_date IS NOT NULL
      AND p.status IN ('pending', 'late')`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      periodId: str(rec.id),
      companyId: str(rec.company_id),
      companyName: str(rec.company_name),
      cadence: str(rec.cadence) || "monthly",
      periodEnd: dateOrNull(rec.period_end),
      dueDate: dateOrNull(rec.due_date) ?? "",
      status: str(rec.status) || "pending",
    };
  });
}

export interface CovenantCalendarItem {
  covenantId: string;
  companyId: string;
  companyName: string;
  label: string;
  covenantKey: string;
  nextTestDate: string;
}

export async function listCovenantCalendarItems(): Promise<
  CovenantCalendarItem[]
> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT c.id, c.company_id, c.label, c.covenant_key, c.next_test_date,
      coalesce(co.name, '') AS company_name
    FROM monitoring.covenants c
    JOIN monitoring.portfolio_companies pc
      ON pc.company_id = c.company_id AND pc.deleted_at IS NULL
    LEFT JOIN core.companies co ON co.id = c.company_id
    WHERE c.deleted_at IS NULL AND c.active = true
      AND c.next_test_date IS NOT NULL`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return {
      covenantId: str(rec.id),
      companyId: str(rec.company_id),
      companyName: str(rec.company_name),
      label: str(rec.label),
      covenantKey: str(rec.covenant_key),
      nextTestDate: dateOrNull(rec.next_test_date) ?? "",
    };
  });
}

/* ------------------------- event registration ------------------------ */
/**
 * deal_closed → portfolio handoff. The deals PUT route also enqueues
 * a 'monitoring_handoff' job as the durable path; this handler is the
 * immediate path, and handoffDealClosed is idempotent on company_id,
 * so both firing is harmless. Registered once per process, mirroring
 * lib/capital/service.ts.
 */
let monitoringHandlerRegistered = false;
function registerMonitoringHandlers(): void {
  if (monitoringHandlerRegistered) return;
  monitoringHandlerRegistered = true;
  onEvent("deal_closed", async (evt) => {
    const dealId =
      (typeof evt.payload?.dealId === "string" && evt.payload.dealId) ||
      evt.entityId;
    if (!dealId) return;
    try {
      await handoffDealClosed(dealId, evt.actor ?? "");
    } catch (err) {
      console.error(
        "[monitoring] deal_closed handoff failed for deal",
        dealId,
        err instanceof Error ? err.message : String(err)
      );
    }
  });
}
registerMonitoringHandlers();
