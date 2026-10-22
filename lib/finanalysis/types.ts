/**
 * Part 4B — shared types for the automated financial analysis engine.
 *
 * Verbatim from the 4B build contract (~/workspace/.p4bpush/CONTRACT.md,
 * "Shared types" section), plus BenchmarkRow (benchmarks table row as
 * consumed by the engine) and the DealScreen grid/sensitivity row types
 * the contract leaves to dealscreen.ts.
 *
 * StatementSet / StatementLine are imported as TYPES ONLY from the
 * Phase 4 financials service. service.ts imports template/parse only —
 * never finanalysis — so there is no circular-import risk.
 */
import type { StatementSet, StatementLine } from "../financials/service";

export type { StatementSet, StatementLine };

export interface AnalysisPeriodInput {
  set: StatementSet; // from financials service
  lines: StatementLine[];
}

/** Alias used by the integrity suite (same shape). */
export type IntegrityPeriodInput = AnalysisPeriodInput;

export interface MetricValue {
  key: string;
  label: string;
  group: "liquidity" | "leverage" | "profitability" | "efficiency" | "growth";
  value: number | null;
  unit: "x" | "pct" | "usd" | "days" | "count";
  prior: number | null;
  deltaPct: number | null;
  formula: string;
  sourceLines: string[]; // template line keys used
  confidence: "high" | "medium" | "low";
  benchmark: {
    median: number | null;
    p25: number | null;
    p75: number | null;
    thin: boolean;
  } | null;
  note: string; // '' when value present; WHY when null
}

export interface AnomalyFlag {
  rule: string;
  severity: "high" | "medium" | "low";
  message: string;
  setId: string | null;
  periodEnd: string | null;
  figures: Record<string, number | null>;
  sourceLines: string[];
}

export interface CoverageNote {
  rule: string;
  reason: string;
}

export interface IntegrityCheckResult {
  check:
    | "bs_balance"
    | "cf_ties_cash"
    | "retained_earnings_rollforward"
    | "subledger_ties"
    | "period_continuity"
    | "monthly_vs_annual";
  scope: "set" | "company";
  setId: string | null;
  periodEnd: string | null;
  status: "pass" | "fail" | "not_applicable";
  message: string; // SPECIFIC: names figures + variance
  figures: Record<string, number | string | null>;
}

export interface SuggestionSeed {
  kind: string;
  label: string;
  amount: number | null;
  direction: "add" | "subtract";
  rationale: string;
  source: Record<string, unknown>;
  requiresInput: string | null;
  reportedSetId: string;
}

export interface WorkingCapitalData {
  points: {
    setId: string;
    periodEnd: string | null;
    wc: number;
    revenue: number | null;
    wcPctRevenue: number | null;
  }[];
  normalizedWcPct: number | null;
  peg: { low: number | null; mid: number | null; high: number | null; basis: string };
  seasonality: { month: number; index: number | null }[];
  missingInputs: string[];
}

export interface RevenueQualityData {
  periodEnd: string | null;
  revenue: number | null;
  identifiedOneTime: number | null;
  identifiedRecurring: number | null;
  concentration: {
    available: boolean;
    customers: { name: string; amount: number; sharePct: number }[];
    top1Pct: number | null;
    top5Pct: number | null;
    sourceSetId: string | null;
  };
  backlog: { amount: number | null; sourceSetId: string | null };
  missingInputs: string[];
}

export interface DealScreenAssumptions {
  leverageMultiple: number;
  feesPct: number;
  growthPct: number;
  holdYears: number;
  debtPaydownPct: number;
}

export interface DealScreenGridRow {
  entryMultiple: number;
  enterpriseValue: number | null;
  debt: number | null;
  fees: number | null;
  equityCheck: number | null;
  exitEbitda: number | null;
  exitValue: number | null;
  equityOut: number | null;
  moic: number | null;
  irr: number | null;
}

export interface DealScreenSensitivityCell {
  entryMultiple: number;
  exitMultiple: number;
  irr: number | null;
  moic: number | null;
}

export interface DealScreenData {
  ebitda: number | null;
  /** Basis label: 'adjusted' | 'reported' | 'ttm-reported' | 'ttm-adjusted'. */
  ebitdaBasis: string;
  /** Alias of ebitdaBasis (the contract calls it "basis label"). */
  basis: string;
  assumptionsUsed: DealScreenAssumptions;
  assumptionNotes: string[];
  grid: DealScreenGridRow[];
  sensitivity: DealScreenSensitivityCell[];
}

export interface AnalysisPayload {
  companyId: string;
  generatedAt: string;
  industry: string;
  periods: {
    setId: string;
    periodEnd: string | null;
    periodType: string;
    periodStart: string | null;
    layer: string;
  }[];
  metricsByPeriod: { setId: string; periodEnd: string | null; metrics: MetricValue[] }[];
  integrity: IntegrityCheckResult[];
  anomalies: AnomalyFlag[];
  coverage: CoverageNote[];
  marginBridge: {
    reportedSetId: string;
    reportedEbitda: number | null;
    items: { label: string; amount: number }[]; // signed effect on EBITDA
    adjustedEbitda: number | null;
    adjustedSetId: string | null;
  } | null;
  revenueQuality: RevenueQualityData;
  workingCapital: WorkingCapitalData;
  dealScreen: DealScreenData;
  chartData: {
    monthly: {
      periodEnd: string | null;
      revenue: number | null;
      ebitda: number | null;
      seasonalityIndex: number | null;
    }[];
    bsComposition: {
      periodEnd: string | null;
      assets: {
        cash: number | null;
        accountsReceivable: number | null;
        inventory: number | null;
        otherCurrent: number | null;
        ppe: number | null;
        intangibles: number | null;
        other: number | null;
      };
      liabEquity: {
        accountsPayable: number | null;
        currentDebt: number | null;
        otherCurrent: number | null;
        longTermDebt: number | null;
        otherLiab: number | null;
        equity: number | null;
      };
    }[];
    cashConversion: {
      periodEnd: string | null;
      ebitda: number | null;
      cfo: number | null;
      cfi: number | null;
      fcf: number | null;
    } | null;
  };
  missingInputs: string[];
}

/** Benchmarks table row as consumed by the engine (lib/finanalysis benchmarks). */
export interface BenchmarkRow {
  industry: string;
  metricKey: string;
  median: number | null;
  p25: number | null;
  p75: number | null;
  sampleSize: number | null;
}

/** An accepted QoE adjustment decision, as passed to the engine by the service. */
export interface AcceptedAdjustmentInput {
  label: string;
  amount: number;
  direction: "add" | "subtract";
  reportedSetId: string;
}
