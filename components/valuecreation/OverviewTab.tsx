"use client";

/**
 * Overview (VCP redesign, §4) — composed entirely from the stored
 * overview payload (GET /plans/[id]/overview): the default scenario's
 * stored EBITDA bridge, lever impacts from the plan summary inputs,
 * at-risk initiatives, next milestones, the locked baseline, realized
 * vs planned from Portfolio Monitoring's service, and recent plan
 * activity. Nothing is recomputed on the client beyond choosing which
 * stored scenario view (base / upside / downside) to draw.
 *
 * Scenario selector semantics: Base = the default scenario's stored
 * bridge (weighted, at its realization assumption); Upside = the same
 * steps at full unweighted impact; Downside = the stored 50%
 * realization sensitivity. Without a scenario, the bridge falls back
 * to the plan's initiatives and baseline/target fields.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, ErrorState } from "@/components/ui";
import PersonAvatar from "@/components/PersonAvatar";
import {
  API,
  PLAYBOOK_CATEGORIES,
  api,
  cardCls,
  fmtDateShort,
  fmtMoneyCompact,
  fmtMoneyN,
  INITIATIVE_STATUSES,
  initiativeStatusBadge,
  labelOf,
  type Initiative,
  type PlanOverviewData,
  type VcTabProps,
} from "@/components/valuecreation/types";

type Mode = "base" | "upside" | "downside";

interface BridgeStep { label: string; value: number }

export default function OverviewTab({ planId, plan, initiatives, onOpenInitiative }: VcTabProps & {
  onOpenInitiative?: (id: string) => void;
}) {
  const [data, setData] = useState<PlanOverviewData | null>(null);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState<Mode>("base");

  const load = async () => {
    try {
      const d = await api<{ overview: PlanOverviewData }>(
        `${API}/plans/${encodeURIComponent(planId)}/overview`
      );
      setData(d.overview);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [planId]);

  const bridge = useMemo(() => {
    if (!data) return null;
    const sc = data.defaultScenario;
    const b = sc?.bridge ?? null;
    if (b && typeof b.baseEbitda === "number") {
      const rows = (b.rows ?? []).filter((r) => r.impact !== 0 || r.weightedImpact !== 0);
      let steps: BridgeStep[];
      let end: number;
      if (mode === "upside") {
        steps = rows.map((r) => ({ label: r.title, value: r.impact }));
        end = b.baseEbitda + b.totalImpact;
      } else if (mode === "downside") {
        steps = rows.map((r) => ({ label: r.title, value: r.weightedImpact * 0.5 }));
        const sens = (b.realizationSensitivity ?? []).find((s) => s.pct === 50);
        end = sens ? sens.ebitda : b.baseEbitda + b.totalWeightedImpact * 0.5;
      } else {
        steps = rows.map((r) => ({ label: r.title, value: r.weightedImpact }));
        end = b.adjustedWeightedEbitda;
      }
      return {
        base: b.baseEbitda,
        steps,
        end,
        source: `Scenario “${sc!.name}”`,
        target: plan.targetEbitda ?? null,
      };
    }
    /* Fallback: initiatives + plan baseline/target fields. */
    const base = plan.baselineEbitda ?? 0;
    const steps = initiatives
      .filter((i) => i.status !== "deferred" && (i.ebitdaImpact ?? 0) !== 0)
      .map((i) => ({
        label: i.title,
        value: mode === "upside" ? (i.ebitdaImpact ?? 0) : (i.ebitdaImpact ?? 0) * (i.confidence ?? 1) * (mode === "downside" ? 0.5 : 1),
      }));
    const end = base + steps.reduce((s, x) => s + x.value, 0);
    return {
      base,
      steps,
      end,
      source: plan.baselineEbitda === null || plan.baselineEbitda === undefined ? "Initiatives (no baseline set, no scenario yet)" : "Initiatives (no scenario yet)",
      target: plan.targetEbitda ?? null,
    };
  }, [data, mode, initiatives, plan.baselineEbitda, plan.targetEbitda]);

  if (failed) return <ErrorState onRetry={() => void load()} />;
  if (!data || !bridge) {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className={cardCls}><div className="skel h-40" /></div>
        <span className="sr-only">Loading overview…</span>
      </div>
    );
  }

  const summary = data.summary;
  const mon = data.monitoring;
  const maxLever = Math.max(1, ...data.leverImpacts.map((l) => Math.abs(l.weightedImpact)));
  const progressRows = [...initiatives]
    .filter((i) => i.status !== "deferred")
    .sort((a, b) => (a.endDate ?? "9999") < (b.endDate ?? "9999") ? -1 : 1)
    .slice(0, 8);
  const planElapsed = plan.planStartDate
    ? Math.min(100, Math.max(0, Math.round(
        ((Date.now() - new Date(`${plan.planStartDate.slice(0, 10)}T12:00:00`).getTime()) /
          (100 * 86_400_000)) * 100
      )))
    : null;

  return (
    <div className="space-y-4">
      {/* ------------------------- bridge + scenario ------------------------ */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              EBITDA bridge
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
              {bridge.source} · baseline {fmtMoneyN(bridge.base)} → {fmtMoneyN(bridge.end)}
              {bridge.target !== null && <> · target {fmtMoneyN(bridge.target)}</>}
            </p>
          </div>
          <div className="flex gap-1.5" role="tablist" aria-label="Scenario view">
            {(["base", "upside", "downside"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`min-h-[36px] rounded-full border px-3.5 text-[13px] font-medium capitalize transition ${
                  mode === m
                    ? "border-[#b8975a] bg-[#b8975a]/10 text-[#0d1f3c] ring-1 ring-[#b8975a]/50 dark:text-white"
                    : "border-slate-200 text-slate-500 hover:text-[#0d1f3c] dark:border-white/10 dark:text-white/55 dark:hover:text-white"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
        {bridge.steps.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No bridge steps yet"
              message="Initiatives with an EBITDA impact draw the bridge from baseline to target. Add initiatives or build a scenario in Playbooks & Models → Scenarios."
            />
          </div>
        ) : (
          <Waterfall base={bridge.base} steps={bridge.steps} end={bridge.end} target={bridge.target} />
        )}
        {data.scenarios.length > 0 && (
          <p className="mt-3 text-xs text-slate-500 dark:text-white/50">
            Scenarios: {data.scenarios.map((s) => `${s.name}${s.isDefault ? " (default)" : ""}`).join(" · ")} — manage in Playbooks &amp; Models → Scenarios.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --------------------------- impact by lever --------------------------- */}
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Impact by lever</h3>
          {data.leverImpacts.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-white/50">No initiative impact recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {data.leverImpacts.map((l) => (
                <li key={l.lever}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-[#0d1f3c] dark:text-white/90">
                      {labelOf(PLAYBOOK_CATEGORIES, l.lever)}
                      <span className="tnum ml-1.5 text-xs text-slate-500 dark:text-white/50">×{l.count}</span>
                    </span>
                    <span className="tnum font-medium text-[#0d1f3c] dark:text-white">
                      {fmtMoneyN(l.weightedImpact)}
                      <span className="ml-1.5 text-xs font-normal text-slate-500 dark:text-white/50">of {fmtMoneyN(l.impact)}</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div className="h-full rounded-full bg-[#b8975a]" style={{ width: `${Math.max(2, (Math.abs(l.weightedImpact) / maxLever) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="tnum mt-3 border-t border-slate-100 pt-2.5 text-sm text-slate-600 dark:border-white/5 dark:text-white/60">
            Weighted {fmtMoneyN(summary?.impactWeighted ?? 0)} · unweighted {fmtMoneyN(summary?.impactUnweighted ?? 0)}
          </p>
        </div>

        {/* ------------------------- progress vs timeline ------------------------ */}
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Progress vs timeline</h3>
          {planElapsed !== null && (
            <p className="tnum mt-1 text-sm text-slate-500 dark:text-white/50">
              Day {Math.max(0, Math.round((planElapsed / 100) * 100))} of the first 100 days · plan window {planElapsed}% elapsed
            </p>
          )}
          {progressRows.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-white/50">No active initiatives yet.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {progressRows.map((i) => (
                <li key={i.id}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-[#0d1f3c] dark:text-white/90">{i.title}</span>
                    <span className="tnum shrink-0 text-xs text-slate-500 dark:text-white/50">
                      {i.progressPct ?? 0}%{i.endDate ? ` · due ${fmtDateShort(i.endDate)}` : ""}
                    </span>
                  </div>
                  <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div
                      className={`h-full rounded-full ${i.status === "at_risk" ? "bg-red-500" : i.status === "done" ? "bg-emerald-500" : "bg-[#0d1f3c] dark:bg-[#54708f]"}`}
                      style={{ width: `${i.progressPct ?? 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ------------------------------- at risk ------------------------------ */}
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">At risk & overdue</h3>
          {data.atRisk.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-white/50">Nothing is flagged at risk or overdue. </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
              {data.atRisk.map((i) => (
                <li key={i.id}>
                  <button type="button" className="flex w-full items-center gap-2.5 py-2.5 text-left" onClick={() => onOpenInitiative?.(i.id)}>
                    {i.ownerName && <PersonAvatar name={i.ownerName} size={24} />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-[#0d1f3c] dark:text-white">{i.title}</span>
                      <span className="tnum block text-xs text-slate-500 dark:text-white/50">
                        {i.ownerName || "No owner"} · impact {fmtMoneyN(i.ebitdaImpact)}{i.endDate ? ` · due ${fmtDateShort(i.endDate)}` : ""}
                      </span>
                    </span>
                    <span className={`badge ${initiativeStatusBadge(i.status)}`}>{labelOf(INITIATIVE_STATUSES, i.status)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---------------------------- next milestones ---------------------------- */}
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Next milestones</h3>
          {data.nextMilestones.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
              No upcoming milestones — add milestones inside an initiative to track checkpoints here.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
              {data.nextMilestones.map((m) => (
                <li key={m.milestoneId} className="flex items-baseline gap-3 py-2.5">
                  <span className="tnum shrink-0 text-sm font-medium text-[#0d1f3c] dark:text-white">{fmtDateShort(m.dueDate)}</span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-[#0d1f3c] dark:text-white/90">{m.title}</span>
                    <span className="block truncate text-xs text-slate-500 dark:text-white/50">{m.initiativeTitle}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* --------------------- baseline + realized strip --------------------- */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Baseline & realized</h3>
            <p className="mt-0.5 max-w-2xl text-sm text-slate-500 dark:text-white/50">
              {data.baseline.current
                ? `Baseline locked ${fmtDateShort(data.baseline.current.lockedAt)} by ${data.baseline.current.lockedBy} — changes since then show as variance in Targets & Exit.`
                : "No baseline locked yet — lock one at close in Targets & Exit so later changes are tracked against it."}
            </p>
            <p className="mt-1.5 max-w-2xl text-sm text-slate-500 dark:text-white/50">
              {mon.hasMonitoring
                ? <>Realized EBITDA {fmtMoneyN(mon.actualEbitda)} (period ending {fmtDateShort(mon.latestPeriodEnd)}) vs baseline {fmtMoneyN(mon.baselineUsed)} — realized impact <span className="tnum font-medium text-[#0d1f3c] dark:text-white">{fmtMoneyN(mon.realizedImpact)}</span> against planned weighted {fmtMoneyN(summary?.impactWeighted ?? 0)}.</>
                : "No Portfolio Monitoring record for this company yet — showing the planned view only. Realized vs planned appears here once monitoring data exists."}
            </p>
          </div>
          {mon.hasMonitoring && (
            <Link href={mon.monitoringUrl} className="shrink-0">
              <Button variant="secondary" size="sm">Open monitoring →</Button>
            </Link>
          )}
        </div>
      </div>

      {/* ------------------------------- activity ------------------------------ */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Recent activity</h3>
        {data.activity.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">No plan activity recorded yet.</p>
        ) : (
          <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
            {data.activity.map((a) => (
              <li key={a.id} className="flex items-baseline gap-3 py-2">
                <span className="tnum w-24 shrink-0 text-xs text-slate-500 dark:text-white/50">{fmtDateShort(a.createdAt)}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-white/75">{a.message}</span>
                {a.actor && <span className="shrink-0 text-xs text-slate-500 dark:text-white/50">{a.actor}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ waterfall ------------------------------ */

function Waterfall({
  base, steps, end, target,
}: {
  base: number;
  steps: BridgeStep[];
  end: number;
  target: number | null;
}) {
  const shown = steps.slice(0, 12);
  const rest = steps.slice(12);
  if (rest.length > 0) {
    shown.push({ label: `+ ${rest.length} more initiatives`, value: rest.reduce((s, x) => s + x.value, 0) });
  }
  const cols: Array<{ label: string; from: number; to: number; kind: "base" | "step" | "end" }> = [
    { label: "Baseline", from: 0, to: base, kind: "base" },
  ];
  let cursor = base;
  for (const s of shown) {
    cols.push({ label: s.label, from: cursor, to: cursor + s.value, kind: "step" });
    cursor += s.value;
  }
  cols.push({ label: "Adjusted", from: 0, to: end, kind: "end" });
  const max = Math.max(1, base, end, target ?? 0, ...cols.map((c) => Math.max(c.from, c.to)));
  const H = 150;
  const y = (v: number) => H - (Math.max(0, v) / max) * H;

  return (
    <div className="mt-4 overflow-x-auto">
      <div className="flex min-w-[560px] items-end gap-1.5" style={{ height: H + 46 }}>
        {cols.map((c, idx) => {
          const top = y(Math.max(c.from, c.to));
          const height = Math.max(3, Math.abs(y(c.from) - y(c.to)));
          const color = c.kind === "base"
            ? "bg-[#0d1f3c] dark:bg-[#54708f]"
            : c.kind === "end"
              ? "bg-[#b8975a]"
              : c.to >= c.from ? "bg-emerald-600/85" : "bg-red-500/85";
          return (
            <div key={idx} className="flex min-w-0 flex-1 flex-col items-center justify-end" style={{ height: H + 46 }}>
              <span className="tnum mb-1 text-[10px] font-medium text-slate-500 dark:text-white/55">
                {fmtMoneyCompact(c.kind === "step" ? c.to - c.from : c.to)}
              </span>
              <div className="relative w-full" style={{ height: H }}>
                {target !== null && c.kind === "end" && (
                  <div className="absolute inset-x-0 border-t-2 border-dashed border-[#b8975a]" style={{ top: y(target) }} title={`Target ${fmtMoneyN(target)}`} />
                )}
                <div className={`absolute inset-x-[8%] rounded-sm ${color}`} style={{ top, height }} />
              </div>
              <span className="mt-1.5 line-clamp-2 h-7 text-center text-[10px] leading-tight text-slate-500 dark:text-white/50" title={c.label}>
                {c.label}
              </span>
            </div>
          );
        })}
      </div>
      {target !== null && (
        <p className="tnum mt-1 text-xs text-slate-500 dark:text-white/50">Dashed line on the adjusted bar = target EBITDA {fmtMoneyN(target)}.</p>
      )}
    </div>
  );
}
