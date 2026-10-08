"use client";

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

type Metric = "income" | "age" | "homeval" | "growth";

const METRICS: { id: Metric; label: string; format: (v: number) => string }[] = [
  { id: "income", label: "Median Income", format: (v) => `$${Math.round(v / 1000)}k` },
  { id: "age", label: "Median Age", format: (v) => `${v.toFixed(1)} yrs` },
  { id: "homeval", label: "Median Home Value", format: (v) => `$${Math.round(v / 1000)}k` },
  { id: "growth", label: "Pop. Growth ’19–’23", format: (v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%` },
];

// Color scales (5 steps, light → dark)
const SCALES: Record<Metric, string[]> = {
  income: ["#fef9e7", "#fde9a7", "#f5c86e", "#e09a3c", "#b8741a"],
  age: ["#e0f2fe", "#a8d8f0", "#6fb3e0", "#3d8bc4", "#1a5f9e"],
  homeval: ["#f3e8ff", "#dcc4f5", "#b98ae6", "#8f5ccf", "#6b34a8"],
  growth: ["#fee2e2", "#fecaca", "#fef9e7", "#bbf7d0", "#16a34a"],
};

function breaksFor(metric: Metric, values: number[]): number[] {
  const vs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!vs.length) return [0, 1, 2, 3, 4];
  if (metric === "growth") return [-5, 0, 5, 15, 30];
  // quintiles
  const q = (p: number) => vs[Math.min(vs.length - 1, Math.floor(p * vs.length))];
  return [q(0.2), q(0.4), q(0.6), q(0.8), q(1)];
}

function colorFor(metric: Metric, v: number, breaks: number[]): string {
  const scale = SCALES[metric];
  for (let i = 0; i < breaks.length; i++) {
    if (v <= breaks[i]) return scale[i];
  }
  return scale[scale.length - 1];
}

interface TractProps {
  geoid: string;
  pop?: number;
  age?: number;
  income?: number;
  homeval?: number;
  growth?: number;
}

export default function ValleyDemographics() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);
  const geoRef = useRef<import("leaflet").GeoJSON | null>(null);
  const dataRef = useRef<any>(null);
  const [metric, setMetric] = useState<Metric>("income");
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<{ tracts: number; withGrowth: number } | null>(null);
  const [legend, setLegend] = useState<number[]>([]);
  const metricRef = useRef(metric);
  metricRef.current = metric;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      // Tract GeoJSON is split into 4 parts to keep each file small.
      const parts = await Promise.all(
        [1, 2, 3, 4].map((i) =>
          fetch(`/data/maricopa-tracts-p${i}.json`).then((r) => r.json())
        )
      );
      const geojson = {
        type: "FeatureCollection",
        features: parts.flatMap((p) => p.features),
      } as unknown as GeoJSON.FeatureCollection;
      if (cancelled || !containerRef.current) return;
      dataRef.current = geojson;

      const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(
        [33.55, -112.1],
        9
      );
      mapRef.current = map;
      // Scroll-wheel zoom while the map is in use, without trapping page
      // scroll: enable on click/focus, disable when the pointer leaves.
      map.on("focus", () => map.scrollWheelZoom.enable());
      map.on("blur", () => map.scrollWheelZoom.disable());
      containerRef.current.addEventListener("mouseleave", () => map.scrollWheelZoom.disable());
      containerRef.current.addEventListener("click", () => map.scrollWheelZoom.enable());
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      const paint = () => {
        const m = metricRef.current;
        const feats = geojson.features as unknown as { properties: TractProps }[];
        const vals = feats.map((f) => f.properties[m]).filter((v) => typeof v === "number") as number[];
        const breaks = breaksFor(m, vals);
        setLegend(breaks);
        if (geoRef.current) geoRef.current.remove();
        geoRef.current = L.geoJSON(geojson, {
          style: (feat) => {
            const p = (feat?.properties || {}) as TractProps;
            const v = p[m];
            return {
              fillColor: typeof v === "number" ? colorFor(m, v, breaks) : "#e5e7eb",
              weight: 0.5,
              opacity: 1,
              color: "#ffffff",
              fillOpacity: 0.75,
            };
          },
          onEachFeature: (feat, layer) => {
            const p = feat.properties as TractProps;
            const fmt = METRICS.find((x) => x.id === metricRef.current)!.format;
            const rows = [
              ["Population", p.pop?.toLocaleString() ?? "—"],
              ["Median age", p.age ? `${p.age.toFixed(1)} yrs` : "—"],
              ["Median income", p.income ? `$${p.income.toLocaleString()}` : "—"],
              ["Median home value", p.homeval ? `$${p.homeval.toLocaleString()}` : "—"],
              ["Pop. growth ’19–’23", p.growth !== undefined ? `${p.growth > 0 ? "+" : ""}${p.growth.toFixed(1)}%` : "—"],
            ]
              .map(([k, v]) => `<div style="display:flex;justify-content:space-between;gap:12px;font-size:11px"><span style="color:#64748b">${k}</span><b style="color:#0d1f3c">${v}</b></div>`)
              .join("");
            layer.bindPopup(
              `<div style="font-family:inherit;min-width:180px"><div style="font-weight:700;font-size:12px;color:#0d1f3c;margin-bottom:4px">Tract ${p.geoid.slice(5)}</div>${rows}<div style="margin-top:4px;font-size:10px;color:#94a3b8">Showing: ${fmt(typeof p[metricRef.current] === "number" ? (p[metricRef.current] as number) : NaN)}</div></div>`
            );
          },
        }).addTo(map);
        (geoRef.current as any)._breaks = breaks;
        setStats({
          tracts: feats.length,
          withGrowth: feats.filter((f) => typeof f.properties.growth === "number").length,
        });
      };

      paint();
      setLoading(false);
      // repaint on metric change
      const iv = setInterval(() => {
        if ((geoRef.current as any)?._metric !== metricRef.current) {
          (geoRef.current as any)._metric = metricRef.current;
          paint();
        }
      }, 200);
      (geoRef.current as any)._metric = metricRef.current;

      return () => clearInterval(iv);
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repaint when metric changes (via ref polling above)
  useEffect(() => {
    metricRef.current = metric;
  }, [metric ]);

  const tabCls = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium ${active ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]" : "text-slate-600 hover:bg-slate-100 dark:text-white/60 dark:hover:bg-white/5"}`;

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-2">
        {METRICS.map((m) => (
          <button key={m.id} onClick={() => setMetric(m.id)} className={tabCls(metric === m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {/* Legend */}
      {legend.length === 5 && (
        <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/50">
            {METRICS.find((m) => m.id === metric)?.label}
          </span>
          {SCALES[metric].map((color, i) => {
            const fmt = METRICS.find((m) => m.id === metric)!.format;
            const label =
              i === 0
                ? `≤ ${fmt(legend[0])}`
                : i === 4
                  ? `> ${fmt(legend[3])}`
                  : `${fmt(legend[i - 1])} – ${fmt(legend[i])}`;
            return (
              <span key={i} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-white/70">
                <span
                  className="inline-block h-3.5 w-5 rounded-sm border border-black/10"
                  style={{ backgroundColor: color }}
                />
                {label}
              </span>
            );
          })}
          <span className="flex items-center gap-1.5 text-xs text-slate-400 dark:text-white/40">
            <span className="inline-block h-3.5 w-5 rounded-sm border border-black/10 bg-[#e5e7eb]" />
            No data
          </span>
        </div>
      )}
      <div className="relative">
        <div
          ref={containerRef}
          className="z-0 h-[420px] w-full overflow-hidden rounded-xl border border-slate-200 sm:h-[520px] dark:border-white/10"
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-white/60 dark:bg-[#0d1f3c]/60">
            <p className="text-sm text-slate-500 dark:text-white/60">Loading tract map…</p>
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xs text-slate-400 dark:text-white/40">
        {stats
          ? `${stats.tracts.toLocaleString()} Maricopa County census tracts · ACS 5-year 2023${metric === "growth" ? ` · growth for ${stats.withGrowth} tracts with stable boundaries` : ""} · Drag to pan — click the map, then scroll to zoom. Click a tract for details.`
          : "Source: US Census Bureau, American Community Survey 5-year."}
      </p>
    </div>
  );
}
