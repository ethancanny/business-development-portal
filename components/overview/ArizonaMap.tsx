"use client";

/**
 * Arizona footprint (Overview redesign §7c, Oct 25, 2026).
 *
 * Stylized inline-SVG Arizona outline with city markers sized by
 * deal/company count. Positions project from REAL stored lat/lng
 * on the summary cards; a small fallback table covers well-known
 * Arizona cities when a card names the city but carries no coords.
 * Cities with neither are listed (counted) but get no marker —
 * a marker is never placed at a guessed location.
 *
 * Stored city strings arrive un-normalized ("Phoenix", "Phoenix, AZ",
 * "Phoenix, AZ, AZ", "phoenix"), so aggregation keys are normalized
 * here at the read path — stored data itself is never rewritten —
 * and fragments of one city merge into a single row/marker.
 */

import { useMemo } from "react";
import type { CompanyCard } from "@/components/CompanyCards";

/** lng/lat bounds for Arizona. */
const BOUNDS = { lngMin: -114.85, lngMax: -108.95, latMin: 31.25, latMax: 37.05 };

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
  "maricopa": { lat: 32.88, lng: -111.96 },
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

/** The outline path below is drawn inside this frame of the 100×116
 * viewBox (its own bounding box: x 6–97, y 3–86). Lat/lng must project
 * into the SAME frame — projecting onto the full viewBox instead put
 * everything south of ~lat 32.75 below the drawn southern border
 * (Tucson rendered outside the state entirely). */
const FRAME = { xMin: 6, xMax: 97, yMin: 3, yMax: 86 };

function project(lat: number, lng: number): { x: number; y: number } {
  const x =
    FRAME.xMin +
    ((lng - BOUNDS.lngMin) / (BOUNDS.lngMax - BOUNDS.lngMin)) *
      (FRAME.xMax - FRAME.xMin);
  const y =
    FRAME.yMin +
    (1 - (lat - BOUNDS.latMin) / (BOUNDS.latMax - BOUNDS.latMin)) *
      (FRAME.yMax - FRAME.yMin);
  return { x, y };
}

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

/** Simplified Arizona boundary (stylized, not a survey outline):
 * Colorado River slant on the west, the southern-border step near
 * the southeast corner. viewBox 0 0 100 116. */
const AZ_PATH =
  "M 13,3 L 97,3 L 97,66 L 82,66 L 82,72 L 86,78 L 84,86 L 30,86 L 10,84 L 6,55 L 9,30 Z";

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
  const max = Math.max(1, ...cities.map((c) => c.count));

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <div className="mx-auto w-full max-w-[240px] shrink-0 sm:mx-0">
        <svg viewBox="0 0 100 116" className="w-full" role="img" aria-label="Map of Arizona with company locations">
          <path
            d={AZ_PATH}
            className="fill-[#0d1f3c]/[0.06] stroke-[#0d1f3c]/30 dark:fill-white/[0.05] dark:stroke-white/25"
            strokeWidth="1"
            strokeLinejoin="round"
          />
          {cities
            .filter((c) => c.lat !== null && c.lng !== null)
            .map((c) => {
              const { x, y } = project(c.lat as number, c.lng as number);
              const r = 2.2 + 3.4 * Math.sqrt(c.count / max);
              return (
                <g key={c.city}>
                  <circle cx={x} cy={y} r={r} fill="#b8975a" fillOpacity="0.85" stroke="#0d1f3c" strokeOpacity="0.25" strokeWidth="0.4">
                    <title>{`${c.city}: ${c.count} ${c.count === 1 ? "company" : "companies"}`}</title>
                  </circle>
                  <text x={x} y={y + 1.1} textAnchor="middle" fontSize="3.2" fontWeight="700" fill="#0d1f3c">
                    {c.count}
                  </text>
                </g>
              );
            })}
        </svg>
      </div>
      <ul className="min-w-0 flex-1 space-y-1.5 self-center">
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
