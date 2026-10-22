/**
 * Part 4B — analysis engine (PURE, no DB / fs / clock).
 *
 * buildAnalysisPayload(input) -> { payload, suggestionSeeds }
 *
 * Inputs: posted current sets as AnalysisPeriodInput[] (the service
 * passes reported-layer sets as the primary chain; adjusted-layer sets
 * may ride along in `periods` and/or in `adjustedSets`), benchmark rows,
 * industry, and a caller-supplied generatedAt timestamp (this module
 * never reads the clock).
 *
 * MARGIN BRIDGE — exact behavior (the engine cannot see accept/reject
 * decisions, so the service passes them in):
 * - The bridge is built for the LATEST reported period that has a
 *   stated EBITDA. If no reported period has EBITDA, marginBridge null.
 * - items = input.acceptedAdjustments filtered to that set's id,
 *   signed by direction ('add' -> +amount, 'subtract' -> -amount).
 *   Proposed (undecided) suggestions NEVER appear in the bridge.
 * - The matching adjusted set is an adjusted-layer set whose
 *   basedOnSetId equals the reported set id (preferred; posted first,
 *   then highest version), else one with the same seriesId and
 *   periodEnd. When a matching adjusted set with a stated EBITDA
 *   exists, adjustedEbitda = THAT set's EBITDA (the QoE layer of
 *   record wins over reported + items if the two disagree) and
 *   adjustedSetId = its id. Otherwise adjustedEbitda =
 *   reportedEbitda + sum(items) when items exist, else reportedEbitda,
 *   and adjustedSetId = null.
 *
 * DEAL SCREEN EBITDA basis (payload.dealScreen): an adjusted set
 * matching the latest reported period wins (basis 'adjusted'); else if
 * the chain's latest period is monthly with >= 12 monthly periods (or
 * quarterly with >= 4), the trailing sum is used (basis 'ttm-reported');
 * else the latest reported EBITDA (basis 'reported').
 *
 * SUGGESTION SEEDS without provenance: a seed that carries an amount is
 * emitted only when its originating line has source.documentId (per
 * contract, sourceless suggestions are allowed only for requiresInput
 * kinds — related-party rent / owner comp — whose rationale says so
 * when the line has no source document). The anomaly flag for such a
 * line is still raised; only the seed is withheld.
 */
import { computeDealScreen } from "./dealscreen";
import { detectSchedulesInSet, lineVal, monthDiff, runIntegritySuite } from "./integrity";
import type {
  AcceptedAdjustmentInput,
  AnalysisPayload,
  AnalysisPeriodInput,
  AnomalyFlag,
  BenchmarkRow,
  CoverageNote,
  MetricValue,
  RevenueQualityData,
  StatementLine,
  SuggestionSeed,
  WorkingCapitalData,
} from "./types";

/* ---------------------------- value helpers -------------------------- */

export function val(lines: StatementLine[], key: string): number | null {
  return lineVal(lines, key);
}

export function detailLines(lines: StatementLine[], key: string): StatementLine[] {
  return lines.filter((l) => l.lineKey === key);
}

/** Inclusive month count of a period; periodType fallbacks per contract. */
export function monthsInPeriod(p: AnalysisPeriodInput): number {
  const s = p.set.periodStart;
  const e = p.set.periodEnd;
  if (s && e) {
    const d = monthDiff(s, e);
    if (d !== null && d >= 0) return d + 1;
  }
  if (p.set.periodType === "annual") return 12;
  if (p.set.periodType === "quarterly") return 3;
  if (p.set.periodType === "monthly") return 1;
  return 12;
}

export function annualize(flowValue: number | null, p: AnalysisPeriodInput): number | null {
  if (flowValue === null) return null;
  const m = monthsInPeriod(p);
  return m > 0 ? (flowValue * 12) / m : flowValue;
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "n/a";
  return `$${n}`;
}

function fmtPct(frac: number | null): string {
  if (frac === null || !isFinite(frac)) return "n/a";
  return `${(frac * 100).toFixed(1)}%`;
}

/* ---------------------------- period chain --------------------------- */

