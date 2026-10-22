"use client";

/**
 * 100-Day Plan — initiatives that start inside the first 100 days
 * from the plan start, listed by day offset with status progress,
 * plus a CSS Gantt: one row per dated initiative, bars positioned
 * by start/end inside the window from plan start to the latest end
 * date, month gridlines and a today marker. Dependency names are
 * printed as text under each bar (no hover-only information).
 */

import { useMemo } from "react";
import { EmptyState } from "@/components/ui";
import {
  INITIATIVE_STATUSES,
  cardCls,
  dayOffset,
  fmtDateShort,
  initiativeStatusBadge,
  labelOf,
  type Initiative,
  type VcTabProps,
} from "@/components/valuecreation/types";

const STATUS_BAR: Record<string, string> = {
  done: "bg-emerald-600",
  on_track: "bg-emerald-500",
  in_progress: "bg-[#b8975a]",
  at_risk: "bg-red-500",
  deferred: "bg-red-400",
  planned: "bg-[#0d1f3c] dark:bg-[#54708f]",
};

function monthTicks(startIso: string, totalDays: number): Array<{ pct: number; label: string }> {
  const ticks: Array<{ pct: number; label: string }> = [];
  const start = new Date(`${startIso.slice(0, 10)}T12:00:00`);
  const cursor = new Date(start.getFullYear(), start.getMonth() + 1, 1, 12);
  while (true) {
    const off = Math.round((cursor.getTime() - start.getTime()) / 86_400_000);
    if (off > totalDays) break;
    ticks.push({
      pct: (off / totalDays) * 100,
      label: cursor.toLocaleDateString("en-US", { month: "short" }),
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

export default function TimelineTab({ plan, initiatives }: VcTabProps) {
  const start = plan.planStartDate;

  const model = useMemo(() => {
    if (!start) return null;
    const inWindow = initiatives
      .filter((i) => i.startDate && dayOffset(start, i.startDate) >= 0 && dayOffset(start, i.startDate) <= 100)
      .sort((a, b) => dayOffset(start, a.startDate ?? start) - dayOffset(start, b.startDate ?? start));
    const dated = initiatives.filter((i) => i.startDate);
    const maxEnd = dated.reduce((max, i) => {
      const end = i.endDate ?? i.startDate ?? start;
      return Math.max(max, dayOffset(start, end));
    }, 100);
    const counts: Record<string, number> = {};
    for (const i of initiatives) counts[i.status] = (counts[i.status] ?? 0) + 1;
    return { inWindow, maxEnd, counts, total: initiatives.length };
  }, [start, initiatives]);

  if (!start) {
    return (
      <EmptyState
        title="No plan start date"
        message="Set the plan start date on the plan to anchor the 100-day window and the Gantt."
      />
    );
  }
  if (!model) return null;

  const byId = new Map(initiatives.map((i) => [i.id, i]));
  const todayOff = dayOffset(start, new Date().toISOString());
  const showToday = todayOff >= 0 && todayOff <= model.maxEnd;
  const ticks = monthTicks(start, model.maxEnd);
  const dated = initiatives
    .filter((i) => i.startDate)
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));

  return (
    <div className="space-y-5">
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          First 100 days · {fmtDateShort(start)} → {fmtDateShort(new Date(new Date(`${start}T12:00:00`).getTime() + 100 * 86_400_000).toISOString())}
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {INITIATIVE_STATUSES.map((s) => (
            <span key={s.key} className={`badge ${initiativeStatusBadge(s.key)}`}>
              {s.label}: {model.counts[s.key] ?? 0}
            </span>
          ))}
          <span className="badge badge-neutral">
            {model.inWindow.length} of {model.total} start in the window
          </span>
        </div>
        {model.inWindow.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
            No initiatives start within the first 100 days yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
            {model.inWindow.map((i) => {
              const off = dayOffset(start, i.startDate ?? start);
              return (
                <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
                  <span className="tnum w-16 shrink-0 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    Day {off}
                  </span>
                  <span className="min-w-[180px] flex-1 text-sm text-[#0d1f3c] dark:text-white/90">
                    {i.title}
                    <span className="block text-xs text-slate-500 dark:text-white/50">
                      {fmtDateShort(i.startDate)} → {fmtDateShort(i.endDate)} · {i.ownerName || "No owner"}
                    </span>
                  </span>
                  <span className={`badge ${initiativeStatusBadge(i.status)}`}>
                    {labelOf(INITIATIVE_STATUSES, i.status)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Gantt — all dated initiatives
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          Window: plan start → latest end date ({model.maxEnd} days).
          {showToday && " The gold line marks today."}
        </p>
        {dated.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
            No initiatives have dates yet — add start/end dates in the Initiatives tab.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <div className="min-w-[640px]">
              {/* month gridline labels */}
              <div className="relative ml-40 h-5 border-b border-slate-200 dark:border-white/10">
                {ticks.map((t, idx) => (
                  <span
                    key={idx}
                    className="absolute top-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40"
                    style={{ left: `${t.pct}%` }}
                  >
                    {t.label}
                  </span>
                ))}
              </div>
              <div className="relative">
                {/* gridlines + today marker */}
                {ticks.map((t, idx) => (
                  <div
                    key={idx}
                    aria-hidden
                    className="absolute inset-y-0 w-px bg-slate-100 dark:bg-white/5"
                    style={{ left: `calc(10rem + (100% - 10rem) * ${t.pct / 100})` }}
                  />
                ))}
                {showToday && (
                  <div
                    aria-hidden
                    className="absolute inset-y-0 w-0.5 bg-[#b8975a]"
                    style={{ left: `calc(10rem + (100% - 10rem) * ${todayOff / model.maxEnd})` }}
                  />
                )}
                {dated.map((i) => {
                  const sOff = dayOffset(start, i.startDate ?? start);
                  const eOff = Math.max(sOff + 1, dayOffset(start, i.endDate ?? i.startDate ?? start));
                  const left = (sOff / model.maxEnd) * 100;
                  const width = Math.max(1.5, ((eOff - sOff) / model.maxEnd) * 100);
                  const deps = (i.dependsOn ?? [])
                    .map((id) => byId.get(id)?.title ?? id)
                    .filter(Boolean);
                  return (
                    <div key={i.id} className="relative flex items-start gap-0 py-1.5">
                      <div className="w-40 shrink-0 pr-3">
                        <p className="truncate text-xs font-medium text-[#0d1f3c] dark:text-white/90" title={i.title}>
                          {i.title}
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-white/50">
                          {labelOf(INITIATIVE_STATUSES, i.status)}
                        </p>
                      </div>
                      <div className="relative h-8 flex-1">
                        <div
                          className={`absolute top-1 h-5 rounded ${STATUS_BAR[i.status] ?? STATUS_BAR.planned}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${i.title}: ${fmtDateShort(i.startDate)} → ${fmtDateShort(i.endDate)}`}
                        />
                        {deps.length > 0 && (
                          <p className="absolute top-6 whitespace-nowrap text-[11px] text-slate-500 dark:text-white/50">
                            ⛓ after: {deps.join(", ")}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-400 dark:text-white/40">
                Bars: navy = planned, gold = in progress, green = done, red = deferred. Dependencies are named under the bar.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
