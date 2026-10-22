/**
 * Part 4B — integrity suite (PURE, no DB / fs / clock).
 *
 * runIntegritySuite(periods, opts?) runs the six contract checks:
 *   1. bs_balance                    (per set with BS lines)
 *   2. cf_ties_cash                  (per set with CF lines)
 *   3. retained_earnings_rollforward (per consecutive pair, annual
 *      reported chain, evaluated on the later set)
 *   4. subledger_ties               (per periodEnd × schedule key)
 *   5. period_continuity             (per consecutive pair, per
 *      periodType chain in the reported layer)
 *   6. monthly_vs_annual             (per fiscal year with an annual set
 *      and >= 10 monthly sets ending in that year)
 *
 * Checks source: set.checks when the set is posted (stored by the
 * Phase 4 service at post time — TRUSTED), runChecks(lines, set) for
 * draft sets (including the set named by opts.draftSetId). Tolerances
 * come from toleranceFor() in lib/financials/template.
 *
 * Schedule detection (shared with revenue quality in engine.ts): a set
 * is a detail schedule for a BS key when it carries >= 2 numeric
 * 'unmapped' detail lines AND a mapped line for that key. The mapped
 * line is the schedule total; the unmapped lines are the detail rows.
 */
import { runChecks, toleranceFor } from "../financials/template";
import type { LineInput } from "../financials/template";
import type {
  AnalysisPeriodInput,
  IntegrityCheckResult,
  StatementLine,
} from "./types";

/* ------------------------------ helpers ------------------------------ */

export function lineVal(lines: StatementLine[], key: string): number | null {
  for (const l of lines) {
    if (l.lineKey === key && l.value !== null && l.value !== undefined) {
      return l.value;
    }
  }
  return null;
}

function fmtMoney(n: number | null | undefined): string {
  if (n === null || n === undefined || !isFinite(n)) return "n/a";
  return `$${n}`;
}

function fmtPeriod(p: AnalysisPeriodInput): string {
  return p.set.periodEnd ?? p.set.periodStart ?? p.set.id;
}

/** Calendar-month difference b − a from ISO dates (year/month only). */
export function monthDiff(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const pa = a.slice(0, 7).split("-");
  const pb = b.slice(0, 7).split("-");
  const ya = Number(pa[0]);
  const ma = Number(pa[1]);
  const yb = Number(pb[0]);
  const mb = Number(pb[1]);
  if (!isFinite(ya) || !isFinite(ma) || !isFinite(yb) || !isFinite(mb)) {
    return null;
  }
  return (yb - ya) * 12 + (mb - ma);
}

function yearOf(date: string | null): number | null {
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  return isFinite(y) ? y : null;
}

