import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import { publishEvent } from "../platform/events";
import { getCompanyFinancials } from "../financials/service";
import { getWorkspaceByDeal, getScorecard } from "../diligence/service";
import { SCORECARD_AREAS } from "../diligence/schema";
import {
  ensureValueCreation,
  INITIATIVE_STATUSES,
  TARGET_METRICS,
} from "./schema";

export { ensureValueCreation };

/**
 * Value Creation service (Phase 6) — plans, initiatives (+ dependency
 * graph), playbooks, diligence-remediation conversion, add-on pipeline,
 * org chart + hiring, targets, and the plan_summary read model.
 *
 * Cross-module data flows ONLY through service functions:
 * - financial data via lib/financials/service (getCompanyFinancials),
 * - diligence workspaces / scorecards via lib/diligence/service,
 * - company / deal reference reads via core.* (platform foundation,
 *   the same precedent lib/diligence/service uses).
 * No direct SQL into financials.* or diligence.* tables anywhere here.
 *
 * Material initiative changes publish `initiative_updated`, write a
 * figure-free core.activity_log row, refresh scenario snapshots
 * (WS-B's scenarios.ts, dynamically imported, failure-tolerant), and
 * recompute valuecreation.plan_summary.
 */

export class VcError extends Error {
  error: string;
  constructor(code: string) {
    super(code);
    this.name = "VcError";
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
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/* ------------------------------ row types ---------------------------- */

export interface PlanRow {
  id: string;
  companyId: string;
  name: string;
  planStartDate: string | null;
  status: string;
  thesis: string;
  incentiveNotes: string;
  source: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface InitiativeRow {
  id: string;
  planId: string;
  title: string;
  description: string;
  category: string;
  status: string;
  ownerName: string;
  ownerPersonId: string | null;
  startDate: string | null;
  endDate: string | null;
  oneTimeCost: number | null;
  recurringCost: number | null;
  ebitdaImpact: number | null;
  confidence: number;
  effort: number | null;
  playbookId: string | null;
  sourceKind: string;
  sourceRef: Record<string, unknown>;
  sort: number;
  source: string;
  dependsOn: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookStep {
  title: string;
  description: string;
  typicalImpact: number;
  effort: number;
  durationDays: number;
  confidence: number;
}

export interface PlaybookRow {
  id: string;
  slug: string;
  name: string;
  category: string;
  description: string;
  steps: PlaybookStep[];
  isSystem: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TargetRow {
  id: string;
  planId: string;
  periodLabel: string;
  periodEnd: string;
  metric: string;
  targetValue: number;
  source: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface AddonRow {
  id: string;
  planId: string;
  targetCompanyId: string | null;
  targetDealId: string | null;
  name: string;
  status: string;
  synergyEstimate: number | null;
  revenueEstimate: number | null;
  ebitdaEstimate: number | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrgNodeRow {
  id: string;
  planId: string;
  personId: string | null;
  name: string;
  title: string;
  reportsToId: string | null;
  isKeyPerson: boolean;
  riskLevel: string;
  riskNotes: string;
  incentiveNotes: string;
  vacancy: boolean;
  targetDate: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface HiringRoleRow {
  id: string;
  planId: string;
  role: string;
  department: string;
  priority: string;
  targetDate: string | null;
  status: string;
  compRange: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlanSummaryRow {
  planId: string;
  companyId: string;
  initiativeCounts: Record<string, number>;
  openInitiatives: number;
  totalOneTimeCost: number;
  totalRecurringCost: number;
  impactUnweighted: number;
  impactWeighted: number;
  addonsCount: number;
  targetsCount: number;
  exitOverall: number | null;
  updatedAt: string;
}

function rowToPlan(r: Record<string, unknown>): PlanRow {
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    name: str(r.name),
    planStartDate: dateOrNull(r.plan_start_date),
    status: str(r.status) || "active",
    thesis: str(r.thesis),
    incentiveNotes: str(r.incentive_notes),
    source: str(r.source) || "manual",
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToInitiative(
  r: Record<string, unknown>,
  dependsOn: string[] = []
): InitiativeRow {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    title: str(r.title),
    description: str(r.description),
    category: str(r.category),
    status: str(r.status) || "planned",
    ownerName: str(r.owner_name),
    ownerPersonId: r.owner_person_id ? str(r.owner_person_id) : null,
    startDate: dateOrNull(r.start_date),
    endDate: dateOrNull(r.end_date),
    oneTimeCost: numOrNull(r.one_time_cost),
    recurringCost: numOrNull(r.recurring_cost),
    ebitdaImpact: numOrNull(r.ebitda_impact),
    confidence: numOrNull(r.confidence) ?? 1,
    effort: r.effort == null ? null : num(r.effort),
    playbookId: r.playbook_id ? str(r.playbook_id) : null,
    sourceKind: str(r.source_kind) || "manual",
    sourceRef: jsonObj(r.source_ref),
    sort: num(r.sort),
    source: str(r.source) || "manual",
    dependsOn,
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToPlaybook(r: Record<string, unknown>): PlaybookRow {
  const steps = jsonArr<Record<string, unknown>>(r.steps).map((s) => ({
    title: str(s.title),
    description: str(s.description),
    typicalImpact: numOrNull(s.typicalImpact) ?? 0,
    effort: num(s.effort) || 3,
    durationDays: num(s.durationDays) || 30,
    confidence: numOrNull(s.confidence) ?? 1,
  }));
  return {
    id: str(r.id),
    slug: str(r.slug),
    name: str(r.name),
    category: str(r.category),
    description: str(r.description),
    steps,
    isSystem: Boolean(r.is_system),
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToTarget(r: Record<string, unknown>): TargetRow {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    periodLabel: str(r.period_label),
    periodEnd: dateOrNull(r.period_end) ?? "",
    metric: str(r.metric),
    targetValue: num(r.target_value),
    source: str(r.source) || "manual",
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToAddon(r: Record<string, unknown>): AddonRow {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    targetCompanyId: r.target_company_id ? str(r.target_company_id) : null,
    targetDealId: r.target_deal_id ? str(r.target_deal_id) : null,
    name: str(r.name),
    status: str(r.status) || "identified",
    synergyEstimate: numOrNull(r.synergy_estimate),
    revenueEstimate: numOrNull(r.revenue_estimate),
    ebitdaEstimate: numOrNull(r.ebitda_estimate),
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToOrgNode(r: Record<string, unknown>): OrgNodeRow {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    personId: r.person_id ? str(r.person_id) : null,
    name: str(r.name),
    title: str(r.title),
    reportsToId: r.reports_to_id ? str(r.reports_to_id) : null,
    isKeyPerson: Boolean(r.is_key_person),
    riskLevel: str(r.risk_level),
    riskNotes: str(r.risk_notes),
    incentiveNotes: str(r.incentive_notes),
    vacancy: Boolean(r.vacancy),
    targetDate: dateOrNull(r.target_date),
    sort: num(r.sort),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToHiringRole(r: Record<string, unknown>): HiringRoleRow {
  return {
    id: str(r.id),
    planId: str(r.plan_id),
    role: str(r.role),
    department: str(r.department),
    priority: str(r.priority) || "medium",
    targetDate: dateOrNull(r.target_date),
    status: str(r.status) || "open",
    compRange: str(r.comp_range),
    notes: str(r.notes),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToSummary(r: Record<string, unknown>): PlanSummaryRow {
  const countsRaw = jsonObj(r.initiative_counts);
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(countsRaw)) counts[k] = num(v);
  return {
    planId: str(r.plan_id),
    companyId: str(r.company_id),
    initiativeCounts: counts,
    openInitiatives: num(r.open_initiatives),
    totalOneTimeCost: num(r.total_one_time_cost),
    totalRecurringCost: num(r.total_recurring_cost),
    impactUnweighted: num(r.impact_unweighted),
    impactWeighted: num(r.impact_weighted),
    addonsCount: num(r.addons_count),
    targetsCount: num(r.targets_count),
    exitOverall: numOrNull(r.exit_overall),
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/* --------------------------- plan summary ---------------------------- */

/**
 * Recompute valuecreation.plan_summary for one plan from its live
 * initiatives / addons / targets / exit_readiness. Exit overall =
 * round1(mean(present scores) × 20) — scores are 1–5 per area, so the
 * overall is a 0–100 figure; null when no area has been scored.
 */
export async function refreshPlanSummary(
  planId: string
): Promise<PlanSummaryRow> {
  await ensureValueCreation();
  const db = sql();
  const planRows = await db`
    SELECT id, company_id FROM valuecreation.plans
    WHERE id = ${planId} LIMIT 1`;
  const companyId = planRows.length
    ? str((planRows[0] as Record<string, unknown>).company_id)
    : "";

  const initRows = await db`
    SELECT status, one_time_cost, recurring_cost, ebitda_impact, confidence
    FROM valuecreation.initiatives
    WHERE plan_id = ${planId} AND deleted_at IS NULL`;
  const counts: Record<string, number> = {};
  let open = 0;
  let totalOne = 0;
  let totalRec = 0;
  let impactU = 0;
  let impactW = 0;
  for (const r of initRows) {
    const rec = r as Record<string, unknown>;
    const status = str(rec.status) || "planned";
    counts[status] = (counts[status] ?? 0) + 1;
    if (status === "deferred") continue;
    if (status !== "done") open += 1;
    totalOne += numOrNull(rec.one_time_cost) ?? 0;
    totalRec += numOrNull(rec.recurring_cost) ?? 0;
    const impact = numOrNull(rec.ebitda_impact) ?? 0;
    impactU += impact;
    impactW += impact * (numOrNull(rec.confidence) ?? 1);
  }
  const addonRows = await db`
    SELECT count(*)::int AS n FROM valuecreation.addons
    WHERE plan_id = ${planId} AND deleted_at IS NULL`;
  const targetRows = await db`
    SELECT count(*)::int AS n FROM valuecreation.targets
    WHERE plan_id = ${planId} AND deleted_at IS NULL`;
  const exitRows = await db`
    SELECT scores FROM valuecreation.exit_readiness
    WHERE plan_id = ${planId} AND deleted_at IS NULL LIMIT 1`;
  let exitOverall: number | null = null;
  if (exitRows.length) {
    const scores = jsonObj(
      (exitRows[0] as Record<string, unknown>).scores
    );
    // Scores are stored by WS-B's readiness.ts as {score, notes} cells
    // per EXIT_AREAS key; tolerate plain numbers too.
    const vals = Object.values(scores)
      .map((v) =>
        v && typeof v === "object"
          ? numOrNull((v as Record<string, unknown>).score)
          : numOrNull(v)
      )
      .filter((v): v is number => v !== null);
    if (vals.length) {
      exitOverall = round1(
        (vals.reduce((a, b) => a + b, 0) / vals.length) * 20
      );
    }
  }
  const addonsCount = addonRows.length
    ? num((addonRows[0] as Record<string, unknown>).n)
    : 0;
  const targetsCount = targetRows.length
    ? num((targetRows[0] as Record<string, unknown>).n)
    : 0;

  await db`
    INSERT INTO valuecreation.plan_summary
      (plan_id, company_id, initiative_counts, open_initiatives,
       total_one_time_cost, total_recurring_cost, impact_unweighted,
       impact_weighted, addons_count, targets_count, exit_overall, updated_at)
    VALUES (${planId}, ${companyId}, ${JSON.stringify(counts)}::jsonb,
      ${open}, ${totalOne}, ${totalRec}, ${impactU}, ${impactW},
      ${addonsCount}, ${targetsCount}, ${exitOverall}, now())
    ON CONFLICT (plan_id) DO UPDATE SET
      company_id = EXCLUDED.company_id,
      initiative_counts = EXCLUDED.initiative_counts,
      open_initiatives = EXCLUDED.open_initiatives,
      total_one_time_cost = EXCLUDED.total_one_time_cost,
      total_recurring_cost = EXCLUDED.total_recurring_cost,
      impact_unweighted = EXCLUDED.impact_unweighted,
      impact_weighted = EXCLUDED.impact_weighted,
      addons_count = EXCLUDED.addons_count,
      targets_count = EXCLUDED.targets_count,
      exit_overall = EXCLUDED.exit_overall,
      updated_at = now()`;
  return (await getPlanSummary(planId)) as PlanSummaryRow;
}

/** Read the plan_summary row; refresh (creating it) when missing. */
export async function getPlanSummary(
  planId: string
): Promise<PlanSummaryRow | null> {
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.plan_summary WHERE plan_id = ${planId} LIMIT 1`;
  if (rows.length) return rowToSummary(rows[0] as Record<string, unknown>);
  const plan = await getPlan(planId);
  if (!plan) return null;
  return refreshPlanSummary(planId);
}

/* -------------------------------- plans ------------------------------ */

export async function getPlan(planId: string): Promise<PlanRow | null> {
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.plans
    WHERE id = ${planId} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToPlan(rows[0] as Record<string, unknown>) : null;
}

export async function requirePlan(planId: string): Promise<PlanRow> {
  const plan = await getPlan(planId);
  if (!plan) throw new VcError("plan_not_found");
  return plan;
}

export async function getPlanByCompany(
  companyId: string
): Promise<PlanRow | null> {
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.plans
    WHERE company_id = ${companyId} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToPlan(rows[0] as Record<string, unknown>) : null;
}

export interface PlanListItem extends PlanRow {
  companyName: string;
  summary: PlanSummaryRow | null;
}

export async function listPlans(): Promise<PlanListItem[]> {
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT p.*, coalesce(co.name, '') AS company_name,
      s.company_id AS s_company_id, s.initiative_counts, s.open_initiatives,
      s.total_one_time_cost, s.total_recurring_cost, s.impact_unweighted,
      s.impact_weighted, s.addons_count, s.targets_count, s.exit_overall,
      s.updated_at AS s_updated_at
    FROM valuecreation.plans p
    LEFT JOIN core.companies co ON co.id = p.company_id
    LEFT JOIN valuecreation.plan_summary s ON s.plan_id = p.id
    WHERE p.deleted_at IS NULL
    ORDER BY p.updated_at DESC`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    const plan = rowToPlan(rec);
    const summary =
      rec.s_company_id != null || rec.initiative_counts != null
        ? rowToSummary({
            plan_id: rec.id,
            company_id: rec.s_company_id ?? rec.company_id,
            initiative_counts: rec.initiative_counts ?? {},
            open_initiatives: rec.open_initiatives ?? 0,
            total_one_time_cost: rec.total_one_time_cost ?? 0,
            total_recurring_cost: rec.total_recurring_cost ?? 0,
            impact_unweighted: rec.impact_unweighted ?? 0,
            impact_weighted: rec.impact_weighted ?? 0,
            addons_count: rec.addons_count ?? 0,
            targets_count: rec.targets_count ?? 0,
            exit_overall: rec.exit_overall ?? null,
            updated_at: rec.s_updated_at ?? rec.updated_at,
          })
        : null;
    return { ...plan, companyName: str(rec.company_name), summary };
  });
}

export async function createPlan(
  input: {
    companyId: string;
    name?: string;
    planStartDate?: string | null;
    thesis?: string;
  },
  actor: string
): Promise<PlanRow> {
  await ensureValueCreation();
  const companyId = (input.companyId ?? "").trim();
  if (!companyId) throw new VcError("company_not_found");
  const db = sql();
  const compRows = await db`
    SELECT id, name FROM core.companies
    WHERE id = ${companyId} AND deleted_at IS NULL LIMIT 1`;
  if (!compRows.length) throw new VcError("company_not_found");
  const companyName = str(
    (compRows[0] as Record<string, unknown>).name
  );
  const existing = await getPlanByCompany(companyId);
  if (existing) throw new VcError("plan_exists");
  const id = `vcp_${newId()}`;
  const name =
    (input.name ?? "").trim() || `Value Creation Plan — ${companyName}`;
  await db`
    INSERT INTO valuecreation.plans
      (id, company_id, name, plan_start_date, thesis, created_by)
    VALUES (${id}, ${companyId}, ${name},
      ${cleanDate(input.planStartDate)}, ${(input.thesis ?? "").trim()},
      ${actor})`;
  await db`
    INSERT INTO valuecreation.plan_summary (plan_id, company_id)
    VALUES (${id}, ${companyId})
    ON CONFLICT (plan_id) DO NOTHING`;
  await refreshPlanSummary(id);
  return (await getPlan(id)) as PlanRow;
}

export async function updatePlan(
  planId: string,
  patch: {
    name?: string;
    planStartDate?: string | null;
    status?: string;
    thesis?: string;
    incentiveNotes?: string;
  },
  actor: string
): Promise<PlanRow> {
  void actor;
  const plan = await requirePlan(planId);
  const db = sql();
  await db`
    UPDATE valuecreation.plans
    SET name = ${patch.name !== undefined ? patch.name.trim() : plan.name},
        plan_start_date = ${patch.planStartDate !== undefined ? cleanDate(patch.planStartDate) : plan.planStartDate},
        status = ${patch.status !== undefined ? patch.status : plan.status},
        thesis = ${patch.thesis !== undefined ? patch.thesis : plan.thesis},
        incentive_notes = ${patch.incentiveNotes !== undefined ? patch.incentiveNotes : plan.incentiveNotes},
        updated_at = now()
    WHERE id = ${planId}`;
  return (await getPlan(planId)) as PlanRow;
}

export async function deletePlan(
  planId: string,
  actor: string
): Promise<boolean> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    UPDATE valuecreation.plans SET deleted_at = now(), updated_at = now()
    WHERE id = ${planId} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

export async function restorePlan(
  planId: string,
  actor: string
): Promise<PlanRow> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.plans WHERE id = ${planId} LIMIT 1`;
  if (!rows.length) throw new VcError("plan_not_found");
  const rec = rows[0] as Record<string, unknown>;
  const clash = await db`
    SELECT id FROM valuecreation.plans
    WHERE company_id = ${str(rec.company_id)} AND deleted_at IS NULL
      AND id <> ${planId} LIMIT 1`;
  if (clash.length) throw new VcError("plan_exists");
  await db`
    UPDATE valuecreation.plans SET deleted_at = NULL, updated_at = now()
    WHERE id = ${planId}`;
  return (await getPlan(planId)) as PlanRow;
}

/* ---------------------------- initiatives ---------------------------- */

const MATERIAL_FIELDS = [
  "status",
  "ebitdaImpact",
  "oneTimeCost",
  "recurringCost",
  "endDate",
  "confidence",
] as const;

/**
 * Post-mutation side effects for initiatives. Every mutation refreshes
 * plan_summary. Material changes additionally publish
 * `initiative_updated`, write a figure-free activity_log row, and
 * refresh WS-B's scenario snapshots (dynamic import, failure-tolerant).
 */
async function afterInitiativeMutation(opts: {
  plan: PlanRow;
  initiativeId: string;
  title: string;
  change: string;
  actor: string;
  material: boolean;
}): Promise<void> {
  if (opts.material) {
    await publishEvent("initiative_updated", {
      entityKind: "company",
      entityId: opts.plan.companyId,
      payload: {
        planId: opts.plan.id,
        initiativeId: opts.initiativeId,
        change: opts.change,
      },
      actor: opts.actor,
    });
    try {
      const db = sql();
      await db`
        INSERT INTO core.activity_log
          (id, entity_kind, entity_id, actor, kind, message, source)
        VALUES (${newId()}, 'company', ${opts.plan.companyId}, ${opts.actor},
          'initiative_updated',
          ${`Initiative ${opts.change}: ${opts.title}`}, 'manual')`;
    } catch (err) {
      console.error(
        "[valuecreation] activity_log write failed",
        err instanceof Error ? err.message : String(err)
      );
    }
    try {
      const { refreshScenariosForPlan } = await import("./scenarios");
      await refreshScenariosForPlan(opts.plan.id).catch(() => {});
    } catch {
      /* scenarios module is WS-B's; absence must never break a write */
    }
  }
  await refreshPlanSummary(opts.plan.id);
}

async function depsForInitiatives(
  planId: string
): Promise<Map<string, string[]>> {
  const db = sql();
  const rows = await db`
    SELECT d.initiative_id, d.depends_on_id
    FROM valuecreation.initiative_dependencies d
    JOIN valuecreation.initiatives i ON i.id = d.initiative_id
    WHERE i.plan_id = ${planId}`;
  const map = new Map<string, string[]>();
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const list = map.get(str(rec.initiative_id)) ?? [];
    list.push(str(rec.depends_on_id));
    map.set(str(rec.initiative_id), list);
  }
  return map;
}

export async function listInitiatives(
  planId: string
): Promise<InitiativeRow[]> {
  await requirePlan(planId);
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.initiatives
    WHERE plan_id = ${planId} AND deleted_at IS NULL
    ORDER BY sort ASC, start_date ASC NULLS LAST, created_at ASC`;
  const deps = await depsForInitiatives(planId);
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    return rowToInitiative(rec, deps.get(str(rec.id)) ?? []);
  });
}

export async function getInitiative(
  id: string
): Promise<InitiativeRow | null> {
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.initiatives
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) return null;
  const rec = rows[0] as Record<string, unknown>;
  const depRows = await db`
    SELECT depends_on_id FROM valuecreation.initiative_dependencies
    WHERE initiative_id = ${id}`;
  return rowToInitiative(
    rec,
    depRows.map((d) => str((d as Record<string, unknown>).depends_on_id))
  );
}

export interface InitiativeInput {
  title?: string;
  description?: string;
  category?: string;
  status?: string;
  ownerName?: string;
  ownerPersonId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  oneTimeCost?: number | null;
  recurringCost?: number | null;
  ebitdaImpact?: number | null;
  confidence?: number;
  effort?: number | null;
  playbookId?: string | null;
  sourceKind?: string;
  sourceRef?: Record<string, unknown>;
  sort?: number;
}

function validStatus(v: string | undefined, fallback: string): string {
  if (v === undefined) return fallback;
  if (!(INITIATIVE_STATUSES as readonly string[]).includes(v))
    throw new VcError("invalid_status");
  return v;
}

export async function createInitiative(
  planId: string,
  input: InitiativeInput,
  actor: string
): Promise<InitiativeRow> {
  const plan = await requirePlan(planId);
  const title = (input.title ?? "").trim();
  if (!title) throw new VcError("title_required");
  const db = sql();
  const maxRows = await db`
    SELECT coalesce(max(sort), 0)::int AS m FROM valuecreation.initiatives
    WHERE plan_id = ${planId}`;
  const id = `vci_${newId()}`;
  await db`
    INSERT INTO valuecreation.initiatives
      (id, plan_id, title, description, category, status, owner_name,
       owner_person_id, start_date, end_date, one_time_cost, recurring_cost,
       ebitda_impact, confidence, effort, playbook_id, source_kind,
       source_ref, sort)
    VALUES (${id}, ${planId}, ${title}, ${(input.description ?? "").trim()},
      ${(input.category ?? "").trim()},
      ${validStatus(input.status, "planned")},
      ${(input.ownerName ?? "").trim()}, ${input.ownerPersonId ?? null},
      ${cleanDate(input.startDate)}, ${cleanDate(input.endDate)},
      ${input.oneTimeCost ?? null}, ${input.recurringCost ?? null},
      ${input.ebitdaImpact ?? null}, ${input.confidence ?? 1},
      ${input.effort ?? null}, ${input.playbookId ?? null},
      ${input.sourceKind ?? "manual"},
      ${JSON.stringify(input.sourceRef ?? {})}::jsonb,
      ${input.sort ?? num((maxRows[0] as Record<string, unknown>).m) + 10})`;
  const created = (await getInitiative(id)) as InitiativeRow;
  await afterInitiativeMutation({
    plan,
    initiativeId: id,
    title,
    change: "created",
    actor,
    material: true,
  });
  return created;
}

export async function updateInitiative(
  id: string,
  patch: InitiativeInput,
  actor: string
): Promise<InitiativeRow> {
  await ensureValueCreation();
  const cur = await getInitiative(id);
  if (!cur) throw new VcError("initiative_not_found");
  const plan = await requirePlan(cur.planId);
  const db = sql();
  const next = {
    title: patch.title !== undefined ? patch.title.trim() : cur.title,
    description:
      patch.description !== undefined ? patch.description : cur.description,
    category: patch.category !== undefined ? patch.category : cur.category,
    status: validStatus(patch.status, cur.status),
    ownerName:
      patch.ownerName !== undefined ? patch.ownerName : cur.ownerName,
    ownerPersonId:
      patch.ownerPersonId !== undefined
        ? patch.ownerPersonId
        : cur.ownerPersonId,
    startDate:
      patch.startDate !== undefined
        ? cleanDate(patch.startDate)
        : cur.startDate,
    endDate:
      patch.endDate !== undefined ? cleanDate(patch.endDate) : cur.endDate,
    oneTimeCost:
      patch.oneTimeCost !== undefined ? patch.oneTimeCost : cur.oneTimeCost,
    recurringCost:
      patch.recurringCost !== undefined
        ? patch.recurringCost
        : cur.recurringCost,
    ebitdaImpact:
      patch.ebitdaImpact !== undefined
        ? patch.ebitdaImpact
        : cur.ebitdaImpact,
    confidence:
      patch.confidence !== undefined ? patch.confidence : cur.confidence,
    effort: patch.effort !== undefined ? patch.effort : cur.effort,
    playbookId:
      patch.playbookId !== undefined ? patch.playbookId : cur.playbookId,
    sort: patch.sort !== undefined ? patch.sort : cur.sort,
  };
  if (!next.title) throw new VcError("title_required");
  await db`
    UPDATE valuecreation.initiatives
    SET title = ${next.title}, description = ${next.description},
        category = ${next.category}, status = ${next.status},
        owner_name = ${next.ownerName}, owner_person_id = ${next.ownerPersonId},
        start_date = ${next.startDate}, end_date = ${next.endDate},
        one_time_cost = ${next.oneTimeCost},
        recurring_cost = ${next.recurringCost},
        ebitda_impact = ${next.ebitdaImpact},
        confidence = ${next.confidence}, effort = ${next.effort},
        playbook_id = ${next.playbookId}, sort = ${next.sort},
        updated_at = now()
    WHERE id = ${id}`;
  const material = MATERIAL_FIELDS.some((f) => {
    if (patch[f] === undefined) return false;
    const before = (cur as unknown as Record<string, unknown>)[f];
    const after = (next as unknown as Record<string, unknown>)[f];
    return before !== after;
  });
  const updated = (await getInitiative(id)) as InitiativeRow;
  await afterInitiativeMutation({
    plan,
    initiativeId: id,
    title: next.title,
    change: "updated",
    actor,
    material,
  });
  return updated;
}

export async function deleteInitiative(
  id: string,
  actor: string
): Promise<boolean> {
  await ensureValueCreation();
  const cur = await getInitiative(id);
  if (!cur) return false;
  const plan = await requirePlan(cur.planId);
  const db = sql();
  await db`
    DELETE FROM valuecreation.initiative_dependencies
    WHERE initiative_id = ${id} OR depends_on_id = ${id}`;
  const rows = await db`
    UPDATE valuecreation.initiatives
    SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
  if (!rows.length) return false;
  await afterInitiativeMutation({
    plan,
    initiativeId: id,
    title: cur.title,
    change: "deleted",
    actor,
    material: true,
  });
  return true;
}

/**
 * Replace an initiative's dependency set. All ids must be initiatives
 * in the same plan; self-dependencies and cycles (checked by
 * reachability over the plan's dependency graph) are rejected with
 * 'dependency_cycle'.
 */
export async function setDependencies(
  initiativeId: string,
  dependsOnIds: string[],
  actor: string
): Promise<InitiativeRow> {
  void actor;
  await ensureValueCreation();
  const cur = await getInitiative(initiativeId);
  if (!cur) throw new VcError("initiative_not_found");
  const unique = Array.from(new Set(dependsOnIds ?? []));
  if (unique.includes(initiativeId)) throw new VcError("dependency_cycle");
  const db = sql();
  const planInitiatives = await db`
    SELECT id FROM valuecreation.initiatives
    WHERE plan_id = ${cur.planId} AND deleted_at IS NULL`;
  const planIds = new Set(
    planInitiatives.map((r) => str((r as Record<string, unknown>).id))
  );
  for (const depId of unique) {
    if (!planIds.has(depId)) throw new VcError("invalid_dependency");
  }
  // Reachability walk: build the graph with this initiative's edges
  // replaced by the proposed set, then check whether any proposed
  // dependency can reach back to the initiative (a cycle).
  const depRows = await db`
    SELECT d.initiative_id, d.depends_on_id
    FROM valuecreation.initiative_dependencies d
    JOIN valuecreation.initiatives i ON i.id = d.initiative_id
    WHERE i.plan_id = ${cur.planId} AND i.deleted_at IS NULL`;
  const graph = new Map<string, string[]>();
  for (const r of depRows) {
    const rec = r as Record<string, unknown>;
    const from = str(rec.initiative_id);
    if (from === initiativeId) continue; // being replaced
    const list = graph.get(from) ?? [];
    list.push(str(rec.depends_on_id));
    graph.set(from, list);
  }
  graph.set(initiativeId, unique);
  const reaches = (from: string, target: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length) {
      const node = stack.pop() as string;
      if (node === target) return true;
      if (seen.has(node)) continue;
      seen.add(node);
      for (const nxt of graph.get(node) ?? []) stack.push(nxt);
    }
    return false;
  };
  for (const depId of unique) {
    if (reaches(depId, initiativeId)) throw new VcError("dependency_cycle");
  }
  await db`
    DELETE FROM valuecreation.initiative_dependencies
    WHERE initiative_id = ${initiativeId}`;
  for (const depId of unique) {
    await db`
      INSERT INTO valuecreation.initiative_dependencies
        (initiative_id, depends_on_id)
      VALUES (${initiativeId}, ${depId})
      ON CONFLICT DO NOTHING`;
  }
  return (await getInitiative(initiativeId)) as InitiativeRow;
}

/* ----------------------------- playbooks ----------------------------- */

export async function listPlaybooks(): Promise<PlaybookRow[]> {
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.playbooks
    WHERE deleted_at IS NULL
    ORDER BY is_system DESC, name ASC`;
  return rows.map((r) => rowToPlaybook(r as Record<string, unknown>));
}

export async function getPlaybook(id: string): Promise<PlaybookRow | null> {
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.playbooks
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToPlaybook(rows[0] as Record<string, unknown>) : null;
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "playbook";
}

export interface PlaybookInput {
  name?: string;
  category?: string;
  description?: string;
  steps?: PlaybookStep[];
}

export async function createPlaybook(
  input: PlaybookInput,
  actor: string
): Promise<PlaybookRow> {
  await ensureValueCreation();
  const name = (input.name ?? "").trim();
  if (!name) throw new VcError("name_required");
  const db = sql();
  let slug = slugify(name);
  const clash = await db`
    SELECT id FROM valuecreation.playbooks WHERE slug = ${slug} LIMIT 1`;
  if (clash.length) slug = `${slug}-${newId().slice(0, 6)}`;
  const id = `pbk_${newId()}`;
  await db`
    INSERT INTO valuecreation.playbooks
      (id, slug, name, category, description, steps, is_system, created_by)
    VALUES (${id}, ${slug}, ${name}, ${(input.category ?? "").trim()},
      ${(input.description ?? "").trim()},
      ${JSON.stringify(input.steps ?? [])}::jsonb, false, ${actor})`;
  return (await getPlaybook(id)) as PlaybookRow;
}

export async function updatePlaybook(
  id: string,
  patch: PlaybookInput,
  actor: string
): Promise<PlaybookRow> {
  void actor;
  const cur = await getPlaybook(id);
  if (!cur) throw new VcError("playbook_not_found");
  const db = sql();
  await db`
    UPDATE valuecreation.playbooks
    SET name = ${patch.name !== undefined ? patch.name.trim() : cur.name},
        category = ${patch.category !== undefined ? patch.category : cur.category},
        description = ${patch.description !== undefined ? patch.description : cur.description},
        steps = ${JSON.stringify(patch.steps !== undefined ? patch.steps : cur.steps)}::jsonb,
        updated_at = now()
    WHERE id = ${id}`;
  return (await getPlaybook(id)) as PlaybookRow;
}

export async function deletePlaybook(
  id: string,
  actor: string
): Promise<boolean> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    UPDATE valuecreation.playbooks SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/**
 * Instantiate a playbook into a plan: ONE initiative per playbook
 * step. Start = the given startDate or the plan start; each step's
 * end = start + its durationDays.
 */
export async function instantiatePlaybook(
  planId: string,
  playbookId: string,
  opts: { ownerName?: string; startDate?: string | null },
  actor: string
): Promise<InitiativeRow[]> {
  const plan = await requirePlan(planId);
  const playbook = await getPlaybook(playbookId);
  if (!playbook) throw new VcError("playbook_not_found");
  const start =
    cleanDate(opts.startDate) ??
    plan.planStartDate ??
    new Date().toISOString().slice(0, 10);
  const created: InitiativeRow[] = [];
  for (const step of playbook.steps) {
    const init = await createInitiative(
      planId,
      {
        title: step.title,
        description: step.description,
        category: playbook.category,
        status: "planned",
        ownerName: opts.ownerName ?? "",
        startDate: start,
        endDate: addDays(start, step.durationDays || 30),
        ebitdaImpact: step.typicalImpact,
        confidence: step.confidence,
        effort: step.effort,
        playbookId: playbook.id,
        sourceKind: "playbook",
        sourceRef: { playbookId: playbook.id, playbookSlug: playbook.slug },
      },
      actor
    );
    created.push(init);
  }
  return created;
}

/* ---------------------------- remediation ---------------------------- */

export interface RemediationCandidate {
  workspaceId: string;
  dealId: string;
  areaKey: string;
  areaLabel: string;
  score: number;
  notes: string;
  alreadyConverted: boolean;
}

/**
 * Low-scoring diligence scorecard areas (score ≤ 2) for the plan's
 * company, resolved through core.deals (+ the company's
 * legacy_deal_id fallback) and the diligence service only.
 */
export async function listRemediationCandidates(
  planId: string
): Promise<RemediationCandidate[]> {
  const plan = await requirePlan(planId);
  const db = sql();
  const dealIds = new Set<string>();
  const dealRows = await db`
    SELECT id FROM core.deals WHERE company_id = ${plan.companyId}`;
  for (const r of dealRows) dealIds.add(str((r as Record<string, unknown>).id));
  const compRows = await db`
    SELECT legacy_deal_id FROM core.companies WHERE id = ${plan.companyId} LIMIT 1`;
  if (compRows.length) {
    const legacy = (compRows[0] as Record<string, unknown>).legacy_deal_id;
    if (legacy) dealIds.add(str(legacy));
  }
  const convertedRows = await db`
    SELECT source_ref FROM valuecreation.initiatives
    WHERE plan_id = ${planId} AND deleted_at IS NULL
      AND source_kind = 'remediation'`;
  const convertedKeys = new Set<string>();
  for (const r of convertedRows) {
    const ref = jsonObj((r as Record<string, unknown>).source_ref);
    convertedKeys.add(`${str(ref.workspaceId)}|${str(ref.areaKey)}`);
  }
  const out: RemediationCandidate[] = [];
  for (const dealId of Array.from(dealIds)) {
    const ws = await getWorkspaceByDeal(dealId).catch(() => null);
    if (!ws) continue;
    const scorecard = await getScorecard(ws.id).catch(() => null);
    if (!scorecard) continue;
    for (const area of SCORECARD_AREAS) {
      const entry = scorecard.areas[area.key];
      const score = entry?.score ?? null;
      if (score === null || score > 2) continue;
      out.push({
        workspaceId: ws.id,
        dealId,
        areaKey: area.key,
        areaLabel: area.label,
        score,
        notes: entry?.notes ?? "",
        alreadyConverted: convertedKeys.has(`${ws.id}|${area.key}`),
      });
    }
  }
  return out;
}

export async function convertRemediation(
  planId: string,
  input: {
    workspaceId: string;
    areaKey: string;
    ownerName?: string;
    dueDate?: string | null;
  },
  actor: string
): Promise<InitiativeRow> {
  const plan = await requirePlan(planId);
  void plan;
  const areaDef = SCORECARD_AREAS.find((a) => a.key === input.areaKey);
  if (!areaDef) throw new VcError("remediation_area_not_found");
  let scorecard: Awaited<ReturnType<typeof getScorecard>>;
  try {
    scorecard = await getScorecard(input.workspaceId);
  } catch (err) {
    if (err instanceof Error && err.message === "workspace_not_found") {
      throw new VcError("remediation_area_not_found");
    }
    throw err;
  }
  const entry = scorecard.areas[input.areaKey];
  const score = entry?.score ?? null;
  if (score === null || score > 2) {
    throw new VcError("area_not_low_scoring");
  }
  return createInitiative(
    planId,
    {
      title: `Remediate: ${areaDef.label}`,
      description: entry?.notes ?? "",
      category: "remediation",
      status: "planned",
      ownerName: input.ownerName ?? "",
      endDate: input.dueDate ?? null,
      ebitdaImpact: null,
      confidence: 1,
      effort: 3,
      sourceKind: "remediation",
      sourceRef: {
        workspaceId: input.workspaceId,
        scorecardId: scorecard.id,
        areaKey: input.areaKey,
        areaLabel: areaDef.label,
        score,
      },
    },
    actor
  );
}

/* ------------------------------- addons ------------------------------ */

export async function listAddons(planId: string): Promise<AddonRow[]> {
  await requirePlan(planId);
  const db = sql();
  const rows = await db`
    SELECT a.*, coalesce(co.name, '') AS live_name
    FROM valuecreation.addons a
    LEFT JOIN core.companies co ON co.id = a.target_company_id
    WHERE a.plan_id = ${planId} AND a.deleted_at IS NULL
    ORDER BY a.created_at ASC`;
  return rows.map((r) => {
    const rec = r as Record<string, unknown>;
    const row = rowToAddon(rec);
    const live = str(rec.live_name);
    if (row.targetCompanyId && live) row.name = live;
    return row;
  });
}

export interface AddonInput {
  targetCompanyId?: string | null;
  targetDealId?: string | null;
  name?: string;
  status?: string;
  synergyEstimate?: number | null;
  revenueEstimate?: number | null;
  ebitdaEstimate?: number | null;
  notes?: string;
}

export async function createAddon(
  planId: string,
  input: AddonInput,
  actor: string
): Promise<AddonRow> {
  void actor;
  await requirePlan(planId);
  const db = sql();
  let name = (input.name ?? "").trim();
  if (input.targetCompanyId) {
    const compRows = await db`
      SELECT name FROM core.companies
      WHERE id = ${input.targetCompanyId} AND deleted_at IS NULL LIMIT 1`;
    if (!compRows.length) throw new VcError("company_not_found");
    name = str((compRows[0] as Record<string, unknown>).name) || name;
  }
  if (!name) throw new VcError("name_required");
  const id = `vca_${newId()}`;
  await db`
    INSERT INTO valuecreation.addons
      (id, plan_id, target_company_id, target_deal_id, name, status,
       synergy_estimate, revenue_estimate, ebitda_estimate, notes)
    VALUES (${id}, ${planId}, ${input.targetCompanyId ?? null},
      ${input.targetDealId ?? null}, ${name},
      ${(input.status ?? "identified").trim() || "identified"},
      ${input.synergyEstimate ?? null}, ${input.revenueEstimate ?? null},
      ${input.ebitdaEstimate ?? null}, ${input.notes ?? ""})`;
  await refreshPlanSummary(planId);
  const rows = await db`
    SELECT * FROM valuecreation.addons WHERE id = ${id} LIMIT 1`;
  return rowToAddon(rows[0] as Record<string, unknown>);
}

export async function updateAddon(
  id: string,
  patch: AddonInput,
  actor: string
): Promise<AddonRow> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.addons
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new VcError("addon_not_found");
  const cur = rowToAddon(rows[0] as Record<string, unknown>);
  let name = patch.name !== undefined ? patch.name.trim() : cur.name;
  const targetCompanyId =
    patch.targetCompanyId !== undefined
      ? patch.targetCompanyId
      : cur.targetCompanyId;
  if (patch.targetCompanyId) {
    const compRows = await db`
      SELECT name FROM core.companies
      WHERE id = ${patch.targetCompanyId} AND deleted_at IS NULL LIMIT 1`;
    if (!compRows.length) throw new VcError("company_not_found");
    name = str((compRows[0] as Record<string, unknown>).name) || name;
  }
  await db`
    UPDATE valuecreation.addons
    SET target_company_id = ${targetCompanyId},
        target_deal_id = ${patch.targetDealId !== undefined ? patch.targetDealId : cur.targetDealId},
        name = ${name},
        status = ${patch.status !== undefined ? patch.status : cur.status},
        synergy_estimate = ${patch.synergyEstimate !== undefined ? patch.synergyEstimate : cur.synergyEstimate},
        revenue_estimate = ${patch.revenueEstimate !== undefined ? patch.revenueEstimate : cur.revenueEstimate},
        ebitda_estimate = ${patch.ebitdaEstimate !== undefined ? patch.ebitdaEstimate : cur.ebitdaEstimate},
        notes = ${patch.notes !== undefined ? patch.notes : cur.notes},
        updated_at = now()
    WHERE id = ${id}`;
  await refreshPlanSummary(cur.planId);
  const after = await db`
    SELECT * FROM valuecreation.addons WHERE id = ${id} LIMIT 1`;
  return rowToAddon(after[0] as Record<string, unknown>);
}

export async function deleteAddon(
  id: string,
  actor: string
): Promise<boolean> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    UPDATE valuecreation.addons SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL RETURNING id, plan_id`;
  if (!rows.length) return false;
  await refreshPlanSummary(
    str((rows[0] as Record<string, unknown>).plan_id)
  );
  return true;
}

/* ------------------------------ org chart ---------------------------- */

export async function listOrgNodes(planId: string): Promise<OrgNodeRow[]> {
  await requirePlan(planId);
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.org_nodes
    WHERE plan_id = ${planId} AND deleted_at IS NULL
    ORDER BY sort ASC, created_at ASC`;
  return rows.map((r) => rowToOrgNode(r as Record<string, unknown>));
}

export interface OrgNodeInput {
  personId?: string | null;
  name?: string;
  title?: string;
  reportsToId?: string | null;
  isKeyPerson?: boolean;
  riskLevel?: string;
  riskNotes?: string;
  incentiveNotes?: string;
  vacancy?: boolean;
  targetDate?: string | null;
  sort?: number;
}

export async function createOrgNode(
  planId: string,
  input: OrgNodeInput,
  actor: string
): Promise<OrgNodeRow> {
  void actor;
  await requirePlan(planId);
  const db = sql();
  if (input.reportsToId) {
    const parent = await db`
      SELECT id FROM valuecreation.org_nodes
      WHERE id = ${input.reportsToId} AND plan_id = ${planId}
        AND deleted_at IS NULL LIMIT 1`;
    if (!parent.length) throw new VcError("org_parent_not_found");
  }
  const maxRows = await db`
    SELECT coalesce(max(sort), 0)::int AS m FROM valuecreation.org_nodes
    WHERE plan_id = ${planId}`;
  const id = `vco_${newId()}`;
  await db`
    INSERT INTO valuecreation.org_nodes
      (id, plan_id, person_id, name, title, reports_to_id, is_key_person,
       risk_level, risk_notes, incentive_notes, vacancy, target_date, sort)
    VALUES (${id}, ${planId}, ${input.personId ?? null},
      ${(input.name ?? "").trim()}, ${(input.title ?? "").trim()},
      ${input.reportsToId ?? null}, ${Boolean(input.isKeyPerson)},
      ${input.riskLevel ?? ""}, ${input.riskNotes ?? ""},
      ${input.incentiveNotes ?? ""}, ${Boolean(input.vacancy)},
      ${cleanDate(input.targetDate)},
      ${input.sort ?? num((maxRows[0] as Record<string, unknown>).m) + 10})`;
  const rows = await db`
    SELECT * FROM valuecreation.org_nodes WHERE id = ${id} LIMIT 1`;
  return rowToOrgNode(rows[0] as Record<string, unknown>);
}

export async function updateOrgNode(
  id: string,
  patch: OrgNodeInput,
  actor: string
): Promise<OrgNodeRow> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.org_nodes
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new VcError("org_node_not_found");
  const cur = rowToOrgNode(rows[0] as Record<string, unknown>);
  const reportsToId =
    patch.reportsToId !== undefined ? patch.reportsToId : cur.reportsToId;
  if (reportsToId) {
    if (reportsToId === id) throw new VcError("org_parent_not_found");
    const parent = await db`
      SELECT id FROM valuecreation.org_nodes
      WHERE id = ${reportsToId} AND plan_id = ${cur.planId}
        AND deleted_at IS NULL LIMIT 1`;
    if (!parent.length) throw new VcError("org_parent_not_found");
  }
  await db`
    UPDATE valuecreation.org_nodes
    SET person_id = ${patch.personId !== undefined ? patch.personId : cur.personId},
        name = ${patch.name !== undefined ? patch.name : cur.name},
        title = ${patch.title !== undefined ? patch.title : cur.title},
        reports_to_id = ${reportsToId},
        is_key_person = ${patch.isKeyPerson !== undefined ? Boolean(patch.isKeyPerson) : cur.isKeyPerson},
        risk_level = ${patch.riskLevel !== undefined ? patch.riskLevel : cur.riskLevel},
        risk_notes = ${patch.riskNotes !== undefined ? patch.riskNotes : cur.riskNotes},
        incentive_notes = ${patch.incentiveNotes !== undefined ? patch.incentiveNotes : cur.incentiveNotes},
        vacancy = ${patch.vacancy !== undefined ? Boolean(patch.vacancy) : cur.vacancy},
        target_date = ${patch.targetDate !== undefined ? cleanDate(patch.targetDate) : cur.targetDate},
        sort = ${patch.sort !== undefined ? patch.sort : cur.sort},
        updated_at = now()
    WHERE id = ${id}`;
  const after = await db`
    SELECT * FROM valuecreation.org_nodes WHERE id = ${id} LIMIT 1`;
  return rowToOrgNode(after[0] as Record<string, unknown>);
}

export async function deleteOrgNode(
  id: string,
  actor: string
): Promise<boolean> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  await db`
    UPDATE valuecreation.org_nodes SET reports_to_id = NULL, updated_at = now()
    WHERE reports_to_id = ${id} AND deleted_at IS NULL`;
  const rows = await db`
    UPDATE valuecreation.org_nodes SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* ------------------------------- hiring ------------------------------ */

export async function listHiringRoles(
  planId: string
): Promise<HiringRoleRow[]> {
  await requirePlan(planId);
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.hiring_roles
    WHERE plan_id = ${planId} AND deleted_at IS NULL
    ORDER BY target_date ASC NULLS LAST, created_at ASC`;
  return rows.map((r) => rowToHiringRole(r as Record<string, unknown>));
}

export interface HiringRoleInput {
  role?: string;
  department?: string;
  priority?: string;
  targetDate?: string | null;
  status?: string;
  compRange?: string;
  notes?: string;
}

export async function createHiringRole(
  planId: string,
  input: HiringRoleInput,
  actor: string
): Promise<HiringRoleRow> {
  void actor;
  await requirePlan(planId);
  const role = (input.role ?? "").trim();
  if (!role) throw new VcError("role_required");
  const db = sql();
  const id = `vch_${newId()}`;
  await db`
    INSERT INTO valuecreation.hiring_roles
      (id, plan_id, role, department, priority, target_date, status,
       comp_range, notes)
    VALUES (${id}, ${planId}, ${role}, ${(input.department ?? "").trim()},
      ${(input.priority ?? "medium").trim() || "medium"},
      ${cleanDate(input.targetDate)},
      ${(input.status ?? "open").trim() || "open"},
      ${input.compRange ?? ""}, ${input.notes ?? ""})`;
  const rows = await db`
    SELECT * FROM valuecreation.hiring_roles WHERE id = ${id} LIMIT 1`;
  return rowToHiringRole(rows[0] as Record<string, unknown>);
}

export async function updateHiringRole(
  id: string,
  patch: HiringRoleInput,
  actor: string
): Promise<HiringRoleRow> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.hiring_roles
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  if (!rows.length) throw new VcError("hiring_role_not_found");
  const cur = rowToHiringRole(rows[0] as Record<string, unknown>);
  await db`
    UPDATE valuecreation.hiring_roles
    SET role = ${patch.role !== undefined ? patch.role : cur.role},
        department = ${patch.department !== undefined ? patch.department : cur.department},
        priority = ${patch.priority !== undefined ? patch.priority : cur.priority},
        target_date = ${patch.targetDate !== undefined ? cleanDate(patch.targetDate) : cur.targetDate},
        status = ${patch.status !== undefined ? patch.status : cur.status},
        comp_range = ${patch.compRange !== undefined ? patch.compRange : cur.compRange},
        notes = ${patch.notes !== undefined ? patch.notes : cur.notes},
        updated_at = now()
    WHERE id = ${id}`;
  const after = await db`
    SELECT * FROM valuecreation.hiring_roles WHERE id = ${id} LIMIT 1`;
  return rowToHiringRole(after[0] as Record<string, unknown>);
}

export async function deleteHiringRole(
  id: string,
  actor: string
): Promise<boolean> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    UPDATE valuecreation.hiring_roles SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL RETURNING id`;
  return rows.length > 0;
}

/* ------------------------------- targets ----------------------------- */
/*
 * Margin metrics (gross_margin_pct, ebitda_margin_pct) are stored as
 * PERCENT numbers — e.g. 18.5 means 18.5%, never a 0.185 fraction.
 * This matches the financials summary convention (pctOf returns
 * percent numbers) so Phase 8 can compare target vs. actual directly.
 */

export async function listTargets(planId: string): Promise<TargetRow[]> {
  await requirePlan(planId);
  const db = sql();
  const rows = await db`
    SELECT * FROM valuecreation.targets
    WHERE plan_id = ${planId} AND deleted_at IS NULL
    ORDER BY period_end ASC, metric ASC`;
  return rows.map((r) => rowToTarget(r as Record<string, unknown>));
}

export interface TargetInput {
  periodLabel: string;
  periodEnd: string;
  metric: string;
  targetValue: number;
  source?: string;
  notes?: string;
}

export async function upsertTarget(
  planId: string,
  input: TargetInput,
  actor: string
): Promise<TargetRow> {
  void actor;
  await requirePlan(planId);
  if (!(TARGET_METRICS as readonly string[]).includes(input.metric)) {
    throw new VcError("invalid_metric");
  }
  const periodEnd = cleanDate(input.periodEnd);
  if (!periodEnd) throw new VcError("invalid_period_end");
  if (typeof input.targetValue !== "number" || !isFinite(input.targetValue)) {
    throw new VcError("invalid_target_value");
  }
  const db = sql();
  const existing = await db`
    SELECT * FROM valuecreation.targets
    WHERE plan_id = ${planId} AND period_end = ${periodEnd}
      AND metric = ${input.metric} AND deleted_at IS NULL LIMIT 1`;
  let id: string;
  if (existing.length) {
    id = str((existing[0] as Record<string, unknown>).id);
    await db`
      UPDATE valuecreation.targets
      SET period_label = ${input.periodLabel},
          target_value = ${input.targetValue},
          source = ${input.source ?? "manual"},
          notes = ${input.notes ?? ""},
          updated_at = now()
      WHERE id = ${id}`;
  } else {
    id = `vct_${newId()}`;
    await db`
      INSERT INTO valuecreation.targets
        (id, plan_id, period_label, period_end, metric, target_value,
         source, notes)
      VALUES (${id}, ${planId}, ${input.periodLabel}, ${periodEnd},
        ${input.metric}, ${input.targetValue},
        ${input.source ?? "manual"}, ${input.notes ?? ""})`;
  }
  await refreshPlanSummary(planId);
  const rows = await db`
    SELECT * FROM valuecreation.targets WHERE id = ${id} LIMIT 1`;
  return rowToTarget(rows[0] as Record<string, unknown>);
}

export async function deleteTarget(
  id: string,
  actor: string
): Promise<boolean> {
  void actor;
  await ensureValueCreation();
  const db = sql();
  const rows = await db`
    UPDATE valuecreation.targets SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL RETURNING id, plan_id`;
  if (!rows.length) return false;
  await refreshPlanSummary(str((rows[0] as Record<string, unknown>).plan_id));
  return true;
}

/**
 * Derive next-year targets from posted financials (via the financials
 * service ONLY) plus initiative EBITDA impact landing by the target
 * period end:
 * - revenue = base revenue × (1 + growthPct/100)   (growthPct default 0)
 * - ebitda  = base ebitda + Σ initiative ebitda_impact for initiatives
 *             with end_date ≤ target period end, all statuses except
 *             'deferred' (null impact counts as 0)
 * - ebitda_margin_pct = ebitda / revenue × 100 (percent number)
 * - gross_margin_pct  = base gross margin, held flat (percent number),
 *             upserted only when the base KPI carries it
 * Base = summary.ttm ?? summary.latest (first carrying a revenue
 * figure wins); throws 'no_base_financials' when neither has revenue.
 */
export async function deriveTargets(
  planId: string,
  opts: { growthPct?: number; scenarioId?: string },
  actor: string
): Promise<TargetRow[]> {
  void opts.scenarioId; // scenarios are WS-B's; derivation is plan-based
  const plan = await requirePlan(planId);
  const { summary } = await getCompanyFinancials(plan.companyId);
  const candidates = [summary.ttm, summary.latest].filter(
    (c): c is NonNullable<typeof c> => c != null
  );
  const base = candidates.find((c) => c.revenue != null);
  if (!base || base.revenue == null || !base.periodEnd) {
    throw new VcError("no_base_financials");
  }
  const baseRevenue = base.revenue;
  const baseEbitda = base.ebitda ?? 0;
  const basePeriodEnd = base.periodEnd;
  const baseDate = new Date(`${basePeriodEnd}T00:00:00Z`);
  baseDate.setUTCFullYear(baseDate.getUTCFullYear() + 1);
  const periodEnd = baseDate.toISOString().slice(0, 10);
  const periodLabel = `FY${baseDate.getUTCFullYear()}`;
  const growthPct = typeof opts.growthPct === "number" ? opts.growthPct : 0;

  const db = sql();
  const impactRows = await db`
    SELECT coalesce(sum(ebitda_impact), 0) AS impact
    FROM valuecreation.initiatives
    WHERE plan_id = ${planId} AND deleted_at IS NULL
      AND status <> 'deferred'
      AND end_date IS NOT NULL AND end_date <= ${periodEnd}`;
  const initiativeImpact = impactRows.length
    ? num((impactRows[0] as Record<string, unknown>).impact)
    : 0;

  const revenueTarget = baseRevenue * (1 + growthPct / 100);
  const ebitdaTarget = baseEbitda + initiativeImpact;
  const basisNote =
    `Derived from posted financials (period ending ${basePeriodEnd}); ` +
    `growth ${growthPct}%; initiative impact through ${periodEnd} included.`;
  const out: TargetRow[] = [];
  out.push(
    await upsertTarget(
      planId,
      {
        periodLabel,
        periodEnd,
        metric: "revenue",
        targetValue: revenueTarget,
        source: "derived",
        notes: basisNote,
      },
      actor
    )
  );
  out.push(
    await upsertTarget(
      planId,
      {
        periodLabel,
        periodEnd,
        metric: "ebitda",
        targetValue: ebitdaTarget,
        source: "derived",
        notes: basisNote,
      },
      actor
    )
  );
  if (revenueTarget !== 0) {
    out.push(
      await upsertTarget(
        planId,
        {
          periodLabel,
          periodEnd,
          metric: "ebitda_margin_pct",
          targetValue: round1((ebitdaTarget / revenueTarget) * 100),
          source: "derived",
          notes: basisNote,
        },
        actor
      )
    );
  }
  const baseKpi = summary.kpis[basePeriodEnd];
  if (baseKpi && baseKpi.grossMarginPct != null) {
    out.push(
      await upsertTarget(
        planId,
        {
          periodLabel,
          periodEnd,
          metric: "gross_margin_pct",
          targetValue: baseKpi.grossMarginPct,
          source: "derived",
          notes: `Gross margin held flat from base period ending ${basePeriodEnd}. ${basisNote}`,
        },
        actor
      )
    );
  }
  return out;
}

/**
 * THE Phase 8 surface: a company's value-creation targets, read from
 * valuecreation.targets only (summary-friendly, no recomputation).
 */
export async function getValueCreationTargets(
  companyId: string,
  periodEnd?: string
): Promise<{
  companyId: string;
  planId: string | null;
  targets: Array<{
    periodLabel: string;
    periodEnd: string;
    metric: string;
    targetValue: number;
    source: string;
    updatedAt: string;
  }>;
}> {
  await ensureValueCreation();
  const plan = await getPlanByCompany(companyId);
  if (!plan) return { companyId, planId: null, targets: [] };
  const db = sql();
  const filter = periodEnd ? cleanDate(periodEnd) : null;
  const rows = await db`
    SELECT * FROM valuecreation.targets
    WHERE plan_id = ${plan.id} AND deleted_at IS NULL
      AND (${filter}::date IS NULL OR period_end = ${filter}::date)
    ORDER BY period_end ASC, metric ASC`;
  return {
    companyId,
    planId: plan.id,
    targets: rows.map((r) => {
      const row = rowToTarget(r as Record<string, unknown>);
      return {
        periodLabel: row.periodLabel,
        periodEnd: row.periodEnd,
        metric: row.metric,
        targetValue: row.targetValue,
        source: row.source,
        updatedAt: row.updatedAt,
      };
    }),
  };
}
