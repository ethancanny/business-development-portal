"use client";

/**
 * Platform summary (Phase 1, Oct 21, 2026) — redesigned Oct 25, 2026
 * (Overview redesign spec §§3, 5–8).
 *
 * The ONLY data source is GET /api/platform/overview, which reads the
 * server-side summary tables (PROJECT_RULES: never recompute on page
 * load). Fetched once on mount — no interval polling. The page may
 * pass its own fetch of the same payload (`initialPayload`) so the
 * endpoint is hit once per page load; without it, this component
 * fetches as before.
 *
 * Layout is now the spec's fixed asymmetric 12-column grid (the old
 * drag/hide widget-customization system is retired): main column =
 * Active deals (slot from the page), Pipeline funnel, Deal heat map,
 * Arizona footprint; right rail = Needs attention + the page's
 * Follow-ups / Important dates slot. Portfolio RAG + Activity pulse
 * sit below the grid — and when BOTH have no data they collapse into
 * one slim "Getting started" strip (§8).
 *
 * The seven blocks Ethan removed Oct 24–25 stay removed: Flywheel
 * (FlywheelBlock retained below, unmounted), Sector overview,
 * Latest intelligence, Source quality — Activity feed, Intermediaries
 * by activity, Investors by last touch, Going quiet.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import CompanyMark from "@/components/identity/CompanyMark";
import { EmptyState, SkeletonRows } from "@/components/ui";
import CommandStrip from "@/components/overview/CommandStrip";
import ArizonaMap from "@/components/overview/ArizonaMap";
import { ragDot, type CompanyCard } from "@/components/CompanyCards";
import { useTheme } from "@/components/ThemeProvider";
import { fmtMoney, fmtMoneyCompact, fmtRelTime } from "@/lib/format";
import { barGradient } from "@/lib/sector-colors";
import type { OverviewSummary } from "@/lib/platform/types";

/* ---------------- API shapes ---------------- */

export type PlatformSummary = OverviewSummary;

export interface EarlyWarningItem {
  companyId: string;
  companyName: string;
  logoVersion?: number;
  score: number;
  band: string;
  components: unknown;
  computedAt: string | null;
}

export interface ActivityPulseItem {
  id: string;
  kind: string;
  title: string;
  createdAt: string;
  isNew: boolean;
}

export interface ActivityPulseData {
  counts: {
    businessesForSale: number;
    operatorsAvailable: number;
    marketNotes: number;
  };
  items: ActivityPulseItem[];
}

/** Flywheel (Investment Types Step 1) — retained from the Oct 24
 * build; the panel stays UNMOUNTED per Ethan's removal. */
export interface FlywheelData {
  platformCashFlow: number | null;
  platformCompanyCount: number;
  earlyStageCommitted: number;
  earlyStageCount: number;
  followOnReserves: number;
}

interface OverviewPayload {
  summary: PlatformSummary;
  cards: CompanyCard[];
  earlyWarning?: EarlyWarningItem[];
  activityPulse?: ActivityPulseData | null;
  flywheel?: FlywheelData | null;
}

