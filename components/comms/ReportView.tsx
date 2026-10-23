"use client";

/**
 * ReportView — renders a ReportRender exactly as assembled (and, for
 * recipients, exactly as audience-filtered server-side). Shared by
 * the internal ReportDetail and the standalone /report/[token] page.
 * No filtering happens here: what arrives is what renders.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  AppendixFigure,
  RenderBlock,
  ReportRender,
} from "@/components/comms/types";
import { formatFigureValue } from "@/components/comms/types";

const SERIES_COLORS = ["#0d1f3c", "#b8975a", "#3B5B84", "#2F7F79", "#B5703A"];

function figureMap(render: ReportRender): Map<string, AppendixFigure> {
  const map = new Map<string, AppendixFigure>();
  for (const b of render.blocks ?? []) {
    for (const f of b.figures ?? []) {
      if (f.key && !map.has(f.key)) map.set(f.key, f);
    }
  }
  return map;
}

function FigureChips({
  keys,
  figures,
}: {
  keys: string[];
  figures: Map<string, AppendixFigure>;
}) {
  if (!keys?.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {keys.map((k) => {
        const fig = figures.get(k);
        return (
          <span
            key={k}
            className="chip"
            title={fig ? `${fig.label}: ${formatFigureValue(fig)}` : k}
          >
            {fig ? `${fig.label} · ${formatFigureValue(fig)}` : k}
          </span>
        );
      })}
    </span>
  );
}

function ChartBlock({ block }: { block: RenderBlock }) {
  const chart = block.chart;
  if (!chart || !chart.series?.length) return null;
  const xs: string[] = [];
  for (const s of chart.series) {
    for (const p of s.points) if (!xs.includes(p.x)) xs.push(p.x);
  }
  const data = xs.map((x) => {
    const row: Record<string, string | number> = { x };
    for (const s of chart.series) {
      const pt = s.points.find((p) => p.x === x);
      if (pt) row[s.name] = pt.y;
    }
    return row;
  });
  if (data.length === 0) return null;
  const common = (
    <>
      <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" />
      <XAxis dataKey="x" tick={{ fontSize: 11, fill: "#64748b" }} minTickGap={24} />
      <YAxis tick={{ fontSize: 11, fill: "#64748b" }} />
      <Tooltip />
    </>
  );
  return (
    <div className="mt-3 h-64">
      <ResponsiveContainer width="100%" height="100%">
        {chart.kind === "line" ? (
          <LineChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            {common}
            {chart.series.map((s, i) => (
              <Line
                key={s.name}
                type="monotone"
                dataKey={s.name}
                stroke={SERIES_COLORS[i % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={data} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
            {common}
            {chart.series.map((s, i) => (
              <Bar
                key={s.name}
                dataKey={s.name}
                fill={SERIES_COLORS[i % SERIES_COLORS.length]}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

function BlockSection({
  block,
  figures,
}: {
  block: RenderBlock;
  figures: Map<string, AppendixFigure>;
}) {
  return (
    <section className="border-t border-slate-100 py-5 first:border-t-0 dark:border-white/5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
          {block.heading || block.type}
        </h3>
        {block.visibility === "internal_only" && (
          <span className="badge badge-warn">Internal only</span>
        )}
        {block.dataStatus === "missing" && (
          <span className="badge badge-danger">Data missing</span>
        )}
        {block.dataStatus === "not_applicable" && (
          <span className="badge badge-neutral">Not applicable</span>
        )}
      </div>

      {block.dataStatus === "missing" && (
        <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
          No data was available for this section when the report was generated.
        </p>
      )}
      {block.dataStatus === "not_applicable" && (
        <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
          This section does not apply to this subject.
        </p>
      )}

      {block.figures?.length > 0 && (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {block.figures.map((f) => (
            <div
              key={f.key}
              className="rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-white/5"
            >
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                {f.label}
              </dt>
              <dd className="tnum mt-0.5 text-lg font-semibold text-navy-900 dark:text-white">
                {formatFigureValue(f)}
              </dd>
              <dd className="mt-0.5 text-[11px] text-slate-400 dark:text-white/35">
                {f.sourceLabel || f.sourceModule}
                {f.verification ? ` · ${f.verification}` : ""}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {block.table && block.table.rows?.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="tbl-grad w-full min-w-[480px] text-sm">
            <thead>
              <tr>
                {block.table.columns.map((c, i) => (
                  <th key={i} className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.table.rows.map((row, ri) => (
                <tr key={ri} className="border-t border-slate-100 dark:border-white/5">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2.5 text-[#0d1f3c] dark:text-white">
                      {cell === null || cell === undefined ? "—" : String(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ChartBlock block={block} />

      {block.text && (
        <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-700 dark:text-white/80">
          {block.text}
        </div>
      )}

      {block.narrative && (
        <div className="mt-3 space-y-2">
          {block.narrative.status &&
            block.narrative.status !== "ready" &&
            block.narrative.status !== "manual" && (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Narrative status: {block.narrative.status}
              </p>
            )}
          {(block.narrative.statements ?? []).map((s, i) => (
            <p key={i} className="text-sm leading-relaxed text-slate-700 dark:text-white/80">
              {s.text}
              <FigureChips keys={s.figureKeys ?? []} figures={figures} />
            </p>
          ))}
          {(block.narrative.statements ?? []).length === 0 && (
            <p className="text-sm text-slate-400 dark:text-white/40">
              No narrative statements yet.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

export default function ReportView({ render }: { render: ReportRender }) {
  const figures = figureMap(render);
  return (
    <div>
      {render.sample && (
        <div
          role="alert"
          className="mb-4 rounded-xl bg-amber-500/15 px-4 py-3 text-center text-sm font-bold uppercase tracking-widest text-amber-800 ring-1 ring-inset ring-amber-500/40 dark:text-amber-200"
        >
          Sample — not a real report
        </div>
      )}

      {/* Cover */}
      <header>
        <p className="micro-label">{render.firm || "Canny Capital Partners"}</p>
        <h2 className="mt-1 font-display text-3xl font-semibold text-navy-900 dark:text-white">
          {render.title}
        </h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
          {[render.subjectLabel, render.asOf ? `As of ${render.asOf}` : ""]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {(render.warnings ?? []).length > 0 && (
          <div className="mt-3 space-y-1.5">
            {render.warnings.map((w, i) => (
              <p
                key={i}
                className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200"
              >
                {w}
              </p>
            ))}
          </div>
        )}
      </header>

      <div className="mt-2">
        {(render.blocks ?? []).map((b) => (
          <BlockSection key={b.key} block={b} figures={figures} />
        ))}
      </div>

      {(render.disclaimers ?? []).length > 0 && (
        <footer className="mt-4 border-t border-slate-200 pt-4 dark:border-white/10">
          {render.disclaimers.map((d, i) => (
            <p key={i} className="text-xs leading-relaxed text-slate-400 dark:text-white/35">
              {d}
            </p>
          ))}
        </footer>
      )}
    </div>
  );
}
