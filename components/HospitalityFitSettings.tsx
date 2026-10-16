"use client";

import { useEffect, useState } from "react";

/**
 * Hospitality fit-rule settings (hospitality build §2, Oct 15, 2026).
 * The two thresholds are portal settings, not code constants: saving
 * re-judges every Hospitality company row immediately. The card also
 * carries the spine's source list + data date so the state of the
 * hospitality data is visible next to its rules.
 */

interface Settings {
  minLocations: number;
  hotelMinRevenue: number;
}

interface Meta {
  permits: number;
  licenses: number;
  groups: number;
  fits: number;
  lastIngestAt: string | null;
  sources: { name: string; status: string }[];
}

const fmtDate = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "America/Phoenix",
      })
    : "never";

export default function HospitalityFitSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [minLocations, setMinLocations] = useState("");
  const [hotelMinRevenue, setHotelMinRevenue] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/market/hospitality-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: Settings; meta?: Meta } | null) => {
        if (!live || !d?.settings) return;
        setSettings(d.settings);
        setMeta(d.meta ?? null);
        setMinLocations(String(d.settings.minLocations));
        setHotelMinRevenue(String(d.settings.hotelMinRevenue));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/market/hospitality-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          minLocations: Number(minLocations),
          hotelMinRevenue: Number(hotelMinRevenue),
        }),
      });
      const d = (await res.json().catch(() => null)) as
        | { settings?: Settings; fitTotal?: number; error?: string }
        | null;
      if (!res.ok || !d?.settings) {
        setError(d?.error ?? "Save failed.");
        return;
      }
      setSettings(d.settings);
      setMeta((m) => (m ? { ...m, fits: d.fitTotal ?? m.fits } : m));
      setNote(
        `Saved — fits re-judged under the new thresholds: ${(
          d.fitTotal ?? 0
        ).toLocaleString()} hospitality fit targets now.`
      );
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#b8975a] dark:border-white/15 dark:bg-white/5 dark:text-white/90";

  return (
    <div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-white/80">
            Minimum active locations
          </span>
          <input
            type="number"
            min={1}
            max={50}
            value={minLocations}
            onChange={(e) => setMinLocations(e.target.value)}
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-slate-400 dark:text-white/40">
            An operator group is a fit at or above this many locations.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-white/80">
            Hotel / venue revenue floor ($)
          </span>
          <input
            type="number"
            min={100000}
            step={100000}
            value={hotelMinRevenue}
            onChange={(e) => setHotelMinRevenue(e.target.value)}
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-slate-400 dark:text-white/40">
            A liquor-licensed hotel or venue is a fit at or above this
            modeled revenue — active once DLLC license data lands.
          </span>
        </label>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={busy || settings === null}
          className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c]"
        >
          {busy ? "Saving + re-judging…" : "Save fit rules"}
        </button>
        {note && <p className="text-sm text-emerald-600 dark:text-emerald-300">{note}</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
      </div>
      {meta && (
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/10">
          <p className="text-xs text-slate-500 dark:text-white/50">
            {meta.groups.toLocaleString()} operator groups · {meta.fits.toLocaleString()} fits ·{" "}
            {meta.permits.toLocaleString()} permits · {meta.licenses.toLocaleString()} liquor licenses ·{" "}
            data as of {fmtDate(meta.lastIngestAt)}
          </p>
          <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-white/50">
            {meta.sources.map((s) => (
              <li key={s.name}>
                <span className="font-medium text-slate-600 dark:text-white/70">{s.name}</span> — {s.status}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
            Revenue on hospitality targets is modeled (locations × per-location range by
            concept, cross-checked against CBP size bands and SBA loan records) and is
            always labeled low confidence. Ownership exclusions (franchise / chain /
            institutional / subsidiary) come from a conservative brand-name match;
            unknown ownership is never excluded.
          </p>
        </div>
      )}
    </div>
  );
}
