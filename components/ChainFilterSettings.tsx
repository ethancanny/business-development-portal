"use client";

import { useEffect, useState } from "react";

/**
 * Chain/franchise filter settings (Ethan, Oct 16, 2026). The exclusion
 * list and the two location thresholds are portal settings, not code:
 * this card edits them (add/remove brand names, thresholds) and can
 * re-run detection over every existing company record. Flagged
 * records are never deleted — they collect in the Filtered Out view
 * on Fit Targets, where each carries its reason and a permanent
 * "Not a chain" override.
 */

interface Settings {
  brands: string[];
  multiStateLocations: number;
  anywhereLocations: number;
}

interface Stats {
  chain: number;
  suspect: number;
  exempt: number;
  chainFits: number;
}

export default function ChainFilterSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [brands, setBrands] = useState<string[]>([]);
  const [newBrand, setNewBrand] = useState("");
  const [multiState, setMultiState] = useState("");
  const [anywhere, setAnywhere] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [runNote, setRunNote] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function apply(d: { settings?: Settings; stats?: Stats } | null) {
    if (!d?.settings) return;
    setSettings(d.settings);
    setStats(d.stats ?? null);
    setBrands(d.settings.brands);
    setMultiState(String(d.settings.multiStateLocations));
    setAnywhere(String(d.settings.anywhereLocations));
  }

  useEffect(() => {
    let live = true;
    fetch("/api/market/chain-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: Settings; stats?: Stats } | null) => {
        if (live) apply(d);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/market/chain-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brands,
          multiStateLocations: Number(multiState),
          anywhereLocations: Number(anywhere),
        }),
      });
      const d = (await res.json().catch(() => null)) as
        | { settings?: Settings; stats?: Stats; error?: string }
        | null;
      if (!res.ok || !d?.settings) {
        setError(d?.error ?? "Save failed.");
        return;
      }
      apply(d);
      setNote(
        "Saved. New records are judged against the updated list immediately; use “Re-run detection” to re-judge existing records."
      );
    } finally {
      setBusy(false);
    }
  }

  async function rerun() {
    setRunning(true);
    setError(null);
    setRunNote(null);
    try {
      let offset = 0;
      let processed = 0;
      let flagged = 0;
      let suspected = 0;
      for (let call = 0; call < 60; call++) {
        const res = await fetch("/api/market/chain-detect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ offset }),
        });
        const d = (await res.json().catch(() => null)) as
          | {
              complete?: boolean;
              nextOffset?: number;
              processed?: number;
              flagged?: number;
              suspected?: number;
              error?: string;
            }
          | null;
        if (!res.ok || !d) {
          setError(d?.error ?? "Detection run failed.");
          return;
        }
        processed += d.processed ?? 0;
        flagged += d.flagged ?? 0;
        suspected += d.suspected ?? 0;
        if (d.complete || d.nextOffset === -1 || d.nextOffset === undefined) break;
        offset = d.nextOffset;
        setRunNote(`Re-judging records… ${processed.toLocaleString()} done so far.`);
      }
      const s = await fetch("/api/market/chain-settings")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      apply(s);
      setRunNote(
        `Detection re-run complete: ${processed.toLocaleString()} records judged — ${flagged.toLocaleString()} newly flagged as chains, ${suspected.toLocaleString()} newly tagged “Possible franchise”.`
      );
    } finally {
      setRunning(false);
    }
  }

  function addBrand() {
    const name = newBrand.trim();
    if (!name) return;
    if (brands.some((b) => b.toLowerCase() === name.toLowerCase())) {
      setNewBrand("");
      return;
    }
    setBrands((prev) => [...prev, name].sort((a, b) => a.localeCompare(b)));
    setNewBrand("");
  }

  const inputCls =
    "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#b8975a] dark:border-white/15 dark:bg-white/5 dark:text-white/90";

  return (
    <div>
      {stats && (
        <p className="mb-4 text-sm text-slate-600 dark:text-white/70">
          Currently <strong>{stats.chain.toLocaleString()}</strong> companies filtered out as
          chains/franchises ({stats.chainFits.toLocaleString()} of them would otherwise be fits),{" "}
          <strong>{stats.suspect.toLocaleString()}</strong> tagged “Possible franchise”, and{" "}
          <strong>{stats.exempt.toLocaleString()}</strong> protected by a “Not a chain” override.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-white/80">
            Multi-state location threshold
          </span>
          <input
            type="number"
            min={2}
            max={100}
            value={multiState}
            onChange={(e) => setMultiState(e.target.value)}
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-slate-400 dark:text-white/40">
            The same business name at this many locations across 2+ states counts as a chain.
          </span>
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-white/80">
            Anywhere location threshold
          </span>
          <input
            type="number"
            min={2}
            max={200}
            value={anywhere}
            onChange={(e) => setAnywhere(e.target.value)}
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-slate-400 dark:text-white/40">
            This many locations under one name anywhere counts as a chain. Arizona-only
            operators below it are never flagged on location count.
          </span>
        </label>
      </div>

      <div className="mt-5">
        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-white/80">
          Exclusion list — national chains &amp; franchise brands ({brands.length})
        </span>
        <div className="flex gap-2">
          <input
            value={newBrand}
            onChange={(e) => setNewBrand(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addBrand();
              }
            }}
            placeholder="Add a brand, e.g. McDonald's"
            className={inputCls}
          />
          <button
            onClick={addBrand}
            disabled={!newBrand.trim()}
            className="shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 disabled:opacity-50 dark:border-white/20 dark:text-white/70"
          >
            Add
          </button>
        </div>
        <div className="mt-2 flex max-h-44 flex-wrap gap-1.5 overflow-auto rounded-lg border border-slate-100 p-2 dark:border-white/10">
          {brands.map((b) => (
            <span
              key={b}
              className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-white/10 dark:text-white/80"
            >
              {b}
              <button
                aria-label={`Remove ${b}`}
                onClick={() => setBrands((prev) => prev.filter((x) => x !== b))}
                className="font-bold text-slate-400 hover:text-red-600 dark:text-white/40 dark:hover:text-red-300"
              >
                ×
              </button>
            </span>
          ))}
          {brands.length === 0 && (
            <span className="text-xs text-slate-400 dark:text-white/40">List is empty.</span>
          )}
        </div>
        <span className="mt-1 block text-xs text-slate-400 dark:text-white/40">
          A company whose name or website domain matches a brand here is filtered out.
          Removing a brand takes effect on the next detection run.
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={save}
          disabled={busy || settings === null}
          className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c]"
        >
          {busy ? "Saving…" : "Save chain filter"}
        </button>
        <button
          onClick={rerun}
          disabled={running || settings === null}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 disabled:opacity-50 dark:border-white/20 dark:text-white/70"
        >
          {running ? "Re-running detection…" : "Re-run detection on all records"}
        </button>
        {note && <p className="text-sm text-emerald-600 dark:text-emerald-300">{note}</p>}
        {error && <p className="text-sm text-red-600 dark:text-red-300">{error}</p>}
      </div>
      {runNote && (
        <p className="mt-2 text-sm text-slate-600 dark:text-white/70">{runNote}</p>
      )}
      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400 dark:border-white/10 dark:text-white/40">
        Detection also fires on franchise language in a record (“franchise opportunities”,
        “own a franchise”, “franchise disclosure document”, “FDD”), on a recorded parent or
        ownership stamp marking the company as a franchise/chain/subsidiary/institutional
        unit, and on location counts above the thresholds. A single weak signal (a look-alike
        name, a bare “franchise” mention, a count one under a threshold) never excludes — it
        tags the record “Possible franchise” and it stays in Fits. Flagged records are kept in
        the Filtered Out view on Fit Targets with their reason; “Not a chain” there restores a
        record permanently.
      </p>
    </div>
  );
}
