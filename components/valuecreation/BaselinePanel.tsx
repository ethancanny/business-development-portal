"use client";

/**
 * Baseline & actuals (VCP redesign, §8) — mounted above the Targets
 * view. Baseline/target EBITDA are plan fields saved via the plan
 * PATCH. Locking writes an IMMUTABLE snapshot (baseline, target,
 * stored summary totals, the full initiative set); locking again
 * supersedes — the old snapshot is never edited. Once locked, the
 * variance block shows current stored totals against the snapshot.
 * Realized vs planned reads Portfolio Monitoring ONLY through the
 * overview payload's monitoring block (its service layer); with no
 * monitoring record the panel says so plainly.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui";
import {
  API,
  api,
  cardCls,
  fmtDateShort,
  fmtMoneyN,
  inputCls,
  labelCls,
  parseNum,
  type BaselineState,
  type PlanOverviewData,
  type VcTabProps,
} from "@/components/valuecreation/types";

function signed(n: number): string {
  if (n === 0) return "—";
  return `${n > 0 ? "+" : "−"}${fmtMoneyN(Math.abs(n)).replace("-", "")}`;
}

export default function BaselinePanel({ planId, plan, summary, reload }: VcTabProps) {
  const [state, setState] = useState<BaselineState | null>(null);
  const [monitoring, setMonitoring] = useState<PlanOverviewData["monitoring"] | null>(null);
  const [baselineIn, setBaselineIn] = useState(plan.baselineEbitda === null || plan.baselineEbitda === undefined ? "" : String(plan.baselineEbitda));
  const [targetIn, setTargetIn] = useState(plan.targetEbitda === null || plan.targetEbitda === undefined ? "" : String(plan.targetEbitda));
  const [note, setNote] = useState("");
  const [confirmLock, setConfirmLock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    try {
      const d = await api<{ baseline: BaselineState }>(
        `${API}/plans/${encodeURIComponent(planId)}/baseline`
      );
      setState(d.baseline);
    } catch {
      setState({ current: null, versions: [], variance: null });
    }
    try {
      const d = await api<{ overview: PlanOverviewData }>(
        `${API}/plans/${encodeURIComponent(planId)}/overview`
      );
      setMonitoring(d.overview.monitoring);
    } catch {
      setMonitoring(null);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [planId]);
  useEffect(() => {
    setBaselineIn(plan.baselineEbitda === null || plan.baselineEbitda === undefined ? "" : String(plan.baselineEbitda));
    setTargetIn(plan.targetEbitda === null || plan.targetEbitda === undefined ? "" : String(plan.targetEbitda));
  }, [plan.baselineEbitda, plan.targetEbitda]);

  const saveFigures = async () => {
    setBusy(true);
    setError(""); setNotice("");
    try {
      await api(`${API}/plans/${encodeURIComponent(planId)}`, {
        method: "PATCH",
        body: JSON.stringify({
          baselineEbitda: parseNum(baselineIn),
          targetEbitda: parseNum(targetIn),
        }),
      });
      setNotice("Baseline and target saved.");
      await reload();
      await load();
    } catch {
      setError("Baseline and target could not be saved.");
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    setBusy(true);
    setError(""); setNotice("");
    try {
      await api(`${API}/plans/${encodeURIComponent(planId)}/baseline`, {
        method: "POST",
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      setNote("");
      setConfirmLock(false);
      setNotice("Baseline locked. The snapshot is immutable; later changes now track against it.");
      await load();
    } catch {
      setError("The baseline could not be locked. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const cur = state?.current ?? null;
  const totals = (cur?.totals ?? {}) as Record<string, number | null>;
  const variance = state?.variance ?? null;

  return (
    <div className={`${cardCls} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Baseline & actuals</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-slate-500 dark:text-white/50">
            The plan&rsquo;s baseline and target EBITDA, the locked close snapshot, and
            realized performance once monitoring data exists.
          </p>
        </div>
        {monitoring?.hasMonitoring && (
          <Link href={monitoring.monitoringUrl} className="shrink-0">
            <Button variant="secondary" size="sm">Company monitoring →</Button>
          </Link>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}
      {notice && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>
      )}

      {/* Plan figures */}
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div>
          <label className={labelCls}>Baseline EBITDA ($)</label>
          <input inputMode="decimal" className={`${inputCls} min-h-[44px]`} value={baselineIn} onChange={(e) => setBaselineIn(e.target.value)} placeholder="At close" />
        </div>
        <div>
          <label className={labelCls}>Target EBITDA ($)</label>
          <input inputMode="decimal" className={`${inputCls} min-h-[44px]`} value={targetIn} onChange={(e) => setTargetIn(e.target.value)} placeholder="Plan target" />
        </div>
        <Button onClick={() => void saveFigures()} loading={busy}>Save figures</Button>
      </div>

      {/* Snapshot state */}
      {state === null ? (
        <div aria-busy="true"><div className="skel h-16" /></div>
      ) : cur === null ? (
        <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <p className="text-sm text-slate-600 dark:text-white/65">
            No baseline locked yet. Locking freezes the baseline, target, plan totals and
            the initiative set as they stand — it cannot be edited afterwards, only
            superseded by a new lock.
          </p>
          {confirmLock ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input className={`${inputCls} min-h-[40px] w-64`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional) — e.g. Locked at close" />
              <Button size="sm" onClick={() => void lock()} loading={busy}>Confirm lock</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmLock(false)}>Cancel</Button>
            </div>
          ) : (
            <Button size="sm" className="mt-3" onClick={() => setConfirmLock(true)}>Lock baseline</Button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-[#b8975a]/10 px-4 py-3 text-sm">
            <span className="font-semibold text-[#0d1f3c] dark:text-white">
              Baseline v{cur.version} · locked {fmtDateShort(cur.lockedAt)} by {cur.lockedBy}
            </span>
            {cur.note && <span className="text-slate-600 dark:text-white/65">{cur.note}</span>}
            <span className="tnum text-slate-600 dark:text-white/65">
              Baseline {fmtMoneyN(cur.baselineEbitda)} → target {fmtMoneyN(cur.targetEbitda)} · {cur.initiatives.length} initiatives frozen
            </span>
          </div>

          {variance && (
            <div className="overflow-x-auto">
              <table className="tbl-grad w-full min-w-[560px] text-sm">
                <thead>
                  <tr>
                    {["Measure", "At lock", "Now", "Variance"].map((h, idx) => (
                      <th key={h} className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide ${idx > 0 ? "text-right" : "text-left"}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label: "Weighted impact", at: totals.impactWeighted, now: summary?.impactWeighted ?? 0, delta: variance.impactWeighted },
                    { label: "Unweighted impact", at: totals.impactUnweighted, now: summary?.impactUnweighted ?? 0, delta: variance.impactUnweighted },
                    { label: "One-time cost", at: totals.totalOneTimeCost, now: summary?.totalOneTimeCost ?? 0, delta: variance.totalOneTimeCost },
                    { label: "Recurring cost / yr", at: totals.totalRecurringCost, now: summary?.totalRecurringCost ?? 0, delta: variance.totalRecurringCost },
                  ].map((r) => (
                    <tr key={r.label} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                      <td className="px-3 py-2.5 font-medium text-[#0d1f3c] dark:text-white">{r.label}</td>
                      <td className="tnum px-3 py-2.5 text-right">{fmtMoneyN(r.at ?? null)}</td>
                      <td className="tnum px-3 py-2.5 text-right">{fmtMoneyN(r.now)}</td>
                      <td className={`tnum px-3 py-2.5 text-right font-medium ${r.delta === 0 ? "text-slate-400" : r.delta > 0 ? "text-emerald-600 dark:text-emerald-300" : "text-red-600 dark:text-red-300"}`}>
                        {signed(r.delta)}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-slate-100 dark:border-white/5">
                    <td className="px-3 py-2.5 font-medium text-[#0d1f3c] dark:text-white">Initiatives</td>
                    <td className="tnum px-3 py-2.5 text-right">{cur.initiatives.length}</td>
                    <td className="tnum px-3 py-2.5 text-right">{cur.initiatives.length + variance.initiativeCount}</td>
                    <td className="tnum px-3 py-2.5 text-right font-medium">{variance.initiativeCount === 0 ? "—" : `${variance.initiativeCount > 0 ? "+" : ""}${variance.initiativeCount}`}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {confirmLock ? (
              <>
                <input className={`${inputCls} min-h-[40px] w-64`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note for the new version (optional)" />
                <Button size="sm" onClick={() => void lock()} loading={busy}>Lock new version</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmLock(false)}>Cancel</Button>
              </>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setConfirmLock(true)}>
                Lock new version (supersedes v{cur.version})
              </Button>
            )}
            {state.versions.length > 1 && (
              <span className="text-xs text-slate-500 dark:text-white/50">
                History: {state.versions.map((v) => `v${v.version} (${fmtDateShort(v.lockedAt)}${v.supersededAt ? ", superseded" : ""})`).join(" · ")}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Realized vs planned */}
      <div className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
        <p className="text-sm font-medium text-[#0d1f3c] dark:text-white">Realized vs planned</p>
        {monitoring === null ? (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">Monitoring status could not be loaded.</p>
        ) : monitoring.hasMonitoring ? (
          <p className="tnum mt-0.5 text-sm text-slate-600 dark:text-white/65">
            Actual EBITDA {fmtMoneyN(monitoring.actualEbitda)} (period ending {fmtDateShort(monitoring.latestPeriodEnd)})
            vs baseline {fmtMoneyN(monitoring.baselineUsed)} → realized impact{" "}
            <span className="font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(monitoring.realizedImpact)}</span>{" "}
            against planned weighted impact {fmtMoneyN(summary?.impactWeighted ?? 0)}.
          </p>
        ) : (
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            Planned view only — no Portfolio Monitoring record exists for this company yet.
            Realized impact appears here automatically once monitoring data is recorded.
          </p>
        )}
      </div>
    </div>
  );
}