function FlywheelBlock({ data }: { data: FlywheelData | null }) {
  if (!data) return null;
  const hasCash = data.platformCashFlow !== null;
  const hasBets = data.earlyStageCount > 0;
  return (
    <section className="card-surface mb-4 p-4 sm:p-5" aria-label="Flywheel">
      <h2 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
        Flywheel
      </h2>
      <p className="mb-3 mt-0.5 text-sm text-slate-500 dark:text-white/50">
        Platform cash flow funds the early-stage bets sourced from the
        portfolio and the market.
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-label text-slate-500 dark:text-white/50">
            Platform cash flow (TTM)
          </p>
          <p className="tnum mt-1 text-2xl font-semibold text-slate-800 dark:text-[#e8dfc8]">
            {hasCash ? fmtMoney(data.platformCashFlow ?? 0) : "—"}
          </p>
          <p className="text-xs text-slate-400 dark:text-white/40">
            {hasCash
              ? `Across ${data.platformCompanyCount} portfolio ${data.platformCompanyCount === 1 ? "company" : "companies"} (Portfolio Monitoring)`
              : "No portfolio cash-flow data yet — closed platforms feed this from Portfolio Monitoring."}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-label text-slate-500 dark:text-white/50">
            Committed to early stage
          </p>
          <p className="tnum mt-1 text-2xl font-semibold text-slate-800 dark:text-[#e8dfc8]">
            {hasBets ? fmtMoney(data.earlyStageCommitted) : "—"}
          </p>
          <p className="text-xs text-slate-400 dark:text-white/40">
            {hasBets
              ? `${data.earlyStageCount} closed early-stage ${data.earlyStageCount === 1 ? "deal" : "deals"}`
              : "No closed early-stage deals yet."}
          </p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-label text-slate-500 dark:text-white/50">
            Follow-on reserves
          </p>
          <p className="tnum mt-1 text-2xl font-semibold text-slate-800 dark:text-[#e8dfc8]">
            {data.followOnReserves > 0 ? fmtMoney(data.followOnReserves) : "—"}
          </p>
          <p className="text-xs text-slate-400 dark:text-white/40">
            Reserved across closed early-stage positions.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Section heading (§6) ---------------- */

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
        {children}
      </h3>
      <div aria-hidden className="mt-1.5 h-0.5 w-10 rounded bg-[#b8975a]" />
    </div>
  );
}

/* ---------------- Funnel (§7a) ----------------
 * Stages are the dominant investment type's LIVE list (summary.funnel,
 * from bd.type_config). Bars run navy→gold by stage position. Counts
 * are current-stage; conversion = share of deals that REACHED each
 * stage (a deal counts at every stage up to its own; Closed counts at
 * all; Passed sits outside, shown separate + muted). */

const FUNNEL_FROM = [13, 31, 60]; // navy rgb
const FUNNEL_TO = [184, 151, 90]; // gold rgb

