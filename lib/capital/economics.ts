import { sql, str, num, numOrNull, isoOrNull } from "../platform/db";
import { ensureCapital } from "./schema";
import { getDealContext } from "../diligence/service";
import {
  getPublishedAnalysis,
  getCurrentAnalysis,
} from "../finanalysis/service";

/**
 * Deal economics engine (Phase 7, WS-B) — PURE core + inputs service.
 *
 * House math (exact; the verification battery hand-computes these):
 *   EV = E×M · debt = min(L×E, 0.9×EV) · advisoryFee = fa×EV ·
 *   financingFee = ff×debt · totalFees = advisory+financing ·
 *   totalUses = EV + totalFees · equityIn = totalUses − debt − R
 *   exitEbitda = E×(1+g)^H · exitValue = exitEbitda×X ·
 *   netDebtAtExit = debt×(1−pd) · equityOutTotal = exitValue − netDebt
 *   totalEquity = equityIn + R · investorShare = equityIn/totalEquity
 *   investorOutGross = equityOutTotal × investorShare
 *   profit = investorOutGross − equityIn
 *   prefAmount = equityIn×((1+p)^H − 1)
 *   carry = c × max(0, profit − prefAmount)   ← NO catch-up: carry is
 *     charged only on profit ABOVE the accrued pref; the GP does not
 *     catch up to a full c share of total profit. This is deliberate
 *     house convention (matches lib/finanalysis/dealscreen.ts style of
 *     documenting assumptions in code) and is surfaced in result notes.
 *   mgmtFees = fm × equityIn × H
 *   investorOutNet = investorOutGross − carry − mgmtFees
 *   MOIC / IRR are computed gross from investorOutGross and net from
 *   investorOutNet (IRR null when the out amount is ≤ 0).
 *
 * EBITDA source: the deal's stored ebitda_override, else the APPROVED
 * (published) analysis margin-bridge adjusted EBITDA via
 * lib/finanalysis/service.getPublishedAnalysis — figures are never
 * re-entered or recomputed from statements here. Neither → the result
 * is available:false with reason 'no_approved_analysis'.
 *
 * Input inheritance: every stored input column that is NULL inherits
 * the capital.valuation_params 'global' row at compute time, so editing
 * the global params re-prices every deal that has not overridden that
 * input. rollover_equity has no global counterpart and defaults to 0.
 *
 * Rounding: money is rounded to 2dp (round2) and ratios to 6dp
 * (round6) ONLY in output fields — all internal math runs unrounded.
 */

export const round2 = (n: number): number => Math.round(n * 100) / 100;
export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;

/* ------------------------------ params ------------------------------- */

