"use client";

/**
 * Platform summary (Phase 1, Oct 21, 2026 — workstream C).
 *
 * The ONLY data source is GET /api/platform/overview, which reads the
 * server-side summary tables (PROJECT_RULES: never recompute on page
 * load). Fetched once on mount — no interval polling. The Companies
 * grid that used to sit under the widgets was removed (Ethan,
 * Oct 23, 2026 — no company pipeline on Overview); the cards payload
 * still feeds the Arizona footprint and Portfolio RAG widgets.
 *
 * Defensive by contract: while the Neon DB is down the fetch fails and
 * the section degrades to a clean error state, never a crash.
 *
 * Arizona map decision: components/TargetMap.tsx takes Deal[] (deal
 * stage colors, deal-value popups) — its props do not fit CompanyCard
 * points, so the map widget renders a city-cluster panel instead of
 * adding a second Leaflet implementation.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, SkeletonRows, StatTile } from "@/components/ui";
import { ragDot, type CompanyCard } from "@/components/CompanyCards";
import { useTheme } from "@/components/ThemeProvider";
import { fmtMoney, fmtMoneyCompact, fmtRelTime } from "@/lib/format";
import { barGradient, stageColor } from "@/lib/sector-colors";

/* ---------------- API shapes (contract with workstream A) ---------------- */

export interface PlatformSummary {
  dealsByStage: Record<string, number>;
  totalDeals: number;
  openTasks: number;
  upcomingFollowUps: number;
  capitalCommitted: number;
  capitalNeeded: number;
  portfolioCount: number;
  ragCounts: { green: number; amber: number; red: number };
  heatmap: {
    verticals: string[];
    stages: string[];
    cells: Record<string, number>;
  };
  capitalStacks: {
    dealId: string;
    companyId: string;
    companyName: string;
    debt: number;
    equity: number;
    sellerNote: number;
    rollover: number;
    total: number;
  }[];
  needsAttention: {
    kind: string;
    label: string;
    detail: string | null;
    href: string | null;
    at: string | null;
  }[];
  updatedAt: string | null;
}

export interface EarlyWarningItem {
  companyId: string;
  companyName: string;
  score: number;
  band: string;
  components: unknown;
  computedAt: string | null;
}

interface OverviewPayload {
  summary: PlatformSummary;
  cards: CompanyCard[];
  earlyWarning?: EarlyWarningItem[];
  activityPulse?: ActivityPulseData | null;
}

/** Activity pulse (Oct 23, 2026): triage counts + latest items from
 *  GET /api/platform/overview's activityPulse field — the BD hub's
 *  BdActivitySummary shape (lib/hubs/bd.ts), mirrored here like the
 *  other API contracts in this file. "Waiting for triage" = status
 *  'new' AND read_at IS NULL, the app-badge predicate. */
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

/* ---------------- Widget layout (localStorage-persisted) ---------------- */

type WidgetId = "funnel" | "heatmap" | "attention" | "map" | "rag" | "pulse";

const WIDGET_DEFS: { id: WidgetId; title: string }[] = [
  { id: "funnel", title: "Pipeline funnel" },
  { id: "heatmap", title: "Deal heat map" },
  { id: "attention", title: "Needs attention" },
  { id: "map", title: "Arizona footprint" },
  { id: "rag", title: "Portfolio RAG" },
  { id: "pulse", title: "Activity pulse" },
];
const WIDGET_STORAGE_KEY = "ccp-overview-widgets";

interface WidgetLayout {
  order: WidgetId[];
  hidden: WidgetId[];
}

