import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import { publishEvent, onEvent } from "../platform/events";
import {
  getCompanyFinancials,
  listSets,
  getSet,
  type StatementLine,
} from "../financials/service";
import {
  getValueCreationTargets,
  getPlanByCompany,
  getPlan,
  getInitiative,
  listInitiatives,
} from "../valuecreation/service";
import {
  ensureMonitoring,
  KPI_UNITS,
  COVENANT_KEYS,
  COVENANT_OPERATORS,
  AGING_KINDS,
  ALERT_RULE_KEYS,
} from "./schema";
import {
  createAlert,
  listAlerts,
  setAlertStatus,
  refreshRollups,
  getPortfolioCompany,
  listPeriods,
} from "./service";

export { ensureMonitoring };

/**
 * Portfolio Monitoring analytics (Phase 8, WS-B) — KPIs derived from
 * posted financials, manual KPIs, budgets, four-way variance, value-
 * creation tracking, cash & liquidity, AR/AP aging, debt & covenant
 * testing, and the KPI / covenant alert evaluators.
 *
 * Module boundaries (PROJECT_RULES.md):
 * - Financial figures come ONLY through lib/financials/service.ts
 *   (getCompanyFinancials / listSets / getSet) — never financials.* SQL.
 * - Value-creation plans / initiatives / targets come ONLY through
 *   lib/valuecreation/service.ts (getPlanByCompany / getPlan /
 *   listInitiatives / getInitiative / getValueCreationTargets).
 * - monitoring.* tables are this module's own — written here via SQL.
 * - WS-A's lib/monitoring/service.ts owns portfolio companies,
 *   reporting periods, alerts storage and rollups; this file consumes
 *   createAlert / listAlerts / setAlertStatus / refreshRollups /
 *   getPortfolioCompany / listPeriods from it and never duplicates
 *   their tables' write logic (alerts are created ONLY via
 *   createAlert, which owns dedupe).
 * - NO figures in event payloads: covenant_breached carries ids +
 *   covenant key only. Alert title/detail are stored internal
 *   records, where figures are acceptable (and useful).
 *
 * Margin convention: kpi_values rows for *_pct keys store FRACTIONS
 * (gross_profit / revenue) with unit 'pct', per the WS-B contract.
 * The flat convenience fields on getKpis period records
 * (grossMarginPct / ebitdaMarginPct) are PERCENT POINTS, matching
 * the financials summary + value-creation target convention the
 * exports layer formats with fmtPctPoints.
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
function dateOrNull(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s ? s.slice(0, 10) : null;
}
function cleanDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function requireDate(v: unknown, code = "invalid_period_end"): string {
  const d = cleanDate(v);
  if (!d) throw new MonitoringError(code);
  return d;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

async function logActivity(opts: {
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
      VALUES (${newId()}, 'company', ${opts.entityId}, ${opts.actor},
        ${opts.kind}, ${opts.message}, 'manual')`;
  } catch (err) {
    console.error(
      "[monitoring] activity_log write failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/* ------------------------------ row types ---------------------------- */

