"use client";

/**
 * Impact / effort matrix — recharts ScatterChart: x = effort (1–5),
 * y = EBITDA impact ($). Quadrant captions name the four regions
 * (Quick wins / Major projects / Fill-ins / Thankless). Done and
 * deferred initiatives are excluded by default, with a toggle.
 */

import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { EmptyState } from "@/components/ui";
import { useTheme } from "@/components/ThemeProvider";
import {
  cardCls,
  fmtMoneyCompact,
  fmtMoneyN,
  labelOf,
  INITIATIVE_STATUSES,
  type VcTabProps,
} from "@/components/valuecreation/types";

interface Point {
  x: number;
  y: number;
  title: string;
  status: string;
  confidence: number | null;
}

export default function MatrixTab({ initiatives }: VcTabProps) {
  const { theme } = useTheme();
  const dark = theme === "dark";
  const [includeClosed, setIncludeClosed] = useState(false);

  const points = useMemo<Point[]>(
    () =>
      initiatives
        .filter((i) => includeClosed || (i.status !== "done" && i.status !== "deferred"))
        .filter((i) => i.effort !== null && i.ebitdaImpact !== null)
        .map((i) => ({
          x: i.effort as number,
          y: i.ebitdaImpact as number,
          title: i.title,
          status: i.status,
          confidence: i.confidence,
        })),
    [initiatives, includeClosed]
  );

  const maxY = points.reduce((m, p) => Math.max(m, p.y), 0);
  const midY = maxY > 0 ? maxY / 2 : 1;

  return (
    <div className={cardCls}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Impact / effort matrix
          </h3>
          <p className="mt-0.5 max-w-xl text-sm text-slate-500 dark:text-white/50">
            Top-left is where to start: high EBITDA impact for low effort.
            Bubble size follows confidence. Tap a bubble for its initiative.
          </p>
        </div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-[#0d1f3c] dark:text-white">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#b8975a]"
            checked={includeClosed}
            onChange={(e) => setIncludeClosed(e.target.checked)}
          />
          Include done / deferred
        </label>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:text-sm">
        <p className="rounded-lg bg-[#b8975a]/10 px-3 py-2 text-[#0d1f3c] dark:text-white/85">
          <span className="font-semibold">Quick wins</span> — high impact, low effort (top-left)
        </p>
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-[#0d1f3c] dark:bg-white/5 dark:text-white/85">
          <span className="font-semibold">Major projects</span> — high impact, high effort (top-right)
        </p>
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-[#0d1f3c] dark:bg-white/5 dark:text-white/85">
          <span className="font-semibold">Fill-ins</span> — low impact, low effort (bottom-left)
        </p>
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[#0d1f3c] dark:text-white/85">
          <span className="font-semibold">Thankless</span> — low impact, high effort (bottom-right)
        </p>
      </div>

      {points.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Nothing to plot yet"
            message="Initiatives need both an effort score (1–5) and an EBITDA impact to appear on the matrix."
          />
        </div>
      ) : (
        <div className="mt-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ top: 12, right: 16, left: 4, bottom: 8 }}>
              <CartesianGrid stroke={dark ? "rgba(255,255,255,0.08)" : "#e2e8f0"} strokeDasharray="3 3" />
              <XAxis
                type="number"
                dataKey="x"
                name="Effort"
                domain={[0.5, 5.5]}
                ticks={[1, 2, 3, 4, 5]}
                tick={{ fontSize: 11, fill: dark ? "rgba(255,255,255,0.55)" : "#64748b" }}
                label={{ value: "Effort →", position: "insideBottom", fontSize: 11, fill: dark ? "rgba(255,255,255,0.55)" : "#64748b" }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="EBITDA impact"
                domain={[0, "auto"]}
                tick={{ fontSize: 11, fill: dark ? "rgba(255,255,255,0.55)" : "#64748b" }}
                tickFormatter={(v: number) => fmtMoneyCompact(v)}
                label={{ value: "EBITDA impact", angle: -90, position: "insideLeft", fontSize: 11, fill: dark ? "rgba(255,255,255,0.55)" : "#64748b" }}
              />
              <ZAxis type="number" dataKey="confidence" range={[70, 260]} />
              <ReferenceArea x1={0.5} x2={3} y1={midY} y2={maxY * 1.05} fill="#b8975a" fillOpacity={0.1} />
              <ReferenceArea x1={3} x2={5.5} y1={0} y2={midY} fill="#dc2626" fillOpacity={0.05} />
              <Tooltip
                contentStyle={{
                  background: dark ? "#0d1f3c" : "#fff",
                  border: `1px solid ${dark ? "rgba(255,255,255,0.08)" : "#e2e8f0"}`,
                  fontSize: 12,
                }}
                formatter={(value, name) => {
                  if (name === "EBITDA impact") return [fmtMoneyN(typeof value === "number" ? value : null), name];
                  return [value, name];
                }}
                labelFormatter={(_, payload) => {
                  const p = (payload?.[0]?.payload ?? null) as Point | null;
                  return p ? p.title : "";
                }}
              />
              <Scatter data={points} name="Initiatives">
                {points.map((p, idx) => (
                  <Cell
                    key={idx}
                    fill={p.status === "done" ? "#2f7f79" : p.status === "deferred" ? "#dc2626" : p.status === "in_progress" ? "#b8975a" : "#0d1f3c"}
                    fillOpacity={0.85}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      )}

      {points.length > 0 && (
        <ul className="mt-3 grid gap-1.5 text-sm sm:grid-cols-2">
          {points.map((p, idx) => (
            <li key={idx} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[#0d1f3c] dark:text-white/90">{p.title}</span>
              <span className="tnum shrink-0 text-xs text-slate-500 dark:text-white/50">
                effort {p.x} · {fmtMoneyN(p.y)} · {labelOf(INITIATIVE_STATUSES, p.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
