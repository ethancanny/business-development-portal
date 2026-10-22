"use client";

/**
 * Deal Screen tab (Phase 7) — the Phase 4B screen for this deal's
 * company, read through the capital API: reported vs adjusted
 * EBITDA, the working-capital peg (served ONLY from an approved
 * analysis), and the entry-multiple grid + IRR sensitivity.
 *
 * Honest empty state is the rule: with no approved analysis there
 * is no screen, and this tab says so plainly rather than estimating
 * anything in its place.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import {
  API,
  api,
  cardCls,
  fmtDateShort,
  fmtMoic,
  fmtMoneyCompact,
  fmtMoneyN,
  fmtMultiple,
  fmtPct,
  tdCls,
  thCls,
  type CapitalTabProps,
  type ScreenData,
} from "@/components/capital/types";

export default function ScreenTab({ dealId }: CapitalTabProps) {
  const [data, setData] = useState<ScreenData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<ScreenData>(
        `${API}/deals/${encodeURIComponent(dealId)}/screen`
      );
      setData(d);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sensitivity = useMemo(() => {
    const cells = data?.dealScreen?.sensitivity ?? [];
    const entries = Array.from(new Set(cells.map((c) => c.entryMultiple))).sort((a, b) => a - b);
    const exits = Array.from(new Set(cells.map((c) => c.exitMultiple))).sort((a, b) => a - b);
    const byKey = new Map(cells.map((c) => [`${c.entryMultiple}|${c.exitMultiple}`, c]));
    return { entries, exits, byKey };
  }, [data]);

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !data) return <ErrorState onRetry={() => void load()} />;

  if (!data.analysis) {
    return (
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          No approved financial analysis yet
        </h3>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
          The deal screen, adjusted EBITDA and the working-capital peg all
          run on the company&apos;s financial analysis — and only once that
          analysis has been reviewed and approved. Until then there is no
          screen to show, and nothing is estimated here in its place.
        </p>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
          Run and approve the analysis from the company&apos;s Financials
          section (posted statements → Financial Analysis → Approve), then
          reopen this tab.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/due-diligence/${encodeURIComponent(dealId)}`}
            className="btn btn-secondary btn-sm min-h-[44px]"
          >
            Open Due Diligence workspace
          </Link>
        </div>
      </div>
    );
  }

  const wc = data.workingCapital;
  const grid = data.dealScreen?.grid ?? [];
  const vp = data.valuationParams;
  const screenBasis = data.dealScreen?.ebitdaBasis ?? data.dealScreen?.basis;

  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-400 dark:text-white/40">
        Analysis {data.analysis.status} · generated {fmtDateShort(data.analysis.generatedAt)}
        {screenBasis ? ` · EBITDA basis: ${screenBasis}` : ""}
      </p>

      {/* EBITDA basis */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card-surface p-4">
          <StatTile label="Reported EBITDA" display={fmtMoneyCompact(data.reportedEbitda ?? 0)} title={fmtMoneyN(data.reportedEbitda)} caption="As reported in posted statements" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Adjusted EBITDA" display={fmtMoneyCompact(data.adjustedEbitda ?? 0)} title={fmtMoneyN(data.adjustedEbitda)} caption="After accepted QoE adjustments" />
        </div>
      </div>

      {/* Working capital peg */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Working capital
        </h3>
        {!wc?.available ? (
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
            {wc?.reason ||
              "Working capital is not available from the approved analysis for this company."}
          </p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-3 gap-4">
              <div>
                <p className="micro-label">Peg — low</p>
                <p className="tnum mt-0.5 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyCompact(wc.data?.peg?.low ?? 0)}</p>
              </div>
              <div>
                <p className="micro-label">Peg — mid</p>
                <p className="tnum mt-0.5 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white" title={fmtMoneyN(wc.data?.peg?.mid)}>{fmtMoneyCompact(wc.data?.peg?.mid ?? 0)}</p>
              </div>
              <div>
                <p className="micro-label">Peg — high</p>
                <p className="tnum mt-0.5 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyCompact(wc.data?.peg?.high ?? 0)}</p>
              </div>
            </div>
            {wc.data?.peg?.basis && (
              <p className="mt-2 text-sm text-slate-500 dark:text-white/50">{wc.data.peg.basis}</p>
            )}
            <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
              Normalized working capital: {fmtPct(wc.data?.normalizedWcPct)} of revenue
            </p>
            {(wc.data?.missingInputs ?? []).length > 0 && (
              <ul className="mt-2 list-inside list-disc text-sm text-amber-700 dark:text-amber-300">
                {wc.data!.missingInputs!.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* Deal screen grid */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Deal screen — entry grid
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          Exit at the entry multiple, on the analysis&apos; assumptions.
        </p>
        {grid.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            The approved analysis carries no deal screen grid for this company.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className={thCls}>Entry</th>
                  <th className={`${thCls} text-right`}>Enterprise value</th>
                  <th className={`${thCls} text-right`}>Debt</th>
                  <th className={`${thCls} text-right`}>Fees</th>
                  <th className={`${thCls} text-right`}>Equity check</th>
                  <th className={`${thCls} text-right`}>Exit value</th>
                  <th className={`${thCls} text-right`}>MOIC</th>
                  <th className={`${thCls} text-right`}>IRR</th>
                </tr>
              </thead>
              <tbody>
                {grid.map((row) => (
                  <tr key={row.entryMultiple} className="border-t border-slate-100 dark:border-white/5">
                    <td className={`${tdCls} font-semibold`}>{fmtMultiple(row.entryMultiple)}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(row.enterpriseValue)}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(row.debt)}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(row.fees)}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(row.equityCheck)}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(row.exitValue)}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtMoic(row.moic)}</td>
                    <td className={`${tdCls} tnum text-right`}>{fmtPct(row.irr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(data.dealScreen?.notes ?? []).map((n) => (
          <p key={n} className="mt-2 text-xs text-slate-400 dark:text-white/40">{n}</p>
        ))}
      </div>

      {/* Sensitivity */}
      {sensitivity.entries.length > 0 && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Sensitivity — IRR by entry × exit
          </h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className={thCls}>Entry \ Exit</th>
                  {sensitivity.exits.map((xm) => (
                    <th key={xm} className={`${thCls} text-right`}>{fmtMultiple(xm)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sensitivity.entries.map((em) => (
                  <tr key={em} className="border-t border-slate-100 dark:border-white/5">
                    <td className={`${tdCls} font-semibold`}>{fmtMultiple(em)}</td>
                    {sensitivity.exits.map((xm) => {
                      const cell = sensitivity.byKey.get(`${em}|${xm}`);
                      return (
                        <td key={xm} className={`${tdCls} tnum text-right`}>
                          {fmtPct(cell?.irr)}
                          {cell?.moic !== null && cell?.moic !== undefined && (
                            <span className="block text-xs text-slate-400 dark:text-white/40">{fmtMoic(cell.moic)}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Valuation params in effect */}
      {vp && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Valuation parameters in effect
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <p className="text-slate-500 dark:text-white/50">Entry range <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMultiple(vp.entryMultipleLow)} – {fmtMultiple(vp.entryMultipleHigh)}</span></p>
            <p className="text-slate-500 dark:text-white/50">Leverage range <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMultiple(vp.leverageLow)} – {fmtMultiple(vp.leverageHigh)}</span></p>
            <p className="text-slate-500 dark:text-white/50">Target IRR <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtPct(vp.targetIrr)}</span></p>
            <p className="text-slate-500 dark:text-white/50">Default entry <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMultiple(vp.entryMultiple)}</span></p>
            <p className="text-slate-500 dark:text-white/50">Default leverage <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMultiple(vp.leverageMultiple)}</span></p>
            <p className="text-slate-500 dark:text-white/50">Default exit <span className="tnum block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMultiple(vp.exitMultiple)}</span></p>
          </div>
          <p className="mt-3 text-xs text-slate-400 dark:text-white/40">
            Global defaults — edit them in Settings → Valuation parameters.
          </p>
        </div>
      )}
    </div>
  );
}