export interface KpiValueRow {
  id: string;
  companyId: string;
  periodEnd: string | null;
  kpiKey: string;
  label: string;
  value: number | null;
  unit: string;
  source: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetRow {
  id: string;
  companyId: string;
  fiscalYear: number;
  lineKey: string;
  amount: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface VarianceNoteRow {
  id: string;
  companyId: string;
  periodEnd: string | null;
  metricKey: string;
  commentary: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface VcRealizedRow {
  id: string;
  companyId: string;
  initiativeId: string;
  periodEnd: string | null;
  realizedImpact: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CashPositionRow {
  id: string;
  companyId: string;
  asOf: string | null;
  cashBalance: number | null;
  revolverLimit: number | null;
  revolverDrawn: number | null;
  revolverAvailable: number | null;
  source: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CashflowWeekRow {
  id: string;
  companyId: string;
  weekStart: string | null;
  inflows: number | null;
  outflows: number | null;
  endingBalance: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface AgingSnapshotRow {
  id: string;
  companyId: string;
  asOf: string | null;
  kind: string;
  currentAmt: number | null;
  d31_60: number | null;
  d61_90: number | null;
  d90Plus: number | null;
  total: number | null;
  source: string;
  documentId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface DebtTrancheRow {
  id: string;
  companyId: string;
  lender: string;
  kind: string;
  principal: number | null;
  currentBalance: number | null;
  ratePct: number | null;
  maturity: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface CovenantRow {
  id: string;
  companyId: string;
  trancheId: string | null;
  covenantKey: string;
  label: string;
  operator: string;
  threshold: number | null;
  nextTestDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CovenantTestRow {
  id: string;
  companyId: string;
  covenantId: string;
  periodEnd: string | null;
  computedValue: number | null;
  threshold: number | null;
  headroomPct: number | null;
  status: string;
  detail: Record<string, unknown>;
  computedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRuleRow {
  id: string;
  companyId: string | null;
  ruleKey: string;
  enabled: boolean;
  params: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/* ----------------------------- row mappers --------------------------- */

function rowToKpi(r: Record<string, unknown>): KpiValueRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    periodEnd: dateOrNull(r.period_end),
    kpiKey: str(r.kpi_key),
    label: str(r.label),
    value: numOrNull(r.value),
    unit: str(r.unit) || "usd",
    source: str(r.source) || "manual",
    updatedBy: str(r.updated_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToBudget(r: Record<string, unknown>): BudgetRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    fiscalYear: num(r.fiscal_year),
    lineKey: str(r.line_key),
    amount: numOrNull(r.amount),
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToVarianceNote(r: Record<string, unknown>): VarianceNoteRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    periodEnd: dateOrNull(r.period_end),
    metricKey: str(r.metric_key),
    commentary: str(r.commentary),
    updatedBy: str(r.updated_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToVcRealized(r: Record<string, unknown>): VcRealizedRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    initiativeId: str(r.initiative_id),
    periodEnd: dateOrNull(r.period_end),
    realizedImpact: numOrNull(r.realized_impact),
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToCashPosition(r: Record<string, unknown>): CashPositionRow {
  const limit = numOrNull(r.revolver_limit);
  const drawn = numOrNull(r.revolver_drawn);
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    asOf: dateOrNull(r.as_of),
    cashBalance: numOrNull(r.cash_balance),
    revolverLimit: limit,
    revolverDrawn: drawn,
    revolverAvailable:
      limit !== null && drawn !== null ? limit - drawn : null,
    source: str(r.source) || "manual",
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToCashflowWeek(r: Record<string, unknown>): CashflowWeekRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    weekStart: dateOrNull(r.week_start),
    inflows: numOrNull(r.inflows),
    outflows: numOrNull(r.outflows),
    endingBalance: numOrNull(r.ending_balance),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToAging(r: Record<string, unknown>): AgingSnapshotRow {
  const currentAmt = numOrNull(r.current_amt);
  const d31 = numOrNull(r.d31_60);
  const d61 = numOrNull(r.d61_90);
  const d90 = numOrNull(r.d90_plus);
  const parts = [currentAmt, d31, d61, d90];
  const total = parts.some((v) => v !== null)
    ? parts.reduce((a: number, v) => a + (v ?? 0), 0)
    : null;
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    asOf: dateOrNull(r.as_of),
    kind: str(r.kind) || "ar",
    currentAmt,
    d31_60: d31,
    d61_90: d61,
    d90Plus: d90,
    total,
    source: str(r.source) || "manual",
    documentId: r.document_id ? str(r.document_id) : null,
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToTranche(r: Record<string, unknown>): DebtTrancheRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    lender: str(r.lender),
    kind: str(r.kind),
    principal: numOrNull(r.principal),
    currentBalance: numOrNull(r.current_balance),
    ratePct: numOrNull(r.rate_pct),
    maturity: dateOrNull(r.maturity),
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToCovenant(r: Record<string, unknown>): CovenantRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    trancheId: r.tranche_id ? str(r.tranche_id) : null,
    covenantKey: str(r.covenant_key),
    label: str(r.label),
    operator: str(r.operator) || ">=",
    threshold: numOrNull(r.threshold),
    nextTestDate: dateOrNull(r.next_test_date),
    active: r.active !== false,
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToTest(r: Record<string, unknown>): CovenantTestRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    covenantId: str(r.covenant_id),
    periodEnd: dateOrNull(r.period_end),
    computedValue: numOrNull(r.computed_value),
    threshold: numOrNull(r.threshold),
    headroomPct: numOrNull(r.headroom_pct),
    status: str(r.status) || "pass",
    detail: jsonObj(r.detail),
    computedAt: isoOrNull(r.computed_at),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToAlertRule(r: Record<string, unknown>): AlertRuleRow {
  return {
    id: str(r.id),
    companyId: r.company_id ? str(r.company_id) : null,
    ruleKey: str(r.rule_key),
    enabled: r.enabled !== false,
    params: jsonObj(r.params),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/* --------------------------- KPI definitions ------------------------- */

export const STANDARD_KPIS: Array<{
  key: string;
  label: string;
  unit: string;
}> = [
  { key: "revenue", label: "Revenue", unit: "usd" },
  { key: "gross_profit", label: "Gross profit", unit: "usd" },
  { key: "gross_margin_pct", label: "Gross margin", unit: "pct" },
  { key: "ebitda", label: "EBITDA", unit: "usd" },
  { key: "ebitda_margin_pct", label: "EBITDA margin", unit: "pct" },
  { key: "net_income", label: "Net income", unit: "usd" },
  { key: "cash", label: "Cash & equivalents", unit: "usd" },
  { key: "total_debt", label: "Total debt", unit: "usd" },
  { key: "headcount", label: "Headcount", unit: "count" },
  { key: "customer_count", label: "Customer count", unit: "count" },
];

export const STANDARD_KPI_KEYS: string[] = STANDARD_KPIS.map((k) => k.key);

function standardKpi(key: string): { label: string; unit: string } {
  const hit = STANDARD_KPIS.find((k) => k.key === key);
  return hit
    ? { label: hit.label, unit: hit.unit }
    : { label: key, unit: "usd" };
}

function validUnit(unit: string | undefined, fallback: string): string {
  if (unit === undefined || unit === "") return fallback;
  if (!(KPI_UNITS as readonly string[]).includes(unit))
    throw new MonitoringError("invalid_unit");
  return unit;
}

/* ------------------------- kpi_values upsert ------------------------- */

/**
 * Upsert one live kpi_values row on the unique live key
 * (company_id, period_end, kpi_key). Select-then-write (house
 * pattern) because the unique index is partial (deleted_at IS NULL).
 */
async function upsertKpiValue(input: {
  companyId: string;
  periodEnd: string;
  kpiKey: string;
  label: string;
  value: number;
  unit: string;
  source: string;
  actor: string;
}): Promise<void> {
  const db = sql();
  const existing = await db`
    SELECT id FROM monitoring.kpi_values
    WHERE company_id = ${input.companyId}
      AND period_end = ${input.periodEnd} AND kpi_key = ${input.kpiKey}
      AND deleted_at IS NULL LIMIT 1`;
  if (existing.length) {
    await db`
      UPDATE monitoring.kpi_values
      SET label = ${input.label}, value = ${input.value},
          unit = ${input.unit}, source = ${input.source},
          updated_by = ${input.actor}, updated_at = now()
      WHERE id = ${str((existing[0] as Record<string, unknown>).id)}`;
    return;
  }
  await db`
    INSERT INTO monitoring.kpi_values
      (id, company_id, period_end, kpi_key, label, value, unit, source,
       updated_by)
    VALUES (${`monkpi_${newId()}`}, ${input.companyId}, ${input.periodEnd},
      ${input.kpiKey}, ${input.label}, ${input.value}, ${input.unit},
      ${input.source}, ${input.actor})`;
}

async function listKpiRows(companyId: string): Promise<KpiValueRow[]> {
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.kpi_values
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY period_end DESC NULLS LAST, kpi_key ASC`;
  return rows.map((r) => rowToKpi(r as Record<string, unknown>));
}

/* ================================ KPIs =============================== */

/**
 * Refresh kpi_values from posted financials (financials service
 * ONLY). For every CURRENT posted REPORTED set: skip the period when
 * it lacks an income statement (no IS lines with values, or no
 * period end); otherwise write revenue / gross_profit /
 * gross_margin_pct (fraction) / ebitda / ebitda_margin_pct
 * (fraction) / net_income / cash (BS cash line) / total_debt
 * (current_debt + long_term_debt) with source 'financials'. Only
 * computable KPIs are written — a missing line never becomes a 0.
 */
export async function refreshKpisFromFinancials(
  companyId: string
): Promise<{ periods: number; written: number }> {
  await ensureMonitoring();
  // Period list via the financials read model (contract: the refresh
  // is driven by the company's posted periods, not raw tables).
  await getCompanyFinancials(companyId);

  // All CURRENT posted reported sets, paged through listSets.
  const sets: Array<{
    id: string;
    periodEnd: string | null;
    isCurrent: boolean;
  }> = [];
  let offset = 0;
  for (;;) {
    const page = await listSets({
      companyId,
      status: "posted",
      layer: "reported",
      limit: 50,
      offset,
    });
    for (const s of page.items) {
      if (s.isCurrent) {
        sets.push({
          id: s.id,
          periodEnd: s.periodEnd,
          isCurrent: s.isCurrent,
        });
      }
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }

  let periods = 0;
  let written = 0;
  for (const s of sets) {
    if (!s.periodEnd) continue;
    const got = await getSet(s.id);
    if (!got) continue;
    const lines: StatementLine[] = got.lines;
    const hasIs = lines.some(
      (l) => l.statementKind === "is" && l.value !== null
    );
    if (!hasIs) continue; // skip periods lacking an income statement
    periods += 1;

    const val = (kind: string, key: string): number | null => {
      const hit = lines.find(
        (l) => l.statementKind === kind && l.lineKey === key
      );
      if (hit && hit.value !== null) return hit.value;
      const anyKind = lines.find((l) => l.lineKey === key);
      return anyKind ? anyKind.value : null;
    };

    const revenue = val("is", "revenue");
    const grossProfit = val("is", "gross_profit");
    const ebitda = val("is", "ebitda");
    const netIncome = val("is", "net_income");
    const cash = val("bs", "cash");
    const currentDebt = val("bs", "current_debt");
    const longTermDebt = val("bs", "long_term_debt");
    const totalDebt =
      currentDebt === null && longTermDebt === null
        ? null
        : (currentDebt ?? 0) + (longTermDebt ?? 0);

    const candidates: Array<{
      key: string;
      value: number | null;
    }> = [
      { key: "revenue", value: revenue },
      { key: "gross_profit", value: grossProfit },
      {
        key: "gross_margin_pct",
        value:
          grossProfit !== null && revenue !== null && revenue !== 0
            ? grossProfit / revenue
            : null,
      },
      { key: "ebitda", value: ebitda },
      {
        key: "ebitda_margin_pct",
        value:
          ebitda !== null && revenue !== null && revenue !== 0
            ? ebitda / revenue
            : null,
      },
      { key: "net_income", value: netIncome },
      { key: "cash", value: cash },
      { key: "total_debt", value: totalDebt },
    ];
    for (const c of candidates) {
      if (c.value === null || !isFinite(c.value)) continue;
      const def = standardKpi(c.key);
      await upsertKpiValue({
        companyId,
        periodEnd: s.periodEnd,
        kpiKey: c.key,
        label: def.label,
        value: c.value,
        unit: def.unit,
        source: "financials",
        actor: "system",
      });
      written += 1;
    }
  }
  return { periods, written };
}

/* ----------------------------- manual KPIs --------------------------- */

export interface ManualKpiInput {
  periodEnd: string;
  kpiKey: string;
  label?: string;
  value: number;
  unit?: string;
}

/** Manual KPI upsert (headcount, customer_count, custom keys). */
export async function upsertManualKpi(
  companyId: string,
  input: ManualKpiInput,
  actor: string
): Promise<KpiValueRow> {
  await ensureMonitoring();
  const periodEnd = requireDate(input.periodEnd);
  const kpiKey = (input.kpiKey ?? "").trim();
  if (!kpiKey) throw new MonitoringError("invalid_kpi_key");
  if (typeof input.value !== "number" || !isFinite(input.value))
    throw new MonitoringError("invalid_value");
  const def = standardKpi(kpiKey);
  const label = (input.label ?? "").trim() || def.label;
  const unit = validUnit(input.unit, def.unit);
  await upsertKpiValue({
    companyId,
    periodEnd,
    kpiKey,
    label,
    value: input.value,
    unit,
    source: "manual",
    actor,
  });
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.kpi_values
    WHERE company_id = ${companyId} AND period_end = ${periodEnd}
      AND kpi_key = ${kpiKey} AND deleted_at IS NULL LIMIT 1`;
  return rowToKpi(rows[0] as Record<string, unknown>);
}

export interface KpiPeriodGroup {
  periodEnd: string | null;
  /** All stored kpi_values rows for the period (canonical values;
   * *_pct rows are fractions). */
  values: KpiValueRow[];
  revenue: number | null;
  gross_profit: number | null;
  /** Percent POINTS (financials-summary convention) for display /
   * export formatting; the stored row stays a fraction. */
  grossMarginPct: number | null;
  gross_margin_pct: number | null;
  ebitda: number | null;
  ebitdaMarginPct: number | null;
  ebitda_margin_pct: number | null;
  net_income: number | null;
  netIncome: number | null;
  cash: number | null;
  total_debt: number | null;
  totalDebt: number | null;
  headcount: number | null;
  customer_count: number | null;
}

export interface KpisResult {
  companyId: string;
  standardKeys: Array<{ key: string; label: string; unit: string }>;
  periods: KpiPeriodGroup[];
  /** Alias of `periods` (the exports layer reads either key). */
  kpis: KpiPeriodGroup[];
  reportingPeriods: unknown;
}

/**
 * All kpi_values for the company grouped by period (latest first),
 * plus the standard key list. Reporting periods (WS-A's listPeriods)
 * are attached best-effort for the UI's period context.
 */
export async function getKpis(companyId: string): Promise<KpisResult> {
  await ensureMonitoring();
  const rows = await listKpiRows(companyId);
  const byPeriod = new Map<string, KpiValueRow[]>();
  for (const r of rows) {
    const key = r.periodEnd ?? "";
    const list = byPeriod.get(key) ?? [];
    list.push(r);
    byPeriod.set(key, list);
  }
  const periods: KpiPeriodGroup[] = Array.from(byPeriod.entries())
    .sort((a, b) => (b[0] < a[0] ? -1 : b[0] > a[0] ? 1 : 0))
    .map(([periodEnd, values]) => {
      const get = (k: string): number | null =>
        values.find((v) => v.kpiKey === k)?.value ?? null;
      const gm = get("gross_margin_pct");
      const em = get("ebitda_margin_pct");
      return {
        periodEnd: periodEnd || null,
        values,
        revenue: get("revenue"),
        gross_profit: get("gross_profit"),
        grossMarginPct: gm === null ? null : round2(gm * 100),
        gross_margin_pct: gm,
        ebitda: get("ebitda"),
        ebitdaMarginPct: em === null ? null : round2(em * 100),
        ebitda_margin_pct: em,
        net_income: get("net_income"),
        netIncome: get("net_income"),
        cash: get("cash"),
        total_debt: get("total_debt"),
        totalDebt: get("total_debt"),
        headcount: get("headcount"),
        customer_count: get("customer_count"),
      };
    });
  let reportingPeriods: unknown = null;
  try {
    reportingPeriods = await listPeriods(companyId);
  } catch {
    reportingPeriods = null;
  }
  return {
    companyId,
    standardKeys: STANDARD_KPIS,
    periods,
    kpis: periods,
    reportingPeriods,
  };
}

/* =============================== Budgets ============================= */

export const BUDGET_LINE_KEYS = [
  "revenue",
  "gross_profit",
  "ebitda",
  "net_income",
  "cash",
] as const;

export interface BudgetsResult {
  companyId: string;
  fiscalYear: number | null;
  lines: BudgetRow[];
  years: number[];
}

export async function getBudgets(
  companyId: string,
  fiscalYear?: number
): Promise<BudgetsResult> {
  await ensureMonitoring();
  const db = sql();
  const yearFilter =
    typeof fiscalYear === "number" && isFinite(fiscalYear)
      ? Math.trunc(fiscalYear)
      : null;
  const rows = await db`
    SELECT * FROM monitoring.budgets
    WHERE company_id = ${companyId} AND deleted_at IS NULL
      AND (${yearFilter}::int IS NULL OR fiscal_year = ${yearFilter})
    ORDER BY fiscal_year DESC, line_key ASC`;
  const yearRows = await db`
    SELECT DISTINCT fiscal_year FROM monitoring.budgets
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY fiscal_year DESC`;
  return {
    companyId,
    fiscalYear: yearFilter,
    lines: rows.map((r) => rowToBudget(r as Record<string, unknown>)),
    years: yearRows.map((r) =>
      num((r as Record<string, unknown>).fiscal_year)
    ),
  };
}

export interface BudgetLineInput {
  lineKey: string;
  amount: number | null;
  notes?: string;
}

/** Bulk budget upsert for one fiscal year (validated line keys). */
export async function upsertBudgets(
  companyId: string,
  fiscalYear: number,
  lines: BudgetLineInput[],
  actor: string
): Promise<BudgetsResult> {
  void actor;
  await ensureMonitoring();
  if (
    typeof fiscalYear !== "number" ||
    !isFinite(fiscalYear) ||
    Math.trunc(fiscalYear) < 2000 ||
    Math.trunc(fiscalYear) > 2200
  ) {
    throw new MonitoringError("invalid_fiscal_year");
  }
  const year = Math.trunc(fiscalYear);
  if (!Array.isArray(lines) || !lines.length)
    throw new MonitoringError("invalid_budget_lines");
  for (const line of lines) {
    if (
      !(BUDGET_LINE_KEYS as readonly string[]).includes(line.lineKey ?? "")
    ) {
      throw new MonitoringError("invalid_budget_line");
    }
    if (
      line.amount !== null &&
      (typeof line.amount !== "number" || !isFinite(line.amount))
    ) {
      throw new MonitoringError("invalid_amount");
    }
  }
  const db = sql();
  for (const line of lines) {
    const existing = await db`
      SELECT id FROM monitoring.budgets
      WHERE company_id = ${companyId} AND fiscal_year = ${year}
        AND line_key = ${line.lineKey} AND deleted_at IS NULL LIMIT 1`;
    if (existing.length) {
      await db`
        UPDATE monitoring.budgets
        SET amount = ${line.amount}, notes = ${line.notes ?? ""},
            updated_at = now()
        WHERE id = ${str((existing[0] as Record<string, unknown>).id)}`;
    } else {
      await db`
        INSERT INTO monitoring.budgets
          (id, company_id, fiscal_year, line_key, amount, notes)
        VALUES (${`monbud_${newId()}`}, ${companyId}, ${year},
          ${line.lineKey}, ${line.amount}, ${line.notes ?? ""})`;
    }
  }
  return getBudgets(companyId, year);
}

/* =============================== Variance ============================ */

export const VARIANCE_METRICS = ["revenue", "gross_profit", "ebitda"] as const;

export interface VarianceDelta {
  abs: number;
  pct: number | null;
}

function varianceDelta(
  actual: number | null,
  comparator: number | null
): VarianceDelta | null {
  if (actual === null || comparator === null) return null;
  const abs = actual - comparator;
  return {
    abs,
    pct: comparator !== 0 ? round2((abs / Math.abs(comparator)) * 100) : null,
  };
}

interface Underwriting {
  periodEnd: string | null;
  revenue: number | null;
  ebitda: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
}

/** Tolerant read of portfolio_companies.underwriting via WS-A's
 * getPortfolioCompany (the row may arrive raw, wrapped, or with the
 * jsonb as a string). */
async function readUnderwriting(companyId: string): Promise<Underwriting> {
  const empty: Underwriting = {
    periodEnd: null,
    revenue: null,
    ebitda: null,
    grossProfit: null,
    grossMarginPct: null,
  };
  try {
    const pc = (await getPortfolioCompany(companyId)) as unknown as
      | Record<string, unknown>
      | null;
    if (!pc) return empty;
    const wrap = jsonObj(pc.company ?? pc.portfolioCompany ?? pc);
    const holder = Object.keys(wrap).length ? wrap : pc;
    const uw = jsonObj(holder.underwriting);
    if (!Object.keys(uw).length) return empty;
    return {
      periodEnd: dateOrNull(uw.periodEnd ?? uw.period_end),
      revenue: numOrNull(uw.revenue),
      ebitda: numOrNull(uw.ebitda),
      grossProfit: numOrNull(uw.grossProfit ?? uw.gross_profit),
      grossMarginPct: numOrNull(
        uw.grossMarginPct ?? uw.gross_margin_pct
      ),
    };
  } catch {
    return empty;
  }
}

export interface VarianceRowResult {
  metric: string;
  label: string;
  actual: number | null;
  budget: number | null;
  /** Value-creation target for the period (absolute for these
   * metrics; VC margin targets are percent points — not used here). */
  vc: number | null;
  vcTarget: number | null;
  underwriting: number | null;
  /** Headline variance (vs budget when present, else vs VC target). */
  variance: number | null;
  variances: {
    actualVsBudget: VarianceDelta | null;
    actualVsVc: VarianceDelta | null;
    actualVsUnderwriting: VarianceDelta | null;
  };
  commentary: string;
  note: VarianceNoteRow | null;
}

export interface VarianceResult {
  companyId: string;
  periodEnd: string;
  underwritingPeriodEnd: string | null;
  underwriting: Underwriting;
  rows: VarianceRowResult[];
}

/**
 * Four-way variance for revenue / gross_profit / ebitda at one
 * period: actual (kpi_values) vs budget (budgets for the period's
 * fiscal year) vs VC target (getValueCreationTargets at the period)
 * vs underwriting (the deal_closed copy; its values are included
 * regardless of period, but actualVsUnderwriting is computed ONLY
 * when underwriting.periodEnd == periodEnd). periodEnd defaults to
 * the company's latest KPI period.
 */
export async function getVariance(
  companyId: string,
  periodEnd?: string
): Promise<VarianceResult> {
  await ensureMonitoring();
  let effectivePeriod = periodEnd ? cleanDate(periodEnd) : null;
  if (periodEnd && !effectivePeriod)
    throw new MonitoringError("invalid_period_end");
  if (!effectivePeriod) {
    const db0 = sql();
    const latest = await db0`
      SELECT period_end FROM monitoring.kpi_values
      WHERE company_id = ${companyId} AND deleted_at IS NULL
        AND period_end IS NOT NULL
      ORDER BY period_end DESC LIMIT 1`;
    effectivePeriod = latest.length
      ? dateOrNull(
          (latest[0] as Record<string, unknown>).period_end
        )
      : null;
    if (!effectivePeriod) {
      return {
        companyId,
        periodEnd: "",
        underwritingPeriodEnd: null,
        underwriting: await readUnderwriting(companyId),
        rows: [],
      };
    }
  }
  const fiscalYear = Number(effectivePeriod.slice(0, 4));
  const db = sql();

  const kpiRows = await db`
    SELECT * FROM monitoring.kpi_values
    WHERE company_id = ${companyId} AND period_end = ${effectivePeriod}
      AND deleted_at IS NULL`;
  const actuals = new Map<string, number | null>();
  for (const r of kpiRows) {
    const row = rowToKpi(r as Record<string, unknown>);
    actuals.set(row.kpiKey, row.value);
  }

  const budgetRows = await db`
    SELECT * FROM monitoring.budgets
    WHERE company_id = ${companyId} AND fiscal_year = ${fiscalYear}
      AND deleted_at IS NULL`;
  const budgets = new Map<string, number | null>();
  for (const r of budgetRows) {
    const row = rowToBudget(r as Record<string, unknown>);
    budgets.set(row.lineKey, row.amount);
  }

  const vcResult = await getValueCreationTargets(
    companyId,
    effectivePeriod
  ).catch(() => ({ targets: [] as Array<{
    periodEnd: string;
    metric: string;
    targetValue: number;
  }> }));
  const vcTargets = new Map<string, number>();
  for (const t of vcResult.targets ?? []) {
    if (t.periodEnd === effectivePeriod) {
      vcTargets.set(t.metric, t.targetValue);
    }
  }

  const underwriting = await readUnderwriting(companyId);
  const uwByMetric: Record<string, number | null> = {
    revenue: underwriting.revenue,
    gross_profit: underwriting.grossProfit,
    ebitda: underwriting.ebitda,
  };
  const uwComparable = underwriting.periodEnd === effectivePeriod;

  const noteRows = await db`
    SELECT * FROM monitoring.variance_notes
    WHERE company_id = ${companyId} AND period_end = ${effectivePeriod}
      AND deleted_at IS NULL`;
  const notes = new Map<string, VarianceNoteRow>();
  for (const r of noteRows) {
    const row = rowToVarianceNote(r as Record<string, unknown>);
    notes.set(row.metricKey, row);
  }

  const labels: Record<string, string> = {
    revenue: "Revenue",
    gross_profit: "Gross profit",
    ebitda: "EBITDA",
  };
  const rows: VarianceRowResult[] = VARIANCE_METRICS.map((metric) => {
    const actual = actuals.get(metric) ?? null;
    const budget = budgets.get(metric) ?? null;
    const vc = vcTargets.get(metric) ?? null;
    const uw = uwByMetric[metric] ?? null;
    const vsBudget = varianceDelta(actual, budget);
    const vsVc = varianceDelta(actual, vc);
    const note = notes.get(metric) ?? null;
    return {
      metric,
      label: labels[metric],
      actual,
      budget,
      vc,
      vcTarget: vc,
      underwriting: uw,
      variance: vsBudget?.abs ?? vsVc?.abs ?? null,
      variances: {
        actualVsBudget: vsBudget,
        actualVsVc: vsVc,
        actualVsUnderwriting: uwComparable
          ? varianceDelta(actual, uw)
          : null,
      },
      commentary: note?.commentary ?? "",
      note,
    };
  });

  return {
    companyId,
    periodEnd: effectivePeriod,
    underwritingPeriodEnd: underwriting.periodEnd,
    underwriting,
    rows,
  };
}

export async function upsertVarianceNote(
  companyId: string,
  periodEnd: string,
  metricKey: string,
  commentary: string,
  actor: string
): Promise<VarianceNoteRow> {
  await ensureMonitoring();
  const period = requireDate(periodEnd);
  const metric = (metricKey ?? "").trim();
  if (!metric) throw new MonitoringError("invalid_metric");
  const db = sql();
  const existing = await db`
    SELECT id FROM monitoring.variance_notes
    WHERE company_id = ${companyId} AND period_end = ${period}
      AND metric_key = ${metric} AND deleted_at IS NULL LIMIT 1`;
  if (existing.length) {
    await db`
      UPDATE monitoring.variance_notes
      SET commentary = ${commentary ?? ""}, updated_by = ${actor},
          updated_at = now()
      WHERE id = ${str((existing[0] as Record<string, unknown>).id)}`;
  } else {
    await db`
      INSERT INTO monitoring.variance_notes
        (id, company_id, period_end, metric_key, commentary, updated_by)
      VALUES (${`monvar_${newId()}`}, ${companyId}, ${period}, ${metric},
        ${commentary ?? ""}, ${actor})`;
  }
  const rows = await db`
    SELECT * FROM monitoring.variance_notes
    WHERE company_id = ${companyId} AND period_end = ${period}
      AND metric_key = ${metric} AND deleted_at IS NULL LIMIT 1`;
  return rowToVarianceNote(rows[0] as Record<string, unknown>);
}

/* ============================ VC tracking ============================ */

export interface VcTrackingInitiative {
  initiativeId: string;
  title: string;
  name: string;
  status: string;
  category: string;
  ownerName: string;
  startDate: string | null;
  endDate: string | null;
  /** Raw planned EBITDA impact (initiative.ebitdaImpact), NOT
   * confidence-weighted — confidence is reported alongside. */
  plannedImpact: number | null;
  ebitdaImpact: number | null;
  /** plannedImpact × confidence, for reference only. */
  plannedWeightedImpact: number | null;
  confidence: number;
  realizedImpact: number | null;
  realizedPeriodEnd: string | null;
  realizedNotes: string;
}

export interface VcTrackingResult {
  companyId: string;
  planId: string | null;
  plan: unknown;
  initiatives: VcTrackingInitiative[];
  targets: Array<{
    periodLabel: string;
    periodEnd: string;
    metric: string;
    targetValue: number;
    source: string;
    updatedAt: string;
  }>;
  totals: {
    plannedImpact: number;
    plannedWeightedImpact: number;
    realizedImpact: number;
  };
}

/**
 * Value-creation tracking: plan + initiatives via the valuecreation
 * service (planned impact reported RAW alongside confidence — never
 * silently weighted), realized impact from monitoring.vc_realized
 * (per initiative, its latest reported period), and the plan targets
 * via getValueCreationTargets.
 */
export async function getVcTracking(
  companyId: string
): Promise<VcTrackingResult> {
  await ensureMonitoring();
  const plan = await getPlanByCompany(companyId).catch(() => null);
  const targetsResult = await getValueCreationTargets(companyId).catch(
    () => null
  );
  const db = sql();
  const realizedRows = await db`
    SELECT * FROM monitoring.vc_realized
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY period_end DESC NULLS LAST, updated_at DESC`;
  const realized = realizedRows.map((r) =>
    rowToVcRealized(r as Record<string, unknown>)
  );
  // Per initiative: rows at that initiative's latest period.
  const latestByInitiative = new Map<string, VcRealizedRow[]>();
  for (const row of realized) {
    const list = latestByInitiative.get(row.initiativeId) ?? [];
    if (!list.length) {
      latestByInitiative.set(row.initiativeId, [row]);
    } else if (list[0].periodEnd === row.periodEnd) {
      list.push(row);
    }
  }

  const initiatives: VcTrackingInitiative[] = [];
  if (plan) {
    const inits = await listInitiatives(plan.id).catch(() => []);
    for (const init of inits) {
      const rows = latestByInitiative.get(init.id) ?? [];
      const realizedImpact = rows.length
        ? rows.reduce((a, r) => a + (r.realizedImpact ?? 0), 0)
        : null;
      initiatives.push({
        initiativeId: init.id,
        title: init.title,
        name: init.title,
        status: init.status,
        category: init.category,
        ownerName: init.ownerName,
        startDate: init.startDate,
        endDate: init.endDate,
        plannedImpact: init.ebitdaImpact,
        ebitdaImpact: init.ebitdaImpact,
        plannedWeightedImpact:
          init.ebitdaImpact === null
            ? null
            : round2(init.ebitdaImpact * (init.confidence ?? 1)),
        confidence: init.confidence ?? 1,
        realizedImpact,
        realizedPeriodEnd: rows.length ? rows[0].periodEnd : null,
        realizedNotes: rows.length ? rows[0].notes : "",
      });
    }
  }

  return {
    companyId,
    planId: plan?.id ?? targetsResult?.planId ?? null,
    plan: plan ?? null,
    initiatives,
    targets: targetsResult?.targets ?? [],
    totals: {
      plannedImpact: initiatives.reduce(
        (a, i) => a + (i.plannedImpact ?? 0),
        0
      ),
      plannedWeightedImpact: initiatives.reduce(
        (a, i) => a + (i.plannedWeightedImpact ?? 0),
        0
      ),
      realizedImpact: initiatives.reduce(
        (a, i) => a + (i.realizedImpact ?? 0),
        0
      ),
    },
  };
}

export async function upsertVcRealized(
  companyId: string,
  initiativeId: string,
  periodEnd: string,
  realizedImpact: number,
  notes: string,
  actor: string
): Promise<VcRealizedRow> {
  void actor;
  await ensureMonitoring();
  const period = requireDate(periodEnd);
  if (typeof realizedImpact !== "number" || !isFinite(realizedImpact))
    throw new MonitoringError("invalid_amount");
  const init = await getInitiative(initiativeId).catch(() => null);
  if (!init) throw new MonitoringError("initiative_not_found");
  const plan = await getPlan(init.planId).catch(() => null);
  if (!plan || plan.companyId !== companyId)
    throw new MonitoringError("initiative_not_found");
  const db = sql();
  const existing = await db`
    SELECT id FROM monitoring.vc_realized
    WHERE company_id = ${companyId} AND initiative_id = ${initiativeId}
      AND period_end = ${period} AND deleted_at IS NULL LIMIT 1`;
  if (existing.length) {
    await db`
      UPDATE monitoring.vc_realized
      SET realized_impact = ${realizedImpact}, notes = ${notes ?? ""},
          updated_at = now()
      WHERE id = ${str((existing[0] as Record<string, unknown>).id)}`;
  } else {
    await db`
      INSERT INTO monitoring.vc_realized
        (id, company_id, initiative_id, period_end, realized_impact, notes)
      VALUES (${`monvcr_${newId()}`}, ${companyId}, ${initiativeId},
        ${period}, ${realizedImpact}, ${notes ?? ""})`;
  }
  const rows = await db`
    SELECT * FROM monitoring.vc_realized
    WHERE company_id = ${companyId} AND initiative_id = ${initiativeId}
      AND period_end = ${period} AND deleted_at IS NULL LIMIT 1`;
  return rowToVcRealized(rows[0] as Record<string, unknown>);
}

/* ========================= Cash & liquidity ========================== */

export interface CashResult {
  companyId: string;
  latest: CashPositionRow | null;
  /** Mirrors of `latest` at the top level (exports-layer access). */
  asOf: string | null;
  cashBalance: number | null;
  revolverLimit: number | null;
  revolverDrawn: number | null;
  revolverAvailable: number | null;
  /** Latest total_debt KPI (getter-sourced; null when unreported). */
  totalDebt: number | null;
  weeks: CashflowWeekRow[];
  totals: { inflows: number; outflows: number; net: number };
}

export async function getCash(companyId: string): Promise<CashResult> {
  await ensureMonitoring();
  const db = sql();
  const posRows = await db`
    SELECT * FROM monitoring.cash_positions
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY as_of DESC NULLS LAST, created_at DESC LIMIT 1`;
  const latest = posRows.length
    ? rowToCashPosition(posRows[0] as Record<string, unknown>)
    : null;
  const weekRows = await db`
    SELECT * FROM monitoring.cashflow_weeks
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY week_start DESC NULLS LAST LIMIT 13`;
  const weeks = weekRows
    .map((r) => rowToCashflowWeek(r as Record<string, unknown>))
    .reverse();
  const debtRows = await db`
    SELECT value FROM monitoring.kpi_values
    WHERE company_id = ${companyId} AND kpi_key = 'total_debt'
      AND deleted_at IS NULL
    ORDER BY period_end DESC NULLS LAST LIMIT 1`;
  const inflows = weeks.reduce((a, w) => a + (w.inflows ?? 0), 0);
  const outflows = weeks.reduce((a, w) => a + (w.outflows ?? 0), 0);
  return {
    companyId,
    latest,
    asOf: latest?.asOf ?? null,
    cashBalance: latest?.cashBalance ?? null,
    revolverLimit: latest?.revolverLimit ?? null,
    revolverDrawn: latest?.revolverDrawn ?? null,
    revolverAvailable: latest?.revolverAvailable ?? null,
    totalDebt: debtRows.length
      ? numOrNull((debtRows[0] as Record<string, unknown>).value)
      : null,
    weeks,
    totals: { inflows, outflows, net: inflows - outflows },
  };
}

export interface CashPositionInput {
  asOf: string;
  cashBalance: number;
  revolverLimit?: number | null;
  revolverDrawn?: number | null;
  source?: string;
  notes?: string;
}

/** Record a cash position snapshot (positions are point-in-time
 * snapshots — each call inserts a new row). */
export async function upsertCashPosition(
  companyId: string,
  input: CashPositionInput,
  actor: string
): Promise<CashPositionRow> {
  void actor;
  await ensureMonitoring();
  const asOf = requireDate(input.asOf, "invalid_date");
  if (
    typeof input.cashBalance !== "number" ||
    !isFinite(input.cashBalance)
  ) {
    throw new MonitoringError("invalid_amount");
  }
  for (const v of [input.revolverLimit, input.revolverDrawn]) {
    if (v !== undefined && v !== null && !isFinite(v))
      throw new MonitoringError("invalid_amount");
  }
  const db = sql();
  const id = `moncash_${newId()}`;
  await db`
    INSERT INTO monitoring.cash_positions
      (id, company_id, as_of, cash_balance, revolver_limit,
       revolver_drawn, source, notes)
    VALUES (${id}, ${companyId}, ${asOf}, ${input.cashBalance},
      ${input.revolverLimit ?? null}, ${input.revolverDrawn ?? null},
      ${(input.source ?? "manual").trim() || "manual"},
      ${input.notes ?? ""})`;
  const rows = await db`
    SELECT * FROM monitoring.cash_positions WHERE id = ${id} LIMIT 1`;
  return rowToCashPosition(rows[0] as Record<string, unknown>);
}

export interface CashflowWeekInput {
  weekStart: string;
  inflows: number | null;
  outflows: number | null;
  endingBalance: number | null;
}

/** Bulk upsert of 13-week cashflow rows (at most 13 per call). */
export async function upsertCashflowWeeks(
  companyId: string,
  weeks: CashflowWeekInput[],
  actor: string
): Promise<CashResult> {
  void actor;
  await ensureMonitoring();
  if (!Array.isArray(weeks) || !weeks.length || weeks.length > 13)
    throw new MonitoringError("invalid_weeks");
  for (const w of weeks) {
    requireDate(w.weekStart, "invalid_date");
    for (const v of [w.inflows, w.outflows, w.endingBalance]) {
      if (v !== null && (typeof v !== "number" || !isFinite(v)))
        throw new MonitoringError("invalid_amount");
    }
  }
  const db = sql();
  for (const w of weeks) {
    const weekStart = cleanDate(w.weekStart) as string;
    const existing = await db`
      SELECT id FROM monitoring.cashflow_weeks
      WHERE company_id = ${companyId} AND week_start = ${weekStart}
        AND deleted_at IS NULL LIMIT 1`;
    if (existing.length) {
      await db`
        UPDATE monitoring.cashflow_weeks
        SET inflows = ${w.inflows}, outflows = ${w.outflows},
            ending_balance = ${w.endingBalance}, updated_at = now()
        WHERE id = ${str((existing[0] as Record<string, unknown>).id)}`;
    } else {
      await db`
        INSERT INTO monitoring.cashflow_weeks
          (id, company_id, week_start, inflows, outflows, ending_balance)
        VALUES (${`moncfw_${newId()}`}, ${companyId}, ${weekStart},
          ${w.inflows}, ${w.outflows}, ${w.endingBalance})`;
    }
  }
  return getCash(companyId);
}

/* ================================ Aging ============================== */

export interface AgingResult {
  companyId: string;
  ar: AgingSnapshotRow | null;
  ap: AgingSnapshotRow | null;
  latestByKind: { ar: AgingSnapshotRow | null; ap: AgingSnapshotRow | null };
}

export async function getAging(companyId: string): Promise<AgingResult> {
  await ensureMonitoring();
  const db = sql();
  const latestFor = async (kind: string): Promise<AgingSnapshotRow | null> => {
    const rows = await db`
      SELECT * FROM monitoring.aging_snapshots
      WHERE company_id = ${companyId} AND kind = ${kind}
        AND deleted_at IS NULL
      ORDER BY as_of DESC NULLS LAST, created_at DESC LIMIT 1`;
    return rows.length
      ? rowToAging(rows[0] as Record<string, unknown>)
      : null;
  };
  const [ar, ap] = await Promise.all([latestFor("ar"), latestFor("ap")]);
  return { companyId, ar, ap, latestByKind: { ar, ap } };
}

export interface AgingSnapshotInput {
  asOf: string;
  kind: string;
  currentAmt: number | null;
  d31_60: number | null;
  d61_90: number | null;
  d90Plus: number | null;
  source?: string;
  documentId?: string | null;
  notes?: string;
}

export async function createAgingSnapshot(
  companyId: string,
  input: AgingSnapshotInput,
  actor: string
): Promise<AgingSnapshotRow> {
  void actor;
  await ensureMonitoring();
  const asOf = requireDate(input.asOf, "invalid_date");
  if (!(AGING_KINDS as readonly string[]).includes(input.kind ?? ""))
    throw new MonitoringError("invalid_kind");
  const source = (input.source ?? "manual").trim() || "manual";
  if (source !== "manual" && source !== "upload")
    throw new MonitoringError("invalid_source");
  for (const v of [input.currentAmt, input.d31_60, input.d61_90, input.d90Plus]) {
    if (v !== null && (typeof v !== "number" || !isFinite(v)))
      throw new MonitoringError("invalid_amount");
  }
  const db = sql();
  const id = `monage_${newId()}`;
  await db`
    INSERT INTO monitoring.aging_snapshots
      (id, company_id, as_of, kind, current_amt, d31_60, d61_90,
       d90_plus, source, document_id, notes)
    VALUES (${id}, ${companyId}, ${asOf}, ${input.kind},
      ${input.currentAmt}, ${input.d31_60}, ${input.d61_90},
      ${input.d90Plus}, ${source}, ${input.documentId ?? null},
      ${input.notes ?? ""})`;
  const rows = await db`
    SELECT * FROM monitoring.aging_snapshots WHERE id = ${id} LIMIT 1`;
  return rowToAging(rows[0] as Record<string, unknown>);
}

/* ============================ Debt tranches ========================== */

export interface DebtResult {
  companyId: string;
  tranches: DebtTrancheRow[];
  totals: { principal: number; currentBalance: number; count: number };
}

export async function listDebtTranches(
  companyId: string
): Promise<DebtResult> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.debt_tranches
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY maturity ASC NULLS LAST, created_at ASC`;
  const tranches = rows.map((r) =>
    rowToTranche(r as Record<string, unknown>)
  );
  return {
    companyId,
    tranches,
    totals: {
      principal: tranches.reduce((a, t) => a + (t.principal ?? 0), 0),
      currentBalance: tranches.reduce(
        (a, t) => a + (t.currentBalance ?? 0),
        0
      ),
      count: tranches.length,
    },
  };
}

/** Alias matching the exports-layer getter naming. */
export const getDebt = listDebtTranches;

export interface DebtTrancheInput {
  lender?: string;
  kind?: string;
  principal?: number | null;
  currentBalance?: number | null;
  ratePct?: number | null;
  maturity?: string | null;
  notes?: string;
}

function validMoneyField(v: number | null | undefined): void {
  if (v !== undefined && v !== null && !isFinite(v))
    throw new MonitoringError("invalid_amount");
}

export async function createDebtTranche(
  companyId: string,
  input: DebtTrancheInput,
  actor: string
): Promise<DebtTrancheRow> {
  void actor;
  await ensureMonitoring();
  const lender = (input.lender ?? "").trim();
  if (!lender) throw new MonitoringError("lender_required");
  validMoneyField(input.principal);
  validMoneyField(input.currentBalance);
  validMoneyField(input.ratePct);
  const maturity =
    input.maturity === undefined || input.maturity === null
      ? null
      : requireDate(input.maturity, "invalid_date");
  const db = sql();
  const id = `montr_${newId()}`;
  await db`
    INSERT INTO monitoring.debt_tranches
      (id, company_id, lender, kind, principal, current_balance,
       rate_pct, maturity, notes)
    VALUES (${id}, ${companyId}, ${lender}, ${(input.kind ?? "").trim()},
      ${input.principal ?? null},
      ${input.currentBalance !== undefined ? input.currentBalance : (input.principal ?? null)},
      ${input.ratePct ?? null}, ${maturity}, ${input.notes ?? ""})`;
  const rows = await db`
    SELECT * FROM monitoring.debt_tranches WHERE id = ${id} LIMIT 1`;
  return rowToTranche(rows[0] as Record<string, unknown>);
}

export async function updateDebtTranche(
  companyId: string,
  trancheId: string,
  patch: DebtTrancheInput,
  actor: string
): Promise<DebtTrancheRow> {
  void actor;
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.debt_tranches
    WHERE id = ${trancheId} AND company_id = ${companyId}
      AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new MonitoringError("tranche_not_found");
  const cur = rowToTranche(rows[0] as Record<string, unknown>);
  validMoneyField(patch.principal);
  validMoneyField(patch.currentBalance);
  validMoneyField(patch.ratePct);
  const maturity =
    patch.maturity !== undefined
      ? patch.maturity === null
        ? null
        : requireDate(patch.maturity, "invalid_date")
      : cur.maturity;
  await db`
    UPDATE monitoring.debt_tranches
    SET lender = ${patch.lender !== undefined ? patch.lender.trim() : cur.lender},
        kind = ${patch.kind !== undefined ? patch.kind : cur.kind},
        principal = ${patch.principal !== undefined ? patch.principal : cur.principal},
        current_balance = ${patch.currentBalance !== undefined ? patch.currentBalance : cur.currentBalance},
        rate_pct = ${patch.ratePct !== undefined ? patch.ratePct : cur.ratePct},
        maturity = ${maturity},
        notes = ${patch.notes !== undefined ? patch.notes : cur.notes},
        updated_at = now()
    WHERE id = ${trancheId}`;
  const after = await db`
    SELECT * FROM monitoring.debt_tranches WHERE id = ${trancheId} LIMIT 1`;
  return rowToTranche(after[0] as Record<string, unknown>);
}

export async function deleteDebtTranche(
  companyId: string,
  trancheId: string,
  actor: string
): Promise<boolean> {
  void actor;
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    UPDATE monitoring.debt_tranches
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${trancheId} AND company_id = ${companyId}
      AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* ============================= Covenants ============================= */

export const COVENANT_LABELS: Record<string, string> = {
  max_total_leverage: "Max total leverage",
  min_ebitda: "Min EBITDA",
  min_cash: "Min cash",
  min_current_ratio: "Min current ratio",
};

export interface CovenantInput {
  trancheId?: string | null;
  covenantKey?: string;
  label?: string;
  operator?: string;
  threshold?: number | null;
  nextTestDate?: string | null;
  active?: boolean;
}

function validCovenantFields(input: CovenantInput): void {
  if (
    input.covenantKey !== undefined &&
    !(COVENANT_KEYS as readonly string[]).includes(input.covenantKey)
  ) {
    throw new MonitoringError("invalid_covenant_key");
  }
  if (
    input.operator !== undefined &&
    !(COVENANT_OPERATORS as readonly string[]).includes(input.operator)
  ) {
    throw new MonitoringError("invalid_operator");
  }
  if (
    input.threshold !== undefined &&
    input.threshold !== null &&
    !isFinite(input.threshold)
  ) {
    throw new MonitoringError("invalid_threshold");
  }
}

export async function createCovenant(
  companyId: string,
  input: CovenantInput,
  actor: string
): Promise<CovenantRow> {
  void actor;
  await ensureMonitoring();
  validCovenantFields(input);
  const covenantKey = (input.covenantKey ?? "").trim();
  if (!covenantKey) throw new MonitoringError("invalid_covenant_key");
  const operator = input.operator ?? (covenantKey === "max_total_leverage" ? "<=" : ">=");
  if (!(COVENANT_OPERATORS as readonly string[]).includes(operator))
    throw new MonitoringError("invalid_operator");
  if (typeof input.threshold !== "number" || !isFinite(input.threshold))
    throw new MonitoringError("invalid_threshold");
  const nextTestDate =
    input.nextTestDate === undefined || input.nextTestDate === null
      ? null
      : requireDate(input.nextTestDate, "invalid_date");
  const db = sql();
  const id = `moncov_${newId()}`;
  await db`
    INSERT INTO monitoring.covenants
      (id, company_id, tranche_id, covenant_key, label, operator,
       threshold, next_test_date, active)
    VALUES (${id}, ${companyId}, ${input.trancheId ?? null}, ${covenantKey},
      ${(input.label ?? "").trim() || COVENANT_LABELS[covenantKey] || covenantKey},
      ${operator}, ${input.threshold}, ${nextTestDate},
      ${input.active !== undefined ? Boolean(input.active) : true})`;
  const rows = await db`
    SELECT * FROM monitoring.covenants WHERE id = ${id} LIMIT 1`;
  return rowToCovenant(rows[0] as Record<string, unknown>);
}

export async function updateCovenant(
  companyId: string,
  covenantId: string,
  patch: CovenantInput,
  actor: string
): Promise<CovenantRow> {
  void actor;
  await ensureMonitoring();
  validCovenantFields(patch);
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.covenants
    WHERE id = ${covenantId} AND company_id = ${companyId}
      AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new MonitoringError("covenant_not_found");
  const cur = rowToCovenant(rows[0] as Record<string, unknown>);
  const nextTestDate =
    patch.nextTestDate !== undefined
      ? patch.nextTestDate === null
        ? null
        : requireDate(patch.nextTestDate, "invalid_date")
      : cur.nextTestDate;
  await db`
    UPDATE monitoring.covenants
    SET tranche_id = ${patch.trancheId !== undefined ? patch.trancheId : cur.trancheId},
        covenant_key = ${patch.covenantKey !== undefined ? patch.covenantKey : cur.covenantKey},
        label = ${patch.label !== undefined ? patch.label : cur.label},
        operator = ${patch.operator !== undefined ? patch.operator : cur.operator},
        threshold = ${patch.threshold !== undefined ? patch.threshold : cur.threshold},
        next_test_date = ${nextTestDate},
        active = ${patch.active !== undefined ? Boolean(patch.active) : cur.active},
        updated_at = now()
    WHERE id = ${covenantId}`;
  const after = await db`
    SELECT * FROM monitoring.covenants WHERE id = ${covenantId} LIMIT 1`;
  return rowToCovenant(after[0] as Record<string, unknown>);
}

export interface CovenantsResult {
  companyId: string;
  covenants: Array<CovenantRow & { latestTest: CovenantTestRow | null }>;
  /** Latest test per covenant, enriched with the covenant label
   * (the exports layer's covenant table reads this list). */
  tests: Array<CovenantTestRow & { label: string; covenantKey: string }>;
}

export async function getCovenants(
  companyId: string
): Promise<CovenantsResult> {
  await ensureMonitoring();
  const db = sql();
  const covRows = await db`
    SELECT * FROM monitoring.covenants
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY created_at ASC`;
  const covenants = covRows.map((r) =>
    rowToCovenant(r as Record<string, unknown>)
  );
  const testRows = await db`
    SELECT * FROM monitoring.covenant_tests
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY period_end DESC NULLS LAST, computed_at DESC NULLS LAST,
      created_at DESC`;
  const allTests = testRows.map((r) =>
    rowToTest(r as Record<string, unknown>)
  );
  const latestByCovenant = new Map<string, CovenantTestRow>();
  for (const t of allTests) {
    if (!latestByCovenant.has(t.covenantId)) {
      latestByCovenant.set(t.covenantId, t);
    }
  }
  return {
    companyId,
    covenants: covenants.map((c) => ({
      ...c,
      latestTest: latestByCovenant.get(c.id) ?? null,
    })),
    tests: covenants
      .map((c) => {
        const t = latestByCovenant.get(c.id);
        return t ? { ...t, label: c.label, covenantKey: c.covenantKey } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null),
  };
}

/** All covenant tests for the company, newest first, enriched with
 * covenant label / key. */
export async function getCovenantTests(
  companyId: string
): Promise<{
  companyId: string;
  tests: Array<CovenantTestRow & { label: string; covenantKey: string }>;
}> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT t.*, coalesce(c.label, '') AS cov_label,
      coalesce(c.covenant_key, '') AS cov_key
    FROM monitoring.covenant_tests t
    LEFT JOIN monitoring.covenants c ON c.id = t.covenant_id
    WHERE t.company_id = ${companyId} AND t.deleted_at IS NULL
    ORDER BY t.period_end DESC NULLS LAST, t.created_at DESC
    LIMIT 200`;
  return {
    companyId,
    tests: rows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        ...rowToTest(rec),
        label: str(rec.cov_label),
        covenantKey: str(rec.cov_key),
      };
    }),
  };
}

/* ------------------------- covenant computation ---------------------- */

export interface CovenantSkipped {
  covenantId: string;
  covenantKey: string;
  reason: "not_computable";
  missing: string[];
}

export interface CovenantComputeResult {
  tests: CovenantTestRow[];
  skipped: CovenantSkipped[];
}

/**
 * Compute covenant tests for one period from the latest CURRENT
 * posted reported set with period_end ≤ periodEnd (financials
 * service ONLY):
 *   max_total_leverage = (current_debt + long_term_debt) / ebitda
 *   min_ebitda         = ebitda
 *   min_cash           = cash
 *   min_current_ratio  = total_current_assets / total_current_liabilities
 * Missing inputs skip the covenant with a 'not_computable' note —
 * never a fabricated value. headroom_pct: '<=' →
 * (threshold − value) / |threshold| × 100; '>=' → (value −
 * threshold) / |threshold| × 100 (null when threshold is 0).
 * status = pass when the value satisfies the operator, else fail.
 * A fail publishes covenant_breached (ids + key ONLY — no figures)
 * and creates a covenant_breach alert (dedupe
 * `cov:<covenantId>:<periodEnd>`); a pass with headroom below the
 * covenant_headroom rule's minHeadroomPct (default 10) creates a
 * warning alert (dedupe `headroom:<covenantId>:<periodEnd>`).
 * Rollups refresh afterwards via WS-A's refreshRollups.
 */
export async function computeCovenantTests(
  companyId: string,
  periodEnd: string,
  actor: string
): Promise<CovenantComputeResult> {
  await ensureMonitoring();
  const period = requireDate(periodEnd);
  const db = sql();
  const covRows = await db`
    SELECT * FROM monitoring.covenants
    WHERE company_id = ${companyId} AND deleted_at IS NULL
      AND active = true
    ORDER BY created_at ASC`;
  const covenants = covRows.map((r) =>
    rowToCovenant(r as Record<string, unknown>)
  );
  const tests: CovenantTestRow[] = [];
  const skipped: CovenantSkipped[] = [];
  if (!covenants.length) return { tests, skipped };

  // Latest posted set with period_end ≤ requested period.
  let chosen: { id: string; periodEnd: string } | null = null;
  let offset = 0;
  const candidates: Array<{ id: string; periodEnd: string }> = [];
  for (;;) {
    const page = await listSets({
      companyId,
      status: "posted",
      layer: "reported",
      limit: 50,
      offset,
    });
    for (const s of page.items) {
      if (s.isCurrent && s.periodEnd && s.periodEnd <= period) {
        candidates.push({ id: s.id, periodEnd: s.periodEnd });
      }
    }
    offset += page.items.length;
    if (!page.items.length || offset >= page.total) break;
  }
  candidates.sort((a, b) =>
    b.periodEnd < a.periodEnd ? -1 : b.periodEnd > a.periodEnd ? 1 : 0
  );
  chosen = candidates.length ? candidates[0] : null;

  if (!chosen) {
    for (const c of covenants) {
      skipped.push({
        covenantId: c.id,
        covenantKey: c.covenantKey,
        reason: "not_computable",
        missing: ["posted_statement_set"],
      });
    }
    return { tests, skipped };
  }

  const got = await getSet(chosen.id);
  const lines: StatementLine[] = got?.lines ?? [];
  const val = (kind: string, key: string): number | null => {
    const hit = lines.find(
      (l) => l.statementKind === kind && l.lineKey === key
    );
    if (hit && hit.value !== null) return hit.value;
    const anyKind = lines.find((l) => l.lineKey === key);
    return anyKind ? anyKind.value : null;
  };
  const inputs: Record<string, number | null> = {
    ebitda: val("is", "ebitda"),
    cash: val("bs", "cash"),
    current_debt: val("bs", "current_debt"),
    long_term_debt: val("bs", "long_term_debt"),
    total_current_assets: val("bs", "total_current_assets"),
    total_current_liabilities: val("bs", "total_current_liabilities"),
  };

  const headroomRule = await resolveAlertRule(companyId, "covenant_headroom");
  const minHeadroomPct =
    typeof headroomRule.params.minHeadroomPct === "number"
      ? headroomRule.params.minHeadroomPct
      : 10;

  for (const cov of covenants) {
    const threshold = cov.threshold;
    if (threshold === null) {
      skipped.push({
        covenantId: cov.id,
        covenantKey: cov.covenantKey,
        reason: "not_computable",
        missing: ["threshold"],
      });
      continue;
    }
    let value: number | null = null;
    const used: Record<string, number | null> = {};
    const missing: string[] = [];
    if (cov.covenantKey === "max_total_leverage") {
      const cd = inputs.current_debt;
      const ltd = inputs.long_term_debt;
      const ebitda = inputs.ebitda;
      if (cd === null && ltd === null) missing.push("current_debt", "long_term_debt");
      if (ebitda === null || ebitda === 0) missing.push("ebitda");
      if (!missing.length) {
        value = ((cd ?? 0) + (ltd ?? 0)) / (ebitda as number);
        used.current_debt = cd;
        used.long_term_debt = ltd;
        used.ebitda = ebitda;
      }
    } else if (cov.covenantKey === "min_ebitda") {
      if (inputs.ebitda === null) missing.push("ebitda");
      else {
        value = inputs.ebitda;
        used.ebitda = inputs.ebitda;
      }
    } else if (cov.covenantKey === "min_cash") {
      if (inputs.cash === null) missing.push("cash");
      else {
        value = inputs.cash;
        used.cash = inputs.cash;
      }
    } else if (cov.covenantKey === "min_current_ratio") {
      const tca = inputs.total_current_assets;
      const tcl = inputs.total_current_liabilities;
      if (tca === null) missing.push("total_current_assets");
      if (tcl === null || tcl === 0) missing.push("total_current_liabilities");
      if (!missing.length) {
        value = (tca as number) / (tcl as number);
        used.total_current_assets = tca;
        used.total_current_liabilities = tcl;
      }
    } else {
      missing.push("covenant_key");
    }
    if (value === null || missing.length) {
      skipped.push({
        covenantId: cov.id,
        covenantKey: cov.covenantKey,
        reason: "not_computable",
        missing,
      });
      continue;
    }

    const passes =
      cov.operator === "<=" ? value <= threshold : value >= threshold;
    const headroomPct =
      threshold === 0
        ? null
        : round2(
            ((cov.operator === "<="
              ? threshold - value
              : value - threshold) /
              Math.abs(threshold)) *
              100
          );
    const status = passes ? "pass" : "fail";
    const testId = `montest_${newId()}`;
    const detail = {
      inputs: used,
      setId: chosen.id,
      setPeriodEnd: chosen.periodEnd,
      periodEnd: period,
    };
    await db`
      INSERT INTO monitoring.covenant_tests
        (id, company_id, covenant_id, period_end, computed_value,
         threshold, headroom_pct, status, detail, computed_at)
      VALUES (${testId}, ${companyId}, ${cov.id}, ${period}, ${value},
        ${threshold}, ${headroomPct}, ${status},
        ${JSON.stringify(detail)}::jsonb, now())`;
    const testRows = await db`
      SELECT * FROM monitoring.covenant_tests WHERE id = ${testId} LIMIT 1`;
    const test = rowToTest(testRows[0] as Record<string, unknown>);
    tests.push(test);

    if (!passes) {
      await publishEvent("covenant_breached", {
        entityKind: "company",
        entityId: companyId,
        actor,
        payload: {
          companyId,
          covenantId: cov.id,
          testId,
          covenantKey: cov.covenantKey,
        },
      });
      await createAlert({
        companyId,
        ruleKey: "covenant_breach",
        severity: "critical",
        title: `Covenant breached — ${cov.label || cov.covenantKey}`,
        detail:
          `${cov.label || cov.covenantKey} failed for period ending ${period}: ` +
          `computed ${round4(value)} vs threshold ${threshold} (${cov.operator}).`,
        dedupeKey: `cov:${cov.id}:${period}`,
      }).catch((err) => {
        console.error(
          "[monitoring] covenant_breach alert failed",
          err instanceof Error ? err.message : String(err)
        );
      });
    } else if (
      headroomPct !== null &&
      headroomPct < minHeadroomPct &&
      headroomRule.enabled
    ) {
      await createAlert({
        companyId,
        ruleKey: "covenant_headroom",
        severity: "warning",
        title: `Covenant headroom low — ${cov.label || cov.covenantKey}`,
        detail:
          `${cov.label || cov.covenantKey} passed for period ending ${period} ` +
          `with headroom ${headroomPct}% (minimum ${minHeadroomPct}%).`,
        dedupeKey: `headroom:${cov.id}:${period}`,
      }).catch((err) => {
        console.error(
          "[monitoring] covenant_headroom alert failed",
          err instanceof Error ? err.message : String(err)
        );
      });
    }
  }

  try {
    await refreshRollups();
  } catch (err) {
    console.error(
      "[monitoring] refreshRollups failed after covenant tests",
      err instanceof Error ? err.message : String(err)
    );
  }
  return { tests, skipped };
}

/* ============================= Alert rules =========================== */

const DEFAULT_RULE_PARAMS: Record<string, Record<string, unknown>> = {
  kpi_miss: { thresholdPct: 10, metrics: ["revenue", "ebitda"] },
  covenant_headroom: { minHeadroomPct: 10 },
  late_reporting: { graceDays: 0 },
};

export interface ResolvedAlertRule {
  ruleKey: string;
  enabled: boolean;
  params: Record<string, unknown>;
  /** Where the winning values came from. */
  source: "company" | "global" | "default";
}

/**
 * Resolve one alert rule for a company: the company-specific row
 * (company_id = companyId) overrides the global row (company_id
 * NULL), which overrides the built-in defaults. Params merge
 * shallowly in the same order.
 */
export async function resolveAlertRule(
  companyId: string,
  ruleKey: string
): Promise<ResolvedAlertRule> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT * FROM monitoring.alert_rules
    WHERE rule_key = ${ruleKey} AND deleted_at IS NULL
      AND (company_id IS NULL OR company_id = ${companyId})`;
  const parsed = rows.map((r) =>
    rowToAlertRule(r as Record<string, unknown>)
  );
  const global = parsed.find((r) => r.companyId === null) ?? null;
  const company = parsed.find((r) => r.companyId === companyId) ?? null;
  const params: Record<string, unknown> = {
    ...(DEFAULT_RULE_PARAMS[ruleKey] ?? {}),
    ...(global?.params ?? {}),
    ...(company?.params ?? {}),
  };
  return {
    ruleKey,
    enabled: company?.enabled ?? global?.enabled ?? true,
    params,
    source: company ? "company" : global ? "global" : "default",
  };
}

/** Merged alert-rule view for a company (every known rule key plus
 * any key with a stored row). */
export async function getAlertRules(
  companyId: string
): Promise<{
  companyId: string;
  rules: ResolvedAlertRule[];
}> {
  await ensureMonitoring();
  const db = sql();
  const rows = await db`
    SELECT DISTINCT rule_key FROM monitoring.alert_rules
    WHERE deleted_at IS NULL
      AND (company_id IS NULL OR company_id = ${companyId})`;
  const keys = new Set<string>([
    ...(ALERT_RULE_KEYS as readonly string[]),
    "covenant_breach",
  ]);
  for (const r of rows) {
    const k = str((r as Record<string, unknown>).rule_key);
    if (k) keys.add(k);
  }
  const rules: ResolvedAlertRule[] = [];
  for (const key of Array.from(keys)) {
    rules.push(await resolveAlertRule(companyId, key));
  }
  return { companyId, rules };
}

/**
 * Upsert an alert rule. companyId null writes the GLOBAL row
 * (company_id NULL); a company id writes that company's override.
 */
export async function upsertAlertRule(
  companyId: string | null,
  ruleKey: string,
  enabled: boolean,
  params: Record<string, unknown>,
  actor: string
): Promise<AlertRuleRow> {
  void actor;
  await ensureMonitoring();
  const key = (ruleKey ?? "").trim();
  if (!key) throw new MonitoringError("invalid_rule_key");
  const db = sql();
  const existing =
    companyId === null
      ? await db`
          SELECT * FROM monitoring.alert_rules
          WHERE rule_key = ${key} AND company_id IS NULL
            AND deleted_at IS NULL LIMIT 1`
      : await db`
          SELECT * FROM monitoring.alert_rules
          WHERE rule_key = ${key} AND company_id = ${companyId}
            AND deleted_at IS NULL LIMIT 1`;
  if (existing.length) {
    const cur = rowToAlertRule(existing[0] as Record<string, unknown>);
    const merged = { ...cur.params, ...(params ?? {}) };
    await db`
      UPDATE monitoring.alert_rules
      SET enabled = ${Boolean(enabled)},
          params = ${JSON.stringify(merged)}::jsonb, updated_at = now()
      WHERE id = ${cur.id}`;
    const after = await db`
      SELECT * FROM monitoring.alert_rules WHERE id = ${cur.id} LIMIT 1`;
    return rowToAlertRule(after[0] as Record<string, unknown>);
  }
  const id = `monrule_${newId()}`;
  await db`
    INSERT INTO monitoring.alert_rules
      (id, company_id, rule_key, enabled, params)
    VALUES (${id}, ${companyId}, ${key}, ${Boolean(enabled)},
      ${JSON.stringify(params ?? {})}::jsonb)`;
  const rows = await db`
    SELECT * FROM monitoring.alert_rules WHERE id = ${id} LIMIT 1`;
  return rowToAlertRule(rows[0] as Record<string, unknown>);
}

/* ============================ KPI alerts ============================= */

export interface KpiAlertEvalResult {
  companyId: string;
  periodEnd: string | null;
  checked: number;
  alertsCreated: number;
  reason?: string;
}

/**
 * Evaluate the kpi_miss rule for the company's LATEST KPI period:
 * for each configured metric (default revenue + ebitda) with both an
 * actual (kpi_values) and a VC target for that exact period end
 * (getValueCreationTargets), an actual below
 * target × (1 − thresholdPct/100) creates a kpi_miss alert via
 * WS-A's createAlert (dedupe `kpi:<companyId>:<metric>:<periodEnd>`).
 * Alert detail carries the figures (alerts are internal records);
 * no event is published, so no figure leaves via an event payload.
 */
export async function evaluateKpiAlerts(
  companyId: string
): Promise<KpiAlertEvalResult> {
  await ensureMonitoring();
  const rule = await resolveAlertRule(companyId, "kpi_miss");
  if (!rule.enabled) {
    return {
      companyId,
      periodEnd: null,
      checked: 0,
      alertsCreated: 0,
      reason: "rule_disabled",
    };
  }
  const thresholdPct =
    typeof rule.params.thresholdPct === "number"
      ? rule.params.thresholdPct
      : 10;
  const metrics = Array.isArray(rule.params.metrics)
    ? rule.params.metrics.map((m) => String(m)).filter(Boolean)
    : ["revenue", "ebitda"];

  const db = sql();
  const latestRows = await db`
    SELECT period_end FROM monitoring.kpi_values
    WHERE company_id = ${companyId} AND deleted_at IS NULL
      AND period_end IS NOT NULL AND kpi_key = ANY(${metrics})
    ORDER BY period_end DESC LIMIT 1`;
  const periodEnd = latestRows.length
    ? dateOrNull((latestRows[0] as Record<string, unknown>).period_end)
    : null;
  if (!periodEnd) {
    return {
      companyId,
      periodEnd: null,
      checked: 0,
      alertsCreated: 0,
      reason: "no_kpi_period",
    };
  }
  const actualRows = await db`
    SELECT * FROM monitoring.kpi_values
    WHERE company_id = ${companyId} AND period_end = ${periodEnd}
      AND deleted_at IS NULL`;
  const actuals = new Map<string, number | null>();
  for (const r of actualRows) {
    const row = rowToKpi(r as Record<string, unknown>);
    actuals.set(row.kpiKey, row.value);
  }
  const vcResult = await getValueCreationTargets(
    companyId,
    periodEnd
  ).catch(() => ({ targets: [] as Array<{
    periodEnd: string;
    metric: string;
    targetValue: number;
  }> }));
  const targets = new Map<string, number>();
  for (const t of vcResult.targets ?? []) {
    if (t.periodEnd === periodEnd) targets.set(t.metric, t.targetValue);
  }

  let checked = 0;
  let alertsCreated = 0;
  for (const metric of metrics) {
    const actual = actuals.get(metric) ?? null;
    const target = targets.get(metric) ?? null;
    if (actual === null || target === null) continue;
    checked += 1;
    const floor = target * (1 - thresholdPct / 100);
    if (actual < floor) {
      try {
        await createAlert({
          companyId,
          ruleKey: "kpi_miss",
          severity: "warning",
          title: `KPI miss — ${metric} (${periodEnd})`,
          detail:
            `${metric} for period ending ${periodEnd} missed the ` +
            `value-creation target by more than ${thresholdPct}% ` +
            `(actual ${actual}, target ${target}).`,
          dedupeKey: `kpi:${companyId}:${metric}:${periodEnd}`,
        });
        alertsCreated += 1;
      } catch (err) {
        console.error(
          "[monitoring] kpi_miss alert failed",
          err instanceof Error ? err.message : String(err)
        );
      }
    }
  }
  return { companyId, periodEnd, checked, alertsCreated };
}

/* ========================= Alert list / status ======================= */

/**
 * Alerts for a company via WS-A's listAlerts(companyId, status)
 * (returns AlertRow[], newest first, capped at 100 by the service;
 * limit/offset are applied here). Normalized to the { items, total }
 * list shape. Status values follow schema ALERT_STATUSES:
 * open | acked | resolved.
 */
export async function listCompanyAlerts(
  companyId: string,
  opts: { status?: string; limit?: number; offset?: number } = {}
): Promise<{ items: unknown[]; total: number }> {
  const rows = await listAlerts(companyId, opts.status);
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  return {
    items: rows.slice(offset, offset + limit),
    total: rows.length,
  };
}

/** Exports-layer alias. */
export const getAlerts = listCompanyAlerts;

export async function getOpenAlerts(
  companyId: string
): Promise<{ items: unknown[]; total: number }> {
  return listCompanyAlerts(companyId, { status: "open", limit: 50 });
}

const ALERT_STATUS_ALIASES: Record<string, string> = {
  open: "open",
  reopen: "open",
  ack: "acked",
  acked: "acked",
  acknowledge: "acked",
  acknowledged: "acked",
  resolve: "resolved",
  resolved: "resolved",
};

/** Ack / resolve / reopen an alert via WS-A's setAlertStatus. */
export async function updateAlertStatus(
  alertId: string,
  status: string,
  actor: string
): Promise<unknown> {
  const mapped = ALERT_STATUS_ALIASES[(status ?? "").trim().toLowerCase()];
  if (!mapped) throw new MonitoringError("invalid_status");
  return setAlertStatus(alertId, mapped, actor);
}

/* ------------------------- event registration ------------------------ */
/**
 * On financials_posted for a LIVE portfolio company: refresh its
 * KPIs from the newly posted financials, then evaluate KPI alerts.
 * (WS-A's receiveReport path calls the same two functions directly
 * for reporting_received.) Registered once per process, mirroring
 * lib/capital/service.ts.
 */
let monitoringAnalyticsHandlerRegistered = false;
function registerMonitoringAnalyticsHandlers(): void {
  if (monitoringAnalyticsHandlerRegistered) return;
  monitoringAnalyticsHandlerRegistered = true;
  onEvent("financials_posted", async (evt) => {
    if (evt.entityKind && evt.entityKind !== "company") return;
    const payload = evt.payload ?? {};
    const companyId =
      typeof payload.companyId === "string" && payload.companyId
        ? payload.companyId
        : evt.entityId;
    if (!companyId) return;
    try {
      const pc = await getPortfolioCompany(companyId).catch(
        () => null
      );
      if (!pc) return; // not a live portfolio company — nothing to do
      await refreshKpisFromFinancials(companyId);
      await evaluateKpiAlerts(companyId);
    } catch (err) {
      console.error(
        "[monitoring] financials_posted analytics handler failed for company",
        companyId,
        err instanceof Error ? err.message : String(err)
      );
    }
  });
}
registerMonitoringAnalyticsHandlers();
