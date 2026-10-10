"use client";

import { useEffect, useState } from "react";
import CompanyTargets from "@/components/CompanyTargets";

/** Consolidated ★ Fit Targets (Ethan, Oct 10, 2026): every company
 * passing Canny's fit rules in ONE table. The industry switcher
 * filters the same consolidated table (All = every focus industry,
 * with an Industry column); expanding a row converts the fit into
 * the acquisition pipeline. */
const SECTORS = [
  "Aerospace & Defense",
  "Healthcare",
  "Advanced Manufacturing",
  "Specialty Trades & Construction",
];

const pill = (active: boolean) =>
  active
    ? "rounded-full bg-[#d7e1f0] px-3.5 py-1.5 text-sm font-semibold text-[#0d1f3c] dark:bg-[#b8975a]/30 dark:text-[#e8cf9a]"
    : "rounded-full border border-slate-300 px-3.5 py-1.5 text-sm text-slate-600 hover:border-[#b8975a] dark:border-white/15 dark:text-white/60";

export default function FitTargets() {
  const [tab, setTab] = useState<string>("All");
  const [counts, setCounts] = useState<Record<string, number | null>>({});

  useEffect(() => {
    let live = true;
    for (const s of SECTORS) {
      fetch(`/api/market/companies?sector=${encodeURIComponent(s)}&limit=1`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { fitTotal?: number } | null) => {
          if (live && d) setCounts((c) => ({ ...c, [s]: d.fitTotal ?? 0 }));
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
  }, []);

  const totalFits = SECTORS.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        <button onClick={() => setTab("All")} className={pill(tab === "All")}>
          All Industries · {totalFits ? totalFits.toLocaleString() : "—"}
        </button>
        {SECTORS.map((s) => (
          <button key={s} onClick={() => setTab(s)} className={pill(tab === s)}>
            {s} · {counts[s] === null || counts[s] === undefined ? "—" : counts[s]?.toLocaleString()}
          </button>
        ))}
      </div>
      <CompanyTargets
        key={tab}
        sectors={tab === "All" ? SECTORS : [tab]}
        fitOnly
        heading={tab === "All" ? "★ All fit targets" : `★ ${tab} — fit targets`}
      />
    </div>
  );
}
