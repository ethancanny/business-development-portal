"use client";

/**
 * Targets — the plan's benchmark set, grouped by period. These are
 * the targets Portfolio Monitoring consumes as the benchmark set
 * for this company. Targets can be added manually or derived from
 * the plan (base financials grown by the scenario growth rate).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  TARGET_METRICS,
  api,
  cardCls,
  fmtTargetValue,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  parseNum,
  selectCls,
  type VcTabProps,
  type VcTarget,
} from "@/components/valuecreation/types";

export default function TargetsTab({ planId }: VcTabProps) {
  const [targets, setTargets] = useState<VcTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [form, setForm] = useState({ periodLabel: "", periodEnd: "", metric: TARGET_METRICS[0].key, value: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [growthPct, setGrowthPct] = useState("5");
  const [deriving, setDeriving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Record<string, unknown>>(
        `${API}/plans/${encodeURIComponent(planId)}/targets`
      );
      setTargets(listFrom<VcTarget>(d, "targets", "items"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const byPeriod = new Map<string, VcTarget[]>();
    for (const t of targets) {
      const key = t.periodLabel || t.period || "—";
      const arr = byPeriod.get(key) ?? [];
      arr.push(t);
      byPeriod.set(key, arr);
    }
    return Array.from(byPeriod.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [targets]);

  const add = async () => {
    if (!form.periodLabel.trim() || !form.periodEnd || form.value.trim() === "" || saving) return;
    const raw = parseNum(form.value);
    if (raw === null) return;
    setSaving(true);
    setError("");
    try {
      await api(`${API}/plans/${encodeURIComponent(planId)}/targets`, {
        method: "POST",
        body: JSON.stringify({
          periodLabel: form.periodLabel.trim(),
          periodEnd: form.periodEnd,
          metric: form.metric,
          // Margin values are entered and stored as percentage points.
          targetValue: raw,
          notes: form.notes,
        }),
      });
      setForm((f) => ({ ...f, value: "", notes: "" }));
      await load();
    } catch {
      setError("Could not add that target. A period label, a period end date and a value are required.");
    } finally {
      setSaving(false);
    }
  };

  const derive = async () => {
    setDeriving(true);
    setError("");
    setNotice("");
    try {
      const d = await api<{ created?: number; targets?: VcTarget[] }>(
        `${API}/plans/${encodeURIComponent(planId)}/targets/derive`,
        { method: "POST", body: JSON.stringify({ growthPct: parseNum(growthPct) ?? undefined }) }
      );
      const n = Array.isArray(d.targets) ? d.targets.length : (d.created ?? 0);
      setNotice(
        n > 0
          ? `Derived ${n} target${n === 1 ? "" : "s"} from the plan at ${growthPct}% growth.`
          : "Derivation ran — no new targets were produced (posted financials may be missing, or targets already exist for those periods)."
      );
      await load();
    } catch {
      setError("Could not derive targets from the plan. Posted financials are required as the base.");
    } finally {
      setDeriving(false);
    }
  };

  const remove = async (t: VcTarget) => {
    setBusyId(t.id);
    setError("");
    try {
      await api(`${API}/targets/${encodeURIComponent(t.id)}`, { method: "DELETE" });
      await load();
    } catch {
      setError("Could not delete that target. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

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
          Plan targets
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          Portfolio Monitoring consumes this set as the benchmark for the company — actuals are judged against these numbers period by period.
        </p>
        {targets.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No targets yet"
              message="Add targets manually below, or derive them from the plan's base financials."
            />
          </div>
        ) : (
          <div className="mt-4 space-y-5">
            {groups.map(([period, rows]) => (
              <div key={period}>
                <p className="micro-label mb-1.5">{period}</p>
                <div className="overflow-x-auto">
                  <table className="tbl-grad w-full min-w-[480px] text-sm">
                    <thead>
                      <tr>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Metric</th>
                        <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Target</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Source</th>
                        <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr key={t.id} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                          <td className="px-3 py-2.5 font-medium text-[#0d1f3c] dark:text-white">
                            {labelOf(TARGET_METRICS, t.metric)}
                            {t.notes && <span className="block text-xs font-normal text-slate-500 dark:text-white/50">{t.notes}</span>}
                          </td>
                          <td className="tnum px-3 py-2.5 text-right font-medium">{fmtTargetValue(t)}</td>
                          <td className="px-3 py-2.5">
                            <span className="badge badge-neutral">{t.source ?? "manual"}</span>
                          </td>
                          <td className="px-3 py-2.5">
                            <button type="button" className="btn btn-danger btn-sm" disabled={busyId === t.id} onClick={() => void remove(t)}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Add target
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label className={labelCls}>Period label</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.periodLabel} onChange={(e) => setForm((f) => ({ ...f, periodLabel: e.target.value }))} placeholder="e.g. FY2027" />
          </div>
          <div>
            <label className={labelCls}>Period end</label>
            <input type="date" className={`${inputCls} min-h-[44px]`} value={form.periodEnd} onChange={(e) => setForm((f) => ({ ...f, periodEnd: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Metric</label>
            <select className={`${selectCls} min-h-[44px]`} value={form.metric} onChange={(e) => setForm((f) => ({ ...f, metric: e.target.value }))}>
              {TARGET_METRICS.map((m) => (
                <option key={m.key} value={m.key}>{m.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>
              {TARGET_METRICS.find((m) => m.key === form.metric)?.margin ? "Value (%)" : "Value (USD)"}
            </label>
            <input type="number" className={`${inputCls} min-h-[44px]`} value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))} placeholder={TARGET_METRICS.find((m) => m.key === form.metric)?.margin ? "e.g. 22.5" : "e.g. 6500000"} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => void add()} loading={saving} disabled={!form.periodLabel.trim() || !form.periodEnd || form.value.trim() === ""}>
            Add target
          </Button>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-4 dark:border-white/5">
          <div className="w-36">
            <label className={labelCls}>Growth % / year</label>
            <input type="number" className={`${inputCls} min-h-[44px]`} value={growthPct} onChange={(e) => setGrowthPct(e.target.value)} />
          </div>
          <Button variant="secondary" onClick={() => void derive()} loading={deriving}>
            Derive from plan
          </Button>
          <p className="max-w-md text-xs text-slate-500 dark:text-white/50">
            Builds the target set from the latest posted financials, grown at this rate, plus the plan's initiative impact.
          </p>
        </div>
      </div>
    </div>
  );
}
