"use client";

/**
 * Arizona footprint (Overview redesign §7c, Oct 25, 2026; live map
 * restored Oct 26, 2026).
 *
 * Aggregation is unchanged from the SVG widget: city clusters are
 * built from REAL stored lat/lng on the summary cards, with a
 * small fallback table for well-known Arizona cities when a card
 * names the city but carries no coords. Cities with neither are
 * listed (counted) but get no marker — a marker is never placed
 * at a guessed location. Stored city strings arrive un-normalized
 * ("Phoenix", "Phoenix, AZ", "Phoenix, AZ, AZ", "phoenix"), so
 * aggregation keys are normalized here at the read path — stored
 * data itself is never rewritten — and fragments of one city merge
 * into a single row/marker.
 *
 * The rendering is the portal's original interactive map again
 * (Leaflet + OpenStreetMap, components/overview/ArizonaLiveMap.tsx,
 * restoring the TargetMap implementation the Oct 8 Overview ran) —
 * loaded via next/dynamic with ssr:false, the same pattern that
 * page used. The inline-SVG outline is retired.
 */

import { useMemo } from "react";
import dynamic from "next/dynamic";
import type { CompanyCard } from "@/components/CompanyCards";
import type { CityPoint } from "@/components/overview/ArizonaLiveMap";

const ArizonaLiveMap = dynamic(
  () => import("@/components/overview/ArizonaLiveMap"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-72 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 sm:h-80 dark:border-white/10 dark:bg-[#0d1f3c]">
        <p className="text-sm text-slate-400 dark:text-white/40">Loading map…</p>
      </div>
    ),
  },
);

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  phoenix: { lat: 33.45, lng: -112.07 },
  tucson: { lat: 32.22, lng: -110.97 },
  mesa: { lat: 33.42, lng: -111.83 },
  gilbert: { lat: 33.35, lng: -111.79 },
  scottsdale: { lat: 33.49, lng: -111.93 },
  tempe: { lat: 33.43, lng: -111.94 },
  chandler: { lat: 33.31, lng: -111.84 },
  glendale: { lat: 33.54, lng: -112.19 },
  peoria: { lat: 33.58, lng: -112.24 },
  surprise: { lat: 33.63, lng: -112.33 },
  avondale: { lat: 33.44, lng: -112.34 },
  goodyear: { lat: 33.44, lng: -112.36 },
  buckeye: { lat: 33.37, lng: -112.58 },
  flagstaff: { lat: 35.2, lng: -111.65 },
  yuma: { lat: 32.69, lng: -114.62 },
  prescott: { lat: 34.54, lng: -112.47 },
  "lake havasu city": { lat: 34.48, lng: -114.34 },
  kingman: { lat: 35.19, lng: -114.05 },
  "sierra vista": { lat: 31.55, lng: -110.3 },
  "casa grande": { lat: 32.88, lng: -111.76 },
  maricopa: { lat: 32.88, lng: -111.96 },
  "queen creek": { lat: 33.25, lng: -111.63 },
  apache: { lat: 33.42, lng: -111.52 },
  "apache junction": { lat: 33.42, lng: -111.52 },
  sedona: { lat: 34.02, lng: -111.76 },
  payson: { lat: 34.23, lng: -111.33 },
  show: { lat: 34.25, lng: -110.03 },
  "show low": { lat: 34.25, lng: -110.03 },
  nogales: { lat: 31.34, lng: -110.93 },
  bullhead: { lat: 35.14, lng: -114.57 },
  "bullhead city": { lat: 35.14, lng: -114.57 },
};

/** Normalize a stored city string to a merge key + display name:
 * trim, collapse whitespace, drop any trailing state suffix
 * (", AZ" / " AZ" / ", Arizona", repeated), fold case. */
function normalizeCity(raw: string): { key: string; name: string } | null {
  let s = raw.trim().replace(/\s+/g, " ");
  for (;;) {
    const next = s
      .replace(/[,\s]+(az|arizona)$/i, "")
      .trim()
      .replace(/,+$/, "")
      .trim();
    if (next === s) break;
    s = next;
  }
  if (!s) return null;
  const key = s.toLowerCase();
  const name = key.replace(/\b\w/g, (ch) => ch.toUpperCase());
  return { key, name };
}

export default function ArizonaMap({ cards }: { cards: CompanyCard[] }) {
  const { cities, unmapped } = useMemo(() => {
    const byCity = new Map<
      string,
      { name: string; count: number; lat: number | null; lng: number | null }
    >();
    for (const c of cards) {
      const norm = normalizeCity(c.city ?? "");
      if (!norm) continue;
      const cur = byCity.get(norm.key) ?? {
        name: norm.name,
        count: 0,
        lat: null,
        lng: null,
      };
      cur.count += 1;
      // First stored coordinate pair for the merged city wins; fragments
      // without coords fall through to the fallback table below.
      if (
        cur.lat === null &&
        typeof c.lat === "number" &&
        typeof c.lng === "number"
      ) {
        cur.lat = c.lat;
        cur.lng = c.lng;
      }
      byCity.set(norm.key, cur);
    }
    const list = Array.from(byCity.entries())
      .map(([key, v]) => {
        const fallback = CITY_COORDS[key];
        const lat = v.lat ?? fallback?.lat ?? null;
        const lng = v.lng ?? fallback?.lng ?? null;
        return { city: v.name, count: v.count, lat, lng };
      })
      .sort((a, b) => b.count - a.count || a.city.localeCompare(b.city));
    return {
      cities: list.slice(0, 10),
      unmapped: list.filter((c) => c.lat === null || c.lng === null).length,
    };
  }, [cards]);

  if (cities.length === 0) {
    return (
      <p className="text-sm text-caption">
        No company locations recorded yet — cities will map here as locations are added.
      </p>
    );
  }

  const points: CityPoint[] = cities
    .filter((c) => c.lat !== null && c.lng !== null)
    .map((c) => ({
      city: c.city,
      count: c.count,
      lat: c.lat as number,
      lng: c.lng as number,
    }));
  // Remount the map when the plotted points change (the payload is
  // version-gated upstream; a changed payload gets a fresh map).
  const pointsKey = points.map((p) => `${p.city}:${p.count}`).join("|");

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1">
        {points.length > 0 ? (
          <ArizonaLiveMap key={pointsKey} points={points} />
        ) : (
          <p className="text-sm text-caption">
            No mapped coordinates yet — cities are counted in the list until
            locations carry coordinates.
          </p>
        )}
      </div>
      <ul className="min-w-0 shrink-0 space-y-1.5 self-center lg:w-52">
        {cities.map((c) => (
          <li key={c.city} className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium text-slate-700 dark:text-white/80">
              {c.city}, AZ
            </span>
            <span className="tnum shrink-0 font-semibold text-[#0d1f3c] dark:text-white">
              {c.count}
            </span>
          </li>
        ))}
        {unmapped > 0 && (
          <li className="pt-1 text-[11px] text-caption">
            {unmapped} {unmapped === 1 ? "city has" : "cities have"} no map coordinates — counted, not marked.
          </li>
        )}
      </ul>
    </div>
  );
}
