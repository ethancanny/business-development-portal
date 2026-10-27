"use client";

/**
 * Arizona live map (restored Oct 26, 2026, Ethan: "an actual live
 * map again that we had before").
 *
 * The interactive map the portal ran on the original Overview
 * (Oct 8, 2026, commit 287e2cd2) was components/TargetMap.tsx —
 * Leaflet + OpenStreetMap tiles, dynamically imported inside the
 * effect, divIcon markers, fitBounds — retired when the Phase 1
 * Overview replaced the page. This restores that exact
 * implementation pattern, fed with the footprint widget's city
 * clusters instead of per-deal points: one gold count badge per
 * city at its real coordinates (stored lat/lng, else the Arizona
 * city fallback table in ArizonaMap.tsx — never a guessed spot).
 */

import { useEffect, useRef } from "react";
import "leaflet/dist/leaflet.css";

export interface CityPoint {
  city: string;
  count: number;
  lat: number;
  lng: number;
}

export default function ArizonaLiveMap({ points }: { points: CityPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        scrollWheelZoom: false,
      }).setView([34.05, -111.95], 7);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      const max = Math.max(1, ...points.map((p) => p.count));
      const bounds: [number, number][] = [];
      for (const p of points) {
        const d = Math.round(24 + 12 * Math.sqrt(p.count / max));
        const icon = L.divIcon({
          className: "",
          html: `<div style="
              width:${d}px;height:${d}px;border-radius:9999px;
              background:#b8975a;
              border:2px solid #ffffff;
              box-shadow:0 1px 4px rgba(13,31,60,.45);
              display:flex;align-items:center;justify-content:center;
              font-size:11px;font-weight:700;color:#0d1f3c;
            ">${p.count}</div>`,
          iconSize: [d, d],
          iconAnchor: [d / 2, d / 2],
        });
        const marker = L.marker([p.lat, p.lng], { icon }).addTo(map);
        marker.bindPopup(`
          <div style="font-family:inherit;min-width:140px">
            <div style="font-weight:700;font-size:13px;color:#0d1f3c">${escapeHtml(p.city)}, AZ</div>
            <div style="font-size:11px;color:#64748b">${p.count} ${p.count === 1 ? "company" : "companies"}</div>
          </div>
        `);
        bounds.push([p.lat, p.lng]);
      }

      if (bounds.length > 1) {
        map.fitBounds(L.latLngBounds(bounds).pad(0.25));
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 9);
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Points arrive as a fresh array per payload; the parent keys
    // this component by the points signature, so a data change
    // remounts instead of re-running the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <div
        ref={containerRef}
        className="z-0 h-72 w-full overflow-hidden rounded-xl border border-slate-200 sm:h-80 dark:border-white/10"
        role="img"
        aria-label="Live map of Arizona with company counts by city"
      />
      <p className="mt-1.5 text-xs text-slate-400 dark:text-white/40">
        Drag to pan, use the controls to zoom. Tap a marker for its count.
      </p>
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
