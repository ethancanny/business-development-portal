"use client";

/**
 * Scenarios — each scenario carries a computed EBITDA bridge from
 * the backend: base EBITDA, per-initiative impact and
 * confidence-weighted impact, adjusted EBITDA in both views, and a
 * realization sensitivity table. A revenue-growth assumption feeds
 * the scenario's revenue line. Recompute refreshes the bridge from
 * the live plan; the computed-at stamp travels with the bridge.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  api,
  cardCls,
  fmtConfidence,
  fmtDateShort,
  fmtMoneyN,
  fmtSignedMoneyN,
  inputCls,
  labelCls,
  listFrom,
  parseNum,
  type Scenario,
  type VcTabProps,
} from "@/components/valuecreation/types";

export default function ScenariosTab({ planId }: VcTabProps) {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Scenario | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [form, setForm] = useState({ name: "", growthPct: "5" });
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Record<string, unknown>>(
        `${API}/plans/${encodeURIComponent(planId)}/scenarios`
      );
      const list = listFrom<Scenario>(d, "scenarios", "items");
      setScenarios(list);
      setSelectedId((cur) => cur || (list[0]?.id ?? ""));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  /* The list carries totals only — the bridge comes from the detail GET. */
  const loadDetail = useCallback(async (id: string) => {
    if (!id) {
      setDetail(null);
      return;
    }
    try {
      const d = await api<{ scenario: Scenario }>(
        `${API}/scenarios/${encodeURIComponent(id)}`
      );
      setDetail(d.scenario ?? null);
    } catch {
      setDetail(null);
    }
  }, []);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const create = async () => {
    if (!form.name.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const growth = parseNum(form.growthPct);
      const d = await api<{ scenario: Scenario }>(
        `${API}/plans/${encodeURIComponent(planId)}/scenarios`,
        {
          method: "POST",
          body: JSON.stringify({
            name: form.name.trim(),
            assumptions: growth === null ? undefined : { revenueGrowthPct: growth },
          }),
        }
      );
      setForm({ name: "", growthPct: "5" });
      await load();
      if (d.scenario?.id) setSelectedId(d.scenario.id);
    } catch {
      setError("Could not create that scenario. A name is required.");
    } finally {
      setCreating(false);
    }
  };

  const recompute = async (s: Scenario) => {
    setBusyId(s.id);
    setError("");
    setNotice("");
    try {
      const d = await api<{ scenario: Scenario }>(
        `${API}/scenarios/${encodeURIComponent(s.id)}/recompute`,
        { method: "POST", body: JSON.stringify({}) }
      );
      if (d.scenario) setDetail(d.scenario);
      await load();
      setNotice(`“${s.name}” recomputed from the current plan.`);
    } catch {
      setError("Could not recompute that scenario. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (s: Scenario) => {
    setBusyId(s.id);
    setError("");
    try {
      await api(`${API}/scenarios/${encodeURIComponent(s.id)}`, { method: "DELETE" });
      if (selectedId === s.id) setSelectedId("");
      await load();
    } catch {
      setError("Could not delete that scenario. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const selected = detail ?? scenarios.find((s) => s.id === selectedId) ?? null;
  const bridge = detail?.bridge ?? null;
  const growthLine = bridge?.revenueScenario ?? null;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}
      {notice && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Scenarios
        </h3>
        {scenarios.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No scenarios yet. Create one below — its bridge computes from the plan's initiatives.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            {scenarios.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[200px] flex-1">
                  <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{s.name}</p>
                  <p className="text-xs text-slate-500 dark:text-white/50">
                    Revenue growth {s.assumptions?.revenueGrowthPct ?? "—"}% · realization {s.assumptions?.realizationPct ?? "—"}%
                    {s.totals
                      ? ` · adjusted EBITDA ${fmtMoneyN(s.totals.adjustedWeightedEbitda)} (weighted)`
                      : " · not computed yet"}
                    {s.computedAt ? ` · computed ${fmtDateShort(s.computedAt)}` : ""}
                  </p>
                </div>
                <button type="button" className={`btn btn-sm min-h-[44px] ${selectedId === s.id ? "btn-primary" : "btn-secondary"}`} onClick={() => setSelectedId(s.id)}>
                  View bridge
                </button>
                <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busyId === s.id} onClick={() => void recompute(s)}>
                  Recompute
                </button>
                <button type="button" className="btn btn-danger btn-sm min-h-[44px]" disabled={busyId === s.id} onClick={() => void remove(s)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4 dark:border-white/5">
          <div className="min-w-[200px] flex-1">
            <label className={labelCls}>New scenario name</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Base case · plan as committed" />
          </div>
          <div className="w-32">
            <label className={labelCls}>Revenue growth %</label>
            <input type="number" className={`${inputCls} min-h-[44px]`} value={form.growthPct} onChange={(e) => setForm((f) => ({ ...f, growthPct: e.target.value }))} />
          </div>
          <Button onClick={() => void create()} loading={creating} disabled={!form.name.trim()}>
            Create scenario
          </Button>
        </div>
      </div>

      {selected && (
        <div className={cardCls}>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                {selected.name} — EBITDA bridge
              </h3>
              <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
                {bridge?.computedAt || selected.computedAt
                  ? `Computed ${fmtDateShort(bridge?.computedAt ?? selected.computedAt)}`
                  : "Not computed yet — press Recompute."}
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => void recompute(selected)} loading={busyId === selected.id}>
              Recompute bridge
            </Button>
          </div>

          {!bridge ? (
            <div className="mt-4">
              <EmptyState
                title="No bridge yet"
                message="Recompute this scenario to build the bridge from the plan's current initiatives and posted financials."
              />
            </div>
          ) : (
            <>
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="micro-label">Base revenue</p>
                  <p className="tnum mt-1 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(bridge.baseRevenue)}</p>
                  {growthLine !== null && (
                    <p className="text-xs text-slate-500 dark:text-white/50">
                      At {growthLine.growthPct}% growth: revenue {fmtMoneyN(growthLine.revenueAtGrowth)} · EBITDA {fmtMoneyN(growthLine.ebitdaAtGrowth)}
                    </p>
                  )}
                </div>
                <div>
                  <p className="micro-label">Base EBITDA</p>
                  <p className="tnum mt-1 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(bridge.baseEbitda)}</p>
                </div>
                <div>
                  <p className="micro-label">Adjusted EBITDA (full)</p>
                  <p className="tnum mt-1 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(bridge.adjustedEbitda)}</p>
                  <p className="text-xs text-slate-500 dark:text-white/50">{fmtSignedMoneyN(bridge.totalImpact)} of initiative impact</p>
                </div>
                <div>
                  <p className="micro-label">Adjusted EBITDA (weighted)</p>
                  <p className="tnum mt-1 font-display text-2xl font-semibold text-gold-700 dark:text-gold-400">{fmtMoneyN(bridge.adjustedWeightedEbitda)}</p>
                  <p className="text-xs text-slate-500 dark:text-white/50">{fmtSignedMoneyN(bridge.totalWeightedImpact)} confidence-weighted</p>
                </div>
              </div>

              <div className="mt-5 overflow-x-auto">
                <table className="tbl-grad w-full min-w-[560px] text-sm">
                  <thead>
                    <tr>
                      <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Initiative</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Impact</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Confidence</th>
                      <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Weighted</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bridge.rows.map((r) => (
                      <tr key={r.initiativeId} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                        <td className="px-3 py-2.5 font-medium text-[#0d1f3c] dark:text-white">{r.title}</td>
                        <td className="tnum px-3 py-2.5 text-right">{fmtSignedMoneyN(r.impact)}</td>
                        <td className="tnum px-3 py-2.5 text-right">{fmtConfidence(r.confidence)}</td>
                        <td className="tnum px-3 py-2.5 text-right">{fmtSignedMoneyN(r.weightedImpact)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-200 dark:border-white/10">
                      <td className="px-3 py-2.5 font-semibold text-[#0d1f3c] dark:text-white">Total</td>
                      <td className="tnum px-3 py-2.5 text-right font-semibold">{fmtSignedMoneyN(bridge.totalImpact)}</td>
                      <td className="px-3 py-2.5" />
                      <td className="tnum px-3 py-2.5 text-right font-semibold">{fmtSignedMoneyN(bridge.totalWeightedImpact)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {(bridge.realizationSensitivity ?? []).length > 0 && (
                <div className="mt-5">
                  <p className="micro-label mb-2">Realization sensitivity — adjusted EBITDA if only part of the plan lands</p>
                  <div className="flex flex-wrap gap-2">
                    {bridge.realizationSensitivity.map((cell) => (
                      <div key={cell.pct} className="min-w-[104px] rounded-xl border border-slate-100 px-3 py-2 text-center dark:border-white/5">
                        <p className="tnum text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">{cell.pct}% realized</p>
                        <p className="tnum mt-0.5 text-sm font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(cell.ebitda)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
