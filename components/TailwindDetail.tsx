"use client";

/**
 * Sector tailwind detail (Hospitality §4 + Phase 5, Oct 17, 2026).
 * Renders the stored computation from GET /api/market/tailwind: per
 * sector, the score + "what changed" one-liner, then the full
 * component table — value, movement, sub-score, nominal weight,
 * as-of date, and source link — with dropped/gap/pending components
 * shown and explained, and the formula note at the foot. Market Intel
 * itself shows only the score + one-liner (Overview tiles); this
 * section is the linked detail Ethan's spec asks for.
 */
import { useEffect, useState } from "react";

interface TwComponent {
  key: string;
  label: string;
  valueText: string;
  movementPct: number | null;
  subScore: number | null;
  weight: number;
  effectiveWeight: number;
  status: "live" | "dropped-stale" | "gap" | "pending";
  statusNote: string;
  asOf: string | null;
  source: string;
  sourceUrl: string;
  note: string;
  detail: { label: string; value: string }[];
}

interface TwSector {
  sector: string;
  score: number | null;
  qualifies: boolean;
  whatChanged: string;
  computedAt: string | null;
  components: TwComponent[];
}

interface TwReport {
  computedAt: string | null;
  formula: string;
  sectors: TwSector[];
}

const STATUS_STYLE: Record<TwComponent["status"], string> = {
  live: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  "dropped-stale": "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  pending: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  gap: "bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/60",
};

const STATUS_LABEL: Record<TwComponent["status"], string> = {
  live: "Counted",
  "dropped-stale": "Dropped — stale",
  pending: "Pending",
  gap: "Gap",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export default function TailwindDetail() {
  const [report, setReport] = useState<TwReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/market/tailwind")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("bad status"))))
      .then((d: TwReport) => {
        if (live) setReport(d);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="mt-6">
      <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
        Sector tailwind scores
      </h3>
      <p className="mb-3 mt-1 text-sm text-slate-600 dark:text-white/70">
        One 0–100 score per focus sector, blending the movements below. 50 means conditions are
        flat. A sector needs at least two live components to show a score — anything older than
        its source&apos;s cadence is dropped and named, never silently carried.
      </p>
      {failed && (
        <p className="text-sm text-slate-500 dark:text-white/50">Tailwind data could not be loaded.</p>
      )}
      {!report && !failed && (
        <p className="text-sm text-slate-500 dark:text-white/50">Loading tailwind scores…</p>
      )}
      {report &&
        report.sectors.map((s) => (
          <div key={s.sector} className="mb-5 rounded-xl border border-slate-200 dark:border-white/10">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3.5 py-3">
              <span className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{s.sector}</span>
              {s.score !== null ? (
                <span className="tnum font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
                  {s.score}
                </span>
              ) : (
                <span className="text-sm font-medium text-slate-500 dark:text-white/50">
                  No score — fewer than 2 live components
                </span>
              )}
              <span className="text-xs text-slate-500 dark:text-white/50">{s.whatChanged}</span>
              {s.computedAt && (
                <span className="ml-auto text-[11px] text-slate-400 dark:text-white/30">
                  Computed {new Date(s.computedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                </span>
              )}
            </div>
            {s.components.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-[#0d1f3c] text-left text-[11px] font-semibold uppercase tracking-wider text-[#f5efe2]">
                      <th className="border-b-2 border-[#b8975a] px-3 py-2">Component</th>
                      <th className="border-b-2 border-[#b8975a] px-3 py-2">Latest value</th>
                      <th className="border-b-2 border-[#b8975a] px-3 py-2">Movement</th>
                      <th className="border-b-2 border-[#b8975a] px-3 py-2">Weight</th>
                      <th className="border-b-2 border-[#b8975a] px-3 py-2">As of</th>
                      <th className="border-b-2 border-[#b8975a] px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {s.components.map((c) => (
                      <tr key={c.key} className="border-b border-slate-100 align-top last:border-0 dark:border-white/5">
                        <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">
                          <span className="font-medium">{c.label}</span>
                          {c.source && (
                            <span className="mt-0.5 block text-[11px] text-slate-400 dark:text-white/40">
                              Source:{" "}
                              {c.sourceUrl ? (
                                <a href={c.sourceUrl} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-[#8a6f3c]">
                                  {c.source}
                                </a>
                              ) : (
                                c.source
                              )}
                            </span>
                          )}
                          {c.detail.map((d) => (
                            <span key={d.label} className="block text-[11px] text-slate-400 dark:text-white/40">
                              {d.label}: {d.value}
                            </span>
                          ))}
                          {c.note && (
                            <span className="mt-0.5 block text-[11px] italic text-slate-400 dark:text-white/40">
                              {c.note}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">{c.valueText}</td>
                        <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">
                          {c.movementPct === null ? "—" : `${c.movementPct >= 0 ? "+" : ""}${c.movementPct.toFixed(1)}%`}
                          {c.subScore !== null && (
                            <span className="block text-[11px] text-slate-400 dark:text-white/40">
                              sub-score {c.subScore.toFixed(0)}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">
                          {c.weight}
                          {c.status === "live" && (
                            <span className="block text-[11px] text-slate-400 dark:text-white/40">
                              {(c.effectiveWeight * 100).toFixed(0)}% effective
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">{fmtDate(c.asOf)}</td>
                        <td className="px-3 py-2 text-sm">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLE[c.status]}`}>
                            {STATUS_LABEL[c.status]}
                          </span>
                          {c.statusNote && (
                            <span className="mt-1 block max-w-[220px] text-[11px] text-slate-400 dark:text-white/40">
                              {c.statusNote}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      {report && (
        <p className="text-[11px] leading-relaxed text-slate-400 dark:text-white/30">{report.formula}</p>
      )}
    </div>
  );
}