export function reportedChain(periods: AnalysisPeriodInput[]): AnalysisPeriodInput[] {
  return periods
    .filter((p) => p.set.layer === "reported")
    .slice()
    .sort((a, b) => {
      const ea = a.set.periodEnd;
      const eb = b.set.periodEnd;
      if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
      if (ea && !eb) return -1;
      if (!ea && eb) return 1;
      if (ea && eb) {
        // Same periodEnd (e.g. a December monthly set, detail schedules,
        // and the annual set all ending Dec 31): longer periods sort
        // later, so "latest period" reads resolve to the annual set.
        const spanA = monthDiff(a.set.periodStart, a.set.periodEnd) ?? 0;
        const spanB = monthDiff(b.set.periodStart, b.set.periodEnd) ?? 0;
        if (spanA !== spanB) return spanA - spanB;
      }
      const sa = a.set.periodStart ?? "";
      const sb = b.set.periodStart ?? "";
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
}

export function priorOf(
  chain: AnalysisPeriodInput[],
  period: AnalysisPeriodInput
): AnalysisPeriodInput | null {
  const idx = chain.indexOf(period);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    if (chain[i].set.periodType === period.set.periodType) return chain[i];
  }
  return chain[idx - 1];
}

export function yearAgoOf(
  chain: AnalysisPeriodInput[],
  period: AnalysisPeriodInput
): AnalysisPeriodInput | null {
  if (!period.set.periodEnd) return null;
  let best: AnalysisPeriodInput | null = null;
  let bestDist = Infinity;
  let bestSameType: AnalysisPeriodInput | null = null;
  let bestSameDist = Infinity;
  for (const c of chain) {
    if (c === period || !c.set.periodEnd) continue;
    if (c.set.periodEnd >= period.set.periodEnd) continue;
    const d = monthDiff(c.set.periodEnd, period.set.periodEnd);
    if (d === null || d < 11 || d > 13) continue;
    const dist = Math.abs(d - 12);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
    if (c.set.periodType === period.set.periodType && dist < bestSameDist) {
      bestSameDist = dist;
      bestSameType = c;
    }
  }
  return bestSameType ?? best;
}

/** Comparison period for trend math: year-ago preferred, else prior. */
function comparisonOf(
  chain: AnalysisPeriodInput[],
  period: AnalysisPeriodInput
): AnalysisPeriodInput | null {
  return yearAgoOf(chain, period) ?? priorOf(chain, period);
}

function growth(cur: number | null, base: number | null): number | null {
  if (cur === null || base === null || base === 0) return null;
  return cur / base - 1;
}

/* ------------------------------ stats -------------------------------- */

function median(nums: number[]): number | null {
  if (!nums.length) return null;
  return percentile(nums, 0.5);
}

function percentile(nums: number[], p: number): number | null {
  if (!nums.length) return null;
  const sorted = nums.slice().sort((a, b) => a - b);
  const pos = p * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/* --------------------------- headcount ------------------------------- */

const HEADCOUNT_RE = /employee|headcount|fte/i;

/** Latest headcount-looking detail/unmapped line across all sets. */
export function findHeadcount(allPeriods: AnalysisPeriodInput[]): number | null {
  const sorted = allPeriods.slice().sort((a, b) => {
    const ea = a.set.periodEnd ?? "";
    const eb = b.set.periodEnd ?? "";
    return ea < eb ? 1 : ea > eb ? -1 : 0;
  });
  for (const p of sorted) {
    for (const l of p.lines) {
      if (
        (l.lineKey === "unmapped" || l.lineKey === "opex_detail") &&
        l.value !== null &&
        l.value > 0 &&
        HEADCOUNT_RE.test(l.label ?? "")
      ) {
        return l.value;
      }
    }
  }
  return null;
}

/* ------------------------------ metrics ------------------------------ */

function confidenceFor(
  lines: StatementLine[],
  keys: string[]
): "high" | "medium" | "low" {
  let min = Infinity;
  for (const k of keys) {
    const line = lines.find((l) => l.lineKey === k && l.value !== null);
    if (line) min = Math.min(min, line.confidence ?? 0.85);
  }
  if (!isFinite(min)) return "low";
  if (min >= 0.9) return "high";
  if (min >= 0.7) return "medium";
  return "low";
}

function benchmarkFor(
  benchmarks: BenchmarkRow[],
  industry: string,
  key: string
): MetricValue["benchmark"] {
  const exact = benchmarks.find((b) => b.metricKey === key && b.industry === industry);
  const general = benchmarks.find((b) => b.metricKey === key && b.industry === "general");
  const row = exact ?? general;
  if (!row) return null;
  return {
    median: row.median,
    p25: row.p25,
    p75: row.p75,
    thin: row.sampleSize === null || row.sampleSize === undefined || row.sampleSize < 10,
  };
}

function totalDebt(lines: StatementLine[]): number | null {
  const cur = val(lines, "current_debt");
  const lt = val(lines, "long_term_debt");
  if (cur === null && lt === null) return null;
  return (cur ?? 0) + (lt ?? 0);
}

interface RawMetric {
  value: number | null;
  note: string;
}

function missingNote(lines: StatementLine[], keys: string[]): string {
  const missing = keys.filter((k) => val(lines, k) === null);
  return missing.length ? `Missing input: ${missing.join(", ")}` : "";
}

/**
 * Raw metric values (no prior/benchmark decoration) for one period.
 * CAGR and growth need the chain; headcount needs every set.
 */
function rawMetrics(
  period: AnalysisPeriodInput,
  chain: AnalysisPeriodInput[],
  headcount: number | null
): Map<string, RawMetric> {
  const lines = period.lines;
  const out = new Map<string, RawMetric>();
  const put = (key: string, value: number | null, note = "") =>
    out.set(key, { value, note: value === null ? note : "" });

  const rev = val(lines, "revenue");
  const cogs = val(lines, "cogs");
  const gpStated = val(lines, "gross_profit");
  const gp = gpStated ?? (rev !== null && cogs !== null ? rev - cogs : null);
  const ebitda = val(lines, "ebitda");
  const da = val(lines, "depreciation_amortization");
  const ebitStated = val(lines, "ebit");
  const ebit = ebitStated ?? (ebitda !== null && da !== null ? ebitda - da : null);
  const interest = val(lines, "interest_expense");
  const pretax = val(lines, "pretax_income");
  const taxes = val(lines, "income_taxes");
  const ni = val(lines, "net_income");
  const tca = val(lines, "total_current_assets");
  const tcl = val(lines, "total_current_liabilities");
  const cash = val(lines, "cash");
  const ar = val(lines, "accounts_receivable");
  const inv = val(lines, "inventory");
  const ap = val(lines, "accounts_payable");
  const debt = totalDebt(lines);
  const totalAssets = val(lines, "total_assets");
  const totalEquity = val(lines, "total_equity");

  const annRev = annualize(rev, period);
  const annCogs = annualize(cogs, period);
  const annEbitda = annualize(ebitda, period);
  const annNi = annualize(ni, period);
  const annEbit = annualize(ebit, period);

  // liquidity
  put(
    "current_ratio",
    tca !== null && tcl !== null && tcl !== 0 ? tca / tcl : null,
    tcl === 0
      ? "Total current liabilities is zero"
      : missingNote(lines, ["total_current_assets", "total_current_liabilities"])
  );
  put(
    "quick_ratio",
    cash !== null && ar !== null && tcl !== null && tcl !== 0
      ? (cash + ar) / tcl
      : null,
    tcl === 0
      ? "Total current liabilities is zero"
      : missingNote(lines, ["cash", "accounts_receivable", "total_current_liabilities"])
  );
  const wc = tca !== null && tcl !== null ? tca - tcl : null;
  put(
    "working_capital",
    wc,
    missingNote(lines, ["total_current_assets", "total_current_liabilities"])
  );
  put(
    "wc_pct_revenue",
    wc !== null && annRev !== null && annRev !== 0 ? wc / annRev : null,
    wc === null
      ? missingNote(lines, ["total_current_assets", "total_current_liabilities"])
      : "Missing input: revenue"
  );

  // leverage
  put(
    "debt_ebitda",
    debt !== null && annEbitda !== null && annEbitda !== 0 ? debt / annEbitda : null,
    debt === null
      ? "Missing input: current_debt, long_term_debt"
      : "Annualized EBITDA is zero or missing"
  );
  put(
    "net_debt_ebitda",
    debt !== null && cash !== null && annEbitda !== null && annEbitda !== 0
      ? (debt - cash) / annEbitda
      : null,
    debt === null
      ? "Missing input: current_debt, long_term_debt"
      : cash === null
        ? "Missing input: cash"
        : "Annualized EBITDA is zero or missing"
  );
  put(
    "interest_coverage",
    ebit !== null && interest !== null && interest !== 0 ? ebit / interest : null,
    interest === null || interest === 0
      ? "Interest expense is zero or missing"
      : "Missing input: ebit (or ebitda and depreciation_amortization)"
  );
  const fcDenom =
    val(lines, "current_debt") !== null
      ? (interest ?? 0) + (val(lines, "current_debt") as number)
      : null;
  put(
    "fixed_charge_coverage",
    ebitda !== null && fcDenom !== null && fcDenom !== 0 ? ebitda / fcDenom : null,
    ebitda === null
      ? "Missing input: ebitda"
      : fcDenom === null
        ? "Missing input: current_debt"
        : "Interest + current debt is zero"
  );

  // profitability
  put(
    "gross_margin",
    gp !== null && rev !== null && rev !== 0 ? gp / rev : null,
    gp === null ? "Missing input: gross_profit (or revenue and cogs)" : "Missing input: revenue"
  );
  put(
    "ebitda_margin",
    ebitda !== null && rev !== null && rev !== 0 ? ebitda / rev : null,
    missingNote(lines, ["ebitda", "revenue"])
  );
  put(
    "net_margin",
    ni !== null && rev !== null && rev !== 0 ? ni / rev : null,
    missingNote(lines, ["net_income", "revenue"])
  );
  put(
    "roa",
    annNi !== null && totalAssets !== null && totalAssets !== 0
      ? annNi / totalAssets
      : null,
    missingNote(lines, ["net_income", "total_assets"])
  );
  put(
    "roe",
    annNi !== null && totalEquity !== null && totalEquity !== 0
      ? annNi / totalEquity
      : null,
    totalEquity === 0 ? "Total equity is zero" : missingNote(lines, ["net_income", "total_equity"])
  );
  const etr =
    taxes !== null && pretax !== null && pretax !== 0 ? taxes / pretax : null;
  const roicDenom =
    debt !== null && totalEquity !== null && cash !== null
      ? debt + totalEquity - cash
      : null;
  put(
    "roic",
    annEbit !== null && etr !== null && roicDenom !== null && roicDenom !== 0
      ? (annEbit * (1 - etr)) / roicDenom
      : null,
    etr === null
      ? "Effective tax rate unavailable — income taxes or pretax income missing"
      : roicDenom === null
        ? "Missing input: debt, total_equity, or cash"
        : roicDenom === 0
          ? "Invested capital (debt + equity − cash) is zero"
          : "Missing input: ebit (or ebitda and depreciation_amortization)"
  );

  // efficiency
  const dso =
    ar !== null && annRev !== null && annRev !== 0 ? (ar / annRev) * 365 : null;
  put("dso", dso, missingNote(lines, ["accounts_receivable", "revenue"]));
  const dpo =
    ap !== null && annCogs !== null && annCogs !== 0 ? (ap / annCogs) * 365 : null;
  put("dpo", dpo, missingNote(lines, ["accounts_payable", "cogs"]));
  const turns =
    annCogs !== null && inv !== null && inv !== 0 ? annCogs / inv : null;
  put(
    "inventory_turns",
    turns,
    inv === 0 ? "Inventory is zero" : missingNote(lines, ["cogs", "inventory"])
  );
  const dio = turns !== null && turns !== 0 ? 365 / turns : null;
  put("dio", dio, turns === null ? "Inventory turns unavailable (cogs or inventory missing)" : "");
  put(
    "cash_conversion_cycle",
    dso !== null && dio !== null && dpo !== null ? dso + dio - dpo : null,
    "Needs DSO, DIO, and DPO — one or more legs missing"
  );
  put(
    "revenue_per_employee",
    headcount !== null && headcount > 0 && annRev !== null ? annRev / headcount : null,
    headcount === null ? "Headcount not recorded" : "Missing input: revenue"
  );

  // growth
  const comp = comparisonOf(chain, period);
  const compLines = comp ? comp.lines : null;
  const compAnnRev = comp ? annualize(val(compLines as StatementLine[], "revenue"), comp) : null;
  const compAnnEbitda = comp
    ? annualize(val(compLines as StatementLine[], "ebitda"), comp)
    : null;
  put(
    "revenue_growth_yoy",
    comp ? growth(annRev, compAnnRev) : null,
    !comp
      ? "No prior period available"
      : "Missing input: revenue in this or the comparison period"
  );
  put(
    "ebitda_growth_yoy",
    comp ? growth(annEbitda, compAnnEbitda) : null,
    !comp
      ? "No prior period available"
      : "Missing input: ebitda in this or the comparison period"
  );

  // CAGR over the annual chain (trailing window ending at this period)
  let cagr: RawMetric = { value: null, note: "CAGR is computed on annual periods only" };
  if (period.set.periodType === "annual") {
    const annuals = chain.filter(
      (c) => c.set.periodType === "annual" && c.set.periodEnd && period.set.periodEnd && c.set.periodEnd < period.set.periodEnd
    );
    let chosen: AnalysisPeriodInput | null = null;
    let chosenIntervals = 0;
    let bestDist = Infinity;
    for (const c of annuals) {
      const d = monthDiff(c.set.periodEnd, period.set.periodEnd);
      if (d === null || d < 11) continue;
      const intervals = Math.round(d / 12);
      if (intervals < 1) continue;
      const dist = Math.abs(d - 36);
      if (dist < bestDist) {
        bestDist = dist;
        chosen = c;
        chosenIntervals = intervals;
      }
    }
    if (!chosen) {
      // fall back to the earliest earlier annual period
      const sorted = annuals.slice().sort((a, b) => ((a.set.periodEnd ?? "") < (b.set.periodEnd ?? "") ? -1 : 1));
      if (sorted.length) {
        const d = monthDiff(sorted[0].set.periodEnd, period.set.periodEnd);
        if (d !== null && d >= 11) {
          chosen = sorted[0];
          chosenIntervals = Math.max(1, Math.round(d / 12));
        }
      }
    }
    if (chosen && rev !== null) {
      const baseRev = val(chosen.lines, "revenue");
      if (baseRev !== null && baseRev > 0 && rev > 0) {
        const v = Math.pow(rev / baseRev, 1 / chosenIntervals) - 1;
        cagr = {
          value: v,
          note: chosenIntervals === 3 ? "" : `${chosenIntervals}-year CAGR (${annuals.length + 1} annual periods)`,
        };
      } else {
        cagr = { value: null, note: "Missing input: positive revenue in the base annual period" };
      }
    } else if (rev === null) {
      cagr = { value: null, note: "Missing input: revenue" };
    } else {
      cagr = { value: null, note: "Needs at least 2 annual periods" };
    }
  }
  out.set("revenue_cagr_3y", cagr);

  return out;
}

const METRIC_DEFS: Array<{
  key: string;
  label: string;
  group: MetricValue["group"];
  unit: MetricValue["unit"];
  formula: string;
  sourceLines: string[] | ((p: AnalysisPeriodInput) => string[]);
}> = [
  { key: "current_ratio", label: "Current ratio", group: "liquidity", unit: "x", formula: "Total current assets ÷ Total current liabilities", sourceLines: ["total_current_assets", "total_current_liabilities"] },
  { key: "quick_ratio", label: "Quick ratio", group: "liquidity", unit: "x", formula: "(Cash + accounts receivable) ÷ Total current liabilities", sourceLines: ["cash", "accounts_receivable", "total_current_liabilities"] },
  { key: "working_capital", label: "Working capital", group: "liquidity", unit: "usd", formula: "Total current assets − Total current liabilities", sourceLines: ["total_current_assets", "total_current_liabilities"] },
  { key: "wc_pct_revenue", label: "Working capital % of revenue", group: "liquidity", unit: "pct", formula: "Working capital ÷ Annualized revenue", sourceLines: ["total_current_assets", "total_current_liabilities", "revenue"] },
  { key: "debt_ebitda", label: "Debt / EBITDA", group: "leverage", unit: "x", formula: "Total debt ÷ Annualized EBITDA", sourceLines: ["current_debt", "long_term_debt", "ebitda"] },
  { key: "net_debt_ebitda", label: "Net debt / EBITDA", group: "leverage", unit: "x", formula: "(Total debt − Cash) ÷ Annualized EBITDA", sourceLines: ["current_debt", "long_term_debt", "cash", "ebitda"] },
  { key: "interest_coverage", label: "Interest coverage", group: "leverage", unit: "x", formula: "EBIT ÷ Interest expense", sourceLines: (p) => (val(p.lines, "ebit") !== null ? ["ebit", "interest_expense"] : ["ebitda", "depreciation_amortization", "interest_expense"]) },
  { key: "fixed_charge_coverage", label: "Fixed charge coverage", group: "leverage", unit: "x", formula: "EBITDA ÷ (Interest + current debt due within one year)", sourceLines: ["ebitda", "interest_expense", "current_debt"] },
  { key: "gross_margin", label: "Gross margin", group: "profitability", unit: "pct", formula: "Gross profit ÷ Revenue", sourceLines: (p) => (val(p.lines, "gross_profit") !== null ? ["gross_profit", "revenue"] : ["revenue", "cogs"]) },
  { key: "ebitda_margin", label: "EBITDA margin", group: "profitability", unit: "pct", formula: "EBITDA ÷ Revenue", sourceLines: ["ebitda", "revenue"] },
  { key: "net_margin", label: "Net margin", group: "profitability", unit: "pct", formula: "Net income ÷ Revenue", sourceLines: ["net_income", "revenue"] },
  { key: "roa", label: "Return on assets", group: "profitability", unit: "pct", formula: "Annualized net income ÷ Total assets", sourceLines: ["net_income", "total_assets"] },
  { key: "roe", label: "Return on equity", group: "profitability", unit: "pct", formula: "Annualized net income ÷ Total equity", sourceLines: ["net_income", "total_equity"] },
  { key: "roic", label: "Return on invested capital", group: "profitability", unit: "pct", formula: "Annualized EBIT × (1 − effective tax rate) ÷ (Total debt + Total equity − Cash)", sourceLines: ["ebit", "income_taxes", "pretax_income", "current_debt", "long_term_debt", "total_equity", "cash"] },
  { key: "dso", label: "Days sales outstanding", group: "efficiency", unit: "days", formula: "Accounts receivable ÷ Annualized revenue × 365", sourceLines: ["accounts_receivable", "revenue"] },
  { key: "dpo", label: "Days payables outstanding", group: "efficiency", unit: "days", formula: "Accounts payable ÷ Annualized COGS × 365", sourceLines: ["accounts_payable", "cogs"] },
  { key: "inventory_turns", label: "Inventory turns", group: "efficiency", unit: "x", formula: "Annualized COGS ÷ Inventory", sourceLines: ["cogs", "inventory"] },
  { key: "dio", label: "Days inventory outstanding", group: "efficiency", unit: "days", formula: "365 ÷ Inventory turns", sourceLines: ["cogs", "inventory"] },
  { key: "cash_conversion_cycle", label: "Cash conversion cycle", group: "efficiency", unit: "days", formula: "DSO + DIO − DPO", sourceLines: ["accounts_receivable", "inventory", "accounts_payable", "revenue", "cogs"] },
  { key: "revenue_per_employee", label: "Revenue per employee", group: "efficiency", unit: "usd", formula: "Annualized revenue ÷ Headcount", sourceLines: ["revenue"] },
  { key: "revenue_growth_yoy", label: "Revenue growth (YoY)", group: "growth", unit: "pct", formula: "Annualized revenue ÷ Year-ago annualized revenue − 1", sourceLines: ["revenue"] },
  { key: "ebitda_growth_yoy", label: "EBITDA growth (YoY)", group: "growth", unit: "pct", formula: "Annualized EBITDA ÷ Year-ago annualized EBITDA − 1", sourceLines: ["ebitda"] },
  { key: "revenue_cagr_3y", label: "Revenue CAGR (3y)", group: "growth", unit: "pct", formula: "(Revenue ÷ Revenue 3 years earlier) ^ (1 / years) − 1", sourceLines: ["revenue"] },
];

export function computeMetrics(
  period: AnalysisPeriodInput,
  chain: AnalysisPeriodInput[],
  benchmarks: BenchmarkRow[],
  industry = "general",
  allPeriods?: AnalysisPeriodInput[]
): MetricValue[] {
  const headcount = findHeadcount(allPeriods ?? chain);
  const raw = rawMetrics(period, chain, headcount);
  const priorPeriod = priorOf(chain, period);
  const priorRaw = priorPeriod ? rawMetrics(priorPeriod, chain, headcount) : null;
  return METRIC_DEFS.map((def) => {
    const r = raw.get(def.key) ?? { value: null, note: "Not computed" };
    const prior = priorRaw?.get(def.key)?.value ?? null;
    const sourceLines =
      typeof def.sourceLines === "function" ? def.sourceLines(period) : def.sourceLines;
    return {
      key: def.key,
      label: def.label,
      group: def.group,
      value: r.value,
      unit: def.unit,
      prior,
      deltaPct:
        r.value !== null && prior !== null && prior !== 0
          ? r.value / prior - 1
          : null,
      formula: def.formula,
      sourceLines,
      confidence: r.value === null ? "low" : confidenceFor(period.lines, sourceLines),
      benchmark: benchmarkFor(benchmarks, industry, def.key),
      note: r.note,
    };
  });
}

/* ----------------------------- anomalies ----------------------------- */

export const ONE_TIME_RE =
  /gain on sale|ppp|loan forgiveness|forgiveness|nonrecurring|non-recurring|one-time|one time|insurance proceeds|erc\b|employee retention credit|related.party/i;

/** The income subset of ONE_TIME_RE: items that inflate EBITDA and
 * must be SUBTRACTED when normalized, wherever the parser mapped them. */
export const INCOME_ONE_TIME_RE =
  /gain on sale|ppp|loan forgiveness|forgiveness|insurance proceeds|erc\b|employee retention credit/i;

function marginOf(lines: StatementLine[], kind: "gross" | "ebitda"): number | null {
  const rev = val(lines, "revenue");
  if (rev === null || rev === 0) return null;
  if (kind === "ebitda") {
    const e = val(lines, "ebitda");
    return e === null ? null : e / rev;
  }
  const gp =
    val(lines, "gross_profit") ??
    (() => {
      const c = val(lines, "cogs");
      return c === null ? null : rev - c;
    })();
  return gp === null ? null : gp / rev;
}

/** Customer concentration per periodEnd from detail schedules, if any. */
export function concentrationByPeriod(
  allPeriods: AnalysisPeriodInput[]
): Map<string, { top1Pct: number; setId: string }> {
  const out = new Map<string, { top1Pct: number; setId: string }>();
  for (const p of allPeriods) {
    const details = p.lines.filter((l) => l.lineKey === "unmapped" && l.value !== null);
    if (details.length < 2) continue;
    const total =
      val(p.lines, "accounts_receivable") ?? val(p.lines, "revenue");
    if (total === null || total === 0) continue;
    const top = Math.max(...details.map((l) => Math.abs(l.value as number)));
    const key = p.set.periodEnd ?? p.set.id;
    const existing = out.get(key);
    if (!existing) out.set(key, { top1Pct: (top / Math.abs(total)) * 100, setId: p.set.id });
  }
  return out;
}

export function detectAnomalies(
  chain: AnalysisPeriodInput[],
  allPeriods?: AnalysisPeriodInput[]
): { flags: AnomalyFlag[]; coverage: CoverageNote[] } {
  const flags: AnomalyFlag[] = [];
  const coverage: CoverageNote[] = [];
  const all = allPeriods ?? chain;

  /* 1. margin_swing */
  let marginCompared = false;
  for (const p of chain) {
    const comp = comparisonOf(chain, p);
    if (!comp) continue;
    for (const kind of ["gross", "ebitda"] as const) {
      const cur = marginOf(p.lines, kind);
      const prev = marginOf(comp.lines, kind);
      if (cur === null || prev === null) continue;
      marginCompared = true;
      const change = cur - prev;
      if (Math.abs(change) > 0.03) {
        flags.push({
          rule: "margin_swing",
          severity: Math.abs(change) > 0.05 ? "high" : "medium",
          message: `${kind === "gross" ? "Gross" : "EBITDA"} margin moved from ${fmtPct(prev)} to ${fmtPct(cur)} (${change >= 0 ? "+" : ""}${(change * 100).toFixed(1)} pts) vs the comparison period`,
          setId: p.set.id,
          periodEnd: p.set.periodEnd,
          figures: {
            [`${kind}Margin`]: cur,
            [`prior${kind === "gross" ? "Gross" : "Ebitda"}Margin`]: prev,
            change,
          },
          sourceLines: kind === "gross" ? ["gross_profit", "revenue"] : ["ebitda", "revenue"],
        });
      }
    }
  }
  if (!marginCompared) {
    coverage.push({
      rule: "margin_swing",
      reason: "Margin history insufficient — needs two periods with revenue and gross profit / EBITDA",
    });
  }

  /* 2. expense_swing */
  let expenseCompared = false;
  const singleKeys = ["cogs", "depreciation_amortization", "interest_expense", "income_taxes"];
  for (const p of chain) {
    const comp = comparisonOf(chain, p);
    if (!comp) continue;
    const candidates: Array<{ key: string; label: string; value: number }> = [];
    for (const l of p.lines) {
      if (l.value === null) continue;
      if (singleKeys.includes(l.lineKey)) candidates.push({ key: l.lineKey, label: l.label, value: l.value });
      if (l.lineKey === "opex_detail") candidates.push({ key: l.lineKey, label: l.label, value: l.value });
    }
    if (!detailLines(p.lines, "opex_detail").length) {
      const oe = p.lines.find((l) => l.lineKey === "operating_expenses" && l.value !== null);
      if (oe) candidates.push({ key: oe.lineKey, label: oe.label, value: oe.value as number });
    }
    for (const cand of candidates) {
      const priorLine = comp.lines.find(
        (l) =>
          l.lineKey === cand.key &&
          (cand.key !== "opex_detail" ||
            (l.label ?? "").trim().toLowerCase() === cand.label.trim().toLowerCase()) &&
          l.value !== null
      );
      if (!priorLine || priorLine.value === null) continue;
      if (Math.abs(priorLine.value) < 1000) continue;
      expenseCompared = true;
      const change = (cand.value - priorLine.value) / Math.abs(priorLine.value);
      if (Math.abs(change) >= 0.3) {
        flags.push({
          rule: "expense_swing",
          severity: Math.abs(change) >= 0.5 ? "high" : "medium",
          message: `Expense line "${cand.label}" moved ${(change * 100).toFixed(1)}% vs the comparison period (${fmtMoney(priorLine.value)} → ${fmtMoney(cand.value)})`,
          setId: p.set.id,
          periodEnd: p.set.periodEnd,
          figures: { current: cand.value, prior: priorLine.value, changePct: change },
          sourceLines: [cand.key],
        });
      }
    }
  }
  if (!expenseCompared && chain.length >= 2) {
    coverage.push({
      rule: "expense_swing",
      reason: "No comparable expense lines across periods (same label/key with prior value >= $1000)",
    });
  }

  /* 3. one_time_items */
  let anyIsLines = false;
  for (const p of chain) {
    for (const l of p.lines) {
      if (l.statementKind === "is") anyIsLines = true;
      if (
        (l.lineKey === "other_income" || l.lineKey === "opex_detail" || l.lineKey === "unmapped") &&
        l.value !== null &&
        l.value !== 0 &&
        ONE_TIME_RE.test(l.label ?? "")
      ) {
        flags.push({
          rule: "one_time_items",
          severity: "medium",
          message: `Possible one-time item "${l.label}" of ${fmtMoney(l.value)} in period ending ${p.set.periodEnd ?? "n/a"}`,
          setId: p.set.id,
          periodEnd: p.set.periodEnd,
          figures: { amount: l.value },
          sourceLines: [l.lineKey],
        });
      }
    }
  }
  if (!anyIsLines) {
    coverage.push({ rule: "one_time_items", reason: "No income statement lines to scan for one-time items" });
  }

  /* 4. ar_growth: AR growth > revenue growth for 2+ consecutive steps.
   * Steps run over the data-bearing points of the chain (periods that
   * carry both AR and revenue) — monthly sets without balance-sheet
   * lines interleave the full chain and must not break the run. */
  const arPoints = chain.filter(
    (p) =>
      val(p.lines, "accounts_receivable") !== null && val(p.lines, "revenue") !== null
  );
  let arEvaluated = false;
  if (arPoints.length >= 3) {
    arEvaluated = true;
    const steps: Array<{ qualifies: boolean; arG: number | null; revG: number | null; endIdx: number }> = [];
    for (let i = 1; i < arPoints.length; i++) {
      const arG = growth(val(arPoints[i].lines, "accounts_receivable"), val(arPoints[i - 1].lines, "accounts_receivable"));
      const revG = growth(val(arPoints[i].lines, "revenue"), val(arPoints[i - 1].lines, "revenue"));
      steps.push({ qualifies: arG !== null && revG !== null && arG > revG, arG, revG, endIdx: i });
    }
    let run: typeof steps = [];
    const flush = () => {
      if (run.length >= 2) {
        const last = run[run.length - 1];
        const p = arPoints[last.endIdx];
        flags.push({
          rule: "ar_growth",
          severity: "high",
          message: `Accounts receivable grew faster than revenue for ${run.length} consecutive periods (latest step: AR ${(last.arG as number) >= 0 ? "+" : ""}${((last.arG as number) * 100).toFixed(1)}% vs revenue ${((last.revG as number) * 100).toFixed(1)}%)`,
          setId: p.set.id,
          periodEnd: p.set.periodEnd,
          figures: { arGrowth: last.arG, revenueGrowth: last.revG, consecutiveSteps: run.length },
          sourceLines: ["accounts_receivable", "revenue"],
        });
      }
      run = [];
    };
    for (const s of steps) {
      if (s.qualifies) run.push(s);
      else flush();
    }
    flush();
  }
  if (!arEvaluated) {
    coverage.push({
      rule: "ar_growth",
      reason: "Needs at least 3 periods with accounts receivable and revenue to test AR vs revenue growth",
    });
  }

  /* 5. inventory_build (latest step over data-bearing points) */
  const invPoints = chain.filter(
    (p) => val(p.lines, "inventory") !== null && val(p.lines, "revenue") !== null
  );
  if (invPoints.length >= 2) {
    const latest = invPoints[invPoints.length - 1];
    const prev = invPoints[invPoints.length - 2];
    const invG = growth(val(latest.lines, "inventory"), val(prev.lines, "inventory"));
    const revG = growth(val(latest.lines, "revenue"), val(prev.lines, "revenue"));
    if (invG !== null && revG !== null) {
      if ((invG > 0 && revG <= 0) || (invG - revG > 0.2 && revG < 0.05)) {
        flags.push({
          rule: "inventory_build",
          severity: "medium",
          message: `Inventory build in the latest period: inventory ${(invG * 100).toFixed(1)}% vs revenue ${(revG * 100).toFixed(1)}%`,
          setId: latest.set.id,
          periodEnd: latest.set.periodEnd,
          figures: { inventoryGrowth: invG, revenueGrowth: revG },
          sourceLines: ["inventory", "revenue"],
        });
      }
    } else {
      coverage.push({ rule: "inventory_build", reason: "Inventory or revenue missing for the latest two periods" });
    }
  } else {
    coverage.push({ rule: "inventory_build", reason: "Needs at least 2 periods to test inventory build" });
  }

  /* 6. negative_cash_positive_ebitda */
  let cashChecked = false;
  for (const p of chain) {
    const cash = val(p.lines, "cash");
    const cashEnd = val(p.lines, "cash_end");
    const ebitda = val(p.lines, "ebitda");
    if ((cash !== null || cashEnd !== null) && ebitda !== null) cashChecked = true;
    if (((cash !== null && cash < 0) || (cashEnd !== null && cashEnd < 0)) && ebitda !== null && ebitda > 0) {
      flags.push({
        rule: "negative_cash_positive_ebitda",
        severity: "high",
        message: `Negative cash (${fmtMoney(cash ?? cashEnd)}) alongside positive EBITDA (${fmtMoney(ebitda)}) in period ending ${p.set.periodEnd ?? "n/a"}`,
        setId: p.set.id,
        periodEnd: p.set.periodEnd,
        figures: { cash, cashEnd, ebitda },
        sourceLines: ["cash", "cash_end", "ebitda"],
      });
    }
  }
  if (!cashChecked) {
    coverage.push({ rule: "negative_cash_positive_ebitda", reason: "No period carries both cash and EBITDA" });
  }

  /* 7. concentration_jump */
  const conc = concentrationByPeriod(all);
  if (conc.size === 0) {
    coverage.push({ rule: "concentration_jump", reason: "customer-level detail not provided" });
  } else {
    const keys = Array.from(conc.keys()).sort();
    for (let i = 1; i < keys.length; i++) {
      const prev = conc.get(keys[i - 1]) as { top1Pct: number; setId: string };
      const cur = conc.get(keys[i]) as { top1Pct: number; setId: string };
      const jump = cur.top1Pct - prev.top1Pct;
      if (jump > 10) {
        flags.push({
          rule: "concentration_jump",
          severity: "medium",
          message: `Top-customer concentration jumped ${jump.toFixed(1)} pts (from ${prev.top1Pct.toFixed(1)}% to ${cur.top1Pct.toFixed(1)}%)`,
          setId: cur.setId,
          periodEnd: keys[i],
          figures: { top1Pct: cur.top1Pct, priorTop1Pct: prev.top1Pct, changePts: jump },
          sourceLines: ["accounts_receivable", "revenue"],
        });
      }
    }
  }

  /* 8. unsupported_addbacks */
  const adjustedSets = all.filter((p) => p.set.layer === "adjusted");
  if (!adjustedSets.length) {
    coverage.push({ rule: "unsupported_addbacks", reason: "No adjusted-layer sets provided — addback provenance not checked" });
  } else {
    for (const p of adjustedSets) {
      for (const l of p.lines) {
        if (l.value === null) continue;
        if (!/qoe|adjustment|addback|add-back/i.test(l.label ?? "")) continue;
        const docId = (l.source ?? {})["documentId"];
        if (!docId) {
          flags.push({
            rule: "unsupported_addbacks",
            severity: "medium",
            message: `Adjusted-layer line "${l.label}" (${fmtMoney(l.value)}) has no source document provenance`,
            setId: p.set.id,
            periodEnd: p.set.periodEnd,
            figures: { amount: l.value },
            sourceLines: [l.lineKey],
          });
        }
      }
    }
  }

  return { flags, coverage };
}

/* ------------------------- suggested adjustments --------------------- */

const FEE_RE = /legal|professional|transaction|deal|consulting|advisory/i;
const RENT_RE = /related.party.*rent|rent.*related/i;
const OWNER_RE = /owner|officer|shareholder/i;
const COMP_RE = /comp|salary|wage/i;

export function suggestAdjustments(
  chain: AnalysisPeriodInput[],
  // Accepted for contract signature compatibility; seeds are derived by
  // re-scanning the originating lines so each seed carries the line's
  // verbatim source provenance, which anomaly flags do not retain.
  _anomalies?: AnomalyFlag[]
): SuggestionSeed[] {
  const seeds: SuggestionSeed[] = [];
  const seen = new Set<string>();
  const push = (seed: SuggestionSeed) => {
    const key = `${seed.kind}|${seed.label}|${seed.reportedSetId}`;
    if (seen.has(key)) return;
    seen.add(key);
    seeds.push(seed);
  };

  for (const p of chain) {
    for (const l of p.lines) {
      if (l.value === null || l.value === undefined) continue;
      const label = l.label ?? "";
      const source = (l.source ?? {}) as Record<string, unknown>;
      const hasDoc = Boolean(source["documentId"]);
      const periodLabel = p.set.periodEnd ?? "unknown period";

      // other_income one-times (incl. gain on sale): subtract from EBITDA
      if (l.lineKey === "other_income" && l.value !== 0 && ONE_TIME_RE.test(label)) {
        if (!hasDoc) continue; // sourceless amount seeds are not allowed
        push({
          kind: "nonrecurring",
          label,
          amount: Math.abs(l.value),
          direction: "subtract",
          rationale: `One-time income "${label}" (${fmtMoney(l.value)}) in period ending ${periodLabel} inflates reported EBITDA — subtract as non-recurring`,
          source,
          requiresInput: null,
          reportedSetId: p.set.id,
        });
        continue;
      }

      if (l.lineKey !== "opex_detail" && l.lineKey !== "unmapped") continue;
      if (l.statementKind !== "is") continue;

      // related-party rent (requires market-rent input)
      if (RENT_RE.test(label)) {
        push({
          kind: "related_party_rent",
          label,
          amount: null,
          direction: "add",
          rationale:
            `Related-party rent "${label}" of ${fmtMoney(l.value)} in period ending ${periodLabel} — accept with the market rent; applied adjustment = stated rent − market rent.` +
            (hasDoc ? "" : " No source document on the originating line; market input required."),
          source,
          requiresInput: "market_rent",
          reportedSetId: p.set.id,
        });
        continue;
      }

      // owner / officer comp (requires market-comp input)
      if (OWNER_RE.test(label) && COMP_RE.test(label)) {
        push({
          kind: "owner_comp",
          label,
          amount: null,
          direction: "add",
          rationale:
            `Owner/officer compensation "${label}" of ${fmtMoney(l.value)} in period ending ${periodLabel} — accept with the market compensation; applied adjustment = stated comp − market comp.` +
            (hasDoc ? "" : " No source document on the originating line; market input required."),
          source,
          requiresInput: "market_owner_comp",
          reportedSetId: p.set.id,
        });
        continue;
      }

      // Income-type one-time items that did NOT map to other_income
      // (the production parser can leave e.g. a PPP forgiveness row
      // 'unmapped'): they are income, so normalizing SUBTRACTS them —
      // never route them into the expense add-back branch below.
      if (l.value !== 0 && INCOME_ONE_TIME_RE.test(label)) {
        if (!hasDoc) continue; // sourceless amount seeds are not allowed
        push({
          kind: "nonrecurring",
          label,
          amount: Math.abs(l.value),
          direction: "subtract",
          rationale: `One-time income "${label}" (${fmtMoney(l.value)}) in period ending ${periodLabel} inflates reported EBITDA — subtract as non-recurring`,
          source,
          requiresInput: null,
          reportedSetId: p.set.id,
        });
        continue;
      }

      // generic one-time expense lines: add back. The seed trigger is
      // the one-time pattern OR the one-time-fees pattern (legal /
      // professional / transaction / deal / consulting / advisory) —
      // a transaction-fee line is a QoE addback candidate even when its
      // label carries no explicit "one-time" wording (the production
      // fixture's "Legal & professional - transaction" line is exactly
      // this case; the anomaly rule itself stays on the strict list).
      if (l.value !== 0 && (ONE_TIME_RE.test(label) || FEE_RE.test(label))) {
        if (!hasDoc) continue; // sourceless amount seeds are not allowed
        push({
          kind: FEE_RE.test(label) ? "one_time_fees" : "nonrecurring",
          label,
          amount: Math.abs(l.value),
          direction: "add",
          rationale: `One-time expense "${label}" (${fmtMoney(l.value)}) in period ending ${periodLabel} — add back as non-recurring`,
          source,
          requiresInput: null,
          reportedSetId: p.set.id,
        });
      }
    }
  }
  return seeds;
}

/* --------------------------- revenue quality ------------------------- */

export function revenueQuality(
  chain: AnalysisPeriodInput[],
  allSets: AnalysisPeriodInput[]
): RevenueQualityData {
  const missingInputs: string[] = [];
  const latest = chain.length ? chain[chain.length - 1] : null;
  const revenue = latest ? val(latest.lines, "revenue") : null;

  // One-time REVENUE detail lines in the latest reported period only
  // (other_income one-times live in anomalies/suggestions, not here).
  let identifiedOneTime: number | null = null;
  let identifiedRecurring: number | null = null;
  if (latest && revenue !== null) {
    let sum = 0;
    let found = false;
    for (const l of latest.lines) {
      if (
        l.lineKey === "unmapped" &&
        l.statementKind === "is" &&
        l.value !== null &&
        ONE_TIME_RE.test(l.label ?? "") &&
        /revenue|sales|receipts|income/i.test(l.label ?? "")
      ) {
        sum += l.value;
        found = true;
      }
    }
    identifiedOneTime = found ? sum : 0;
    identifiedRecurring = revenue - identifiedOneTime;
    if (!found) {
      missingInputs.push(
        "Recurring-revenue split not provided — no one-time revenue detail lines identified in the latest period"
      );
    }
  } else {
    missingInputs.push("Latest reported revenue not available — revenue quality cannot be assessed");
  }

  // Concentration: detail schedule with an AR or revenue total.
  let concentration: RevenueQualityData["concentration"] = {
    available: false,
    customers: [],
    top1Pct: null,
    top5Pct: null,
    sourceSetId: null,
  };
  let bestSchedule: { p: AnalysisPeriodInput; total: number } | null = null;
  for (const p of allSets) {
    const details = p.lines.filter((l) => l.lineKey === "unmapped" && l.value !== null);
    if (details.length < 2) continue;
    const total = val(p.lines, "accounts_receivable") ?? val(p.lines, "revenue");
    if (total === null || total === 0) continue;
    if (
      !bestSchedule ||
      (p.set.periodEnd ?? "") > (bestSchedule.p.set.periodEnd ?? "")
    ) {
      bestSchedule = { p, total };
    }
  }
  if (bestSchedule) {
    const details = bestSchedule.p.lines
      .filter((l) => l.lineKey === "unmapped" && l.value !== null)
      .map((l) => ({
        name: l.label ?? "",
        amount: l.value as number,
        sharePct: ((l.value as number) / (bestSchedule as { total: number }).total) * 100,
      }))
      .sort((a, b) => b.amount - a.amount);
    concentration = {
      available: true,
      customers: details,
      top1Pct: details.length ? details[0].sharePct : null,
      top5Pct: details.slice(0, 5).reduce((a, c) => a + c.sharePct, 0),
      sourceSetId: bestSchedule.p.set.id,
    };
  } else {
    missingInputs.push("Customer concentration detail not provided");
  }

  // Backlog
  let backlog: RevenueQualityData["backlog"] = { amount: null, sourceSetId: null };
  const sortedAll = allSets.slice().sort((a, b) => ((a.set.periodEnd ?? "") < (b.set.periodEnd ?? "") ? 1 : -1));
  outer: for (const p of sortedAll) {
    for (const l of p.lines) {
      if (l.value !== null && /backlog|contracted revenue/i.test(l.label ?? "")) {
        backlog = { amount: l.value, sourceSetId: p.set.id };
        break outer;
      }
    }
  }
  if (backlog.amount === null) {
    missingInputs.push("Backlog / contracted revenue not provided");
  }

  return {
    periodEnd: latest?.set.periodEnd ?? null,
    revenue,
    identifiedOneTime,
    identifiedRecurring,
    concentration,
    backlog,
    missingInputs,
  };
}

/* --------------------------- working capital ------------------------- */

export function workingCapital(chain: AnalysisPeriodInput[]): WorkingCapitalData {
  const missingInputs: string[] = [];
  const points: WorkingCapitalData["points"] = [];
  const typeBySet = new Map<string, string>();
  for (const p of chain) {
    typeBySet.set(p.set.id, p.set.periodType);
    const tca = val(p.lines, "total_current_assets");
    const cash = val(p.lines, "cash");
    const tcl = val(p.lines, "total_current_liabilities");
    const curDebt = val(p.lines, "current_debt");
    if (tca === null || cash === null || tcl === null || curDebt === null) continue;
    const wc = tca - cash - (tcl - curDebt);
    const rev = val(p.lines, "revenue");
    const annRev = annualize(rev, p);
    points.push({
      setId: p.set.id,
      periodEnd: p.set.periodEnd,
      wc,
      revenue: rev,
      wcPctRevenue: annRev !== null && annRev !== 0 ? wc / annRev : null,
    });
  }
  if (!points.length) {
    missingInputs.push(
      "Operating working capital cannot be computed — cash, current debt, or current totals missing in every period"
    );
  }

  const pcts = points.map((pt) => pt.wcPctRevenue).filter((v): v is number => v !== null);
  const normalizedWcPct = median(pcts);

  // Seasonality from monthly revenue
  const monthlyPeriods = chain.filter((p) => p.set.periodType === "monthly");
  const byMonth = new Map<number, number[]>();
  const allMonthlyRev: number[] = [];
  for (const p of monthlyPeriods) {
    const rev = val(p.lines, "revenue");
    if (rev === null || !p.set.periodEnd) continue;
    const m = Number(p.set.periodEnd.slice(5, 7));
    if (!isFinite(m) || m < 1 || m > 12) continue;
    const arr = byMonth.get(m) ?? [];
    arr.push(rev);
    byMonth.set(m, arr);
    allMonthlyRev.push(rev);
  }
  const overallAvg = allMonthlyRev.length
    ? allMonthlyRev.reduce((a, b) => a + b, 0) / allMonthlyRev.length
    : null;
  const seasonality: WorkingCapitalData["seasonality"] = [];
  for (let m = 1; m <= 12; m++) {
    const arr = byMonth.get(m);
    const idx =
      arr && arr.length && overallAvg !== null && overallAvg !== 0
        ? arr.reduce((a, b) => a + b, 0) / arr.length / overallAvg
        : null;
    seasonality.push({ month: m, index: idx });
  }
  if (overallAvg === null) {
    missingInputs.push("Monthly revenue history not available — seasonality not computed");
  }

  // Peg
  const monthlyPoints = points.filter((pt) => typeBySet.get(pt.setId) === "monthly");
  let peg: WorkingCapitalData["peg"];
  if (monthlyPoints.length >= 6) {
    const wcs = monthlyPoints.map((pt) => pt.wc);
    peg = {
      low: percentile(wcs, 0.25),
      mid: median(wcs),
      high: percentile(wcs, 0.75),
      basis: `Median of ${monthlyPoints.length} monthly operating working capital points; low/high are the 25th/75th percentiles of monthly working capital`,
    };
  } else if (normalizedWcPct !== null && chain.length) {
    const latest = chain[chain.length - 1];
    const annRev = annualize(val(latest.lines, "revenue"), latest);
    if (annRev !== null) {
      const mid = normalizedWcPct * annRev;
      peg = {
        low: mid * 0.8,
        mid,
        high: mid * 1.2,
        basis: `Normalized working capital ${(normalizedWcPct * 100).toFixed(1)}% of revenue (median across periods) × latest annualized revenue ${annRev}; range = mid ±20%`,
      };
    } else {
      peg = { low: null, mid: null, high: null, basis: "Insufficient working capital inputs — peg unavailable" };
      missingInputs.push("Working capital peg unavailable — latest annualized revenue missing");
    }
  } else {
    peg = { low: null, mid: null, high: null, basis: "Insufficient working capital inputs — peg unavailable" };
    if (points.length) missingInputs.push("Working capital peg unavailable — no period has both working capital and revenue");
  }

  return { points, normalizedWcPct, peg, seasonality, missingInputs };
}

/* --------------------------- payload build --------------------------- */

export interface BuildAnalysisInput {
  companyId: string;
  industry: string;
  periods: AnalysisPeriodInput[];
  benchmarks: BenchmarkRow[];
  generatedAt: string;
  acceptedAdjustments?: AcceptedAdjustmentInput[];
  /** Adjusted-layer periods (the WS-B service passes them under this name). */
  adjustedPeriods?: AnalysisPeriodInput[];
  /** Alias of adjustedPeriods (task-spec name); both are merged. */
  adjustedSets?: AnalysisPeriodInput[];
}

export function buildAnalysisPayload(input: BuildAnalysisInput): {
  payload: AnalysisPayload;
  suggestionSeeds: SuggestionSeed[];
  /** Alias of suggestionSeeds (the WS-B service reads `.seeds`). */
  seeds: SuggestionSeed[];
} {
  const industry = input.industry || "general";
  const chain = reportedChain(input.periods);
  const adjustedInput: AnalysisPeriodInput[] = [
    ...(input.adjustedPeriods ?? []),
    ...(input.adjustedSets ?? []),
  ];
  const adjustedPool: AnalysisPeriodInput[] = [
    ...adjustedInput,
    ...input.periods.filter((p) => p.set.layer === "adjusted"),
  ];
  const allSets: AnalysisPeriodInput[] = [...input.periods, ...adjustedInput];

  const metricsByPeriod = chain.map((p) => ({
    setId: p.set.id,
    periodEnd: p.set.periodEnd,
    metrics: computeMetrics(p, chain, input.benchmarks, industry, allSets),
  }));

  const integrity = runIntegritySuite(allSets);
  const { flags, coverage } = detectAnomalies(chain, allSets);
  const suggestionSeeds = suggestAdjustments(chain, flags);
  const rq = revenueQuality(chain, allSets);
  const wc = workingCapital(chain);

  /* margin bridge (behavior documented in the header comment) */
  let latestWithEbitda: AnalysisPeriodInput | null = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (val(chain[i].lines, "ebitda") !== null) {
      latestWithEbitda = chain[i];
      break;
    }
  }
  const findAdjustedFor = (reportedSet: AnalysisPeriodInput): AnalysisPeriodInput | null => {
    const byBase = adjustedPool
      .filter((p) => p.set.basedOnSetId === reportedSet.set.id)
      .sort((a, b) => {
        const ap = a.set.status === "posted" ? 0 : 1;
        const bp = b.set.status === "posted" ? 0 : 1;
        if (ap !== bp) return ap - bp;
        return (b.set.version ?? 0) - (a.set.version ?? 0);
      });
    if (byBase.length) return byBase[0];
    const bySeries = adjustedPool
      .filter(
        (p) =>
          p.set.seriesId === reportedSet.set.seriesId &&
          p.set.periodEnd === reportedSet.set.periodEnd
      )
      .sort((a, b) => (b.set.version ?? 0) - (a.set.version ?? 0));
    return bySeries.length ? bySeries[0] : null;
  };

  let marginBridge: AnalysisPayload["marginBridge"] = null;
  if (latestWithEbitda) {
    const reportedEbitda = val(latestWithEbitda.lines, "ebitda");
    const items = (input.acceptedAdjustments ?? [])
      .filter((a) => a.reportedSetId === (latestWithEbitda as AnalysisPeriodInput).set.id)
      .map((a) => ({
        label: a.label,
        amount: a.direction === "add" ? a.amount : -a.amount,
      }));
    const adjSet = findAdjustedFor(latestWithEbitda);
    const adjEbitdaFromSet = adjSet ? val(adjSet.lines, "ebitda") : null;
    let adjustedEbitda: number | null;
    let adjustedSetId: string | null = null;
    if (adjSet && adjEbitdaFromSet !== null) {
      adjustedEbitda = adjEbitdaFromSet;
      adjustedSetId = adjSet.set.id;
    } else if (items.length && reportedEbitda !== null) {
      adjustedEbitda = reportedEbitda + items.reduce((a, it) => a + it.amount, 0);
      adjustedSetId = adjSet ? adjSet.set.id : null;
    } else {
      adjustedEbitda = reportedEbitda;
      adjustedSetId = adjSet ? adjSet.set.id : null;
    }
    marginBridge = {
      reportedSetId: latestWithEbitda.set.id,
      reportedEbitda,
      items,
      adjustedEbitda,
      adjustedSetId,
    };
  }

  /* deal screen EBITDA basis */
  let screenEbitda: number | null = null;
  let screenBasis = "reported";
  if (latestWithEbitda) {
    const adjSet = findAdjustedFor(latestWithEbitda);
    const adjEbitda = adjSet ? val(adjSet.lines, "ebitda") : null;
    const latestType = latestWithEbitda.set.periodType;
    if (adjEbitda !== null && latestType === "annual") {
      screenEbitda = adjEbitda;
      screenBasis = "adjusted";
    } else if (latestType === "monthly" || latestType === "quarterly") {
      const need = latestType === "monthly" ? 12 : 4;
      const sameType = chain.filter((p) => p.set.periodType === latestType);
      if (sameType.length >= need) {
        const lastN = sameType.slice(-need);
        const vals = lastN.map((p) => val(p.lines, "ebitda"));
        if (vals.every((v) => v !== null)) {
          screenEbitda = vals.reduce((a, v) => a + (v as number), 0);
          screenBasis = "ttm-reported";
        } else {
          screenEbitda = val(latestWithEbitda.lines, "ebitda");
          screenBasis = "reported";
        }
      } else {
        screenEbitda = val(latestWithEbitda.lines, "ebitda");
        screenBasis = "reported";
      }
    } else {
      screenEbitda = val(latestWithEbitda.lines, "ebitda");
      screenBasis = "reported";
    }
  }
  const dealScreen = computeDealScreen({ ebitda: screenEbitda, ebitdaBasis: screenBasis });

  /* chart data */
  const seasonalityByMonth = new Map(wc.seasonality.map((s) => [s.month, s.index]));
  const monthlyChain = chain.filter((p) => p.set.periodType === "monthly");
  const monthly = monthlyChain.map((p) => {
    const m = p.set.periodEnd ? Number(p.set.periodEnd.slice(5, 7)) : NaN;
    return {
      periodEnd: p.set.periodEnd,
      revenue: val(p.lines, "revenue"),
      ebitda: val(p.lines, "ebitda"),
      seasonalityIndex:
        isFinite(m) && m >= 1 && m <= 12 ? (seasonalityByMonth.get(m) ?? null) : null,
    };
  });
  const bsComposition = chain.map((p) => ({
    periodEnd: p.set.periodEnd,
    assets: {
      cash: val(p.lines, "cash"),
      accountsReceivable: val(p.lines, "accounts_receivable"),
      inventory: val(p.lines, "inventory"),
      otherCurrent: val(p.lines, "other_current_assets"),
      ppe: val(p.lines, "ppe_net"),
      intangibles: val(p.lines, "intangible_assets"),
      other: val(p.lines, "other_assets"),
    },
    liabEquity: {
      accountsPayable: val(p.lines, "accounts_payable"),
      currentDebt: val(p.lines, "current_debt"),
      otherCurrent: val(p.lines, "other_current_liabilities"),
      longTermDebt: val(p.lines, "long_term_debt"),
      otherLiab: val(p.lines, "other_liabilities"),
      equity: val(p.lines, "total_equity"),
    },
  }));
  let cashConversion: AnalysisPayload["chartData"]["cashConversion"] = null;
  for (let i = chain.length - 1; i >= 0; i--) {
    const p = chain[i];
    const ebitda = val(p.lines, "ebitda");
    const cfo = val(p.lines, "cfo");
    const cfi = val(p.lines, "cfi");
    if (ebitda !== null || cfo !== null) {
      cashConversion = {
        periodEnd: p.set.periodEnd,
        ebitda,
        cfo,
        cfi,
        fcf: cfo !== null && cfi !== null ? cfo + cfi : null,
      };
      break;
    }
  }

  /* missing inputs rollup */
  const missing = new Set<string>();
  for (const m of rq.missingInputs) missing.add(m);
  for (const m of wc.missingInputs) missing.add(m);
  if (findHeadcount(allSets) === null) missing.add("Headcount not recorded");
  if (!monthlyChain.length) {
    missing.add("Monthly statements not provided — monthly charts and seasonality unavailable");
  }
  // Surface (but do not double-count) schedule detection for integrity users:
  void detectSchedulesInSet;

  const payload: AnalysisPayload = {
    companyId: input.companyId,
    generatedAt: input.generatedAt,
    industry,
    periods: chain.map((p) => ({
      setId: p.set.id,
      periodEnd: p.set.periodEnd,
      periodType: p.set.periodType,
      periodStart: p.set.periodStart,
      layer: p.set.layer,
    })),
    metricsByPeriod,
    integrity,
    anomalies: flags,
    coverage,
    marginBridge,
    revenueQuality: rq,
    workingCapital: wc,
    dealScreen,
    chartData: { monthly, bsComposition, cashConversion },
    missingInputs: Array.from(missing),
  };

  return { payload, suggestionSeeds, seeds: suggestionSeeds };
}