function loadLayout(): WidgetLayout {
  const fallback: WidgetLayout = {
    order: WIDGET_DEFS.map((w) => w.id),
    hidden: [],
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(WIDGET_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<WidgetLayout>;
    const known = new Set(WIDGET_DEFS.map((w) => w.id));
    const order = (parsed.order ?? []).filter((id): id is WidgetId =>
      known.has(id as WidgetId),
    );
    for (const def of WIDGET_DEFS) if (!order.includes(def.id)) order.push(def.id);
    const hidden = (parsed.hidden ?? []).filter((id): id is WidgetId =>
      known.has(id as WidgetId),
    );
    return { order, hidden };
  } catch {
    return fallback;
  }
}

/* ---------------- Small pieces ---------------- */

function WidgetShell({
  title,
  children,
  customize,
  onMove,
  onHide,
  canUp,
  canDown,
}: {
  title: string;
  children: React.ReactNode;
  customize: boolean;
  onMove: (dir: -1 | 1) => void;
  onHide: () => void;
  canUp: boolean;
  canDown: boolean;
}) {
  return (
    <div className="card-surface flex min-w-0 flex-col p-4 sm:p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
          {title}
        </h3>
        {customize && (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              aria-label={`Move ${title} up`}
              disabled={!canUp}
              onClick={() => onMove(-1)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-caption transition hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-white/10"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${title} down`}
              disabled={!canDown}
              onClick={() => onMove(1)}
              className="flex h-8 w-8 items-center justify-center rounded-md text-caption transition hover:bg-slate-100 disabled:opacity-30 dark:hover:bg-white/10"
            >
              ↓
            </button>
            <button
              type="button"
              aria-label={`Hide ${title}`}
              onClick={onHide}
              className="flex h-8 w-8 items-center justify-center rounded-md text-caption transition hover:bg-slate-100 dark:hover:bg-white/10"
            >
              ✕
            </button>
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function FunnelWidget({ summary }: { summary: PlatformSummary }) {
  const entries = Object.entries(summary.dealsByStage ?? {});
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (entries.length === 0) {
    return (
      <EmptyState title="No deals yet" message="Deals will appear here as the pipeline fills in." />
    );
  }
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <Link href="/pipeline" className="ml-auto text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]">
          Open pipeline →
        </Link>
      </div>
      <ul className="space-y-2.5">
        {entries.map(([stage, count]) => (
          <li key={stage}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-slate-700 dark:text-white/80">{stage}</span>
              <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">{count}</span>
            </div>
            <div className="h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(4, (count / max) * 100)}%`,
                  background: barGradient(stageColor(stage)),
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function HeatmapWidget({ summary }: { summary: PlatformSummary }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const { verticals, stages, cells } = summary.heatmap ?? {
    verticals: [],
    stages: [],
    cells: {},
  };
  const max = Math.max(1, ...Object.values(cells ?? {}));
  if (!verticals.length || !stages.length) {
    return (
      <EmptyState
        title="No heat map data"
        message="Deal distribution by vertical and stage will appear once deals are in the summary."
      />
    );
  }
  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[26rem] gap-1"
        style={{
          gridTemplateColumns: `minmax(6rem,1.2fr) repeat(${stages.length}, 1fr)`,
        }}
      >
        <span />
        {stages.map((s) => (
          <span
            key={s}
            className="px-0.5 pb-1 text-center text-[10px] font-semibold uppercase leading-tight tracking-wide text-caption"
            title={s}
          >
            {s}
          </span>
        ))}
        {verticals.map((v) => (
          <Fragment key={v}>
            <span
              className="flex items-center pr-2 text-xs font-medium leading-tight text-slate-700 dark:text-white/80"
              title={v}
            >
              {v}
            </span>
            {stages.map((s) => {
              const n = cells[`${v}|${s}`] ?? 0;
              const intensity = n === 0 ? 0 : 0.15 + 0.85 * (n / max);
              return (
                <span
                  key={`${v}|${s}`}
                  title={`${v} · ${s}: ${n} deal${n === 1 ? "" : "s"}`}
                  className="tnum flex h-9 items-center justify-center rounded-md text-xs font-semibold"
                  style={{
                    // Every cell carries a visible border + fill in
                    // BOTH modes (Ethan, Oct 23, 2026): the old empty
                    // fill was navy at 5% — invisible on the navy
                    // night-mode card, so the grid vanished.
                    border: `1px solid ${
                      dark ? "rgba(255,255,255,0.12)" : "rgba(13,31,60,0.12)"
                    }`,
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
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-slate-400 dark:text-white/35">
        Gold intensity = deal count. Hover or tap a cell for its exact count.
      </p>
    </div>
  );
}

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
                <Link
                  href={`/companies/${s.companyId}`}
                  className="truncate font-medium text-slate-700 hover:text-gold-700 dark:text-white/80 dark:hover:text-gold-400"
                >
                  {s.companyName}
                </Link>
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
                      style={{
                        width: `${(v / total) * 100}%`,
                        backgroundColor: seg.color,
                      }}
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

const ATTENTION_DOT: Record<string, string> = {
  overdue: "bg-red-500",
  task: "bg-amber-400",
  follow_up: "bg-[#b8975a]",
  followup: "bg-[#b8975a]",
  deal: "bg-[#0d1f3c]",
  alert: "bg-red-500",
};

function AttentionWidget({ summary }: { summary: PlatformSummary }) {
  const items = summary.needsAttention ?? [];
  if (items.length === 0) {
    return (
      <EmptyState title="All clear" message="Nothing needs attention right now." />
    );
  }
  return (
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
  );
}

function ArizonaWidget({ cards }: { cards: CompanyCard[] }) {
  const byCity = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of cards) {
      const city = (c.city ?? "").trim();
      if (!city) continue;
      counts.set(city, (counts.get(city) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [cards]);
  const located = cards.filter(
    (c) => typeof c.lat === "number" && typeof c.lng === "number",
  ).length;
  if (byCity.length === 0) {
    return (
      <EmptyState
        title="No locations yet"
        message="Company cities will cluster here as locations are recorded."
      />
    );
  }
  const max = Math.max(1, ...byCity.map(([, n]) => n));
  return (
    <div>
      <ul className="space-y-2.5">
        {byCity.map(([city, n]) => (
          <li key={city}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-slate-700 dark:text-white/80">{city}, AZ</span>
              <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">{n}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(6, (n / max) * 100)}%`,
                  background: barGradient("#0d1f3c"),
                }}
              />
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[11px] text-slate-400 dark:text-white/35">
        {located} of {cards.length} companies carry map coordinates; city
        clusters shown until the map view is wired for company points.
      </p>
    </div>
  );
}

function RagWidget({
  summary,
  cards,
}: {
  summary: PlatformSummary;
  cards: CompanyCard[];
}) {
  const portfolio = cards.filter((c) => c.stage === "portfolio");
  const counts = summary.ragCounts ?? { green: 0, amber: 0, red: 0 };
  if (summary.portfolioCount === 0 && portfolio.length === 0) {
    return (
      <EmptyState
        title="No portfolio companies yet"
        message="Closed deals will land here with their RAG status."
      />
    );
  }
  return (
    <div>
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
                <span className="min-w-0 truncate">{c.name}</span>
                {c.city && (
                  <span className="ml-auto shrink-0 text-xs text-caption">{c.city}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------------- Activity pulse (Oct 23, 2026) ----------------
 * The 6th widget, chosen by Ethan to fill the slot Capital Stacks
 * vacated: how much Activity triage is waiting, by kind, with the
 * newest items. Data arrives on the overview payload — no fetch,
 * no recompute here. */

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

function PulseWidget({ pulse }: { pulse: ActivityPulseData | null | undefined }) {
  if (!pulse) {
    return (
      <EmptyState
        title="Activity pulse unavailable"
        message="Triage counts couldn't be loaded — the Activity feed itself is unaffected."
      />
    );
  }
  const rows = [
    ["Businesses for sale", pulse.counts.businessesForSale],
    ["Operators available", pulse.counts.operatorsAvailable],
    ["Market notes", pulse.counts.marketNotes],
  ] as const;
  const total = rows.reduce((sum, [, n]) => sum + (n ?? 0), 0);
  if (total === 0) {
    return (
      <EmptyState
        title="All caught up"
        message="Nothing is waiting for triage in the Activity feed."
      />
    );
  }
  return (
    <div>
      <p className="tnum font-display text-4xl font-semibold text-[#0d1f3c] dark:text-white">
        {total}
        <span className="ml-2 align-middle text-sm font-normal text-slate-500 dark:text-white/50">
          waiting for triage
        </span>
      </p>
      <ul className="mt-3 space-y-1.5">
        {rows.map(([label, n]) => (
          <li
            key={label}
            className="flex items-baseline justify-between gap-2 text-sm"
          >
            <span className="text-slate-600 dark:text-white/70">{label}</span>
            <span className="tnum font-semibold text-[#0d1f3c] dark:text-white">
              {n}
            </span>
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
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#b8975a]"
                  />
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
        <Link
          href="/activity"
          className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
        >
          Open Activity →
        </Link>
      </p>
    </div>
  );
}

/* ---------------- Early warning (Phase 9) ----------------
 * Rendered exactly as served by GET /api/platform/overview's
 * earlyWarning array — no recompute, no client scoring. */

function ewBandChip(band: string): { label: string; className: string; style?: React.CSSProperties } {
  switch (band.toLowerCase()) {
    case "low":
      return { label: "Low", className: "badge-neutral" };
    case "watch":
      return { label: "Watch", className: "badge-warn" };
    case "elevated":
      return {
        label: "Elevated",
        className: "",
        style: { backgroundColor: "#ffedd5", color: "#9a3412" },
      };
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

/** Top drivers from the components payload, whatever shape the
 * backend serves (array of {label/name/key, score/value/contribution}
 * or a record of key → number). Sorted by |contribution| when the
 * values are numeric; first two win. */
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
            <li
              key={it.companyId}
              className="rounded-xl border border-slate-100 p-4 dark:border-white/10"
            >
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/portfolio-monitoring/${encodeURIComponent(it.companyId)}`}
                  className="min-w-0 truncate text-sm font-semibold text-slate-800 hover:text-gold-700 dark:text-white/90 dark:hover:text-gold-400"
                >
                  {it.companyName}
                </Link>
                <span
                  className={`badge shrink-0 ${chip.className}`}
                  style={chip.style}
                >
                  {chip.label}
                </span>
              </div>
              <p className="tnum mt-1 font-display text-4xl font-semibold text-navy-900 dark:text-white">
                {typeof it.score === "number" ? Math.round(it.score) : "—"}
              </p>
              {drivers.length > 0 && (
                <p className="mt-1 text-xs text-caption">
                  {drivers
                    .map((d) => (d.detail ? `${d.label} ${d.detail}` : d.label))
                    .join(" · ")}
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

export default function PlatformOverview() {
  const [payload, setPayload] = useState<OverviewPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [customize, setCustomize] = useState(false);
  const [layout, setLayout] = useState<WidgetLayout>(loadLayout);

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
          data.activityPulse &&
          typeof data.activityPulse === "object" &&
          data.activityPulse.counts
            ? data.activityPulse
            : null,
      });
      setLoadFailed(false);
    } catch {
      if (!signal.cancelled) setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    const signal = { cancelled: false };
    void fetchOnce(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [fetchOnce, reloadTick]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(layout));
    } catch {
      /* storage unavailable — layout simply won't persist */
    }
  }, [layout]);

  const summary = payload?.summary ?? null;
  const allCards = useMemo(() => payload?.cards ?? [], [payload]);

  const moveWidget = (id: WidgetId, dir: -1 | 1) =>
    setLayout((prev) => {
      const order = [...prev.order];
      const i = order.indexOf(id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= order.length) return prev;
      [order[i], order[j]] = [order[j], order[i]];
      return { ...prev, order };
    });
  const hideWidget = (id: WidgetId) =>
    setLayout((prev) => ({ ...prev, hidden: [...prev.hidden, id] }));
  const showWidget = (id: WidgetId) =>
    setLayout((prev) => ({ ...prev, hidden: prev.hidden.filter((h) => h !== id) }));

  const visibleWidgets = layout.order.filter((id) => !layout.hidden.includes(id));

  const renderWidget = (id: WidgetId) => {
    if (!summary) return null;
    switch (id) {
      case "funnel":
        return <FunnelWidget summary={summary} />;
      case "heatmap":
        return <HeatmapWidget summary={summary} />;
      case "attention":
        return <AttentionWidget summary={summary} />;
      case "map":
        return <ArizonaWidget cards={allCards} />;
      case "rag":
        return <RagWidget summary={summary} cards={allCards} />;
      case "pulse":
        return <PulseWidget pulse={payload?.activityPulse} />;
    }
  };

  const stageBreakdown = summary
    ? Object.entries(summary.dealsByStage ?? {})
        .slice(0, 3)
        .map(([s, n]) => `${s} ${n}`)
        .join(" · ")
    : "";

  return (
    <section className="mb-6" aria-label="Platform summary">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
            Platform summary
          </h2>
          <p className="caption mt-0.5">
            {summary
              ? summary.updatedAt
                ? `Updated ${fmtRelTime(summary.updatedAt)}`
                : "Awaiting first summary build"
              : loadFailed
                ? "Summary unavailable"
                : "Loading…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={customize ? "primary" : "secondary"}
            size="sm"
            onClick={() => setCustomize((c) => !c)}
          >
            Customize
          </Button>
        </div>
      </div>

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
          <div className="card-surface mb-4 grid grid-cols-2 gap-x-4 gap-y-5 p-5 sm:p-6 lg:grid-cols-5">
            <StatTile
              label="Deals in pipeline"
              display={String(summary.totalDeals)}
              numericValue={summary.totalDeals}
              format={(n) => String(n)}
              caption={stageBreakdown || undefined}
            />
            <StatTile
              label="Open tasks"
              display={String(summary.openTasks)}
              numericValue={summary.openTasks}
              format={(n) => String(n)}
            />
            <StatTile
              label="Follow-ups · 7d"
              display={String(summary.upcomingFollowUps)}
              numericValue={summary.upcomingFollowUps}
              format={(n) => String(n)}
            />
            <StatTile
              label="Capital committed"
              display={fmtMoneyCompact(summary.capitalCommitted)}
              numericValue={summary.capitalCommitted}
              format={fmtMoneyCompact}
              title={fmtMoney(summary.capitalCommitted)}
              caption={`Needed ${fmtMoneyCompact(summary.capitalNeeded)}`}
            />
            <StatTile
              label="Portfolio companies"
              display={String(summary.portfolioCount)}
              numericValue={summary.portfolioCount}
              format={(n) => String(n)}
              caption={`${summary.ragCounts.green} on track · ${summary.ragCounts.amber} watch · ${summary.ragCounts.red} at risk`}
            />
          </div>

          <EarlyWarningBlock items={payload?.earlyWarning ?? []} />

          {customize && layout.hidden.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-caption">Hidden:</span>
              {layout.hidden.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="chip"
                  onClick={() => showWidget(id)}
                >
                  + {WIDGET_DEFS.find((w) => w.id === id)?.title ?? id}
                </button>
              ))}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleWidgets.map((id, idx) => (
              <WidgetShell
                key={id}
                title={WIDGET_DEFS.find((w) => w.id === id)?.title ?? id}
                customize={customize}
                canUp={idx > 0}
                canDown={idx < visibleWidgets.length - 1}
                onMove={(dir) => moveWidget(id, dir)}
                onHide={() => hideWidget(id)}
              >
                {renderWidget(id)}
              </WidgetShell>
            ))}
          </div>

        </>
      )}
    </section>
  );
}
