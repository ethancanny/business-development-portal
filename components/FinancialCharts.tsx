"use client";

/**
 * FinancialCharts (Phase 4, workstream D) — chart pieces split out of
 * FinancialsSection to keep that file manageable. Recharts styling
 * matches the existing portal charts (market-intel / IndustryExplorer):
 * navy revenue bars, gold EBITDA bars, margin % lines on a right axis,
 * dashed grid, 11px ticks, theme-aware tooltip surface.
 */

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useTheme } from "@/components/ThemeProvider";
import { fmtMoney, fmtMoneyCompact } from "@/lib/format";

export interface FinChartPoint {
  label: string;
  periodEnd: string | null;
  revenue: number | null;
  ebitda: number | null;
  grossMarginPct: number | null;
  ebitdaMarginPct: number | null;
}

function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(1)}%`;
}

export function FinancialChart({ data }: { data: FinChartPoint[] }) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const grid = dark ? "rgba(255,255,255,0.08)" : "#e2e8f0";
  const tick = dark ? "rgba(255,255,255,0.55)" : "#64748b";
  return (
    <div className="h-64">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={grid} strokeDasharray="3 3" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: tick }} minTickGap={30} />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 11, fill: tick }}
            tickFormatter={(v: number) => fmtMoneyCompact(v)}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 11, fill: tick }}
            tickFormatter={(v: number) => `${v}%`}
          />
          <Tooltip
            contentStyle={{
              background: dark ? "#0d1f3c" : "#fff",
              border: `1px solid ${grid}`,
              fontSize: 12,
            }}
            formatter={(v, name) => [
              name === "Gross margin %" || name === "EBITDA margin %"
                ? fmtPct(typeof v === "number" ? v : null)
                : fmtMoney(typeof v === "number" ? v : 0),
              name,
            ]}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="left" dataKey="revenue" name="Revenue" fill="#0d1f3c" radius={[2, 2, 0, 0]} />
          <Bar yAxisId="left" dataKey="ebitda" name="EBITDA" fill="#b8975a" radius={[2, 2, 0, 0]} />
          <Line yAxisId="right" type="monotone" dataKey="grossMarginPct" name="Gross margin %" stroke="#54708f" strokeWidth={2} dot={false} />
          <Line yAxisId="right" type="monotone" dataKey="ebitdaMarginPct" name="EBITDA margin %" stroke="#8a6f3c" strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