export interface ValuationParams {
  id: string;
  entryMultipleLow: number;
  entryMultipleHigh: number;
  targetIrr: number;
  leverageLow: number;
  leverageHigh: number;
  entryMultiple: number;
  leverageMultiple: number;
  exitMultiple: number;
  growthPct: number;
  holdYears: number;
  advisoryFeePct: number;
  financingFeePct: number;
  mgmtFeePct: number;
  prefPct: number;
  carryPct: number;
  debtPaydownPct: number;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

const PARAM_COLS = `id, entry_multiple_low, entry_multiple_high, target_irr,
  leverage_low, leverage_high, entry_multiple, leverage_multiple,
  exit_multiple, growth_pct, hold_years, advisory_fee_pct,
  financing_fee_pct, mgmt_fee_pct, pref_pct, carry_pct, debt_paydown_pct,
  updated_by, created_at, updated_at`;

function rowToParams(r: Record<string, unknown>): ValuationParams {
  return {
    id: str(r.id) || "global",
    entryMultipleLow: num(r.entry_multiple_low),
    entryMultipleHigh: num(r.entry_multiple_high),
    targetIrr: num(r.target_irr),
    leverageLow: num(r.leverage_low),
    leverageHigh: num(r.leverage_high),
    entryMultiple: num(r.entry_multiple),
    leverageMultiple: num(r.leverage_multiple),
    exitMultiple: num(r.exit_multiple),
    growthPct: num(r.growth_pct),
    holdYears: num(r.hold_years),
    advisoryFeePct: num(r.advisory_fee_pct),
    financingFeePct: num(r.financing_fee_pct),
    mgmtFeePct: num(r.mgmt_fee_pct),
    prefPct: num(r.pref_pct),
    carryPct: num(r.carry_pct),
    debtPaydownPct: num(r.debt_paydown_pct),
    updatedBy: str(r.updated_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/** The global house valuation params (capital.valuation_params 'global'). */
export async function getValuationParams(): Promise<ValuationParams> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(PARAM_COLS)} FROM capital.valuation_params
    WHERE id = 'global' LIMIT 1`;
  if (!rows.length) throw new Error("valuation_params_not_found");
  return rowToParams(rows[0] as Record<string, unknown>);
}

/* ------------------------------ inputs ------------------------------- */

export interface EconomicsInputs {
  dealId: string;
  ebitdaOverride: number | null;
  entryMultiple: number | null;
  leverageMultiple: number | null;
  exitMultiple: number | null;
  growthPct: number | null;
  holdYears: number | null;
  advisoryFeePct: number | null;
  financingFeePct: number | null;
  mgmtFeePct: number | null;
  prefPct: number | null;
  carryPct: number | null;
  rolloverEquity: number | null;
  debtPaydownPct: number | null;
  snapshot: EconomicsResult | null;
  snapshotAt: string | null;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

/** The writable economics input fields (camelCase API ↔ snake columns). */
export interface EconomicsInputsPatch {
  ebitdaOverride?: number | null;
  entryMultiple?: number | null;
  leverageMultiple?: number | null;
  exitMultiple?: number | null;
  growthPct?: number | null;
  holdYears?: number | null;
  advisoryFeePct?: number | null;
  financingFeePct?: number | null;
  mgmtFeePct?: number | null;
  prefPct?: number | null;
  carryPct?: number | null;
  rolloverEquity?: number | null;
  debtPaydownPct?: number | null;
}

const INPUT_COLS = `deal_id, ebitda_override, entry_multiple,
  leverage_multiple, exit_multiple, growth_pct, hold_years,
  advisory_fee_pct, financing_fee_pct, mgmt_fee_pct, pref_pct, carry_pct,
  rollover_equity, debt_paydown_pct, snapshot, snapshot_at, updated_by,
  created_at, updated_at`;

function jsonResult(v: unknown): EconomicsResult | null {
  if (v && typeof v === "object") return v as EconomicsResult;
  if (typeof v === "string" && v.trim()) {
    try {
      const p: unknown = JSON.parse(v);
      return p && typeof p === "object" ? (p as EconomicsResult) : null;
    } catch {
      return null;
    }
  }
  return null;
}

function rowToInputs(r: Record<string, unknown>): EconomicsInputs {
  return {
    dealId: str(r.deal_id),
    ebitdaOverride: numOrNull(r.ebitda_override),
    entryMultiple: numOrNull(r.entry_multiple),
    leverageMultiple: numOrNull(r.leverage_multiple),
    exitMultiple: numOrNull(r.exit_multiple),
    growthPct: numOrNull(r.growth_pct),
    holdYears: numOrNull(r.hold_years),
    advisoryFeePct: numOrNull(r.advisory_fee_pct),
    financingFeePct: numOrNull(r.financing_fee_pct),
    mgmtFeePct: numOrNull(r.mgmt_fee_pct),
    prefPct: numOrNull(r.pref_pct),
    carryPct: numOrNull(r.carry_pct),
    rolloverEquity: numOrNull(r.rollover_equity),
    debtPaydownPct: numOrNull(r.debt_paydown_pct),
    snapshot: jsonResult(r.snapshot),
    snapshotAt: isoOrNull(r.snapshot_at),
    updatedBy: str(r.updated_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function emptyInputs(dealId: string): EconomicsInputs {
  return {
    dealId,
    ebitdaOverride: null,
    entryMultiple: null,
    leverageMultiple: null,
    exitMultiple: null,
    growthPct: null,
    holdYears: null,
    advisoryFeePct: null,
    financingFeePct: null,
    mgmtFeePct: null,
    prefPct: null,
    carryPct: null,
    rolloverEquity: null,
    debtPaydownPct: null,
    snapshot: null,
    snapshotAt: null,
    updatedBy: "",
    createdAt: "",
    updatedAt: "",
  };
}

/** Stored (raw, un-resolved) economics inputs for a deal. */
export async function getEconomicsInputs(
  dealId: string
): Promise<EconomicsInputs> {
  await ensureCapital();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(INPUT_COLS)} FROM capital.economics_inputs
    WHERE deal_id = ${dealId} AND deleted_at IS NULL LIMIT 1`;
  return rows.length
    ? rowToInputs(rows[0] as Record<string, unknown>)
    : emptyInputs(dealId);
}

async function ensureInputsRow(
  dealId: string,
  actor: string
): Promise<EconomicsInputs> {
  const db = sql();
  await db`
    INSERT INTO capital.economics_inputs (deal_id, updated_by)
    VALUES (${dealId}, ${actor})
    ON CONFLICT (deal_id) DO NOTHING`;
  return getEconomicsInputs(dealId);
}

/**
 * Save provided input fields (undefined leaves the column untouched;
 * explicit null clears it back to param inheritance). Creates the
 * inputs row when absent.
 */
export async function saveEconomicsInputs(
  dealId: string,
  patch: EconomicsInputsPatch,
  actor: string
): Promise<EconomicsInputs> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");
  await ensureInputsRow(dealId, actor);
  const cur = await getEconomicsInputs(dealId);
  const pick = (
    v: number | null | undefined,
    curVal: number | null
  ): number | null => (v === undefined ? curVal : v);
  const db = sql();
  await db`
    UPDATE capital.economics_inputs
    SET ebitda_override = ${pick(patch.ebitdaOverride, cur.ebitdaOverride)},
        entry_multiple = ${pick(patch.entryMultiple, cur.entryMultiple)},
        leverage_multiple = ${pick(patch.leverageMultiple, cur.leverageMultiple)},
        exit_multiple = ${pick(patch.exitMultiple, cur.exitMultiple)},
        growth_pct = ${pick(patch.growthPct, cur.growthPct)},
        hold_years = ${pick(patch.holdYears, cur.holdYears)},
        advisory_fee_pct = ${pick(patch.advisoryFeePct, cur.advisoryFeePct)},
        financing_fee_pct = ${pick(patch.financingFeePct, cur.financingFeePct)},
        mgmt_fee_pct = ${pick(patch.mgmtFeePct, cur.mgmtFeePct)},
        pref_pct = ${pick(patch.prefPct, cur.prefPct)},
        carry_pct = ${pick(patch.carryPct, cur.carryPct)},
        rollover_equity = ${pick(patch.rolloverEquity, cur.rolloverEquity)},
        debt_paydown_pct = ${pick(patch.debtPaydownPct, cur.debtPaydownPct)},
        updated_by = ${actor}, updated_at = now()
    WHERE deal_id = ${dealId} AND deleted_at IS NULL`;
  return getEconomicsInputs(dealId);
}

/* --------------------------- resolved inputs -------------------------- */

export interface ResolvedInputs {
  ebitda: number | null;
  entryMultiple: number;
  leverageMultiple: number;
  exitMultiple: number;
  growthPct: number;
  holdYears: number;
  advisoryFeePct: number;
  financingFeePct: number;
  mgmtFeePct: number;
  prefPct: number;
  carryPct: number;
  rolloverEquity: number;
  debtPaydownPct: number;
}

/** Core inputs with a concrete EBITDA — the pure engine's input. */
export interface EconomicsCoreInputs extends ResolvedInputs {
  ebitda: number;
}

export function resolveInputs(
  stored: EconomicsInputs,
  params: ValuationParams,
  ebitda: number | null
): ResolvedInputs {
  return {
    ebitda,
    entryMultiple: stored.entryMultiple ?? params.entryMultiple,
    leverageMultiple: stored.leverageMultiple ?? params.leverageMultiple,
    exitMultiple: stored.exitMultiple ?? params.exitMultiple,
    growthPct: stored.growthPct ?? params.growthPct,
    holdYears: stored.holdYears ?? params.holdYears,
    advisoryFeePct: stored.advisoryFeePct ?? params.advisoryFeePct,
    financingFeePct: stored.financingFeePct ?? params.financingFeePct,
    mgmtFeePct: stored.mgmtFeePct ?? params.mgmtFeePct,
    prefPct: stored.prefPct ?? params.prefPct,
    carryPct: stored.carryPct ?? params.carryPct,
    rolloverEquity: stored.rolloverEquity ?? 0,
    debtPaydownPct: stored.debtPaydownPct ?? params.debtPaydownPct,
  };
}

/* ----------------------------- pure engine ---------------------------- */

export interface EconomicsResult {
  available: boolean;
  reason: string | null;
  ebitda: number | null;
  ebitdaSource: "override" | "analysis" | null;
  analysisId: string | null;
  resolvedInputs: ResolvedInputs;
  sourcesUses: {
    sources: { debt: number; rolloverEquity: number; equity: number };
    uses: {
      purchasePrice: number;
      advisoryFee: number;
      financingFee: number;
      totalFees: number;
      totalUses: number;
    };
  } | null;
  feeStack: Array<{ key: string; label: string; amount: number; basis: number }>;
  returns: {
    exitEbitda: number | null;
    exitValue: number | null;
    netDebtAtExit: number | null;
    equityOutTotal: number | null;
    investorShare: number | null;
    investorOutGross: number | null;
    profit: number | null;
    prefAmount: number | null;
    carry: number | null;
    mgmtFees: number | null;
    investorOutNet: number | null;
    grossMoic: number | null;
    grossIrr: number | null;
    netMoic: number | null;
    netIrr: number | null;
  };
  sensitivity: {
    entryMultiples: number[];
    exitMultiples: number[];
    leverages: number[];
    /** netIrrCube[leverageIdx][entryIdx][exitIdx] — null when undefined. */
    netIrr: Array<Array<Array<number | null>>>;
  };
  notes: string[];
  computedAt: string;
}

const RESULT_NOTES = [
  "Carry is charged only on profit above the accrued pref — no GP catch-up.",
  "Debt held constant except stated paydown %; no interim cash flows.",
];

interface CoreComputation {
  enterpriseValue: number;
  debt: number;
  advisoryFee: number;
  financingFee: number;
  totalFees: number;
  totalUses: number;
  equityIn: number;
  exitEbitda: number;
  exitValue: number;
  netDebtAtExit: number;
  equityOutTotal: number;
  totalEquity: number;
  investorShare: number;
  investorOutGross: number;
  profit: number;
  prefAmount: number;
  carry: number;
  mgmtFees: number;
  investorOutNet: number;
  grossMoic: number | null;
  grossIrr: number | null;
  netMoic: number | null;
  netIrr: number | null;
}

/**
 * Unrounded core computation for one concrete input set. When the new-
 * money equity check is ≤ 0 the deal economics are undefined and every
 * return figure comes back null (callers that need the structure error
 * check equityIn themselves — see computeForDeal).
 */
function computeCore(inp: EconomicsCoreInputs): CoreComputation {
  const E = inp.ebitda;
  const enterpriseValue = E * inp.entryMultiple;
  const debt = Math.min(inp.leverageMultiple * E, 0.9 * enterpriseValue);
  const advisoryFee = inp.advisoryFeePct * enterpriseValue;
  const financingFee = inp.financingFeePct * debt;
  const totalFees = advisoryFee + financingFee;
  const totalUses = enterpriseValue + totalFees;
  const equityIn = totalUses - debt - inp.rolloverEquity;

  const exitEbitda = E * Math.pow(1 + inp.growthPct, inp.holdYears);
  const exitValue = exitEbitda * inp.exitMultiple;
  const netDebtAtExit = debt * (1 - inp.debtPaydownPct);
  const equityOutTotal = exitValue - netDebtAtExit;

  const base: CoreComputation = {
    enterpriseValue,
    debt,
    advisoryFee,
    financingFee,
    totalFees,
    totalUses,
    equityIn,
    exitEbitda,
    exitValue,
    netDebtAtExit,
    equityOutTotal,
    totalEquity: equityIn + inp.rolloverEquity,
    investorShare: 0,
    investorOutGross: 0,
    profit: 0,
    prefAmount: 0,
    carry: 0,
    mgmtFees: 0,
    investorOutNet: 0,
    grossMoic: null,
    grossIrr: null,
    netMoic: null,
    netIrr: null,
  };
  if (!(equityIn > 0)) return base;

  const totalEquity = equityIn + inp.rolloverEquity;
  const investorShare = totalEquity > 0 ? equityIn / totalEquity : 0;
  const investorOutGross = equityOutTotal * investorShare;
  const profit = investorOutGross - equityIn;
  const prefAmount = equityIn * (Math.pow(1 + inp.prefPct, inp.holdYears) - 1);
  // No catch-up: carry applies only to profit above the pref amount.
  const carry = inp.carryPct * Math.max(0, profit - prefAmount);
  const mgmtFees = inp.mgmtFeePct * equityIn * inp.holdYears;
  const investorOutNet = investorOutGross - carry - mgmtFees;

  const grossMoic = investorOutGross / equityIn;
  const grossIrr =
    investorOutGross > 0 && inp.holdYears > 0
      ? Math.pow(grossMoic, 1 / inp.holdYears) - 1
      : null;
  const netMoic = investorOutNet / equityIn;
  const netIrr =
    investorOutNet > 0 && inp.holdYears > 0
      ? Math.pow(netMoic, 1 / inp.holdYears) - 1
      : null;

  return {
    ...base,
    totalEquity,
    investorShare,
    investorOutGross,
    profit,
    prefAmount,
    carry,
    mgmtFees,
    investorOutNet,
    grossMoic,
    grossIrr,
    netMoic,
    netIrr,
  };
}

function multipleLadder(center: number): number[] {
  const raw = [center - 1, center - 0.5, center, center + 0.5, center + 1].map(
    (v) => round6(Math.max(0.5, v))
  );
  return Array.from(new Set(raw)).sort((a, b) => a - b);
}

function leverageLadder(center: number): number[] {
  const raw = [Math.max(0, center - 1), center, center + 1].map((v) =>
    round6(v)
  );
  return Array.from(new Set(raw)).sort((a, b) => a - b);
}

function resultFromCore(
  inp: EconomicsCoreInputs,
  meta: {
    ebitdaSource: "override" | "analysis";
    analysisId: string | null;
    computedAt: string;
  }
): EconomicsResult {
  const core = computeCore(inp);
  const defined = core.equityIn > 0;
  const entryMultiples = multipleLadder(inp.entryMultiple);
  const exitMultiples = multipleLadder(inp.exitMultiple);
  const leverages = leverageLadder(inp.leverageMultiple);

  // Sensitivity cube: [leverage][entry][exit], each cell a full
  // recomputation with those three inputs substituted.
  const netIrrCube: Array<Array<Array<number | null>>> = leverages.map((lev) =>
    entryMultiples.map((entry) =>
      exitMultiples.map((exit) => {
        const cell = computeCore({
          ...inp,
          entryMultiple: entry,
          leverageMultiple: lev,
          exitMultiple: exit,
        });
        return cell.netIrr === null ? null : round6(cell.netIrr);
      })
    )
  );

  const moneyOrNull = (v: number): number | null =>
    defined ? round2(v) : null;
  const ratioOrNull = (v: number | null): number | null =>
    defined && v !== null ? round6(v) : null;

  return {
    available: true,
    reason: null,
    ebitda: round2(inp.ebitda),
    ebitdaSource: meta.ebitdaSource,
    analysisId: meta.analysisId,
    resolvedInputs: {
      ebitda: round2(inp.ebitda),
      entryMultiple: round6(inp.entryMultiple),
      leverageMultiple: round6(inp.leverageMultiple),
      exitMultiple: round6(inp.exitMultiple),
      growthPct: round6(inp.growthPct),
      holdYears: round6(inp.holdYears),
      advisoryFeePct: round6(inp.advisoryFeePct),
      financingFeePct: round6(inp.financingFeePct),
      mgmtFeePct: round6(inp.mgmtFeePct),
      prefPct: round6(inp.prefPct),
      carryPct: round6(inp.carryPct),
      rolloverEquity: round2(inp.rolloverEquity),
      debtPaydownPct: round6(inp.debtPaydownPct),
    },
    sourcesUses: {
      sources: {
        debt: round2(core.debt),
        rolloverEquity: round2(inp.rolloverEquity),
        equity: round2(core.equityIn),
      },
      uses: {
        purchasePrice: round2(core.enterpriseValue),
        advisoryFee: round2(core.advisoryFee),
        financingFee: round2(core.financingFee),
        totalFees: round2(core.totalFees),
        totalUses: round2(core.totalUses),
      },
    },
    feeStack: [
      {
        key: "advisory",
        label: "Advisory fee",
        amount: round2(core.advisoryFee),
        basis: round2(core.enterpriseValue),
      },
      {
        key: "financing",
        label: "Financing fee",
        amount: round2(core.financingFee),
        basis: round2(core.debt),
      },
      {
        key: "management",
        label: "Management fee",
        amount: round2(core.mgmtFees),
        basis: round2(core.equityIn),
      },
    ],
    returns: {
      exitEbitda: moneyOrNull(core.exitEbitda),
      exitValue: moneyOrNull(core.exitValue),
      netDebtAtExit: moneyOrNull(core.netDebtAtExit),
      equityOutTotal: moneyOrNull(core.equityOutTotal),
      investorShare: defined ? round6(core.investorShare) : null,
      investorOutGross: moneyOrNull(core.investorOutGross),
      profit: moneyOrNull(core.profit),
      prefAmount: moneyOrNull(core.prefAmount),
      carry: moneyOrNull(core.carry),
      mgmtFees: moneyOrNull(core.mgmtFees),
      investorOutNet: moneyOrNull(core.investorOutNet),
      grossMoic: ratioOrNull(core.grossMoic),
      grossIrr: ratioOrNull(core.grossIrr),
      netMoic: ratioOrNull(core.netMoic),
      netIrr: ratioOrNull(core.netIrr),
    },
    sensitivity: {
      entryMultiples,
      exitMultiples,
      leverages,
      netIrr: netIrrCube,
    },
    notes: [...RESULT_NOTES],
    computedAt: meta.computedAt,
  };
}

/**
 * Pure economics computation over fully-resolved inputs (EBITDA
 * concrete). No DB access — the battery may call this directly.
 */
export function computeEconomics(
  resolved: EconomicsCoreInputs,
  meta: {
    ebitdaSource?: "override" | "analysis";
    analysisId?: string | null;
    computedAt?: string;
  } = {}
): EconomicsResult {
  return resultFromCore(resolved, {
    ebitdaSource: meta.ebitdaSource ?? "analysis",
    analysisId: meta.analysisId ?? null,
    computedAt: meta.computedAt ?? new Date().toISOString(),
  });
}

/** Alias for computeEconomics (house naming symmetry). */
export const computeDealEconomics = computeEconomics;

function unavailableResult(
  resolved: ResolvedInputs,
  computedAt: string
): EconomicsResult {
  const entryMultiples = multipleLadder(resolved.entryMultiple);
  const exitMultiples = multipleLadder(resolved.exitMultiple);
  const leverages = leverageLadder(resolved.leverageMultiple);
  return {
    available: false,
    reason: "no_approved_analysis",
    ebitda: null,
    ebitdaSource: null,
    analysisId: null,
    resolvedInputs: {
      ...resolved,
      entryMultiple: round6(resolved.entryMultiple),
      leverageMultiple: round6(resolved.leverageMultiple),
      exitMultiple: round6(resolved.exitMultiple),
      growthPct: round6(resolved.growthPct),
      holdYears: round6(resolved.holdYears),
      advisoryFeePct: round6(resolved.advisoryFeePct),
      financingFeePct: round6(resolved.financingFeePct),
      mgmtFeePct: round6(resolved.mgmtFeePct),
      prefPct: round6(resolved.prefPct),
      carryPct: round6(resolved.carryPct),
      rolloverEquity: round2(resolved.rolloverEquity),
      debtPaydownPct: round6(resolved.debtPaydownPct),
    },
    sourcesUses: null,
    feeStack: [],
    returns: {
      exitEbitda: null,
      exitValue: null,
      netDebtAtExit: null,
      equityOutTotal: null,
      investorShare: null,
      investorOutGross: null,
      profit: null,
      prefAmount: null,
      carry: null,
      mgmtFees: null,
      investorOutNet: null,
      grossMoic: null,
      grossIrr: null,
      netMoic: null,
      netIrr: null,
    },
    sensitivity: {
      entryMultiples,
      exitMultiples,
      leverages,
      netIrr: leverages.map(() =>
        entryMultiples.map(() => exitMultiples.map(() => null))
      ),
    },
    notes: [...RESULT_NOTES],
    computedAt,
  };
}

/* --------------------------- compute service -------------------------- */

/**
 * Resolve the published analysis id for metadata purposes only. All
 * FIGURES come from getPublishedAnalysis; the published service does
 * not expose the analysis record id, so when the current analysis is
 * the approved one that produced the published payload (same
 * generatedAt) its id/approver are trustworthy metadata. Otherwise the
 * id is honestly null.
 */
async function publishedAnalysisMeta(
  companyId: string,
  publishedGeneratedAt: string
): Promise<{ id: string | null }> {
  try {
    const cur = await getCurrentAnalysis(companyId);
    if (
      cur &&
      cur.analysis.status === "approved" &&
      cur.payload.generatedAt === publishedGeneratedAt
    ) {
      return { id: cur.analysis.id };
    }
  } catch {
    /* metadata is best-effort; figures never depend on it */
  }
  return { id: null };
}

/**
 * Compute the deal's economics from stored inputs + global params +
 * the published financial analysis, and persist the result as the
 * inputs row's snapshot (creating the row when absent; input columns
 * stay NULL so param inheritance remains live).
 */
export async function computeForDeal(
  dealId: string,
  actor = ""
): Promise<EconomicsResult> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");
  const params = await getValuationParams();
  let stored = await getEconomicsInputs(dealId);
  const computedAt = new Date().toISOString();