function funnelColor(t: number): string {
  const c = FUNNEL_FROM.map((f, i) => Math.round(f + (FUNNEL_TO[i] - f) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function FunnelWidget({ summary }: { summary: PlatformSummary }) {
  const funnel = summary.funnel;
  if (!funnel || funnel.stages.length === 0) {
    return (
      <div className="card-surface p-4 sm:p-5">
        <SectionHeading>Pipeline funnel</SectionHeading>
        <p className="text-sm text-caption">
          No deals yet — the funnel appears as the pipeline fills in.{" "}
          <Link href="/pipeline?new=deal" className="font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]">
            Add a deal →
          </Link>
        </p>
      </div>
    );
  }
  const stages = funnel.stages;
  // Reached-cumulative: stages are in pipeline order with Closed last.
  const reached = stages.map((_, i) =>
    stages.slice(i).reduce((s, x) => s + x.count, 0)
  );
  const maxReached = Math.max(1, ...reached);
  return (
    <div className="card-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <SectionHeading>Pipeline funnel</SectionHeading>
        <Link href="/pipeline" className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]">
          Open pipeline →
        </Link>
      </div>
      <p className="-mt-1.5 mb-3 text-xs text-caption">
        {funnel.typeLabel} stages (per Investment Types config)
        {funnel.otherTypeDeals > 0
          ? ` · plus ${funnel.otherTypeDeals} active deal${funnel.otherTypeDeals === 1 ? "" : "s"} in other types`
          : ""}
      </p>
      <ul className="space-y-2.5">
        {stages.map((s, i) => {
          const conv =
            i === 0
              ? null
              : reached[i - 1] > 0
                ? Math.round((reached[i] / reached[i - 1]) * 100)
                : null;
          return (
            <li key={s.stage}>
              <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-2 text-xs">
                <span className="font-medium text-slate-700 dark:text-white/80">
                  {s.stage}
                  {conv !== null && (
                    <span className="ml-1.5 text-caption">
                      {conv}% from {stages[i - 1].stage}
                    </span>
                  )}
                </span>
                <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">
                  {s.count}
                  {s.value > 0 && (
                    <span className="ml-1.5 font-normal text-caption">
                      {fmtMoneyCompact(s.value)}
                    </span>
                  )}
                </span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${Math.max(s.count > 0 ? 4 : 0, (reached[i] / maxReached) * 100)}%`,
                    background: barGradient(funnelColor(stages.length > 1 ? i / (stages.length - 1) : 0)),
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 border-t border-slate-100 pt-2.5 text-xs text-caption dark:border-white/10">
        <span className="font-medium text-slate-500 dark:text-white/50">Passed</span>
        {" — "}
        <span className="tnum font-semibold">{funnel.passed.count}</span>
        {funnel.passed.value > 0 && <> · {fmtMoneyCompact(funnel.passed.value)}</>}
        {" "}(outside the funnel)
      </p>
    </div>
  );
}

/* ---------------- Heat map (§7b) ----------------
 * Fits INSIDE its card: fluid grid, no min-width, no horizontal
 * scroll, no clipped columns (stage headers abbreviate with the
 * full name in the title). Clicking a cell filters the pipeline
 * (PipelineView honors ?stage= + ?industry= on load). */

const STAGE_SHORT: Record<string, string> = {
  Sourced: "Src",
  IOI: "IOI",
  Diligence: "Dil",
  LOI: "LOI",
  Financing: "Fin",
  Closed: "Clo",
  Passed: "Pas",
  Sourcing: "Src",
  "Initial Contact": "Init",
  Negotiation: "Neg",
  Closing: "Clo",
  "Closed Won": "Won",
  Intro: "Int",
  "Partner Meeting": "PM",
  "Term Sheet": "TS",
};

function HeatmapWidget({ summary }: { summary: PlatformSummary }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { verticals, stages, cells } = summary.heatmap ?? {
    verticals: [],
    stages: [],
    cells: {},
  };
  const max = Math.max(1, ...Object.values(cells ?? {}));
  return (
    <div className="card-surface p-4 sm:p-5">
      <SectionHeading>Deal heat map</SectionHeading>
      {!verticals.length || !stages.length ? (
        <p className="text-sm text-caption">
          Deal distribution by sector and stage will appear once deals are in the summary.
        </p>
      ) : (
        <>
          <div
            className="grid w-full gap-1"
            style={{
              gridTemplateColumns: `minmax(0,1.3fr) repeat(${stages.length}, minmax(0,1fr))`,
            }}
          >
            <span />
            {stages.map((s) => (
              <span
                key={s}
                className="truncate px-0.5 pb-1 text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-caption"
                title={s}
              >
                {STAGE_SHORT[s] ?? s.slice(0, 3)}
              </span>
            ))}
            {verticals.map((v) => (
              <Fragment key={v}>
                <span
                  className="flex min-w-0 items-center pr-1.5 text-xs font-medium leading-tight text-slate-700 dark:text-white/80"
                  title={v}
                >
                  <span className="truncate">{v}</span>
                </span>
                {stages.map((s) => {
                  const n = cells[`${v}|${s}`] ?? 0;
                  const intensity = n === 0 ? 0 : 0.15 + 0.85 * (n / max);
                  return (
                    <Link
                      key={`${v}|${s}`}
                      href={`/pipeline?stage=${encodeURIComponent(s)}&industry=${encodeURIComponent(v)}`}
                      title={`${v} · ${s}: ${n} deal${n === 1 ? "" : "s"} — view in pipeline`}
                      aria-label={`${v}, ${s}: ${n} deals. View in pipeline.`}
                      className="tnum flex h-9 items-center justify-center rounded-md text-xs font-semibold transition hover:ring-2 hover:ring-[#b8975a]/60"
                      style={{
                        border: `1px solid ${dark ? "rgba(255,255,255,0.12)" : "rgba(13,31,60,0.12)"}`,
                        backgroundColor:
                          n === 0
                            ? dark
                              ? "rgba(232,223,200,0.07)"
                              : "rgba(13,31,60,0.05)"
                            : `rgba(184,151,90,${intensity.toFixed(2)})`,
                        color:
                          n === 0
                            ? dark
                              ? "rgba(232,223,200,0.55)"
                              : "#0d1f3c"
                            : intensity > 0.55
                              ? "#ffffff"
                              : dark
                                ? "#e8dfc8"
                                : "#0d1f3c",
                      }}
                    >
                      {n > 0 ? n : "·"}
                    </Link>
                  );
                })}
              </Fragment>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-caption">
            Gold intensity = deal count. Tap a cell for its exact count and to open the
            filtered pipeline.
          </p>
        </>
      )}
    </div>
  );
}

/* ---------------- Capital stacks (exported; PipelineView renders it) -------- */

const STACK_SEGMENTS = [
  { key: "debt", label: "Debt", color: "#64748b" },
  { key: "equity", label: "Equity", color: "#0d1f3c" },
  { key: "sellerNote", label: "Seller note", color: "#b8975a" },
  { key: "rollover", label: "Rollover", color: "#dcc79b" },
] as const;

export function CapitalStacksPanel({ summary }: { summary: PlatformSummary }) {
  const stacks = (summary.capitalStacks ?? []).slice(0, 8);
  if (stacks.length === 0) {
    return (
      <EmptyState
        title="No capital structures yet"
        message="Deal capital stacks will appear here once structures are recorded."
      />
    );
  }
  return (
    <div>
      <ul className="space-y-3.5">
        {stacks.map((s) => {
          const total = s.total || s.debt + s.equity + s.sellerNote + s.rollover;
          return (
            <li key={s.dealId}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="flex min-w-0 items-center gap-1.5">
                  {s.companyId && (
                    <CompanyMark
                      companyId={s.companyId}
                      name={s.companyName}
                      logoVersion={s.logoVersion ?? 0}
                      size={16}
                    />
                  )}
                  <Link
                    href={`/companies/${s.companyId}`}
                    className="truncate font-medium text-slate-700 hover:text-gold-700 dark:text-white/80 dark:hover:text-gold-400"
                  >
                    {s.companyName}
                  </Link>
                </span>
                <span className="tnum shrink-0 font-semibold text-[#0d1f3c] dark:text-white" title={fmtMoney(total)}>
                  {fmtMoneyCompact(total)}
                </span>
              </div>
              <div className="flex h-3.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                {STACK_SEGMENTS.map((seg) => {
                  const v = s[seg.key];
                  if (!v || total <= 0) return null;
                  return (
                    <span
                      key={seg.key}
                      title={`${seg.label}: ${fmtMoney(v)}`}
                      style={{ width: `${(v / total) * 100}%`, backgroundColor: seg.color }}
                    />
                  );
                })}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {STACK_SEGMENTS.map((seg) => (
          <span key={seg.key} className="flex items-center gap-1.5 text-[11px] text-caption">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: seg.color }} />
            {seg.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Needs attention (rail) ---------------- */

const ATTENTION_DOT: Record<string, string> = {
  overdue: "bg-red-500",
  overdue_task: "bg-red-500",
  task: "bg-amber-400",
  follow_up: "bg-[#b8975a]",
  followup: "bg-[#b8975a]",
  deal: "bg-[#0d1f3c]",
  stalled_deal: "bg-amber-400",
  alert: "bg-red-500",
};

function AttentionCard({ summary }: { summary: PlatformSummary }) {
  const items = summary.needsAttention ?? [];
  return (
    <div className="card-surface p-4 sm:p-5">
      <SectionHeading>Needs attention</SectionHeading>
      {items.length === 0 ? (
        <p className="text-sm text-caption">All clear — nothing needs attention right now.</p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {items.slice(0, 8).map((item, i) => {
            const row = (
              <>
                <span
                  aria-hidden
                  className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${ATTENTION_DOT[item.kind] ?? "bg-slate-400"}`}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-slate-800 dark:text-white/90">
                    {item.label}
                  </span>
                  {(item.detail || item.at) && (
                    <span className="block truncate text-xs text-caption">
                      {[item.detail, item.at ? fmtRelTime(item.at) : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </span>
              </>
            );
            return (
              <li key={`${item.kind}-${i}`} className="py-2 first:pt-0 last:pb-0">
                {item.href ? (
                  <Link href={item.href} className="flex items-start gap-2.5">
                    {row}
                  </Link>
                ) : (
                  <div className="flex items-start gap-2.5">{row}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Portfolio RAG + Activity pulse (§8) ---------------- */

function pulseKindLabel(kind: string): string {
  switch (kind) {
    case "business_for_sale":
      return "For sale";
    case "operator_available":
      return "Operator";
    case "market_note":
      return "Note";
    default:
      return kind;
  }
}

function pulseTotal(pulse: ActivityPulseData | null | undefined): number {
  if (!pulse) return 0;
  return (
    (pulse.counts.businessesForSale ?? 0) +
    (pulse.counts.operatorsAvailable ?? 0) +
    (pulse.counts.marketNotes ?? 0)
  );
}

function RagCard({
  summary,
  cards,
}: {
  summary: PlatformSummary;
  cards: CompanyCard[];
}) {
  const portfolio = cards.filter((c) => c.stage === "portfolio");
  const counts = summary.ragCounts ?? { green: 0, amber: 0, red: 0 };
  return (
    <div className="card-surface p-4 sm:p-5">
      <SectionHeading>Portfolio RAG</SectionHeading>
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1.5">
        {(
          [
            ["green", counts.green, "On track"],
            ["amber", counts.amber, "Watch"],
            ["red", counts.red, "At risk"],
          ] as const
        ).map(([rag, n, label]) => (
          <span key={rag} className="flex items-center gap-1.5 text-sm">
            {ragDot(rag)}
            <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">{n}</span>
            <span className="text-caption">{label}</span>
          </span>
        ))}
      </div>
      {portfolio.length > 0 && (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {portfolio.slice(0, 6).map((c) => (
            <li key={c.id} className="py-1.5 first:pt-0 last:pb-0">
              <Link
                href={`/companies/${c.id}`}
                className="flex items-center gap-2 text-sm text-slate-800 hover:text-gold-700 dark:text-white/90 dark:hover:text-gold-400"
              >
                {ragDot(c.rag)}
                <CompanyMark companyId={c.id} name={c.name} logoVersion={c.logoVersion ?? 0} size={18} />
                <span className="min-w-0 truncate">{c.name}</span>
                {c.city && <span className="ml-auto shrink-0 text-xs text-caption">{c.city}</span>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PulseCard({ pulse }: { pulse: ActivityPulseData | null | undefined }) {
  if (!pulse) {
    return (
      <div className="card-surface p-4 sm:p-5">
        <SectionHeading>Activity pulse</SectionHeading>
        <p className="text-sm text-caption">
          Triage counts couldn't be loaded — the Activity feed itself is unaffected.
        </p>
      </div>
    );
  }
  const rows = [
    ["Businesses for sale", pulse.counts.businessesForSale],
    ["Operators available", pulse.counts.operatorsAvailable],
    ["Market notes", pulse.counts.marketNotes],
  ] as const;
  const total = pulseTotal(pulse);
  return (
    <div className="card-surface p-4 sm:p-5">
      <SectionHeading>Activity pulse</SectionHeading>
      <p className="tnum font-display text-4xl font-semibold text-[#0d1f3c] dark:text-white">
        {total}
        <span className="ml-2 align-middle text-sm font-normal text-slate-500 dark:text-white/50">
          waiting for triage
        </span>
      </p>
      <ul className="mt-3 space-y-1.5">
        {rows.map(([label, n]) => (
          <li key={label} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="text-slate-600 dark:text-white/70">{label}</span>
            <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">{n}</span>
          </li>
        ))}
      </ul>
      {pulse.items.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/10">
          {pulse.items.slice(0, 3).map((it) => (
            <li key={it.id} className="py-1.5 first:pt-2 last:pb-0">
              <Link
                href="/activity"
                className="flex items-center gap-2 text-sm text-slate-800 hover:text-gold-700 dark:text-white/90 dark:hover:text-gold-400"
              >
                {it.isNew && (
                  <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#b8975a]" />
                )}
                <span className="min-w-0 truncate">{it.title}</span>
                <span className="ml-auto shrink-0 text-xs text-caption">
                  {pulseKindLabel(it.kind)} · {fmtRelTime(it.createdAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3">
        <Link href="/activity" className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]">
          Open Activity →
        </Link>
      </p>
    </div>
  );
}

/** §8: with no portfolio companies AND nothing waiting for triage,
 * RAG + Pulse collapse into this one slim strip — it disappears the
 * moment either gains data. */
function GettingStartedStrip() {
  return (
    <div className="card-surface flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
      <p className="text-sm text-slate-600 dark:text-white/70">
        <span className="font-display text-base font-semibold text-[#0d1f3c] dark:text-white">
          Getting started —
        </span>{" "}
        no portfolio companies and nothing waiting for triage yet. Closed deals land here
        with their RAG status; new Activity items show what needs review.
      </p>
      <span className="ml-auto flex gap-3">
        <Link href="/pipeline?new=deal" className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]">
          Add a deal →
        </Link>
        <Link href="/activity" className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]">
          Open Activity →
        </Link>
      </span>
    </div>
  );
}

/* ---------------- Early warning (Phase 9) — unchanged behavior ---------------- */

function ewBandChip(band: string): { label: string; className: string; style?: React.CSSProperties } {
  switch (band.toLowerCase()) {
    case "low":
      return { label: "Low", className: "badge-neutral" };
    case "watch":
      return { label: "Watch", className: "badge-warn" };
    case "elevated":
      return { label: "Elevated", className: "", style: { backgroundColor: "#ffedd5", color: "#9a3412" } };
    case "critical":
      return { label: "Critical", className: "badge-danger" };
    default:
      return { label: band || "—", className: "badge-neutral" };
  }
}

interface EwDriver {
  label: string;
  detail: string;
}

function ewDrivers(components: unknown): EwDriver[] {
  const rows: Array<EwDriver & { weight: number }> = [];
  const push = (label: string, raw: unknown) => {
    const n = typeof raw === "number" ? raw : Number(raw);
    rows.push({
      label,
      detail: Number.isFinite(n) ? String(Math.round(n * 10) / 10) : String(raw ?? ""),
      weight: Number.isFinite(n) ? Math.abs(n) : 0,
    });
  };
  if (Array.isArray(components)) {
    for (const c of components) {
      if (c && typeof c === "object") {
        const r = c as Record<string, unknown>;
        const label = String(r.label ?? r.name ?? r.key ?? "");
        if (!label) continue;
        push(label, r.contribution ?? r.score ?? r.value ?? "");
      }
    }
  } else if (components && typeof components === "object") {
    for (const [k, v] of Object.entries(components as Record<string, unknown>)) {
      if (v && typeof v === "object") {
        const r = v as Record<string, unknown>;
        push(k, r.contribution ?? r.score ?? r.value ?? "");
      } else {
        push(k, v);
      }
    }
  }
  return rows
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 2)
    .map(({ label, detail }) => ({ label, detail }));
}

function EarlyWarningBlock({ items }: { items: EarlyWarningItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="card-surface mb-4 p-5 sm:p-6" aria-label="Early warning">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
          Early warning
        </h3>
        <span className="caption">Portfolio-company risk scores, as computed</span>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((it) => {
          const chip = ewBandChip(it.band ?? "");
          const drivers = ewDrivers(it.components);
          return (
            <li key={it.companyId} className="rounded-xl border border-slate-100 p-4 dark:border-white/10">
              <div className="flex items-start justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <CompanyMark companyId={it.companyId} name={it.companyName} logoVersion={it.logoVersion ?? 0} size={22} />
                  <Link
                    href={`/portfolio-monitoring/${encodeURIComponent(it.companyId)}`}
                    className="min-w-0 truncate text-sm font-semibold text-slate-800 hover:text-gold-700 dark:text-white/90 dark:hover:text-gold-400"
                  >
                    {it.companyName}
                  </Link>
                </span>
                <span className={`badge shrink-0 ${chip.className}`} style={chip.style}>
                  {chip.label}
                </span>
              </div>
              <p className="tnum mt-1 font-display text-4xl font-semibold text-navy-900 dark:text-white">
                {typeof it.score === "number" ? Math.round(it.score) : "—"}
              </p>
              {drivers.length > 0 && (
                <p className="mt-1 text-xs text-caption">
                  {drivers.map((d) => (d.detail ? `${d.label} ${d.detail}` : d.label)).join(" · ")}
                </p>
              )}
              {it.computedAt && (
                <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/35">
                  Computed {fmtRelTime(it.computedAt)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ---------------- Main section ---------------- */

export default function PlatformOverview({
  initialPayload = null,
  fitTotal = 0,
  fitReady = false,
  activeDealsNode = null,
  railNode = null,
}: {
  /** The page's own fetch of /api/platform/overview, when it has one
   * (avoids a second request); self-fetches when absent. */
  initialPayload?: OverviewPayload | null;
  fitTotal?: number;
  fitReady?: boolean;
  /** Active deals row (§4), built by the page from its deal data. */
  activeDealsNode?: React.ReactNode;
  /** Right-rail Follow-ups + Important dates (§§5, 9), built by the
   * page from its task/calendar data. */
  railNode?: React.ReactNode;
}) {
  const [payload, setPayload] = useState<OverviewPayload | null>(initialPayload);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const fetchOnce = useCallback(async (signal: { cancelled: boolean }) => {
    try {
      const res = await fetch("/api/platform/overview");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as OverviewPayload;
      if (signal.cancelled) return;
      if (!data || typeof data !== "object" || !data.summary) {
        throw new Error("Unexpected response");
      }
      setPayload({
        summary: data.summary,
        cards: Array.isArray(data.cards) ? data.cards : [],
        earlyWarning: Array.isArray(data.earlyWarning) ? data.earlyWarning : [],
        activityPulse:
          data.activityPulse && typeof data.activityPulse === "object" && data.activityPulse.counts
            ? data.activityPulse
            : null,
        flywheel:
          data.flywheel && typeof data.flywheel === "object" ? data.flywheel : null,
      });
      setLoadFailed(false);
    } catch {
      if (!signal.cancelled) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    if (initialPayload) {
      setPayload(initialPayload);
      return;
    }
    const signal = { cancelled: false };
    void fetchOnce(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [fetchOnce, reloadTick, initialPayload]);

  const summary = payload?.summary ?? null;
  const allCards = useMemo(() => payload?.cards ?? [], [payload]);
  const showGettingStarted =
    summary !== null &&
    summary.portfolioCount === 0 &&
    pulseTotal(payload?.activityPulse) === 0;

  return (
    <section className="mb-6" aria-label="Platform summary">
      {loadFailed && !summary ? (
        <div className="card-surface p-5">
          <EmptyState
            title="Platform summary unavailable"
            message="The summary could not be loaded — the database may be unavailable. The rest of the Overview is unaffected."
            actionLabel="Try again"
            onAction={() => {
              setLoadFailed(false);
              setReloadTick((t) => t + 1);
            }}
          />
        </div>
      ) : !summary ? (
        <div className="card-surface p-5">
          <SkeletonRows rows={4} />
        </div>
      ) : (
        <>
          <CommandStrip summary={summary} fitTotal={fitTotal} fitReady={fitReady} />

          <div className="grid gap-4 lg:grid-cols-12">
            {/* Main column (§5) */}
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-8">
              {activeDealsNode}
              <FunnelWidget summary={summary} />
              <HeatmapWidget summary={summary} />
              <div className="card-surface p-4 sm:p-5">
                <SectionHeading>Arizona footprint</SectionHeading>
                <ArizonaMap cards={allCards} />
              </div>
            </div>
            {/* Right rail (§5) */}
            <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
              <AttentionCard summary={summary} />
              {railNode}
            </div>
          </div>

          <div className="mt-4">
            <EarlyWarningBlock items={payload?.earlyWarning ?? []} />
          </div>

          {/* Flywheel panel unmounted from Overview Oct 24, 2026
              (Ethan: "get rid of these for now"). FlywheelBlock and
              the getFlywheel() payload are retained — re-mount here
              to restore. */}

          {showGettingStarted ? (
            <GettingStartedStrip />
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <RagCard summary={summary} cards={allCards} />
              <PulseCard pulse={payload?.activityPulse} />
            </div>
          )}

          {summary.updatedAt && (
            <p className="mt-3 text-right text-[11px] text-caption">
              Summary updated {fmtRelTime(summary.updatedAt)}
            </p>
          )}
        </>
      )}
    </section>
  );
}
