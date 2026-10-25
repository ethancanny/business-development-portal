"use client";

/**
 * Command strip (Overview redesign §3, Oct 25, 2026).
 *
 * ONE strip replacing the two stat cards (Morning Brief tiles +
 * Platform summary tiles). Every number comes from the stored
 * platform summary or the page's single fit-total count — nothing
 * here recomputes from raw tables, and no metric shown here is
 * repeated anywhere else on the Overview page.
 *
 * Primary: Active Pipeline Value (feature treatment). Its sparkline
 * and change indicator render ONLY when the summary carries ≥2 real
 * daily snapshots (core.overview_history, written from Oct 25, 2026
 * forward — never backfilled). With fewer points the strip says so
 * plainly instead of inventing a trend.
 */

import Link from "next/link";
import { useCountUp } from "@/components/ui";
import {
  IconActivity,
  IconAnalytics,
  IconDirectory,
  IconFollowUp,
  IconPipeline,
} from "@/components/icons";
import { fmtMoney, fmtMoneyCompact } from "@/lib/format";
import type { OverviewSummary } from "@/lib/platform/types";

function Sparkline({ points }: { points: { day: string; value: number }[] }) {
  const w = 120;
  const h = 32;
  const min = Math.min(...points.map((p) => p.value));
  const max = Math.max(...points.map((p) => p.value));
  const span = max - min || 1;
  const coords = points.map((p, i) => {
    const x = points.length === 1 ? w / 2 : (i / (points.length - 1)) * (w - 4) + 2;
    const y = h - 3 - ((p.value - min) / span) * (h - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-8 w-[120px]"
      role="img"
      aria-label={`Pipeline value trend over ${points.length} days`}
    >
      <polyline
        points={coords.join(" ")}
        fill="none"
        stroke="#b8975a"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function Secondary({
  href,
  label,
  display,
  caption,
  Icon,
}: {
  href: string;
  label: string;
  display: string;
  caption?: string;
  Icon: (p: { className?: string }) => React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex min-w-0 items-start gap-3 rounded-xl px-2 py-1 transition hover:bg-slate-50 dark:hover:bg-white/5"
    >
      <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#b8975a]/12 text-[#8a6f3c] ring-1 ring-inset ring-[#b8975a]/30 dark:text-[#d4b37a]">
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="micro-label block">{label}</span>
        <span className="tnum block truncate font-display text-[26px] font-semibold leading-tight text-[#0d1f3c] dark:text-white">
          {display}
        </span>
        {caption && (
          <span className="block truncate text-[11px] text-caption">{caption}</span>
        )}
      </span>
    </Link>
  );
}

export default function CommandStrip({
  summary,
  fitTotal,
  fitReady,
}: {
  summary: OverviewSummary;
  fitTotal: number;
  fitReady: boolean;
}) {
  const pipelineValue = summary.pipelineValue ?? 0;
  const valuedCount = summary.pipelineValuedCount ?? 0;
  const counted = useCountUp(pipelineValue);
  const history = summary.pipelineHistory ?? [];
  const hasTrend = history.length >= 2;
  const change = hasTrend
    ? history[history.length - 1].value - history[history.length - 2].value
    : null;

  return (
    <section
      aria-label="Command strip"
      className="card-surface mb-4 grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,2fr)]"
    >
      {/* Primary — feature treatment (navy / ivory / gold) */}
      <div className="relative overflow-hidden rounded-xl bg-[#0d1f3c] px-5 py-4 text-white">
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[#dec084] via-[#b8975a] to-[#9c7c3f]"
        />
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#d4b37a]">
          Active pipeline value
        </p>
        <p
          className="tnum mt-1 font-display text-[42px] font-semibold leading-none"
          title={valuedCount === 0 ? undefined : fmtMoney(pipelineValue)}
        >
          {valuedCount === 0 ? "—" : fmtMoneyCompact(counted)}
        </p>
        <p className="mt-1.5 text-xs text-white/60">
          {valuedCount === 0
            ? "No valued active deals yet"
            : `${valuedCount} valued deal${valuedCount === 1 ? "" : "s"} · stated price, else market estimate`}
        </p>
        <div className="mt-2 flex items-end gap-3">
          {hasTrend ? (
            <>
              <Sparkline points={history} />
              {change !== null && change !== 0 && (
                <span
                  className={`tnum text-xs font-semibold ${
                    change > 0 ? "text-[#d4b37a]" : "text-red-300"
                  }`}
                >
                  {change > 0 ? "▲" : "▼"} {fmtMoneyCompact(Math.abs(change))} vs prior day
                </span>
              )}
              {change === 0 && (
                <span className="text-xs text-white/50">Unchanged vs prior day</span>
              )}
            </>
          ) : (
            <span className="text-xs text-white/50">
              Daily trend starts today — snapshots accrue from here, no backfilled history.
            </span>
          )}
        </div>
        <Link
          href="/pipeline"
          className="mt-3 inline-block text-xs font-semibold text-[#d4b37a] hover:underline"
        >
          Open pipeline →
        </Link>
      </div>

      {/* Secondaries — each appears exactly once on this page */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-3 xl:grid-cols-3">
        <Secondary
          href="/pipeline"
          label="Deals in diligence"
          display={String(summary.dealsInDiligence ?? 0)}
          caption="At the Diligence stage"
          Icon={IconPipeline}
        />
        <Secondary
          href="#overview-tasks"
          label="Open follow-ups"
          display={String(summary.openTasks)}
          caption={
            summary.upcomingFollowUps > 0
              ? `${summary.upcomingFollowUps} due in 7 days`
              : "None due in 7 days"
          }
          Icon={IconFollowUp}
        />
        <Secondary
          href="/investors-capital"
          label="Capital committed"
          display={fmtMoneyCompact(summary.capitalCommitted)}
          caption={`Needed ${fmtMoneyCompact(summary.capitalNeeded)}`}
          Icon={IconAnalytics}
        />
        <Secondary
          href="/market-intel#fit-targets"
          label="Fit targets"
          display={fitReady ? fitTotal.toLocaleString() : "…"}
          caption="Across the five focus sectors"
          Icon={IconActivity}
        />
        <Secondary
          href="/portfolio-monitoring"
          label="Portfolio companies"
          display={String(summary.portfolioCount)}
          caption={`${summary.ragCounts.green} on track · ${summary.ragCounts.amber} watch · ${summary.ragCounts.red} at risk`}
          Icon={IconDirectory}
        />
      </div>
    </section>
  );
}
