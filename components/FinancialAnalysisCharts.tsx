"use client";

/**
 * FinancialAnalysisCharts (Part 4B, WS-D) — recharts pieces for the
 * automated financial analysis panel. Styling follows
 * FinancialCharts.tsx: navy #0d1f3c bars, gold #b8975a EBITDA, dashed
 * grid, 11px ticks, theme-aware tooltip surface (useTheme from
 * ThemeProvider). All charts are ~h-64 in a ResponsiveContainer.
 *
 * Payload conventions (contract): pct metric values are FRACTIONS
 * (0.25 = 25%) — callers pass percentage points for line axes, or the
 * chart formats fractions itself where noted.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "@/components/ThemeProvider";
import { fmtDate, fmtMoney, fmtMoneyCompact } from "@/lib/format";

/* ---------------- shared ---------------- */

function useChartTheme() {
  const { theme } = useTheme();
  const dark = theme === "dark";
  return {
    dark,
    grid: dark ? "rgba(255,255,255,0.08)" : "#e2e8f0",
    tick: dark ? "rgba(255,255,255,0.55)" : "#64748b",
    tooltipStyle: {
      background: dark ? "#0d1f3c" : "#fff",
      border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "#e2e8f0"}`,
      fontSize: 12,
    } as React.CSSProperties,
  };
}

function shortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function fmtPctPoints(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

/* ---------------- TrendChart ---------------- */

export interface TrendPoint {
  label: string;
  periodEnd: string | null;
  revenue: number | null;
  ebitda: number | null;
  /** Percentage points (25 = 25%). */
  grossMarginPct: number | null;
  ebitdaMarginPct: number | null;
}

/**
 * Revenue/EBITDA bars (left axis) + gross/EBITDA margin lines (right
 * axis, percentage points). Anomaly markers: a gold ReferenceDot on the
 * revenue bar (falling back to EBITDA) for each periodEnd in
 * anomalyPeriodEnds.
 */
export function TrendChart({
  points,
  anomalyPeriodEnds,
}: {
  points: TrendPoint[];
  anomalyPeriodEnds: string[];
}) {
  const t = useChartTheme();
  const flagged = new Set(anomalyPeriodEnds.filter(Boolean));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={points} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: t.tick }} minTickGap={30} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: t.tick }}
            tickFormatter={(v: number) => fmtMoneyCompact(v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: t.tick }}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={t.tooltipStyle}
            formatter={(v, name) => [
              name === "Gross margin %" || name === "EBITDA margin %"
                ? fmtPctPoints(typeof v === "number" ? v : null)
                : fmtMoney(typeof v === "number" ? v : 0),
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#0d1f3c" radius={[2, 2, 0, 0]} />
          <Bar yAxisId="left" dataKey="ebitda" name="EBITDA" fill="#b8975a" radius={[2, 2, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="grossMarginPct" name="Gross margin %" stroke="#54708f" strokeWidth={2} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey="ebitdaMarginPct" name="EBITDA margin %" stroke="#8a6f3c" strokeWidth={2} dot={false} />
          {points
            .filter((p) => p.periodEnd && flagged.has(p.periodEnd))
            .map((p) => {
              const y = p.revenue ?? p.ebitda;
              if (y === null || y === undefined) return null;
              return (
                <ReferenceDot
                  key={`anom-${p.periodEnd}`}
                  yAxisId="left"
                  x={p.label}
                  y={y}
                  r={6}
                  fill="#dc2626"
                  stroke="#fff"
                  strokeWidth={1.5}
                />
              );
            })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- MarginBridgeChart ---------------- */

export interface MarginBridgeData {
  reportedEbitda: number | null;
  items: { label: string; amount: number }[];
  adjustedEbitda: number | null;
}

interface WaterfallDatum {
  name: string;
  base: number;
  value: number;
  fill: string;
  total: number;
}

/** Build waterfall rows: transparent base + visible value segment. */
function waterfall(
  startLabel: string,
  start: number,
  items: { label: string; amount: number }[],
  endLabel: string,
  end: number | null
): WaterfallDatum[] {
  const rows: WaterfallDatum[] = [
    { name: startLabel, base: 0, value: start, fill: "#0d1f3c", total: start },
  ];
  let running = start;
  for (const item of items) {
    const base = item.amount >= 0 ? running : running + item.amount;
    rows.push({
      name: item.label,
      base,
      value: Math.abs(item.amount),
      fill: item.amount >= 0 ? "#2f7f79" : "#dc2626",
      total: running + item.amount,
    });
    running += item.amount;
  }
  const final = end ?? running;
  rows.push({ name: endLabel, base: 0, value: final, fill: "#b8975a", total: final });
  return rows;
}

export function MarginBridgeChart({ bridge }: { bridge: MarginBridgeData }) {
  const t = useChartTheme();
  if (bridge.reportedEbitda === null) {
    return <p className="text-sm text-caption">No reported EBITDA to bridge from.</p>;
  }
  const data = waterfall(
    "Reported EBITDA",
    bridge.reportedEbitda,
    bridge.items,
    "Adjusted EBITDA",
    bridge.adjustedEbitda
  );
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: t.tick }} interval={0} angle={-18} textAnchor="end" height={56} />
          <YAxis tick={{ fontSize: 11, fill: t.tick }} tickFormatter={(v: number) => fmtMoneyCompact(v)} />
          <Tooltip
            contentStyle={t.tooltipStyle}
            formatter={(v, name, item) => {
              if (name === "base") return [null, null];
              const payload = (item as { payload?: WaterfallDatum } | undefined)?.payload;
              return [fmtMoney(payload ? payload.total : typeof v === "number" ? v : 0), "Running EBITDA"];
            }}
          />
          <Bar dataKey="base" stackId="wf" fill="transparent" isAnimationActive={false} />
          <Bar dataKey="value" stackId="wf" radius={[2, 2, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- WorkingCapitalChart ---------------- */

export interface WcPoint {
  setId: string;
  periodEnd: string | null;
  wc: number;
  revenue: number | null;
  /** FRACTION (0.25 = 25%). */
  wcPctRevenue: number | null;
}

/**
 * Working-capital bars (left axis, $) + WC % of revenue line (right
 * axis, % points). When a peg is supplied, the peg low–high band is
 * shaded with a ReferenceArea on the $ axis (viz #10).
 */
export function WorkingCapitalChart({
  points,
  peg,
}: {
  points: WcPoint[];
  peg?: { low: number | null; mid: number | null; high: number | null } | null;
}) {
  const t = useChartTheme();
  const data = points.map((p) => ({
    label: shortDate(p.periodEnd),
    periodEnd: p.periodEnd,
    wc: p.wc,
    wcPct: p.wcPctRevenue === null ? null : p.wcPctRevenue * 100,
  }));
  const showPeg = peg && peg.low !== null && peg.high !== null;
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: t.tick }} minTickGap={30} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: t.tick }}
            tickFormatter={(v: number) => fmtMoneyCompact(v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: t.tick }}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={t.tooltipStyle}
            formatter={(v, name) => [
              name === "WC % of revenue"
                ? fmtPctPoints(typeof v === "number" ? v : null)
                : fmtMoney(typeof v === "number" ? v : 0),
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {showPeg && (
            <ReferenceArea
              yAxisId="left"
              y1={peg.low as number}
              y2={peg.high as number}
              fill="#b8975a"
              fillOpacity={0.18}
              stroke="#b8975a"
              strokeOpacity={0.4}
              label={{ value: "Peg band", fontSize: 11, fill: t.tick, position: "insideTopLeft" }}
            />
          )}
          <Bar yAxisId="left" dataKey="wc" name="Working capital" fill="#0d1f3c" radius={[2, 2, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="wcPct" name="WC % of revenue" stroke="#b8975a" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- MonthlyChart ---------------- */

export interface MonthlyPoint {
  periodEnd: string | null;
  revenue: number | null;
  ebitda: number | null;
  seasonalityIndex: number | null;
}

/** Monthly revenue + EBITDA bars with the seasonality index line (1.0 = average month). */
export function MonthlyChart({ data: raw }: { data: MonthlyPoint[] }) {
  const t = useChartTheme();
  const data = raw.map((p) => ({
    label: p.periodEnd
      ? new Date(p.periodEnd).toLocaleDateString("en-US", { month: "short", year: "2-digit" })
      : "—",
    revenue: p.revenue,
    ebitda: p.ebitda,
    seasonalityIndex: p.seasonalityIndex,
  }));
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: t.tick }} minTickGap={20} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: t.tick }}
            tickFormatter={(v: number) => fmtMoneyCompact(v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            domain={[0, "auto"]}
            tick={{ fontSize: 11, fill: t.tick }}
          />
          <Tooltip
            contentStyle={t.tooltipStyle}
            formatter={(v, name) => [
              name === "Seasonality index"
                ? typeof v === "number"
                  ? v.toFixed(2)
                  : "—"
                : fmtMoney(typeof v === "number" ? v : 0),
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#0d1f3c" radius={[2, 2, 0, 0]} />
          <Bar yAxisId="left" dataKey="ebitda" name="EBITDA" fill="#b8975a" radius={[2, 2, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="seasonalityIndex" name="Seasonality index" stroke="#2f7f79" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------- BsCompositionChart ---------------- */

export interface BsCompositionPoint {
  periodEnd: string | null;
  assets: {
    cash: number | null;
    accountsReceivable: number | null;
    inventory: number | null;
    otherCurrent: number | null;
    ppe: number | null;
    intangibles: number | null;
    other: number | null;
  };
  liabEquity: {
    accountsPayable: number | null;
    currentDebt: number | null;
    otherCurrent: number | null;
    longTermDebt: number | null;
    otherLiab: number | null;
    equity: number | null;
  };
}

const ASSET_SERIES: { key: string; name: string; fill: string }[] = [
  { key: "cash", name: "Cash", fill: "#0d1f3c" },
  { key: "accountsReceivable", name: "Accounts receivable", fill: "#3b5b84" },
  { key: "inventory", name: "Inventory", fill: "#b8975a" },
  { key: "otherCurrent", name: "Other current", fill: "#8a7a2e" },
  { key: "ppe", name: "PP&E", fill: "#2f7f79" },
  { key: "intangibles", name: "Intangibles", fill: "#7a4e7e" },
  { key: "other", name: "Other", fill: "#94a3b8" },
];

const LIAB_SERIES: { key: string; name: string; fill: string }[] = [
  { key: "accountsPayable", name: "Accounts payable", fill: "#0d1f3c" },
  { key: "currentDebt", name: "Current debt", fill: "#b5703a" },
  { key: "otherCurrent", name: "Other current", fill: "#8a7a2e" },
  { key: "longTermDebt", name: "Long-term debt", fill: "#dc2626" },
  { key: "otherLiab", name: "Other liabilities", fill: "#94a3b8" },
  { key: "equity", name: "Equity", fill: "#b8975a" },
];

/** Two stacked-bar sets side by side: asset mix and liabilities + equity mix. */
export function BsCompositionChart({ data: raw }: { data: BsCompositionPoint[] }) {
  const t = useChartTheme();
  const assets = raw.map((p) => ({
    label: shortDate(p.periodEnd),
    cash: p.assets.cash ?? 0,
    accountsReceivable: p.assets.accountsReceivable ?? 0,
    inventory: p.assets.inventory ?? 0,
    otherCurrent: p.assets.otherCurrent ?? 0,
    ppe: p.assets.ppe ?? 0,
    intangibles: p.assets.intangibles ?? 0,
    other: p.assets.other ?? 0,
  }));
  const liab = raw.map((p) => ({
    label: shortDate(p.periodEnd),
    accountsPayable: p.liabEquity.accountsPayable ?? 0,
    currentDebt: p.liabEquity.currentDebt ?? 0,
    otherCurrent: p.liabEquity.otherCurrent ?? 0,
    longTermDebt: p.liabEquity.longTermDebt ?? 0,
    otherLiab: p.liabEquity.otherLiab ?? 0,
    equity: p.liabEquity.equity ?? 0,
  }));
  const chart = (
    rows: Record<string, unknown>[],
    series: { key: string; name: string; fill: string }[]
  ) => (
    <div className="h-64 min-w-0 flex-1">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: t.tick }} minTickGap={30} />
          <YAxis tick={{ fontSize: 11, fill: t.tick }} tickFormatter={(v: number) => fmtMoneyCompact(v)} />
          <Tooltip
            contentStyle={t.tooltipStyle}
            formatter={(v, name) => [fmtMoney(typeof v === "number" ? v : 0), name]}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {series.map((s) => (
            <Bar key={s.key} dataKey={s.key} name={s.name} stackId="bs" fill={s.fill} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div>
        <p className="micro-label mb-1.5">Assets mix</p>
        {chart(assets as unknown as Record<string, unknown>[], ASSET_SERIES)}
      </div>
      <div>
        <p className="micro-label mb-1.5">Liabilities &amp; equity mix</p>
        {chart(liab as unknown as Record<string, unknown>[], LIAB_SERIES)}
      </div>
    </div>
  );
}

/* ---------------- CashConversionChart ---------------- */

export interface CashConversionPoint {
  periodEnd: string | null;
  ebitda: number | null;
  cfo: number | null;
  cfi: number | null;
  fcf: number | null;
}

/**
 * 3-step waterfall: EBITDA → CFO → FCF (FCF = CFO + CFI, after all
 * investing — the caption lives in the parent panel). Steps are drawn
 * as a waterfall (transparent base + segment) from EBITDA through the
 * CFO and FCF levels.
 */
export function CashConversionChart({ data }: { data: CashConversionPoint }) {
  const t = useChartTheme();
  const steps: { name: string; level: number | null; fill: string }[] = [
    { name: "EBITDA", level: data.ebitda, fill: "#b8975a" },
    { name: "CFO", level: data.cfo, fill: "#0d1f3c" },
    { name: "FCF (CFO + CFI)", level: data.fcf, fill: "#2f7f79" },
  ];
  // Waterfall segments between consecutive levels.
  const rows: WaterfallDatum[] = [];
  let prev = 0;
  steps.forEach((s, i) => {
    const level = s.level ?? 0;
    if (i === 0) {
      rows.push({ name: s.name, base: 0, value: level, fill: s.fill, total: level });
    } else {
      const base = Math.min(prev, level);
      rows.push({ name: s.name, base, value: Math.abs(level - prev), fill: s.fill, total: level });
    }
    prev = level;
  });
  return (
    <div>
      {data.periodEnd && (
        <p className="mb-1 text-xs text-caption">Period ending {fmtDate(data.periodEnd)}</p>
      )}
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={t.grid} strokeDasharray="3 3" />
            <XAxis dataKey="name" tick={{ fontSize: 11, fill: t.tick }} interval={0} />
            <YAxis tick={{ fontSize: 11, fill: t.tick }} tickFormatter={(v: number) => fmtMoneyCompact(v)} />
            <Tooltip
              contentStyle={t.tooltipStyle}
              formatter={(v, name, item) => {
                if (name === "base") return [null, null];
                const payload = (item as { payload?: WaterfallDatum } | undefined)?.payload;
                return [fmtMoney(payload ? payload.total : typeof v === "number" ? v : 0), "Level"];
              }}
            />
            <Bar dataKey="base" stackId="cc" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="value" stackId="cc" radius={[2, 2, 0, 0]}>
              {rows.map((d) => (
                <Cell key={d.name} fill={d.fill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm">
        {steps.map((s) => (
          <div key={s.name} className="rounded-xl border border-slate-100 px-2 py-2 dark:border-white/5">
            <dt className="micro-label">{s.name}</dt>
            <dd className="tnum mt-0.5 font-medium text-[#0d1f3c] dark:text-white">
              {s.level === null ? "—" : fmtMoney(s.level)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/* ---------------- ConcentrationChart (div bars live in the parent) ---------------- */

export function seasonalityLabel(month: number): string {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
    Math.min(11, Math.max(0, month - 1))
  ] ?? String(month);
}
