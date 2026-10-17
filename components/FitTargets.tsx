"use client";

import { useEffect, useState } from "react";
import CompanyTargets from "@/components/CompanyTargets";
import { SectorLegend } from "@/components/SectorChip";
import { sectorColor, sectorIcon } from "@/lib/sector-colors";

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
  "Hospitality",
];

/* Pill filters (visual polish, Oct 17, 2026 — spec §6): shared chip
   classes; selected = navy fill + white text (gold gradient in dark
   mode). Order is never changed by selection (Ethan's rule). */
const pill = (active: boolean) =>
  `chip text-sm ${active ? "chip-active" : ""}`;

export default function FitTargets() {
  const [tab, setTab] = useState<string>("All");
  const [counts, setCounts] = useState<Record<string, number | null>>({});
  const [unscored, setUnscored] = useState<Record<string, number | null>>({});
  const [hosp, setHosp] = useState<{
    minLocations: number;
    hotelMinRevenue: number;
    licenses: number;
    groups: number;
  } | null>(null);

  useEffect(() => {
    let live = true;
    for (const s of SECTORS) {
      fetch(`/api/market/companies?sector=${encodeURIComponent(s)}&limit=1`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { fitTotal?: number; unscoredTotal?: number } | null) => {
          if (live && d) {
            setCounts((c) => ({ ...c, [s]: d.fitTotal ?? 0 }));
            setUnscored((c) => ({ ...c, [s]: d.unscoredTotal ?? 0 }));
          }
        })
        .catch(() => undefined);
    }
    fetch("/api/market/hospitality-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d: {
          settings?: { minLocations: number; hotelMinRevenue: number };
          meta?: { licenses: number; groups: number };
        } | null) => {
          if (live && d?.settings && d?.meta) {
            setHosp({
              minLocations: d.settings.minLocations,
              hotelMinRevenue: d.settings.hotelMinRevenue,
              licenses: d.meta.licenses,
              groups: d.meta.groups,
            });
          }
        }
      )
      .catch(() => undefined);
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
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: sectorColor(s) }} />
            <span className="mr-1" aria-hidden>{sectorIcon(s)}</span>
            {s} · {counts[s] === null || counts[s] === undefined ? "—" : counts[s]?.toLocaleString()}
          </button>
        ))}
      </div>
      {tab === "All" && (
        <div className="mb-3">
          <SectorLegend sectors={SECTORS} />
        </div>
      )}
      {(tab === "All" || tab === "Healthcare") && (unscored["Healthcare"] ?? 0) > 0 && (
        <p className="mb-2 text-xs text-slate-500 dark:text-white/50">
          Healthcare: {(unscored["Healthcare"] ?? 0).toLocaleString()} companies are <span className="font-semibold">unscored</span> — no revenue estimate can be derived yet, so they are held out of fits until SBA loan / ADHS licensing data scores them. A healthcare fit now requires estimated revenue of at least $1M.
        </p>
      )}
      {(tab === "All" || tab === "Hospitality") && hosp && (
        <p className="mb-2 text-xs text-slate-500 dark:text-white/50">
          Hospitality: fits are operator groups resolved from Maricopa County food-permit
          records ({hosp.groups.toLocaleString()} groups) — a fit needs at least{" "}
          {hosp.minLocations} locations, and revenue is modeled per location (low
          confidence, inputs shown on each profile). Franchise / chain / institutional
          operators are excluded by ownership.
          {hosp.licenses === 0 && (
            <>
              {" "}
              The AZ DLLC liquor-license feed is not connected yet (its public search was
              retired), so the hotel/venue arm — a liquor-licensed venue at{" "}
              ${(hosp.hotelMinRevenue / 1_000_000).toFixed(1)}M+ modeled revenue — is
              armed and activates automatically when license data lands.
            </>
          )}
        </p>
      )}
      <CompanyTargets
        key={tab}
        sectors={tab === "All" ? SECTORS : [tab]}
        fitOnly
        heading={tab === "All" ? "★ All fit targets" : `★ ${tab} — fit targets`}
      />
    </div>
  );
}
