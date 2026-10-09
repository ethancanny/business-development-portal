"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import type { MiMultiple } from "@/lib/types";

/** Market multiples table + manual-entry form (quarterly IB reports).
 * Extracted from the Market Intel page (Oct 9, 2026) to keep that file
 * pushable. Row highlighting is painted from state via inline styles. */
export default function MultiplesPanel({ multiples, onAdded, dark }: { multiples: MiMultiple[]; onAdded: () => void; dark: boolean }) {
  const [form, setForm] = useState({ sourceReport: "", period: "", industry: "", sizeBand: "", evEbitdaLow: "", evEbitdaHigh: "", evEbitdaMedian: "", evRevenueMedian: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [selRow, setSelRow] = useState("");
  const toggleRow = (key: string) => setSelRow((s) => (s === key ? "" : key));
  // Row highlighting is painted from React state with inline styles (not
  // utility classes) so hover/select always render. (Ethan, Oct 9, 2026.)
  const [hovRow, setHovRow] = useState("");
  const rowStyle = (key: string) => ({
    backgroundColor:
      selRow === key
        ? dark
          ? "rgba(184,151,90,0.28)"
          : "rgba(13,31,60,0.14)"
        : hovRow === key
          ? dark
            ? "rgba(255,255,255,0.08)"
            : "rgba(13,31,60,0.055)"
          : undefined,
    transition: "background-color 200ms ease",
  });
  const rowProps = (key: string) => ({
    onMouseEnter: () => setHovRow(key),
    onMouseLeave: () => setHovRow((h: string) => (h === key ? "" : h)),
    onClick: () => toggleRow(key),
    style: rowStyle(key),
    className: `border-b border-slate-100 dark:border-white/5 cursor-pointer ${
      selRow === key
        ? "bg-slate-300 dark:bg-white/20"
        : hovRow === key
          ? "bg-slate-200 dark:bg-white/10"
          : ""
    }`,
  });
  const set = (k: string) => (e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const input = "rounded-lg border border-slate-300 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-white/5 dark:text-white";

  const save = async () => {
    if (!form.sourceReport || !form.period) return;
    setSaving(true);
    await fetch("/api/market/multiples", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        evEbitdaLow: form.evEbitdaLow ? Number(form.evEbitdaLow) : null,
        evEbitdaHigh: form.evEbitdaHigh ? Number(form.evEbitdaHigh) : null,
        evEbitdaMedian: form.evEbitdaMedian ? Number(form.evEbitdaMedian) : null,
        evRevenueMedian: form.evRevenueMedian ? Number(form.evRevenueMedian) : null,
      }),
    });
    setForm({ sourceReport: "", period: "", industry: "", sizeBand: "", evEbitdaLow: "", evEbitdaHigh: "", evEbitdaMedian: "", evRevenueMedian: "", notes: "" });
    setSaving(false);
    onAdded();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-[#132847]/40">
        <h3 className="mb-3 text-sm font-semibold text-[#0d1f3c] dark:text-white">Log multiples</h3>
        <p className="mb-3 text-xs text-slate-500 dark:text-white/40">From quarterly IB reports (PitchBook, BDO, Houlihan Lokey…). Enter once per report and it stays on the charts forever.</p>
        <div className="grid grid-cols-2 gap-2">
          <input className={input} placeholder="Report (e.g. PitchBook Q3)" value={form.sourceReport} onChange={set("sourceReport")} />
          <input className={input} placeholder="Period (e.g. 2026-Q3)" value={form.period} onChange={set("period")} />
          <input className={input} placeholder="Industry" value={form.industry} onChange={set("industry")} />
          <input className={input} placeholder="Size band" value={form.sizeBand} onChange={set("sizeBand")} />
          <input className={input} placeholder="EV/EBITDA low" value={form.evEbitdaLow} onChange={set("evEbitdaLow")} />
          <input className={input} placeholder="EV/EBITDA high" value={form.evEbitdaHigh} onChange={set("evEbitdaHigh")} />
          <input className={input} placeholder="EV/EBITDA median" value={form.evEbitdaMedian} onChange={set("evEbitdaMedian")} />
          <input className={input} placeholder="EV/Rev median" value={form.evRevenueMedian} onChange={set("evRevenueMedian")} />
          <input className={`${input} col-span-2`} placeholder="Notes" value={form.notes} onChange={set("notes")} />
        </div>
        <button onClick={save} disabled={saving || !form.sourceReport || !form.period} className="mt-3 rounded-lg bg-[#0d1f3c] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-40 dark:bg-[#b8975a] dark:text-[#0d1f3c]">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
      <div className="lg:col-span-2 max-h-[360px] overflow-auto rounded-xl border border-slate-200 dark:border-white/10">
        <table className="w-full border-collapse bg-white dark:bg-[#132847]/40">
          <thead><tr className="border-b border-slate-200 dark:border-white/10">
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50 sticky top-0 bg-white dark:bg-[#132847]">Report</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50 sticky top-0 bg-white dark:bg-[#132847]">Period</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50 sticky top-0 bg-white dark:bg-[#132847]">Industry</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50 sticky top-0 bg-white dark:bg-[#132847]">EV/EBITDA</th>
            <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50 sticky top-0 bg-white dark:bg-[#132847]">EV/Rev</th>
          </tr></thead>
          <tbody>
            {multiples.map((m) => (
              <tr key={m.id} {...rowProps(`mult:${m.id}`)}>
                <td className="px-3 py-2 text-sm font-medium text-slate-700 dark:text-white/80">{m.sourceReport}{m.sizeBand && <span className="block text-xs text-slate-400">{m.sizeBand}</span>}</td>
                <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">{m.period}</td>
                <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">{m.industry || "—"}</td>
                <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">
                  {m.evEbitdaMedian ? `${m.evEbitdaMedian}x` : m.evEbitdaLow && m.evEbitdaHigh ? `${m.evEbitdaLow}–${m.evEbitdaHigh}x` : "—"}
                </td>
                <td className="px-3 py-2 text-sm text-slate-700 dark:text-white/80">{m.evRevenueMedian ? `${m.evRevenueMedian}x` : "—"}</td>
              </tr>
            ))}
            {multiples.length === 0 && <tr><td className="px-3 py-2 text-sm text-slate-500 dark:text-white/40" colSpan={5}>No multiples logged yet — add them from quarterly reports as they publish.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
