import { sql, newId, str, numOrNull, isoOrNull } from "../platform/db";
import { onEvent } from "../platform/events";
import { ensureValueCreation } from "./schema";
import { VcError, requirePlan } from "./service";
import { getCompanyFinancials } from "../financials/service";

/**
 * Scenario modeling (Phase 6, WS-B) — EBITDA bridge scenarios per plan.
 *
 * Table is WS-A's (lib/valuecreation/schema.ts ensureValueCreation):
 *   valuecreation.scenarios(id, plan_id, name, is_default, base_set_id,
 *     base_period_end, base_revenue, base_ebitda, assumptions jsonb,
 *     bridge jsonb, computed_at, timestamps, deleted_at)
 *
 * Boundary rules honored:
 * - The scenario BASE is a snapshot taken at creation from the
 *   financials service ONLY (getCompanyFinancials → summary.ttm ??
 *   summary.latest). Recomputes never re-base: they re-run the bridge
 *   over the plan's CURRENT initiatives against the stored snapshot.
 * - Initiative impacts are read from this module's own schema
 *   (valuecreation.initiatives) — same-module SQL, no cross-module
 *   queries. Financial data never comes from SQL here.
 * - WS-A's service dynamically imports refreshScenariosForPlan from
 *   this module; an initiative_updated event for the plan triggers the
 *   same refresh (registered once at module scope below).
 */

export interface ScenarioAssumptions {
  horizonMonths: number;
  revenueGrowthPct: number;
  realizationPct: number;
}

export const DEFAULT_ASSUMPTIONS: ScenarioAssumptions = {
  horizonMonths: 12,
  revenueGrowthPct: 0,
  realizationPct: 100,
};

export interface BridgeRow {
  initiativeId: string;
  title: string;
  /** Unweighted EBITDA impact (dollars). */
  impact: number;
  /** impact × confidence. */
  weightedImpact: number;
  /** Confidence as a 0–1 fraction (the value used in the weighting). */
  confidence: number;
}

export interface ScenarioBridge {
  baseRevenue: number;
  baseEbitda: number;
  basePeriodEnd: string | null;
  rows: BridgeRow[];
  totalImpact: number;
  totalWeightedImpact: number;
  adjustedEbitda: number;
  adjustedWeightedEbitda: number;
  revenueScenario: {
    growthPct: number;
    revenueAtGrowth: number;
    ebitdaAtGrowth: number;
  };
  realizationSensitivity: Array<{ pct: number; ebitda: number }>;
  computedAt: string;
}