function byPeriodEndAsc(
  a: AnalysisPeriodInput,
  b: AnalysisPeriodInput
): number {
  const ea = a.set.periodEnd;
  const eb = b.set.periodEnd;
  if (ea && eb && ea !== eb) return ea < eb ? -1 : 1;
  if (ea && !eb) return -1;
  if (!ea && eb) return 1;
  if (ea && eb) {
    // Same periodEnd: longer periods sort later (annual after monthly /
    // detail schedules ending the same day).
    const spanA = monthDiff(a.set.periodStart, a.set.periodEnd) ?? 0;
    const spanB = monthDiff(b.set.periodStart, b.set.periodEnd) ?? 0;
    if (spanA !== spanB) return spanA - spanB;
  }
  const sa = a.set.periodStart ?? "";
  const sb = b.set.periodStart ?? "";
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

interface EffectiveChecks {
  bsPresent: boolean;
  bsBalanced: boolean | null;
  bsVariance: number | null;
  cfTies: boolean | null;
  cfVariance: number | null;
}

function effectiveChecks(
  p: AnalysisPeriodInput,
  opts?: { draftSetId?: string }
): EffectiveChecks {
  const isDraft =
    p.set.status !== "posted" || (opts?.draftSetId != null && p.set.id === opts.draftSetId);
  if (!isDraft && p.set.checks && typeof p.set.checks === "object") {
    const c = p.set.checks as unknown as Record<string, unknown>;
    const hasBsSignal =
      c.bsBalanced !== undefined || c.bsPresent !== undefined || c.bsVariance !== undefined;
    if (hasBsSignal || c.cfTies !== undefined) {
      return {
        bsPresent: Boolean(c.bsPresent),
        bsBalanced: (c.bsBalanced as boolean | null) ?? null,
        bsVariance: (c.bsVariance as number | null) ?? null,
        cfTies: (c.cfTies as boolean | null) ?? null,
        cfVariance: (c.cfVariance as number | null) ?? null,
      };
    }
  }
  const rc = runChecks(p.lines as unknown as LineInput[], p.set);
  return {
    bsPresent: rc.bsPresent,
    bsBalanced: rc.bsBalanced,
    bsVariance: rc.bsVariance,
    cfTies: rc.cfTies,
    cfVariance: rc.cfVariance,
  };
}

function hasKind(p: AnalysisPeriodInput, kind: "bs" | "cf" | "is"): boolean {
  return p.lines.some((l) => l.statementKind === kind && l.value !== null);
}

/* ------------------------- schedule detection ------------------------ */

export interface ScheduleInfo {
  key: "accounts_receivable" | "accounts_payable" | "debt";
  scheduleSet: AnalysisPeriodInput;
  scheduleTotal: number;
  detailSum: number;
  detailCount: number;
}

const SCHEDULE_KEYS: Array<{
  key: ScheduleInfo["key"];
  lineKeys: string[];
  label: string;
}> = [
  { key: "accounts_receivable", lineKeys: ["accounts_receivable"], label: "accounts receivable" },
  { key: "accounts_payable", lineKeys: ["accounts_payable"], label: "accounts payable" },
  { key: "debt", lineKeys: ["current_debt", "long_term_debt"], label: "debt" },
];

/** Detect detail schedules inside one set (one entry per matched key). */
export function detectSchedulesInSet(p: AnalysisPeriodInput): ScheduleInfo[] {
  const details = p.lines.filter(
    (l) => l.lineKey === "unmapped" && l.value !== null && l.value !== undefined
  );
  if (details.length < 2) return [];
  const detailSum = details.reduce((a, l) => a + (l.value as number), 0);
  const out: ScheduleInfo[] = [];
  for (const spec of SCHEDULE_KEYS) {
    let total: number | null = null;
    for (const k of spec.lineKeys) {
      const v = lineVal(p.lines, k);
      if (v !== null) total = (total ?? 0) + v;
    }
    if (total !== null) {
      out.push({
        key: spec.key,
        scheduleSet: p,
        scheduleTotal: total,
        detailSum,
        detailCount: details.length,
      });
    }
  }
  return out;
}

/** The primary balance-sheet figure for a schedule key on a normal set. */
function bsFigureFor(lines: StatementLine[], key: ScheduleInfo["key"]): number | null {
  if (key === "debt") {
    const cur = lineVal(lines, "current_debt");
    const lt = lineVal(lines, "long_term_debt");
    if (cur === null && lt === null) return null;
    return (cur ?? 0) + (lt ?? 0);
  }
  return lineVal(lines, key);
}

/* ------------------------------ suite -------------------------------- */

export function runIntegritySuite(
  periods: AnalysisPeriodInput[],
  opts?: { draftSetId?: string }
): IntegrityCheckResult[] {
  const results: IntegrityCheckResult[] = [];
  const reported = periods
    .filter((p) => p.set.layer === "reported")
    .slice()
    .sort(byPeriodEndAsc);

  /* ---------------- 1. bs_balance + 2. cf_ties_cash (per set) -------- */
  for (const p of periods.slice().sort(byPeriodEndAsc)) {
    const checks = effectiveChecks(p, opts);
    // 1. balance sheet balance
    if (!hasKind(p, "bs") && !checks.bsPresent) {
      results.push({
        check: "bs_balance",
        scope: "set",
        setId: p.set.id,
        periodEnd: p.set.periodEnd,
        status: "not_applicable",
        message: `No balance sheet lines in set for ${fmtPeriod(p)} — balance check not applicable`,
        figures: {},
      });
    } else if (checks.bsBalanced === null) {
      results.push({
        check: "bs_balance",
        scope: "set",
        setId: p.set.id,
        periodEnd: p.set.periodEnd,
        status: "not_applicable",
        message: `Balance sheet totals incomplete for ${fmtPeriod(p)} — total assets or total liabilities + equity missing`,
        figures: { variance: checks.bsVariance },
      });
    } else {
      const totalAssets = lineVal(p.lines, "total_assets");
      const tleDirect = lineVal(p.lines, "total_liab_equity");
      const tl = lineVal(p.lines, "total_liabilities");
      const te = lineVal(p.lines, "total_equity");
      const totalLiabEquity =
        tleDirect ?? (tl !== null && te !== null ? tl + te : null);
      const variance = checks.bsVariance ?? null;
      if (checks.bsBalanced) {
        results.push({
          check: "bs_balance",
          scope: "set",
          setId: p.set.id,
          periodEnd: p.set.periodEnd,
          status: "pass",
          message: `Balance sheet balances (variance ${fmtMoney(variance ?? 0)})`,
          figures: { totalAssets, totalLiabEquity, variance },
        });
      } else {
        results.push({
          check: "bs_balance",
          scope: "set",
          setId: p.set.id,
          periodEnd: p.set.periodEnd,
          status: "fail",
          message: `Balance sheet does not balance: total assets ${fmtMoney(totalAssets)} vs liabilities + equity ${fmtMoney(totalLiabEquity)} — variance ${fmtMoney(variance)}`,
          figures: { totalAssets, totalLiabEquity, variance },
        });
      }
    }

    // 2. cash flow ties to cash
    if (!hasKind(p, "cf")) {
      results.push({
        check: "cf_ties_cash",
        scope: "set",
        setId: p.set.id,
        periodEnd: p.set.periodEnd,
        status: "not_applicable",
        message: `No cash flow lines in set for ${fmtPeriod(p)} — cash tie-out not applicable`,
        figures: {},
      });
    } else if (checks.cfTies === null) {
      results.push({
        check: "cf_ties_cash",
        scope: "set",
        setId: p.set.id,
        periodEnd: p.set.periodEnd,
        status: "not_applicable",
        message: `Cash flow tie-out cannot be evaluated for ${fmtPeriod(p)} — beginning cash, net change, or ending cash missing`,
        figures: { variance: checks.cfVariance },
      });
    } else {
      const cashBegin = lineVal(p.lines, "cash_begin");
      const cashEnd = lineVal(p.lines, "cash_end");
      let netChange = lineVal(p.lines, "net_change_cash");
      if (netChange === null) {
        const o = lineVal(p.lines, "cfo");
        const i = lineVal(p.lines, "cfi");
        const f = lineVal(p.lines, "cff");
        if (o !== null && i !== null && f !== null) netChange = o + i + f;
      }
      const variance = checks.cfVariance;
      const expected =
        cashBegin !== null && netChange !== null ? cashBegin + netChange : null;
      if (checks.cfTies) {
        results.push({
          check: "cf_ties_cash",
          scope: "set",
          setId: p.set.id,
          periodEnd: p.set.periodEnd,
          status: "pass",
          message: `Cash flow ties: beginning cash ${fmtMoney(cashBegin)} + net change ${fmtMoney(netChange)} = ${fmtMoney(expected)} vs ending cash ${fmtMoney(cashEnd)} (variance ${fmtMoney(variance ?? 0)})`,
          figures: { cashBegin, netChange, cashEnd, expectedCashEnd: expected, variance },
        });
      } else {
        results.push({
          check: "cf_ties_cash",
          scope: "set",
          setId: p.set.id,
          periodEnd: p.set.periodEnd,
          status: "fail",
          message: `Cash flow does not tie: beginning cash ${fmtMoney(cashBegin)} + net change ${fmtMoney(netChange)} = ${fmtMoney(expected)} vs ending cash ${fmtMoney(cashEnd)} — variance ${fmtMoney(variance)}`,
          figures: { cashBegin, netChange, cashEnd, expectedCashEnd: expected, variance },
        });
      }
    }
  }

  /* ------------- 3. retained earnings roll-forward ------------------- */
  // Primary statements only: detail schedules carry no equity and must
  // not enter the roll-forward chain.
  const annualReported = reported.filter(
    (p) => p.set.periodType === "annual" && lineVal(p.lines, "total_equity") !== null
  );
  if (annualReported.length < 2) {
    results.push({
      check: "retained_earnings_rollforward",
      scope: "company",
      setId: null,
      periodEnd: null,
      status: "not_applicable",
      message:
        "Retained earnings roll-forward needs at least two annual reported periods — not applicable",
      figures: {},
    });
  } else {
    for (let i = 1; i < annualReported.length; i++) {
      const earlier = annualReported[i - 1];
      const later = annualReported[i];
      const eqEarlier = lineVal(earlier.lines, "total_equity");
      const eqLater = lineVal(later.lines, "total_equity");
      const ni = lineVal(later.lines, "net_income");
      if (eqEarlier === null || eqLater === null || ni === null) {
        results.push({
          check: "retained_earnings_rollforward",
          scope: "set",
          setId: later.set.id,
          periodEnd: later.set.periodEnd,
          status: "not_applicable",
          message: `Retained earnings roll-forward cannot be evaluated for ${fmtPeriod(later)} — total equity or net income missing`,
          figures: { equityEarlier: eqEarlier, equityLater: eqLater, netIncome: ni },
        });
        continue;
      }
      const actualChange = eqLater - eqEarlier;
      const variance = actualChange - ni;
      const expectedEquity = eqEarlier + ni;
      const pass =
        Math.abs(variance) <= toleranceFor(eqLater, expectedEquity);
      if (pass) {
        results.push({
          check: "retained_earnings_rollforward",
          scope: "set",
          setId: later.set.id,
          periodEnd: later.set.periodEnd,
          status: "pass",
          message: `Retained earnings roll forward: equity ${fmtMoney(eqEarlier)} + net income ${fmtMoney(ni)} = ${fmtMoney(expectedEquity)} vs reported equity ${fmtMoney(eqLater)} (variance ${fmtMoney(variance)})`,
          figures: {
            equityEarlier: eqEarlier,
            equityLater: eqLater,
            netIncome: ni,
            expectedEquity,
            variance,
          },
        });
      } else {
        results.push({
          check: "retained_earnings_rollforward",
          scope: "set",
          setId: later.set.id,
          periodEnd: later.set.periodEnd,
          status: "fail",
          message: `Retained earnings roll-forward fails for ${fmtPeriod(later)}: equity moved from ${fmtMoney(eqEarlier)} to ${fmtMoney(eqLater)} (change ${fmtMoney(actualChange)}) vs net income ${fmtMoney(ni)} — variance ${fmtMoney(variance)}. Distributions/contributions are not template lines — a variance usually means owner draws or contributions`,
          figures: {
            equityEarlier: eqEarlier,
            equityLater: eqLater,
            netIncome: ni,
            expectedEquity,
            actualChange,
            variance,
          },
        });
      }
    }
  }

  /* --------------------- 4. subledger ties --------------------------- */
  // Group all sets by periodEnd.
  const byEnd = new Map<string, AnalysisPeriodInput[]>();
  for (const p of periods) {
    const key = p.set.periodEnd ?? "__null__";
    const arr = byEnd.get(key) ?? [];
    arr.push(p);
    byEnd.set(key, arr);
  }
  const periodEnds = Array.from(byEnd.keys()).sort();
  if (periodEnds.length === 0) {
    results.push({
      check: "subledger_ties",
      scope: "company",
      setId: null,
      periodEnd: null,
      status: "not_applicable",
      message: "No periods provided — no AR/AP/debt detail schedule to tie",
      figures: {},
    });
  }
  for (const endKey of periodEnds) {
    const group = byEnd.get(endKey) ?? [];
    const displayEnd = endKey === "__null__" ? null : endKey;
    const schedules: ScheduleInfo[] = [];
    for (const p of group) schedules.push(...detectSchedulesInSet(p));
    if (schedules.length === 0) {
      results.push({
        check: "subledger_ties",
        scope: "company",
        setId: null,
        periodEnd: displayEnd,
        status: "not_applicable",
        message: `No AR/AP/debt detail schedule uploaded for ${displayEnd ?? "unknown period"}`,
        figures: {},
      });
      continue;
    }
    for (const sched of schedules) {
      const spec = SCHEDULE_KEYS.find((s) => s.key === sched.key);
      const label = spec ? spec.label : sched.key;
      // Primary BS figure: prefer another set in the same period group
      // (reported layer, with a balance sheet) that is not the schedule.
      let bsValue: number | null = null;
      const candidates = group
        .filter((p) => p !== sched.scheduleSet)
        .sort((a, b) => {
          const ar = a.set.layer === "reported" ? 0 : 1;
          const br = b.set.layer === "reported" ? 0 : 1;
          return ar - br;
        });
      for (const c of candidates) {
        const v = bsFigureFor(c.lines, sched.key);
        if (v !== null) {
          bsValue = v;
          break;
        }
      }
      if (bsValue === null) bsValue = sched.scheduleTotal; // schedule embedded in its own set
      const internalVariance = sched.detailSum - sched.scheduleTotal;
      const bsVariance = sched.scheduleTotal - bsValue;
      const internalOk =
        Math.abs(internalVariance) <= toleranceFor(sched.detailSum, sched.scheduleTotal);
      const bsOk = Math.abs(bsVariance) <= toleranceFor(sched.scheduleTotal, bsValue);
      const figures: Record<string, number | string | null> = {
        key: sched.key,
        scheduleTotal: sched.scheduleTotal,
        detailSum: sched.detailSum,
        detailCount: sched.detailCount,
        bsValue,
        internalVariance,
        bsVariance,
      };
      if (internalOk && bsOk) {
        results.push({
          check: "subledger_ties",
          scope: "set",
          setId: sched.scheduleSet.set.id,
          periodEnd: displayEnd,
          status: "pass",
          message: `${label} detail schedule ties for ${displayEnd ?? "unknown period"}: schedule total ${fmtMoney(sched.scheduleTotal)}, detail sum ${fmtMoney(sched.detailSum)}, balance sheet ${fmtMoney(bsValue)} (variances ${fmtMoney(internalVariance)} / ${fmtMoney(bsVariance)})`,
          figures,
        });
      } else {
        results.push({
          check: "subledger_ties",
          scope: "set",
          setId: sched.scheduleSet.set.id,
          periodEnd: displayEnd,
          status: "fail",
          message: `${label} detail schedule does not tie for ${displayEnd ?? "unknown period"}: schedule total ${fmtMoney(sched.scheduleTotal)} vs detail sum ${fmtMoney(sched.detailSum)} (variance ${fmtMoney(internalVariance)}) and vs balance sheet ${fmtMoney(bsValue)} (variance ${fmtMoney(bsVariance)})`,
          figures,
        });
      }
    }
  }

  /* ------------------- 5. period continuity -------------------------- */
  const expectedStep: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12 };
  // Primary statements only: a detail schedule (no revenue, no total
  // assets) is not a period in the chain and must not read as a gap or
  // overlap against the statements it supports.
  const primaryReported = reported.filter(
    (p) =>
      lineVal(p.lines, "revenue") !== null || lineVal(p.lines, "total_assets") !== null
  );
  const typesSeen = new Set(primaryReported.map((p) => p.set.periodType));
  if (primaryReported.length === 0) {
    results.push({
      check: "period_continuity",
      scope: "company",
      setId: null,
      periodEnd: null,
      status: "not_applicable",
      message: "No reported periods — continuity not applicable",
      figures: {},
    });
  }
  for (const t of Array.from(typesSeen)) {
    const chain = primaryReported
      .filter((p) => p.set.periodType === t)
      .slice()
      .sort((a, b) => {
        const sa = a.set.periodStart ?? a.set.periodEnd ?? "";
        const sb = b.set.periodStart ?? b.set.periodEnd ?? "";
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
    if (chain.length <= 1) {
      results.push({
        check: "period_continuity",
        scope: "company",
        setId: chain[0]?.set.id ?? null,
        periodEnd: chain[0]?.set.periodEnd ?? null,
        status: "pass",
        message: `Period continuity (${t}): single period — nothing to gap against`,
        figures: { periodType: t, periods: chain.length },
      });
      continue;
    }
    const expected = expectedStep[t];
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1];
      const next = chain[i];
      const step = monthDiff(prev.set.periodEnd, next.set.periodEnd);
      if (step === null || expected === undefined) {
        results.push({
          check: "period_continuity",
          scope: "company",
          setId: next.set.id,
          periodEnd: next.set.periodEnd,
          status: "not_applicable",
          message: `Period continuity (${t}) cannot be evaluated between ${fmtPeriod(prev)} and ${fmtPeriod(next)} — period dates missing`,
          figures: { periodType: t, expectedStep: expected ?? null, actualStep: step },
        });
        continue;
      }
      if (step === expected) {
        results.push({
          check: "period_continuity",
          scope: "company",
          setId: next.set.id,
          periodEnd: next.set.periodEnd,
          status: "pass",
          message: `Period continuity (${t}): ${fmtPeriod(prev)} → ${fmtPeriod(next)} is a continuous ${expected}-month step`,
          figures: { periodType: t, expectedStep: expected, actualStep: step },
        });
      } else if (step > expected) {
        results.push({
          check: "period_continuity",
          scope: "company",
          setId: next.set.id,
          periodEnd: next.set.periodEnd,
          status: "fail",
          message: `Period gap (${t}): ${fmtPeriod(prev)} → ${fmtPeriod(next)} spans ${step} months, expected ${expected} — missing period(s) between the two periods`,
          figures: { periodType: t, expectedStep: expected, actualStep: step },
        });
      } else {
        results.push({
          check: "period_continuity",
          scope: "company",
          setId: next.set.id,
          periodEnd: next.set.periodEnd,
          status: "fail",
          message: `Period overlap (${t}): ${fmtPeriod(prev)} → ${fmtPeriod(next)} spans ${step} months, expected ${expected} — the two periods overlap`,
          figures: { periodType: t, expectedStep: expected, actualStep: step },
        });
      }
    }
  }

  /* ------------------- 6. monthly vs annual -------------------------- */
  const monthlyReported = reported.filter((p) => p.set.periodType === "monthly");
  const annualByYear = new Map<number, AnalysisPeriodInput>();
  for (const p of annualReported) {
    const y = yearOf(p.set.periodEnd);
    if (y !== null) annualByYear.set(y, p);
  }
  const monthlyByYear = new Map<number, AnalysisPeriodInput[]>();
  for (const p of monthlyReported) {
    const y = yearOf(p.set.periodEnd);
    if (y === null) continue;
    const arr = monthlyByYear.get(y) ?? [];
    arr.push(p);
    monthlyByYear.set(y, arr);
  }
  let mvaEmitted = 0;
  for (const [year, annual] of Array.from(annualByYear.entries()).sort((a, b) => a[0] - b[0])) {
    const months = monthlyByYear.get(year) ?? [];
    if (months.length < 10) continue;
    const linesToCheck: Array<{ key: string; label: string }> = [
      { key: "revenue", label: "revenue" },
      { key: "ebitda", label: "EBITDA" },
      { key: "net_income", label: "net income" },
    ];
    const figures: Record<string, number | string | null> = { year };
    let anyChecked = false;
    let firstFailure: string | null = null;
    for (const { key, label } of linesToCheck) {
      const annualVal = lineVal(annual.lines, key);
      let monthlySum: number | null = null;
      let seen = 0;
      for (const m of months) {
        const v = lineVal(m.lines, key);
        if (v !== null) {
          monthlySum = (monthlySum ?? 0) + v;
          seen++;
        }
      }
      if (annualVal === null || monthlySum === null || seen === 0) continue;
      anyChecked = true;
      const variance = monthlySum - annualVal;
      const tol = Math.max(
        toleranceFor(monthlySum, annualVal),
        0.01 * Math.max(Math.abs(monthlySum), Math.abs(annualVal))
      );
      figures[`${key}MonthlySum`] = monthlySum;
      figures[`${key}Annual`] = annualVal;
      figures[`${key}Variance`] = variance;
      if (Math.abs(variance) > tol && firstFailure === null) {
        firstFailure = `${label}: monthly sum ${fmtMoney(monthlySum)} vs annual ${fmtMoney(annualVal)} — variance ${fmtMoney(variance)}`;
      }
    }
    mvaEmitted++;
    if (!anyChecked) {
      results.push({
        check: "monthly_vs_annual",
        scope: "company",
        setId: annual.set.id,
        periodEnd: annual.set.periodEnd,
        status: "not_applicable",
        message: `Monthly vs annual for ${year}: no comparable revenue/EBITDA/net income lines in both the monthly sets and the annual set`,
        figures,
      });
    } else if (firstFailure === null) {
      results.push({
        check: "monthly_vs_annual",
        scope: "company",
        setId: annual.set.id,
        periodEnd: annual.set.periodEnd,
        status: "pass",
        message: `Monthly statements sum to the annual figures for ${year} (revenue monthly ${fmtMoney(figures.revenueMonthlySum as number | null)} vs annual ${fmtMoney(figures.revenueAnnual as number | null)})`,
        figures,
      });
    } else {
      results.push({
        check: "monthly_vs_annual",
        scope: "company",
        setId: annual.set.id,
        periodEnd: annual.set.periodEnd,
        status: "fail",
        message: `Monthly vs annual mismatch for ${year} — ${firstFailure}`,
        figures,
      });
    }
  }
  if (mvaEmitted === 0) {
    results.push({
      check: "monthly_vs_annual",
      scope: "company",
      setId: null,
      periodEnd: null,
      status: "not_applicable",
      message:
        "Monthly vs annual check needs a fiscal year with both an annual set and at least 10 monthly sets — not applicable",
      figures: {},
    });
  }

  return results;
}
