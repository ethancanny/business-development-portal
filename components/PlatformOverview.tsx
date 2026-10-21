"use client";

/**
 * Platform summary (Phase 1, Oct 21, 2026 — workstream C).
 *
 * The ONLY data source is GET /api/platform/overview, which reads the
 * server-side summary tables (PROJECT_RULES: never recompute on page
 * load). Fetched once on mount — no interval polling. This component
 * owns the card filter state and renders <CompanyCards/> itself with
 * the filtered list, so the Overview page needs a single insertion.
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
import CompanyCards, {
  applyCardFilters,
  ragDot,
  STAGE_GROUP_LABELS,
  type CompanyCard,
  type CompanyCardFilters,
  type CompanyStageGroup,
} from "@/components/CompanyCards";
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

interface OverviewPayload {
  summary: PlatformSummary;
  cards: CompanyCard[];
}

/* ---------------- Widget layout (localStorage-persisted) ---------------- */

type WidgetId = "funnel" | "heatmap" | "capital" | "attention" | "map" | "rag";

const WIDGET_DEFS: { id: WidgetId; title: string }[] = [
  { id: "funnel", title: "Pipeline funnel" },
  { id: "heatmap", title: "Deal heat map" },
  { id: "capital", title: "Capital stacks" },
  { id: "attention", title: "Needs attention" },
  { id: "map", title: "Arizona footprint" },
  { id: "rag", title: "Portfolio RAG" },
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
  const [view, setView] = useState<"funnel" | "kanban">("funnel");
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
        <button
          type="button"
          onClick={() => setView("funnel")}
          className={`chip ${view === "funnel" ? "chip-active" : ""}`}
        >
          Funnel
        </button>
        <button
          type="button"
          onClick={() => setView("kanban")}
          className={`chip ${view === "kanban" ? "chip-active" : ""}`}
        >
          Kanban
        </button>
        <Link href="/pipeline" className="ml-auto text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]">
          Open pipeline →
        </Link>
      </div>
      {view === "funnel" ? (
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
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {entries.map(([stage, count]) => (
            <div
              key={stage}
              className="min-w-[6.5rem] flex-1 rounded-lg bg-slate-50 p-2.5 text-center dark:bg-white/5"
            >
              <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-caption" title={stage}>
                {stage}
              </p>
              <p className="tnum mt-1 font-display text-2xl font-semibold text-navy-900 dark:text-white">
                {count}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function HeatmapWidget({ summary }: { summary: PlatformSummary }) {
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
            className="truncate px-1 pb-1 text-center text-[11px] font-semibold uppercase tracking-wide text-caption"
            title={s}
          >
            {s}
          </span>
        ))}
        {verticals.map((v) => (
          <Fragment key={v}>
            <span
              className="flex items-center truncate pr-2 text-xs font-medium text-slate-700 dark:text-white/80"
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
                    backgroundColor:
                      n === 0
                        ? "rgba(13,31,60,0.05)"
                        : `rgba(184,151,90,${intensity.toFixed(2)})`,
                    color: intensity > 0.55 ? "#ffffff" : "#0d1f3c",
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

function CapitalWidget({ summary }: { summary: PlatformSummary }) {
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

/* ---------------- Main section ---------------- */

const selectClass =
  "min-h-[44px] max-w-full rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-navy-900 dark:border-white/15 dark:bg-white/5 dark:text-white";

export default function PlatformOverview() {
  const [payload, setPayload] = useState<OverviewPayload | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [customize, setCustomize] = useState(false);
  const [layout, setLayout] = useState<WidgetLayout>(loadLayout);
  const [filters, setFilters] = useState<CompanyCardFilters>({
    stage: "all",
    vertical: "all",
    query: "",
  });

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
  const verticals = useMemo(
    () =>
      Array.from(new Set(allCards.map((c) => c.vertical).filter(Boolean) as string[])).sort(),
    [allCards],
  );
  const filteredCards = useMemo(
    () => applyCardFilters(allCards, filters),
    [allCards, filters],
  );

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
      case "capital":
        return <CapitalWidget summary={summary} />;
      case "attention":
        return <AttentionWidget summary={summary} />;
      case "map":
        return <ArizonaWidget cards={allCards} />;
      case "rag":
        return <RagWidget summary={summary} cards={allCards} />;
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
          <label className="sr-only" htmlFor="po-stage">Stage</label>
          <select
            id="po-stage"
            className={selectClass}
            value={filters.stage}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                stage: e.target.value as CompanyCardFilters["stage"],
              }))
            }
          >
            <option value="all">All stages</option>
            {(Object.keys(STAGE_GROUP_LABELS) as CompanyStageGroup[]).map((s) => (
              <option key={s} value={s}>
                {STAGE_GROUP_LABELS[s]}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="po-vertical">Vertical</label>
          <select
            id="po-vertical"
            className={selectClass}
            value={filters.vertical}
            onChange={(e) => setFilters((f) => ({ ...f, vertical: e.target.value }))}
          >
            <option value="all">All verticals</option>
            {verticals.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
          <label className="sr-only" htmlFor="po-query">Operator or search</label>
          <input
            id="po-query"
            type="search"
            placeholder="Operator / search cards…"
            className={`${selectClass} min-w-0`}
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          />
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

          <div className="mt-6">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h3 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
                Companies
              </h3>
              <span className="caption">
                {filteredCards.length} of {allCards.length}
              </span>
            </div>
            <CompanyCards cards={allCards} filters={filters} />
          </div>
        </>
      )}
    </section>
  );
}
