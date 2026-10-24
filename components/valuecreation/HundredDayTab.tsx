"use client";

/**
 * 100-Day Plan (VCP redesign, §7) — presentation restructure only;
 * the data is the plan's initiatives + milestones placed by date
 * against the plan start, exactly as before. Three phase swimlanes
 * come from plan.phases (names + day boundaries editable, saved via
 * the plan PATCH), a progress ring summarizes initiative progress,
 * and a "today" marker is computed from the plan start date.
 * Milestones are read through the overview payload's next-milestones
 * list plus each initiative's own milestones endpoint is not needed
 * here — milestones shown are initiative milestones fetched per plan
 * via the initiatives' milestone counts, and dated milestones are
 * loaded from the overview payload when available. Items beyond day
 * 100 and unscheduled items stay visible in their own lanes so
 * nothing from the old timeline view is lost.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import PersonAvatar from "@/components/PersonAvatar";
import {
  API,
  api,
  cardCls,
  dayOffset,
  fmtDateShort,
  initiativeStatusBadge,
  inputCls,
  labelCls,
  labelOf,
  INITIATIVE_STATUSES,
  type Initiative,
  type PlanPhase,
  type VcTabProps,
} from "@/components/valuecreation/types";

interface DatedMilestone {
  milestoneId: string;
  title: string;
  dueDate: string;
  initiativeTitle: string;
  initiativeId: string;
}

const FALLBACK_PHASES: PlanPhase[] = [
  { key: "stabilize", name: "Stabilize", fromDay: 0, toDay: 30 },
  { key: "build", name: "Build", fromDay: 31, toDay: 60 },
  { key: "execute", name: "Execute", fromDay: 61, toDay: 100 },
];

function ProgressRing({ pct }: { pct: number }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, pct)) / 100) * c;
  return (
    <div className="relative h-[76px] w-[76px] shrink-0" role="img" aria-label={`Overall progress ${Math.round(pct)} percent`}>
      <svg viewBox="0 0 76 76" className="h-full w-full -rotate-90">
        <circle cx="38" cy="38" r={r} fill="none" strokeWidth="7" className="stroke-slate-100 dark:stroke-white/10" />
        <circle
          cx="38" cy="38" r={r} fill="none" strokeWidth="7" strokeLinecap="round"
          className="stroke-[#b8975a]"
          strokeDasharray={`${filled} ${c - filled}`}
        />
      </svg>
      <span className="tnum absolute inset-0 flex items-center justify-center text-base font-semibold text-[#0d1f3c] dark:text-white">
        {Math.round(pct)}%
      </span>
    </div>
  );
}

export default function HundredDayTab({ planId, plan, initiatives, reload }: VcTabProps) {
  const [milestones, setMilestones] = useState<DatedMilestone[]>([]);
  const [editing, setEditing] = useState(false);
  const [phases, setPhases] = useState<PlanPhase[]>(plan.phases ?? FALLBACK_PHASES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { setPhases(plan.phases ?? FALLBACK_PHASES); }, [plan.phases]);

  /* Dated milestones for the whole plan, via the overview payload. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await api<{ overview: { nextMilestones: Array<{ milestoneId: string; title: string; dueDate: string | null; initiativeId: string; initiativeTitle: string }> } }>(
          `${API}/plans/${encodeURIComponent(planId)}/overview`
        );
        if (!cancelled) {
          setMilestones(
            (d.overview.nextMilestones ?? [])
              .filter((m) => m.dueDate)
              .map((m) => ({
                milestoneId: m.milestoneId,
                title: m.title,
                dueDate: m.dueDate as string,
                initiativeId: m.initiativeId,
                initiativeTitle: m.initiativeTitle,
              }))
          );
        }
      } catch {
        if (!cancelled) setMilestones([]);
      }
    })();
    return () => { cancelled = true; };
  }, [planId]);

  const start = plan.planStartDate;
  const planPhases = plan.phases ?? FALLBACK_PHASES;
  const todayOff = start ? dayOffset(start, new Date().toISOString()) : -1;

  const overall = useMemo(() => {
    if (initiatives.length === 0) return 0;
    return initiatives.reduce((s, i) => s + (i.progressPct ?? 0), 0) / initiatives.length;
  }, [initiatives]);

  const savePhases = async () => {
    const clean = phases
      .map((p, idx) => ({
        key: p.key || `phase-${idx + 1}`,
        name: p.name.trim() || `Phase ${idx + 1}`,
        fromDay: Math.max(0, Math.round(Number(p.fromDay) || 0)),
        toDay: Math.max(0, Math.round(Number(p.toDay) || 0)),
      }))
      .sort((a, b) => a.fromDay - b.fromDay);
    setSaving(true);
    setError("");
    try {
      await api(`${API}/plans/${encodeURIComponent(planId)}`, {
        method: "PATCH",
        body: JSON.stringify({ phases: clean }),
      });
      setEditing(false);
      await reload();
    } catch {
      setError("Phases could not be saved. Boundaries must be whole days.");
    } finally {
      setSaving(false);
    }
  };

  if (!start) {
    return (
      <EmptyState
        title="No plan start date"
        message="Set the plan start date on the plan to anchor the 100-day window, the phases and the today marker."
      />
    );
  }

  const inPhase = (off: number, p: PlanPhase) => off >= p.fromDay && off <= p.toDay;
  const initiativeOffset = (i: Initiative) => (i.startDate ? dayOffset(start, i.startDate) : null);
  const beyond = initiatives.filter((i) => {
    const off = initiativeOffset(i);
    return off !== null && !planPhases.some((p) => inPhase(off, p));
  });
  const unscheduled = initiatives.filter((i) => initiativeOffset(i) === null);

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      <div className={`${cardCls} flex flex-wrap items-center gap-4`}>
        <ProgressRing pct={overall} />
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            First 100 days — from {fmtDateShort(start)}
          </h3>
          <p className="tnum mt-0.5 text-sm text-slate-500 dark:text-white/50">
            {todayOff < 0
              ? "The plan has not started yet."
              : todayOff > 100
                ? `Today is day ${todayOff} — past the 100-day window.`
                : `Today is day ${todayOff} of 100.`}{" "}
            {initiatives.length} initiative{initiatives.length === 1 ? "" : "s"} · mean progress {Math.round(overall)}%.
          </p>
          {/* Window ruler with today marker */}
          <div className="relative mt-3 h-2 rounded-full bg-slate-100 dark:bg-white/10" aria-hidden="true">
            {planPhases.map((p, idx) => (
              <div
                key={p.key}
                className={`absolute inset-y-0 ${idx % 2 === 0 ? "bg-[#0d1f3c]/25 dark:bg-white/20" : "bg-[#b8975a]/35"}`}
                style={{ left: `${p.fromDay}%`, width: `${Math.max(1, p.toDay - p.fromDay)}%` }}
              />
            ))}
            {todayOff >= 0 && todayOff <= 100 && (
              <div className="absolute -inset-y-1 w-0.5 bg-red-500" style={{ left: `${todayOff}%` }}>
                <span className="absolute -top-4 left-1 text-[10px] font-semibold uppercase tracking-wide text-red-500">Today</span>
              </div>
            )}
          </div>
          <div className="mt-1 flex justify-between text-[10px] uppercase tracking-wide text-slate-400 dark:text-white/35">
            <span>Day 0</span><span>Day 50</span><span>Day 100</span>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setEditing((e) => !e)}>
          {editing ? "Close phase editor" : "Edit phases"}
        </Button>
      </div>

      {editing && (
        <div className={cardCls}>
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Phases</h4>
          <div className="mt-3 space-y-2">
            {phases.map((p, idx) => (
              <div key={p.key || idx} className="grid grid-cols-[1fr_84px_84px] items-end gap-2 sm:grid-cols-[1fr_110px_110px]">
                <div>
                  <label className={labelCls}>Name</label>
                  <input className={`${inputCls} min-h-[40px]`} value={p.name} onChange={(e) => setPhases((rows) => rows.map((r, i) => (i === idx ? { ...r, name: e.target.value } : r)))} />
                </div>
                <div>
                  <label className={labelCls}>From day</label>
                  <input inputMode="numeric" className={`${inputCls} min-h-[40px]`} value={p.fromDay} onChange={(e) => setPhases((rows) => rows.map((r, i) => (i === idx ? { ...r, fromDay: Number(e.target.value) || 0 } : r)))} />
                </div>
                <div>
                  <label className={labelCls}>To day</label>
                  <input inputMode="numeric" className={`${inputCls} min-h-[40px]`} value={p.toDay} onChange={(e) => setPhases((rows) => rows.map((r, i) => (i === idx ? { ...r, toDay: Number(e.target.value) || 0 } : r)))} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={() => void savePhases()} loading={saving}>Save phases</Button>
            <Button size="sm" variant="ghost" onClick={() => { setPhases(plan.phases ?? FALLBACK_PHASES); setEditing(false); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* Swimlanes — stacked lanes; on mobile they read as a scrollable list. */}
      <div className="space-y-4">
        {planPhases.map((p) => {
          const laneInitiatives = initiatives
            .filter((i) => { const off = initiativeOffset(i); return off !== null && inPhase(off, p); })
            .sort((a, b) => (initiativeOffset(a) ?? 0) - (initiativeOffset(b) ?? 0));
          const laneMilestones = milestones
            .filter((m) => inPhase(dayOffset(start, m.dueDate), p))
            .sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
          const isCurrent = todayOff >= p.fromDay && todayOff <= p.toDay;
          return (
            <section key={p.key} className={cardCls} aria-label={`${p.name} phase`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">{p.name}</h3>
                <span className="tnum text-sm text-slate-500 dark:text-white/50">Days {p.fromDay}–{p.toDay}</span>
                {isCurrent && <span className="badge badge-warn">Today is in this phase</span>}
                <span className="tnum ml-auto text-sm text-slate-500 dark:text-white/50">
                  {laneInitiatives.length} initiatives · {laneMilestones.length} milestones
                </span>
              </div>
              {laneInitiatives.length === 0 && laneMilestones.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-white/50">Nothing scheduled in this phase yet.</p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {laneInitiatives.map((i) => {
                    const off = initiativeOffset(i) ?? 0;
                    return (
                      <li key={i.id} className="flex flex-wrap items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-white/5">
                        <span className="tnum shrink-0 rounded-md bg-[#0d1f3c] px-2 py-1 text-[11px] font-semibold text-white dark:bg-[#54708f]">Day {off}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[#0d1f3c] dark:text-white">{i.title}</span>
                          <span className="tnum block text-xs text-slate-500 dark:text-white/50">
                            {fmtDateShort(i.startDate)} → {fmtDateShort(i.endDate)} · {i.progressPct ?? 0}% complete
                          </span>
                        </span>
                        {i.ownerName && (
                          <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-white/50">
                            <PersonAvatar name={i.ownerName} size={20} /> {i.ownerName}
                          </span>
                        )}
                        <span className={`badge ${initiativeStatusBadge(i.status)}`}>{labelOf(INITIATIVE_STATUSES, i.status)}</span>
                      </li>
                    );
                  })}
                  {laneMilestones.map((m) => {
                    const off = dayOffset(start, m.dueDate);
                    return (
                      <li key={m.milestoneId} className="flex flex-wrap items-center gap-2.5 rounded-xl border border-dashed border-[#b8975a]/50 px-3.5 py-2.5">
                        <span className="tnum shrink-0 rounded-md bg-[#b8975a] px-2 py-1 text-[11px] font-semibold text-white">Day {off}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-[#0d1f3c] dark:text-white">◆ {m.title}</span>
                          <span className="block truncate text-xs text-slate-500 dark:text-white/50">Milestone · {m.initiativeTitle} · due {fmtDateShort(m.dueDate)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}

        {(beyond.length > 0 || unscheduled.length > 0) && (
          <section className={cardCls} aria-label="Outside the 100-day phases">
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Outside the phases</h3>
            <ul className="mt-3 space-y-2">
              {beyond.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-white/5">
                  <span className="tnum shrink-0 rounded-md bg-slate-400 px-2 py-1 text-[11px] font-semibold text-white">Day {initiativeOffset(i)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0d1f3c] dark:text-white">{i.title}</span>
                  <span className={`badge ${initiativeStatusBadge(i.status)}`}>{labelOf(INITIATIVE_STATUSES, i.status)}</span>
                </li>
              ))}
              {unscheduled.map((i) => (
                <li key={i.id} className="flex flex-wrap items-center gap-2.5 rounded-xl bg-slate-50 px-3.5 py-2.5 dark:bg-white/5">
                  <span className="shrink-0 rounded-md bg-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:bg-white/15 dark:text-white/70">No date</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#0d1f3c] dark:text-white">{i.title}</span>
                  <span className={`badge ${initiativeStatusBadge(i.status)}`}>{labelOf(INITIATIVE_STATUSES, i.status)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