  // EBITDA: override first, else the approved analysis margin bridge.
  let ebitda: number | null = stored.ebitdaOverride;
  let ebitdaSource: "override" | "analysis" | null =
    ebitda !== null ? "override" : null;
  let analysisId: string | null = null;
  if (ebitda === null && ctx.companyId) {
    const published = await getPublishedAnalysis(ctx.companyId);
    const adjusted = published?.marginBridge?.adjustedEbitda ?? null;
    if (published && adjusted !== null && isFinite(adjusted)) {
      ebitda = adjusted;
      ebitdaSource = "analysis";
      analysisId = (await publishedAnalysisMeta(ctx.companyId, published.generatedAt)).id;
    }
  }

  const resolved = resolveInputs(stored, params, ebitda);
  let result: EconomicsResult;
  if (ebitda === null || ebitdaSource === null) {
    result = unavailableResult(resolved, computedAt);
  } else {
    const coreInputs: EconomicsCoreInputs = { ...resolved, ebitda };
    const probe = computeCore(coreInputs);
    if (probe.equityIn <= 0 && ebitda > 0) {
      throw new Error("invalid_structure");
    }
    result = resultFromCore(coreInputs, {
      ebitdaSource,
      analysisId,
      computedAt,
    });
  }

  // Persist the snapshot (creating the inputs row when absent).
  stored = await ensureInputsRow(dealId, actor);
  const db = sql();
  await db`
    UPDATE capital.economics_inputs
    SET snapshot = ${JSON.stringify(result)}::jsonb, snapshot_at = now(),
        updated_at = now()
    WHERE deal_id = ${dealId} AND deleted_at IS NULL`;
  return result;
}

/** GET economics payload: stored raw inputs + global params + snapshot. */
export async function getEconomics(
  dealId: string
): Promise<{
  inputs: EconomicsInputs;
  params: ValuationParams;
  result: EconomicsResult | null;
}> {
  await ensureCapital();
  const ctx = await getDealContext(dealId);
  if (!ctx) throw new Error("deal_not_found");
  const [inputs, params] = await Promise.all([
    getEconomicsInputs(dealId),
    getValuationParams(),
  ]);
  return { inputs, params, result: inputs.snapshot };
}

/** POST economics: save provided inputs, then compute. */
export async function saveAndComputeEconomics(
  dealId: string,
  patch: EconomicsInputsPatch,
  actor: string
): Promise<{ inputs: EconomicsInputs; result: EconomicsResult }> {
  await saveEconomicsInputs(dealId, patch, actor);
  const result = await computeForDeal(dealId, actor);
  const inputs = await getEconomicsInputs(dealId);
  return { inputs, result };
}
