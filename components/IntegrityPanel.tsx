"use client";

/**
 * IntegrityPanel (Part 4B, WS-D) — shared per-check integrity rows.
 *
 * Used by FinancialAnalysis (fed from payload.integrity) and by
 * FinancialReview (fed from GET /api/platform/financials/analysis/
 * integrity). Structural local type — mirrors IntegrityCheckResult in
 * lib/finanalysis/types.ts without importing server code.
 *
 * Each row: status chip (pass = emerald, fail = red, not_applicable =
 * slate), the humanized check label, the specific message (which names
 * the figures + variance), the period when present, and the figures
 * rendered compactly as key: value with money formatted.
 */

import { fmtDate, fmtMoney } from "@/lib/format";

export interface IntegrityCheckResult {
  check: string;
  scope: "set" | "company" | string;
  setId: string | null;
  periodEnd: string | null;
  status: "pass" | "fail" | "not_applicable" | string;
  message: string;
  figures: Record<string, number | string | null>;
}

const CHECK_LABELS: Record<string, string> = {
  bs_balance: "Balance sheet balance",
  cf_ties_cash: "Cash flow ties to cash",
  retained_earnings_rollforward: "Retained earnings roll-forward",
  subledger_ties: "Subledger ties",
  period_continuity: "Period continuity",
  monthly_vs_annual: "Monthly vs annual",
};

function checkLabel(check: string): string {
  return CHECK_LABELS[check] ?? check.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function statusChip(status: string): { label: string; cls: string } {
  if (status === "pass")
    return {
      label: "✓ Pass",
      cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
    };
  if (status === "fail")
    return {
      label: "✗ Fail",
      cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
    };
  return {
    label: "N/A",
    cls: "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/60",
  };
}

/** Figure keys that are counts/steps/years/ratios rather than money. */
function isMoneyFigure(key: string, value: number): boolean {
  if (
    /count|index|months?|days|pct|percent|ratio|multiple|periods|step|year/i.test(key)
  )
    return false;
  return Number.isFinite(value);
}

function figureValue(key: string, value: number | string | null): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") {
    return isMoneyFigure(key, value) ? fmtMoney(value) : String(value);
  }
  return String(value);
}

export default function IntegrityPanel({
  results,
}: {
  results: IntegrityCheckResult[];
}) {
  if (!results || results.length === 0) {
    return (
      <p className="text-sm text-caption">
        No integrity checks available — post financial statements first, then run the
        analysis.
      </p>
    );
  }
  const fails = results.filter((r) => r.status === "fail").length;
  return (
    <div>
      {fails > 0 && (
        <p className="mb-2 text-sm font-medium text-red-700 dark:text-red-300">
          {fails} integrity check{fails === 1 ? "" : "s"} failing — see the specific figures
          below.
        </p>
      )}
      <ul className="divide-y divide-slate-100 dark:divide-white/5">
        {results.map((r, i) => {
          const chip = statusChip(r.status);
          const figures = Object.entries(r.figures ?? {});
          return (
            <li key={`${r.check}-${r.setId ?? "company"}-${i}`} className="py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${chip.cls}`}
                >
                  {chip.label}
                </span>
                <span className="text-sm font-medium text-[#0d1f3c] dark:text-white">
                  {checkLabel(r.check)}
                </span>
                {r.periodEnd && (
                  <span className="text-xs text-caption">{fmtDate(r.periodEnd)}</span>
                )}
                <span className="text-xs text-caption">{r.scope}</span>
              </div>
              <p className="mt-1 text-sm text-slate-700 dark:text-white/80">{r.message}</p>
              {figures.length > 0 && (
                <p className="tnum mt-0.5 text-xs text-caption">
                  {figures
                    .map(([k, v]) => `${k.replace(/_/g, " ")}: ${figureValue(k, v)}`)
                    .join(" · ")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