export interface ScenarioRow {
  id: string;
  planId: string;
  name: string;
  isDefault: boolean;
  baseSetId: string | null;
  basePeriodEnd: string | null;
  baseRevenue: number | null;
  baseEbitda: number | null;
  assumptions: ScenarioAssumptions;
  bridge: ScenarioBridge | null;
  computedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScenarioListRow extends Omit<ScenarioRow, "bridge"> {
  totals: {
    totalImpact: number;
    totalWeightedImpact: number;
    adjustedEbitda: number;
    adjustedWeightedEbitda: number;
  } | null;
}

/* ------------------------------- helpers ------------------------------ */

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function dateOnly(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function parseJsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}

function toAssumptions(v: unknown): ScenarioAssumptions {
  const obj = parseJsonObj(v);
  const n = (x: unknown, fallback: number): number => {
    const parsed = numOrNull(x);
    return parsed === null ? fallback : parsed;
  };
  return {
    horizonMonths: n(obj.horizonMonths, DEFAULT_ASSUMPTIONS.horizonMonths),
    revenueGrowthPct: n(obj.revenueGrowthPct, DEFAULT_ASSUMPTIONS.revenueGrowthPct),
    realizationPct: n(obj.realizationPct, DEFAULT_ASSUMPTIONS.realizationPct),
  };
}

function toBridge(v: unknown): ScenarioBridge | null {
  const obj = parseJsonObj(v);
  if (!Object.keys(obj).length) return null;
  return obj as unknown as ScenarioBridge;
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(`${dateStr}T00:00:00.000Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

/**
 * Initiatives store confidence as a 0–1 fraction (schema default 1).
 * Values > 1 are read as percents defensively and normalized; the
 * fraction actually used is what the bridge row reports.
 */
function normalizeConfidence(v: unknown): number {
  const raw = numOrNull(v);
  if (raw === null) return 1;
  const frac = raw > 1 ? raw / 100 : raw;
  return Math.min(1, Math.max(0, frac));
}

function rowToScenario(r: Record<string, unknown>): ScenarioRow {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    name: str(r.name),
    isDefault: Boolean(r.is_default),
    baseSetId: r.base_set_id ? str(r.base_set_id) : null,
    basePeriodEnd: dateOnly(r.base_period_end),
    baseRevenue: numOrNull(r.base_revenue),
    baseEbitda: numOrNull(r.base_ebitda),
    assumptions: toAssumptions(r.assumptions),
    bridge: toBridge(r.bridge),
    computedAt: isoOrNull(r.computed_at),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

const SCENARIO_COLS = `
  id, plan_id, name, is_default, base_set_id, base_period_end,
  base_revenue, base_ebitda, assumptions, bridge, computed_at,
  created_at, updated_at`;

async function fetchScenarioRow(id: string): Promise<ScenarioRow> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SCENARIO_COLS)} FROM valuecreation.scenarios
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new VcError("scenario_not_found");
  return rowToScenario(rows[0] as Record<string, unknown>);
}

/* ------------------------------ the bridge ----------------------------- */

/**
 * Compute the EBITDA bridge for a scenario against the plan's CURRENT
 * initiatives. Inclusion rule: status 'deferred' and soft-deleted
 * initiatives are excluded; of the rest, an initiative is included
 * when its end_date is NULL or falls on/before
 * base_period_end + horizonMonths (when the base has no period end,
 * every non-deferred initiative is included).
 *
 * adjustedEbitda / adjustedWeightedEbitda apply the scenario's
 * realizationPct on top of the (weighted) totals:
 *   adjustedEbitda         = baseEbitda + totalImpact × realization
 *   adjustedWeightedEbitda = baseEbitda + totalWeightedImpact × realization
 * The realizationSensitivity table is independent of the assumption:
 * ebitda = baseEbitda + totalWeightedImpact × pct/100 for 0/50/100.
 *
 * revenueScenario.ebitdaAtGrowth uses the INCREMENTAL-MARGIN
 * assumption: incremental revenue carries the base EBITDA margin
 * (baseEbitda / baseRevenue), i.e.
 *   ebitdaAtGrowth = baseEbitda + (revenueAtGrowth − baseRevenue)
 *                    × baseEbitdaMargin.
 * All money values are rounded to 2dp.
 */
export async function computeBridge(
  planId: string,
  scenario: {
    baseRevenue: number | null;
    baseEbitda: number | null;
    basePeriodEnd: string | null;
    assumptions: ScenarioAssumptions;
  }
): Promise<ScenarioBridge> {
  await ensureValueCreation();
  const db = sql();
  const baseRevenue = scenario.baseRevenue ?? 0;
  const baseEbitda = scenario.baseEbitda ?? 0;
  const basePeriodEnd = scenario.basePeriodEnd;
  const { horizonMonths, revenueGrowthPct, realizationPct } =
    scenario.assumptions;
  const horizonEnd = basePeriodEnd
    ? addMonths(basePeriodEnd, horizonMonths)
    : null;

  const rows = await db`
    SELECT id, title, end_date, ebitda_impact, confidence
    FROM valuecreation.initiatives
    WHERE plan_id = ${planId} AND deleted_at IS NULL
      AND status <> 'deferred'
    ORDER BY created_at ASC`;
  const bridgeRows: BridgeRow[] = [];
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const endDate = dateOnly(rec.end_date);
    if (endDate !== null && horizonEnd !== null && endDate > horizonEnd) {
      continue;
    }
    const impact = round2(numOrNull(rec.ebitda_impact) ?? 0);
    const confidence = normalizeConfidence(rec.confidence);
    bridgeRows.push({
      initiativeId: str(rec.id),
      title: str(rec.title),
      impact,
      weightedImpact: round2(impact * confidence),
      confidence,
    });
  }
  const totalImpact = round2(
    bridgeRows.reduce((sum, r) => sum + r.impact, 0)
  );
  const totalWeightedImpact = round2(
    bridgeRows.reduce((sum, r) => sum + r.weightedImpact, 0)
  );
  const realization =
    Math.min(100, Math.max(0, realizationPct)) / 100;
  const adjustedEbitda = round2(baseEbitda + totalImpact * realization);
  const adjustedWeightedEbitda = round2(
    baseEbitda + totalWeightedImpact * realization
  );
  const baseMargin = baseRevenue !== 0 ? baseEbitda / baseRevenue : 0;
  const revenueAtGrowth = round2(baseRevenue * (1 + revenueGrowthPct / 100));
  const ebitdaAtGrowth = round2(
    baseEbitda + (revenueAtGrowth - baseRevenue) * baseMargin
  );
  return {
    baseRevenue: round2(baseRevenue),
    baseEbitda: round2(baseEbitda),
    basePeriodEnd,
    rows: bridgeRows,
    totalImpact,
    totalWeightedImpact,
    adjustedEbitda,
    adjustedWeightedEbitda,
    revenueScenario: {
      growthPct: revenueGrowthPct,
      revenueAtGrowth,
      ebitdaAtGrowth,
    },
    realizationSensitivity: [0, 50, 100].map((pct) => ({
      pct,
      ebitda: round2(baseEbitda + totalWeightedImpact * (pct / 100)),
    })),
    computedAt: new Date().toISOString(),
  };
}

async function persistBridge(
  scenarioId: string,
  bridge: ScenarioBridge
): Promise<void> {
  const db = sql();
  await db`
    UPDATE valuecreation.scenarios
    SET bridge = ${JSON.stringify(bridge)}::jsonb,
        computed_at = ${bridge.computedAt},
        updated_at = now()
    WHERE id = ${scenarioId}`;
}

/* -------------------------------- CRUD --------------------------------- */

/** List scenarios for a plan: metadata + stored-bridge totals only. */
export async function listScenarios(
  planId: string
): Promise<ScenarioListRow[]> {
  await ensureValueCreation();
  await requirePlan(planId);
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SCENARIO_COLS)} FROM valuecreation.scenarios
    WHERE plan_id = ${planId} AND deleted_at IS NULL
    ORDER BY is_default DESC, created_at ASC`;
  return rows.map((r) => {
    const s = rowToScenario(r as Record<string, unknown>);
    const { bridge, ...rest } = s;
    return {
      ...rest,
      totals: bridge
        ? {
            totalImpact: bridge.totalImpact,
            totalWeightedImpact: bridge.totalWeightedImpact,
            adjustedEbitda: bridge.adjustedEbitda,
            adjustedWeightedEbitda: bridge.adjustedWeightedEbitda,
          }
        : null,
    };
  });
}

/**
 * Create a scenario. The base is snapshotted from the financials
 * service: summary.ttm when it carries an EBITDA figure, else
 * summary.latest; when neither has EBITDA the plan's company has no
 * usable base and VcError('no_base_financials') is thrown. baseSetId
 * is the posted, reported, current set whose periodEnd matches the
 * base period (best effort, else null). The bridge is computed and
 * stored immediately.
 */
export async function createScenario(
  planId: string,
  input: { name?: string; assumptions?: Partial<ScenarioAssumptions> },
  actor: string
): Promise<ScenarioRow> {
  await ensureValueCreation();
  void actor;
  const plan = await requirePlan(planId);
  const { summary, sets } = await getCompanyFinancials(plan.companyId);
  const ttm = summary.ttm;
  const latest = summary.latest;
  const base =
    ttm && ttm.ebitda !== null && ttm.ebitda !== undefined
      ? ttm
      : latest && latest.ebitda !== null && latest.ebitda !== undefined
        ? latest
        : null;
  if (!base) throw new VcError("no_base_financials");
  const basePeriodEnd = base.periodEnd ?? null;
  const baseRevenue = base.revenue ?? null;
  const baseEbitda = base.ebitda ?? null;
  const baseSet =
    sets.find(
      (s) =>
        s.status === "posted" &&
        s.layer === "reported" &&
        s.isCurrent &&
        s.periodEnd === basePeriodEnd
    ) ?? null;

  const assumptions: ScenarioAssumptions = {
    ...DEFAULT_ASSUMPTIONS,
    ...(input.assumptions ?? {}),
  };
  const db = sql();
  const countRows = await db`
    SELECT count(*)::int AS n FROM valuecreation.scenarios
    WHERE plan_id = ${planId} AND deleted_at IS NULL`;
  const count = countRows.length
    ? Number((countRows[0] as Record<string, unknown>).n ?? 0)
    : 0;
  const name = (input.name ?? "").trim() || `Scenario ${count + 1}`;
  const id = `vcs_${newId()}`;
  const bridge = await computeBridge(planId, {
    baseRevenue,
    baseEbitda,
    basePeriodEnd,
    assumptions,
  });
  await db`
    INSERT INTO valuecreation.scenarios
      (id, plan_id, name, is_default, base_set_id, base_period_end,
        base_revenue, base_ebitda, assumptions, bridge, computed_at)
    VALUES (${id}, ${planId}, ${name}, ${count === 0},
      ${baseSet ? baseSet.id : null}, ${basePeriodEnd},
      ${baseRevenue}, ${baseEbitda},
      ${JSON.stringify(assumptions)}::jsonb,
      ${JSON.stringify(bridge)}::jsonb, ${bridge.computedAt})`;
  return fetchScenarioRow(id);
}

/** One scenario with its stored bridge. */
export async function getScenario(id: string): Promise<ScenarioRow> {
  await ensureValueCreation();
  return fetchScenarioRow(id);
}

export async function updateScenario(
  id: string,
  input: { name?: string; assumptions?: Partial<ScenarioAssumptions> },
  actor: string
): Promise<ScenarioRow> {
  await ensureValueCreation();
  void actor;
  const cur = await fetchScenarioRow(id);
  const name = input.name !== undefined ? input.name.trim() : cur.name;
  if (!name) throw new VcError("name_required");
  const assumptions: ScenarioAssumptions = {
    ...cur.assumptions,
    ...(input.assumptions ?? {}),
  };
  const db = sql();
  await db`
    UPDATE valuecreation.scenarios
    SET name = ${name},
        assumptions = ${JSON.stringify(assumptions)}::jsonb,
        updated_at = now()
    WHERE id = ${id}`;
  const bridge = await computeBridge(cur.planId, {
    baseRevenue: cur.baseRevenue,
    baseEbitda: cur.baseEbitda,
    basePeriodEnd: cur.basePeriodEnd,
    assumptions,
  });
  await persistBridge(id, bridge);
  return fetchScenarioRow(id);
}

export async function deleteScenario(
  id: string,
  actor: string
): Promise<boolean> {
  await ensureValueCreation();
  void actor;
  const db = sql();
  const rows = await db`
    UPDATE valuecreation.scenarios
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/** Re-run the bridge over current initiatives (base stays snapshotted). */
export async function recomputeScenario(
  id: string,
  actor: string
): Promise<ScenarioRow> {
  await ensureValueCreation();
  void actor;
  const cur = await fetchScenarioRow(id);
  const bridge = await computeBridge(cur.planId, {
    baseRevenue: cur.baseRevenue,
    baseEbitda: cur.baseEbitda,
    basePeriodEnd: cur.basePeriodEnd,
    assumptions: cur.assumptions,
  });
  await persistBridge(id, bridge);
  return fetchScenarioRow(id);
}

/**
 * Recompute EVERY live scenario for a plan. Called by WS-A's service
 * on its initiative write paths (dynamic import) and by the
 * initiative_updated event handler below. A single failing scenario
 * is logged and skipped — it must not block the rest.
 */
export async function refreshScenariosForPlan(planId: string): Promise<void> {
  await ensureValueCreation();
  if (!planId) return;
  const db = sql();
  const rows = await db`
    SELECT id FROM valuecreation.scenarios
    WHERE plan_id = ${planId} AND deleted_at IS NULL`;
  for (const r of rows) {
    const id = str((r as Record<string, unknown>).id);
    try {
      const cur = await fetchScenarioRow(id);
      const bridge = await computeBridge(planId, {
        baseRevenue: cur.baseRevenue,
        baseEbitda: cur.baseEbitda,
        basePeriodEnd: cur.basePeriodEnd,
        assumptions: cur.assumptions,
      });
      await persistBridge(id, bridge);
    } catch (err) {
      console.error(
        "[valuecreation:scenarios] refresh failed for scenario",
        id,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
}

/* --------------------------- event registration ------------------------ */
/**
 * Keep scenario bridges fresh when initiatives change: the platform
 * publishes initiative_updated with payload.planId; refresh that
 * plan's scenarios. Registered once per process (module-level guard —
 * this module can be imported by several routes).
 */
let scenariosHandlerRegistered = false;
function registerScenarioHandlers(): void {
  if (scenariosHandlerRegistered) return;
  scenariosHandlerRegistered = true;
  onEvent("initiative_updated", async (evt) => {
    const planId =
      typeof evt.payload?.planId === "string" ? evt.payload.planId : "";
    if (!planId) return;
    try {
      await refreshScenariosForPlan(planId);
    } catch (err) {
      console.error(
        "[valuecreation:scenarios] initiative_updated refresh failed for plan",
        planId,
        err instanceof Error ? err.message : String(err)
      );
    }
  });
}
registerScenarioHandlers();
