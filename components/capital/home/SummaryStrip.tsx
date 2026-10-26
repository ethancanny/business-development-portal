"use client";

/**
 * Capital summary strip (Step 1 redesign) — Target / Soft / Hard /
 * Funded / Remaining + closings & calls due ≤30 days, each tile
 * clickable into the section it describes, a segmented progress bar
 * for the active type filter, and the by-type allocation bars.
 * Data is the pre-aggregated GET /api/platform/capital/summary
 * payload (stored summaries only — nothing is recomputed here beyond
 * display percentages).
 */

import { CardSkeleton } from "@/components/ui";
import { fmtMoneyCompact, fmtMoneyN } from "@/components/capital/types";
import {
  SegmentLegend,
  SegmentedBar,
  scrollToId,
  type CapitalSummaryData,
} from "./shared";

export default function SummaryStrip({
  summary,
  loading,
}: {
  summary: CapitalSummaryData | null;
  loading: boolean;
}) {
  if (loading && !summary) {
    return <CardSkeleton lines={4} />;
  }
  if (!summary) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 dark:text-white/50">
        Capital summary unavailable.
      </div>
    );
  }

  const { target, soft, hard, funded, remaining, closingsNext30, byType } =
    summary;
  const committedPct =
    target > 0 ? Math.min(100, Math.round(((soft + hard + funded) / target) * 100)) : 0;

  const tiles: Array<{
    label: string;
    value: number;
    targetId: string;
    hint: string;
  }> = [
    { label: "Target", value: target, targetId: "raises", hint: "Across open raises" },
    { label: "Soft-circled", value: soft, targetId: "raises", hint: "Indicated interest" },
    { label: "Hard-committed", value: hard, targetId: "raises", hint: "Signed commitments" },
    { label: "Funded", value: funded, targetId: "raises", hint: "Cash received" },
    { label: "Remaining", value: remaining, targetId: "raises", hint: "Target not yet covered" },
  ];

  const maxTypeTarget = Math.max(1, ...byType.map((t) => t.target));

  return (
    <section
      aria-label="Capital summary"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiles.map((t) => (
          <button
            key={t.label}
            type="button"
            onClick={() => scrollToId(t.targetId)}
            className="min-h-[44px] rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 text-left transition hover:border-[#b8975a]/50 hover:bg-slate-50 dark:border-white/5 dark:bg-white/5 dark:hover:bg-white/10"
            title={`${t.label}: ${fmtMoneyN(t.value)} — ${t.hint}`}
          >
            <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
              {t.label}
            </span>
            <span className="mt-0.5 block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
              {fmtMoneyCompact(t.value)}
            </span>
            <span className="mt-0.5 block text-[11px] text-slate-400 dark:text-white/40">
              {t.hint}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => scrollToId("action-center")}
          className="min-h-[44px] rounded-xl border border-slate-100 bg-slate-50/60 px-3 py-2.5 text-left transition hover:border-[#b8975a]/50 hover:bg-slate-50 dark:border-white/5 dark:bg-white/5 dark:hover:bg-white/10"
          title="Closings and capital calls due in the next 30 days — see Action Center"
        >
          <span className="block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
            Closings / calls ≤30d
          </span>
          <span className="mt-0.5 block font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
            {closingsNext30.length}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-slate-400 dark:text-white/40">
            {closingsNext30[0]
              ? `${closingsNext30[0].dealName} · ${closingsNext30[0].label}`
              : "Nothing due"}
          </span>
        </button>
      </div>

      <div className="mt-5">
        <SegmentedBar target={target} soft={soft} hard={hard} funded={funded} />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <SegmentLegend soft={soft} hard={hard} funded={funded} />
          <p className="text-[11px] text-slate-400 dark:text-white/40">
            {committedPct}% of {fmtMoneyCompact(target)} target covered
          </p>
        </div>
      </div>

      {byType.length > 0 && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
            Allocation by type
          </h3>
          <div className="mt-3 space-y-2.5">
            {byType.map((t) => {
              const committed = t.hard + t.funded;
              const widthPct = Math.max(0, Math.min(100, (t.target / maxTypeTarget) * 100));
              const committedPctOfBar =
                t.target > 0 ? Math.max(0, Math.min(100, (committed / t.target) * 100)) : 0;
              const fundedPctOfBar =
                t.target > 0 ? Math.max(0, Math.min(100, (t.funded / t.target) * 100)) : 0;
              return (
                <div key={t.typeKey} className="flex items-center gap-3">
                  <span className="w-28 shrink-0 truncate text-xs font-medium text-[#0d1f3c] dark:text-white/80">
                    {t.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="relative h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
                      style={{ width: `${widthPct}%`, minWidth: "2rem" }}
                      role="img"
                      aria-label={`${t.label}: ${fmtMoneyCompact(committed)} committed of ${fmtMoneyCompact(t.target)} target`}
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-[#b8975a]"
                        style={{ width: `${committedPctOfBar}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 bg-[#0d1f3c] dark:bg-[#3b5b84]"
                        style={{ width: `${fundedPctOfBar}%` }}
                      />
                    </div>
                  </div>
                  <span className="shrink-0 text-[11px] text-slate-500 dark:text-white/50">
                    {fmtMoneyCompact(committed)} committed · {fmtMoneyCompact(t.target)} target ·{" "}
                    {fmtMoneyCompact(t.funded)} funded
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-400 dark:text-white/40">
            Committed (hard + funded) as a share of each type&apos;s target — navy is the funded
            part, gold the hard-committed part; bar length is scaled to the largest type target.
          </p>
        </div>
      )}
    </section>
  );
}
