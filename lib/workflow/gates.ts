import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { getDeals } from "../db";
import type { Deal } from "../types";
import { DEAL_STAGES } from "../types";
import { ensureWorkflow, CONDITION_CATALOG } from "./schema";

export { ensureWorkflow, CONDITION_CATALOG };

/**
 * Stage-gate service (Phase 10) — evaluates workflow.gate_rules for a
 * deal entering a target stage, and records partner overrides.
 *
 * Cross-module reads go ONLY through service functions:
 * - contact: the legacy deal record via lib/db getDeals(),
 * - financials: lib/financials/service getCompanyFinancials(),
 * - data room: lib/dataroom/service getRoomResolutionByDeal(),
 * - diligence: lib/diligence/service getWorkspaceByDeal() /
 *   listClosingItems(), lib/diligence/memo getCurrentMemo().
 * The only direct SQL is workflow.* (own schema) + core.deals /
 * core.audit_log (shared platform tables).
 *
 * Evaluators FAIL SAFE: any exception is swallowed (ids logged only,
 * never figures) and the condition counts as UNMET — a broken check
 * blocks the move until a partner overrides it with a reason, rather
 * than silently waving the deal through.
 */

/* ------------------------------- types ------------------------------ */

export interface GateRuleRow {
  id: string;
  targetStage: string;
  conditionKey: string;
  label: string;
  enabled: boolean;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface GateConditionResult {
  key: string;
  label: string;
  met: boolean;
}

export interface GateEvaluation {
  targetStage: string;
  blocked: boolean;
  results: GateConditionResult[];
  unmet: Array<{ key: string; label: string }>;
}

export interface GateOverrideRow {
  id: string;
  dealId: string;
  dealName: string;
  fromStage: string;
  toStage: string;
  actor: string;
  reason: string;
  bypassed: Array<{ key: string; label: string }>;
  createdAt: string;
}

/** Prospective contact fields for a not-yet-saved deal update (the
 * deals PUT passes its merged record so a contact added in the same
 * request satisfies contact_recorded). */
export interface DealGateOverrideContext {
  contactName?: string | null;
  contactEmail?: string | null;
}

/* ------------------------------ helpers ----------------------------- */

function rowToRule(r: Record<string, unknown>): GateRuleRow {
  return {
    id: str(r.id),
    targetStage: str(r.target_stage),
    conditionKey: str(r.condition_key),
    label: str(r.label),
    enabled: Boolean(r.enabled),
    sort: num(r.sort),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function parseBypassed(v: unknown): Array<{ key: string; label: string }> {
  let arr: unknown = v;
  if (typeof v === "string" && v.trim()) {
    try {
      arr = JSON.parse(v) as unknown;
    } catch {
      arr = [];
    }
  }
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === "object" && x !== null
    )
    .map((x) => ({ key: str(x.key), label: str(x.label) }))
    .filter((x) => x.key !== "");
}

function rowToOverride(r: Record<string, unknown>): GateOverrideRow {
  return {
    id: str(r.id),
    dealId: str(r.deal_id),
    dealName: str(r.deal_name),
    fromStage: str(r.from_stage),
    toStage: str(r.to_stage),
    actor: str(r.actor),
    reason: str(r.reason),
    bypassed: parseBypassed(r.bypassed),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}

/** core.deals is the platform projection of the legacy deal — the
 * company link lives there (shared core table read, allowed). */
async function resolveCompanyId(dealId: string): Promise<string | null> {
  const db = sql();
  const rows = await db`
    SELECT company_id FROM core.deals WHERE id = ${dealId} LIMIT 1`;
  if (!rows.length) return null;
  const v = (rows[0] as Record<string, unknown>).company_id;
  return v ? str(v) : null;
}

async function loadDeal(dealId: string): Promise<Deal | null> {
  const deals = await getDeals();
  return deals.find((d) => d.id === dealId) ?? null;
}

/* ---------------------------- evaluators ---------------------------- */

type Evaluator = (
  dealId: string,
  ctx: { deal: Deal | null; dealCtx?: DealGateOverrideContext }
) => Promise<boolean>;

/** Terminal closing-item statuses. Verified in lib/diligence/schema.ts
 * (CLOSING_STATUSES = ["open", "done", "waived"], line 92): the live
 * enum has no "na" value for closing items, but "na" is tolerated here
 * so the gate honors the spec wording if the enum ever grows it. */
const CLOSING_TERMINAL = new Set(["done", "waived", "na"]);

const EVALUATORS: Record<string, Evaluator> = {
  contact_recorded: async (dealId, ctx) => {
    const name = (ctx.dealCtx?.contactName ?? ctx.deal?.contactName ?? "").trim();
    const email = (
      ctx.dealCtx?.contactEmail ??
      ctx.deal?.contactEmail ??
      ""
    ).trim();
    return name !== "" || email !== "";
  },

  financials_posted: async (dealId) => {
    const companyId = await resolveCompanyId(dealId);
    if (!companyId) return false;
    const { getCompanyFinancials } = await import("../financials/service");
    // StatementSet shape verified in lib/financials/service.ts
    // rowToSet (line 252): status: string, isCurrent: boolean.
    const { sets } = await getCompanyFinancials(companyId);
    return sets.some((s) => s.status === "posted" && s.isCurrent);
  },

  data_room_created: async (dealId) => {
    // Dataroom resolution verified in lib/dataroom/service.ts:
    // getRoomResolutionByDeal (line 768) → { roomId, roomCount, room }.
    // A room of any status counts.
    const { getRoomResolutionByDeal } = await import("../dataroom/service");
    const res = await getRoomResolutionByDeal(dealId);
    return Boolean(res.roomId) || res.roomCount > 0;
  },

  diligence_workspace_created: async (dealId) => {
    const { getWorkspaceByDeal } = await import("../diligence/service");
    const ws = await getWorkspaceByDeal(dealId);
    return ws !== null;
  },

  ic_memo_approved: async (dealId) => {
    // getCurrentMemo verified in lib/diligence/memo.ts (line 494):
    // returns { memo: MemoRow | null, stale } — MemoRow.status (line 64).
    const { getCurrentMemo } = await import("../diligence/memo");
    const { memo } = await getCurrentMemo(dealId);
    return memo?.status === "approved";
  },

  closing_checklist_complete: async (dealId) => {
    const { getWorkspaceByDeal, listClosingItems } = await import(
      "../diligence/service"
    );
    const ws = await getWorkspaceByDeal(dealId);
    if (!ws) return false;
    // ClosingItemRow verified in lib/diligence/service.ts (line 1751):
    // status: string, default "open".
    const items = await listClosingItems(ws.id);
    if (items.length < 1) return false;
    return items.every((i) => CLOSING_TERMINAL.has(i.status));
  },
};

/* ------------------------------ rules CRUD -------------------------- */

export async function listGateRules(): Promise<GateRuleRow[]> {
  await ensureWorkflow();
  const db = sql();
  const rows = await db`
    SELECT * FROM workflow.gate_rules ORDER BY target_stage ASC, sort ASC, condition_key ASC`;
  const order = new Map<string, number>(
    DEAL_STAGES.map((s, i) => [s, i] as [string, number])
  );
  return rows
    .map((r) => rowToRule(r as Record<string, unknown>))
    .sort((a, b) => {
      const sa = order.get(a.targetStage) ?? 99;
      const sb = order.get(b.targetStage) ?? 99;
      if (sa !== sb) return sa - sb;
      if (a.sort !== b.sort) return a.sort - b.sort;
      return a.conditionKey.localeCompare(b.conditionKey);
    });
}

export async function listGateRulesForStage(
  targetStage: string,
  enabledOnly = true
): Promise<GateRuleRow[]> {
  await ensureWorkflow();
  const db = sql();
  const rows = enabledOnly
    ? await db`
        SELECT * FROM workflow.gate_rules
        WHERE target_stage = ${targetStage} AND enabled = true
        ORDER BY sort ASC, condition_key ASC`
    : await db`
        SELECT * FROM workflow.gate_rules
        WHERE target_stage = ${targetStage}
        ORDER BY sort ASC, condition_key ASC`;
  return rows.map((r) => rowToRule(r as Record<string, unknown>));
}

export async function updateGateRules(
  updates: Array<{ id: string; enabled: boolean }>
): Promise<GateRuleRow[]> {
  await ensureWorkflow();
  const db = sql();
  for (const u of updates) {
    if (!u.id) continue;
    await db`
      UPDATE workflow.gate_rules
      SET enabled = ${Boolean(u.enabled)}, updated_at = now()
      WHERE id = ${u.id}`;
  }
  return listGateRules();
}

/* ----------------------------- evaluation --------------------------- */

export async function evaluateStageGates(
  dealId: string,
  targetStage: string,
  dealCtx?: DealGateOverrideContext
): Promise<GateEvaluation> {
  await ensureWorkflow();
  const rules = await listGateRulesForStage(targetStage, true);
  if (!rules.length) {
    return { targetStage, blocked: false, results: [], unmet: [] };
  }
  let deal: Deal | null = null;
  try {
    deal = await loadDeal(dealId);
  } catch {
    deal = null;
  }
  const results: GateConditionResult[] = [];
  for (const rule of rules) {
    const evaluator = EVALUATORS[rule.conditionKey];
    let met = false;
    if (evaluator) {
      try {
        met = await evaluator(dealId, { deal, dealCtx });
      } catch (err) {
        // Fail safe: an evaluator error means UNMET. Log ids only.
        console.error(
          "[workflow] gate evaluator failed",
          rule.conditionKey,
          "deal",
          dealId,
          err instanceof Error ? err.message : String(err)
        );
        met = false;
      }
    }
    results.push({ key: rule.conditionKey, label: rule.label, met });
  }
  const unmet = results
    .filter((r) => !r.met)
    .map((r) => ({ key: r.key, label: r.label }));
  return { targetStage, blocked: unmet.length > 0, results, unmet };
}

/* ------------------------------ overrides --------------------------- */

export async function recordGateOverride(input: {
  dealId: string;
  dealName: string;
  fromStage: string;
  toStage: string;
  actor: string;
  reason: string;
  bypassed: Array<{ key: string; label: string }>;
}): Promise<GateOverrideRow> {
  await ensureWorkflow();
  const db = sql();
  const id = `gov_${newId()}`;
  const bypassed = input.bypassed.map((b) => ({
    key: b.key,
    label: b.label,
  }));
  const rows = await db`
    INSERT INTO workflow.gate_overrides
      (id, deal_id, deal_name, from_stage, to_stage, actor, reason, bypassed)
    VALUES (${id}, ${input.dealId}, ${input.dealName}, ${input.fromStage},
      ${input.toStage}, ${input.actor}, ${input.reason},
      ${JSON.stringify(bypassed)}::jsonb)
    RETURNING *`;
  // Audit trail — reason + bypassed condition KEYS only, no figures.
  try {
    await db`
      INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
      VALUES ('deal', ${input.dealId}, ${input.actor}, 'stage_gate_override',
        ${JSON.stringify({
          fromStage: input.fromStage,
          toStage: input.toStage,
          reason: input.reason,
          bypassed: bypassed.map((b) => b.key),
        })}::jsonb)`;
  } catch (err) {
    console.error(
      "[workflow] gate override audit write failed",
      input.dealId,
      err instanceof Error ? err.message : String(err)
    );
  }
  return rowToOverride(rows[0] as Record<string, unknown>);
}

export async function listGateOverrides(
  dealId: string
): Promise<GateOverrideRow[]> {
  await ensureWorkflow();
  const db = sql();
  const rows = await db`
    SELECT * FROM workflow.gate_overrides
    WHERE deal_id = ${dealId}
    ORDER BY created_at DESC
    LIMIT 50`;
  return rows.map((r) => rowToOverride(r as Record<string, unknown>));
}
