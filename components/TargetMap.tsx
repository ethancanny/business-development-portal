"use client";

import { useEffect, useRef } from "react";
import type { Deal } from "@/lib/types";
import { fmtMoney } from "@/lib/format";
import "leaflet/dist/leaflet.css";

const STAGE_COLORS: Record<string, string> = {
  Sourcing: "#64748b",
  "Initial Contact": "#0ea5e9",
  Diligence: "#f59e0b",
  Negotiation: "#b8975a",
  Closing: "#16a34a",
  "Closed Won": "#15803d",
  Passed: "#cbd5e1",
};

export default function TargetMap({ deals }: { deals: Deal[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import("leaflet").Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const L = await import("leaflet");

      const located = deals.filter(
        (d): d is Deal & { lat: number; lng: number } =>
          typeof d.lat === "number" && typeof d.lng === "number"
      );
      if (cancelled || !containerRef.current) return;

      const map = L.map(containerRef.current, {
        scrollWheelZoom: false,
      }).setView([33.4484, -112.074], 10);
      mapRef.current = map;

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 18,
      }).addTo(map);

      const bounds: [number, number][] = [];
      for (const d of located) {
        const color = STAGE_COLORS[d.stage] ?? "#0d1f3c";
        const icon = L.divIcon({
          className: "",
          html: `<div style="
              width:18px;height:18px;border-radius:9999px;
              background:${color};
              border:3px solid #ffffff;
              box-shadow:0 1px 4px rgba(13,31,60,.45);
            "></div>`,
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });
        const marker = L.marker([d.lat, d.lng], { icon }).addTo(map);
        marker.bindPopup(`
          <div style="font-family:inherit;min-width:160px">
            <div style="font-weight:700;font-size:13px;color:#0d1f3c">${escapeHtml(d.companyName)}</div>
            <div style="font-size:11px;color:#64748b">${escapeHtml(d.city || "")} · ${escapeHtml(d.stage)}</div>
            <div style="font-size:11px;color:#334155;margin-top:2px">${escapeHtml(fmtMoney(d.dealValue))}${d.owner ? ` · ${escapeHtml(d.owner)}` : ""}</div>
            <a href="/deals/${d.id}" style="font-size:11px;color:#8a6f3c;font-weight:600">Open account →</a>
          </div>
        `);
        bounds.push([d.lat, d.lng]);
      }

      if (bounds.length > 1) {
        map.fitBounds(L.latLngBounds(bounds).pad(0.25));
      } else if (bounds.length === 1) {
        map.setView(bounds[0], 11);
      }
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locatedCount = deals.filter(
    (d) => typeof d.lat === "number" && typeof d.lng === "number"
  ).length;

  return (
    <div>
      <div
        ref={containerRef}
        className="z-0 h-72 w-full overflow-hidden rounded-xl border border-slate-200 sm:h-80 dark:border-white/10"
      />
      <p className="mt-1.5 text-xs text-slate-400 dark:text-white/40">
        {locatedCount === 0
          ? "Add a city to a deal to place it on the map."
          : `Showing ${locatedCount} of ${deals.length} targets. Drag to pan, scroll to zoom.`}
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
