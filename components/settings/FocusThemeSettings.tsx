"use client";

import { useEffect, useState } from "react";
import FocusConfirmDialog from "@/components/focus/FocusConfirmDialog";
import { useFocus } from "@/components/focus/FocusProvider";
import { useTheme } from "@/components/ThemeProvider";
import type {
  FocusImpact,
  FocusMode,
  FocusSettings,
  NamedTheme,
  NaicsEntry,
  TaxonomySegment,
} from "@/lib/platform/focus";

/**
 * Settings → Focus & Theme (Ethan, Oct 26, 2026).
 * - Focus (workspace-wide, admin-only): "ad" (Aerospace & Defense)
 *   vs "all" (All sectors). Every change goes through
 *   FocusConfirmDialog with the live impact payload from
 *   GET /api/platform/settings/focus; the PUT response replaces
 *   local state (no polling, no extra read paths).
 * - Theme (per user): "desert" (Aerospace Desert) vs "classic",
 *   bound to ThemeProvider — instant apply, follows the user
 *   across devices.
 * - A&D settings: the sub-segment taxonomy, the fit-sourcing NAICS
 *   list, and the investor-matching boost share one save
 *   (PUT { taxonomy, naics, matchingBoost }).
 * FocusProvider is not currently an ancestor of the Settings page
 * (checked app/layout.tsx + app/settings/page.tsx), so focus writes
 * rely on the PUT response for local state; useFocus().refresh() is
 * still called after a successful switch so the context stays in
 * sync wherever a provider IS mounted (it is a no-op otherwise).
 */

interface FocusResponse {
  settings: FocusSettings;
  impact: FocusImpact;
  role: string;
}

interface FocusPutResponse {
  settings?: FocusSettings;
  impact?: FocusImpact;
  error?: string;
}

/** Spec §2 default taxonomy — Reset to defaults restores these 11. */
const TAXONOMY_DEFAULTS: TaxonomySegment[] = [
  { slug: "precision-machining", label: "Precision machining & machine shops" },
  { slug: "castings-forgings", label: "Castings & forgings" },
  { slug: "aerostructures-composites", label: "Aerostructures & composites" },
  { slug: "avionics-electronics", label: "Avionics & electronics" },
  {
    slug: "special-processes",
    label: "Special processes (heat treat, plating, coatings, NDT)",
  },
  { slug: "testing-certification", label: "Testing & certification services" },
  { slug: "mro", label: "MRO (maintenance, repair & overhaul)" },
  { slug: "tooling-fixtures", label: "Tooling & fixtures" },
  { slug: "space-systems", label: "Space systems & components" },
  { slug: "uas-drones", label: "UAS & drones" },
  { slug: "defense-electronics", label: "Defense electronics" },
];

function slugify(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function cloneSegments(list: TaxonomySegment[]): TaxonomySegment[] {
  return list.map((s) => ({ ...s }));
}

function cloneNaics(list: NaicsEntry[]): NaicsEntry[] {
  return list.map((n) => ({ ...n }));
}

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#b8975a] disabled:opacity-50 dark:border-white/15 dark:bg-white/5 dark:text-white/90";

const removeBtnCls =
  "shrink-0 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 disabled:opacity-50 dark:border-white/20 dark:text-white/70";

function optionCardCls(selected: boolean): string {
  return `w-full rounded-xl border p-4 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${
    selected
      ? "border-[#b8975a] bg-[#f7f1e3] shadow-sm dark:border-[#b8975a] dark:bg-white/10"
      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-[#f0f4fa] dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10"
  }`;
}

export default function FocusThemeSettings() {
  const { namedTheme, setNamedTheme } = useTheme();
  const focusCtx = useFocus();

  const [settings, setSettings] = useState<FocusSettings | null>(null);
  const [impact, setImpact] = useState<FocusImpact | null>(null);
  const [role, setRole] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<FocusMode>("ad");
  const [focusBusy, setFocusBusy] = useState(false);
  const [focusNote, setFocusNote] = useState<string | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);

  // A&D settings drafts (taxonomy + NAICS + matching boost, one save).
  const [taxonomy, setTaxonomy] = useState<TaxonomySegment[]>([]);
  const [naics, setNaics] = useState<NaicsEntry[]>([]);
  const [savedNaics, setSavedNaics] = useState<NaicsEntry[]>([]);
  const [boost, setBoost] = useState("10");
  const [newSegmentLabel, setNewSegmentLabel] = useState("");
  const [newNaicsCode, setNewNaicsCode] = useState("");
  const [newNaicsTitle, setNewNaicsTitle] = useState("");
  const [adBusy, setAdBusy] = useState(false);
  const [adNote, setAdNote] = useState<string | null>(null);
  const [adError, setAdError] = useState<string | null>(null);

  const isAdmin = role === "admin";

  /** Full apply — initial load and the A&D-settings save. */
  function applyAll(d: FocusResponse) {
    setSettings(d.settings);
    setImpact(d.impact);
    if (typeof d.role === "string") setRole(d.role);
    setTaxonomy(cloneSegments(d.settings.taxonomy));
    setNaics(cloneNaics(d.settings.naics));
    setSavedNaics(cloneNaics(d.settings.naics));
    setBoost(String(d.settings.matchingBoost));
  }

  /** Focus-only apply — keeps any unsaved A&D drafts intact. */
  function applyFocusOnly(d: FocusPutResponse) {
    if (!d.settings) return;
    setSettings(d.settings);
    if (d.impact) setImpact(d.impact);
    setSavedNaics(cloneNaics(d.settings.naics));
  }

  useEffect(() => {
    let live = true;
    fetch("/api/platform/settings/focus")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FocusResponse | null) => {
        if (!live) return;
        if (!d?.settings) {
          setLoadError("Focus settings could not be loaded.");
          return;
        }
        applyAll(d);
      })
      .catch(() => {
        if (live) setLoadError("Focus settings could not be loaded.");
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function requestFocusChange(target: FocusMode) {
    setFocusNote(null);
    setFocusError(null);
    if (!settings || target === settings.focus) return;
    if (!isAdmin) {
      setFocusError("Workspace focus is set by an admin.");
      return;
    }
    setDialogTarget(target);
    setDialogOpen(true);
  }

  async function confirmFocusChange() {
    setFocusBusy(true);
    setFocusError(null);
    setFocusNote(null);
    try {
      const res = await fetch("/api/platform/settings/focus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ focus: dialogTarget }),
      });
      const d = (await res.json().catch(() => null)) as FocusPutResponse | null;
      if (!res.ok || !d?.settings) {
        setDialogOpen(false);
        setFocusError(
          res.status === 403
            ? "Admins only."
            : (d?.error ?? "Focus change failed.")
        );
        return;
      }
      applyFocusOnly(d);
      setDialogOpen(false);
      setFocusNote(
        dialogTarget === "ad"
          ? "Focus switched to Aerospace & Defense."
          : "Focus switched to All sectors."
      );
      focusCtx.refresh();
    } catch {
      setDialogOpen(false);
      setFocusError("Focus change failed — network error.");
    } finally {
      setFocusBusy(false);
    }
  }

  function applyPreset(theme: NamedTheme, target: FocusMode) {
    // Theme is per-user and instant; Focus follows the confirmation
    // flow (skipped entirely when it already matches the preset).
    setNamedTheme(theme);
    if (settings && target !== settings.focus) {
      requestFocusChange(target);
    }
  }

  function addSegment() {
    const label = newSegmentLabel.trim();
    if (!label) return;
    const base = slugify(label);
    if (!base) return;
    if (taxonomy.some((s) => s.slug === base)) {
      setAdError(`A segment with slug “${base}” already exists.`);
      return;
    }
    setAdError(null);
    setTaxonomy((prev) => [...prev, { slug: base, label }]);
    setNewSegmentLabel("");
  }

  function addNaics() {
    const code = newNaicsCode.replace(/\D/g, "");
    const title = newNaicsTitle.trim();
    if (!/^\d{6}$/.test(code)) {
      setAdError("NAICS codes must be exactly 6 digits.");
      return;
    }
    if (naics.some((n) => n.code === code)) {
      setAdError(`NAICS code ${code} is already in the list.`);
      return;
    }
    setAdError(null);
    setNaics((prev) => [...prev, { code, title }]);
    setNewNaicsCode("");
    setNewNaicsTitle("");
  }

  async function saveAdSettings() {
    setAdNote(null);
    setAdError(null);
    // Client-side validation (the server re-validates on PUT).
    const cleanTaxonomy = taxonomy.map((s) => ({
      slug: s.slug,
      label: s.label.trim(),
    }));
    if (
      cleanTaxonomy.length === 0 ||
      cleanTaxonomy.some((s) => !s.slug || !s.label)
    ) {
      setAdError("Every taxonomy segment needs a label.");
      return;
    }
    if (
      new Set(cleanTaxonomy.map((s) => s.slug)).size !== cleanTaxonomy.length
    ) {
      setAdError("Taxonomy slugs must be unique.");
      return;
    }
    const cleanNaics = naics.map((n) => ({
      code: n.code.replace(/\D/g, ""),
      title: n.title.trim(),
    }));
    const badCode = cleanNaics.find((n) => !/^\d{6}$/.test(n.code));
    if (badCode) {
      setAdError(
        `NAICS code “${badCode.code || "(blank)"}” must be exactly 6 digits.`
      );
      return;
    }
    if (new Set(cleanNaics.map((n) => n.code)).size !== cleanNaics.length) {
      setAdError("NAICS codes must be unique.");
      return;
    }
    const boostValue = Number(boost);
    if (
      !Number.isFinite(boostValue) ||
      boostValue < 0 ||
      boostValue > 50
    ) {
      setAdError("Matching boost must be a number between 0 and 50.");
      return;
    }
    setAdBusy(true);
    try {
      const res = await fetch("/api/platform/settings/focus", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taxonomy: cleanTaxonomy,
          naics: cleanNaics,
          matchingBoost: Math.round(boostValue),
        }),
      });
      const d = (await res.json().catch(() => null)) as FocusPutResponse | null;
      if (!res.ok || !d?.settings) {
        setAdError(
          res.status === 403
            ? "Admins only."
            : (d?.error ?? "Save failed.")
        );
        return;
      }
      setSettings(d.settings);
      if (d.impact) setImpact(d.impact);
      setTaxonomy(cloneSegments(d.settings.taxonomy));
      setNaics(cloneNaics(d.settings.naics));
      setSavedNaics(cloneNaics(d.settings.naics));
      setBoost(String(d.settings.matchingBoost));
      setAdNote("A&D settings saved.");
      focusCtx.refresh();
    } catch {
      setAdError("Save failed — network error.");
    } finally {
      setAdBusy(false);
    }
  }

  if (loadError && !settings) {
    return <p className="text-sm text-red-600 dark:text-red-300">{loadError}</p>;
  }
  if (!settings) {
    return (
      <p className="text-sm text-slate-500 dark:text-white/50">
        Loading focus settings…
      </p>
    );
  }

  const updatedMeta =
    settings.updatedBy || settings.updatedAt
      ? `Last changed${settings.updatedBy ? ` by ${settings.updatedBy}` : ""}${
          settings.updatedAt
            ? ` on ${new Date(settings.updatedAt).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
                hour: "numeric",
                minute: "2-digit",
                timeZone: "America/Phoenix",
              })}`
            : ""
        }.`
      : null;

  return (
    <div className="space-y-8">
      {/* ---------- Focus (workspace-wide) ---------- */}
      <div>
        <p className="micro-label mb-2">Workspace focus</p>
        <div
          role="radiogroup"
          aria-label="Workspace focus"
          className="grid gap-3 sm:grid-cols-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={settings.focus === "ad"}
            disabled={!isAdmin}
            onClick={() => requestFocusChange("ad")}
            className={optionCardCls(settings.focus === "ad")}
          >
            <span className="block text-sm font-bold text-[#0d1f3c] dark:text-white">
              Aerospace &amp; Defense
            </span>
            <span className="mt-1 block text-sm text-slate-500 dark:text-white/55">
              Focused: A&amp;D sectors, the A&amp;D taxonomy, and A&amp;D
              defaults everywhere. Other sectors are flagged “Out of
              focus” and their pulls pause.
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={settings.focus === "all"}
            disabled={!isAdmin}
            onClick={() => requestFocusChange("all")}
            className={optionCardCls(settings.focus === "all")}
          >
            <span className="block text-sm font-bold text-[#0d1f3c] dark:text-white">
              All sectors
            </span>
            <span className="mt-1 block text-sm text-slate-500 dark:text-white/55">
              Every sector, selector, pull, and default is active —
              nothing is flagged or paused.
            </span>
          </button>
        </div>
        {!isAdmin && (
          <p className="caption mt-2">Workspace focus is set by an admin.</p>
        )}
        {updatedMeta && <p className="caption mt-2">{updatedMeta}</p>}
        {focusNote && (
          <p className="mt-2 text-sm text-emerald-600 dark:text-emerald-300">
            {focusNote}
          </p>
        )}
        {focusError && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-300">
            {focusError}
          </p>
        )}
      </div>

      {/* ---------- Theme (per user) + presets ---------- */}
      <div className="border-t border-slate-100 pt-6 dark:border-white/10">
        <p className="micro-label mb-2">Theme — just you</p>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid gap-3 sm:grid-cols-2"
        >
          <button
            type="button"
            role="radio"
            aria-checked={namedTheme === "desert"}
            onClick={() => setNamedTheme("desert")}
            className={optionCardCls(namedTheme === "desert")}
          >
            <span className="block text-sm font-bold text-[#0d1f3c] dark:text-white">
              Aerospace Desert
            </span>
            <span className="mt-1 block text-sm text-slate-500 dark:text-white/55">
              Midnight navy, sandstone ivory, desert sand, and copper —
              the Aerospace &amp; Defense look.
            </span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={namedTheme === "classic"}
            onClick={() => setNamedTheme("classic")}
            className={optionCardCls(namedTheme === "classic")}
          >
            <span className="block text-sm font-bold text-[#0d1f3c] dark:text-white">
              Classic
            </span>
            <span className="mt-1 block text-sm text-slate-500 dark:text-white/55">
              The original navy and gold portal look.
            </span>
          </button>
        </div>
        <p className="caption mt-2">
          Applies instantly. Follows you across devices.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="micro-label mr-1">Presets</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => applyPreset("desert", "ad")}
          >
            Aerospace preset
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => applyPreset("classic", "all")}
          >
            Classic preset
          </button>
          <span className="caption">
            A preset sets your theme immediately and moves the workspace
            focus through the same confirmation (admins only).
          </span>
        </div>
      </div>

      {/* ---------- A&D settings (taxonomy + NAICS + boost) ---------- */}
      <div className="border-t border-slate-100 pt-6 dark:border-white/10">
        <p className="micro-label mb-1">Aerospace &amp; Defense settings</p>
        <p className="mb-5 text-sm text-slate-500 dark:text-white/50">
          The sub-segment taxonomy and NAICS sourcing list behind Focus
          mode. Editable anytime — they take effect the next time Focus
          is on.
        </p>
        {!isAdmin && (
          <p className="caption mb-4">Admins only — these settings are read-only for your role.</p>
        )}

        <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-white/80">
          Sub-segment taxonomy ({taxonomy.length})
        </span>
        <div className="space-y-2">
          {taxonomy.map((seg, i) => (
            <div key={seg.slug} className="flex items-center gap-2">
              <input
                value={seg.label}
                disabled={!isAdmin}
                onChange={(e) =>
                  setTaxonomy((prev) =>
                    prev.map((s, j) =>
                      j === i ? { ...s, label: e.target.value } : s
                    )
                  )
                }
                className={inputCls}
                aria-label={`Segment ${i + 1} label`}
              />
              <span className="w-40 shrink-0 truncate font-mono text-xs text-slate-400 dark:text-white/40">
                {seg.slug}
              </span>
              <button
                type="button"
                disabled={!isAdmin}
                onClick={() =>
                  setTaxonomy((prev) => prev.filter((_, j) => j !== i))
                }
                className={removeBtnCls}
                aria-label={`Remove ${seg.label}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newSegmentLabel}
            disabled={!isAdmin}
            onChange={(e) => setNewSegmentLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addSegment();
              }
            }}
            placeholder="Add a segment — slug is derived from the label"
            className={inputCls}
          />
          <button
            type="button"
            onClick={addSegment}
            disabled={!isAdmin || !newSegmentLabel.trim()}
            className={removeBtnCls}
          >
            Add
          </button>
          <button
            type="button"
            disabled={!isAdmin}
            onClick={() => setTaxonomy(cloneSegments(TAXONOMY_DEFAULTS))}
            className={removeBtnCls}
          >
            Reset to defaults
          </button>
        </div>

        <span className="mb-1 mt-6 block text-sm font-medium text-slate-700 dark:text-white/80">
          Fit-sourcing NAICS list ({naics.length})
        </span>
        <div className="space-y-2">
          {naics.map((entry, i) => (
            <div key={`${entry.code}-${i}`} className="flex items-center gap-2">
              <input
                value={entry.code}
                disabled={!isAdmin}
                inputMode="numeric"
                maxLength={6}
                onChange={(e) =>
                  setNaics((prev) =>
                    prev.map((n, j) =>
                      j === i
                        ? { ...n, code: e.target.value.replace(/\D/g, "") }
                        : n
                    )
                  )
                }
                className={`${inputCls} w-28 shrink-0`}
                aria-label={`NAICS code ${i + 1}`}
              />
              <input
                value={entry.title}
                disabled={!isAdmin}
                onChange={(e) =>
                  setNaics((prev) =>
                    prev.map((n, j) =>
                      j === i ? { ...n, title: e.target.value } : n
                    )
                  )
                }
                className={inputCls}
                aria-label={`NAICS title ${i + 1}`}
              />
              <button
                type="button"
                disabled={!isAdmin}
                onClick={() =>
                  setNaics((prev) => prev.filter((_, j) => j !== i))
                }
                className={removeBtnCls}
                aria-label={`Remove NAICS ${entry.code}`}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            value={newNaicsCode}
            disabled={!isAdmin}
            inputMode="numeric"
            maxLength={6}
            onChange={(e) => setNewNaicsCode(e.target.value.replace(/\D/g, ""))}
            placeholder="6-digit code"
            className={`${inputCls} w-32 shrink-0`}
          />
          <input
            value={newNaicsTitle}
            disabled={!isAdmin}
            onChange={(e) => setNewNaicsTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addNaics();
              }
            }}
            placeholder="NAICS title"
            className={inputCls}
          />
          <button
            type="button"
            onClick={addNaics}
            disabled={!isAdmin || !newNaicsCode.trim()}
            className={removeBtnCls}
          >
            Add
          </button>
          <button
            type="button"
            disabled={!isAdmin}
            onClick={() => setNaics(cloneNaics(savedNaics))}
            className={removeBtnCls}
          >
            Reset to defaults
          </button>
        </div>
        <span className="mt-1 block text-xs text-slate-400 dark:text-white/40">
          Reset restores the last saved NAICS list.
        </span>

        <label className="mt-6 block">
          <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-white/80">
            A&amp;D interest boost in investor matching (Focus mode)
          </span>
          <input
            type="number"
            min={0}
            max={50}
            step={1}
            value={boost}
            disabled={!isAdmin}
            onChange={(e) => setBoost(e.target.value)}
            className={`${inputCls} w-32`}
          />
          <span className="mt-1 block text-xs text-slate-400 dark:text-white/40">
            Added to the sector weight when scoring investor–raise matches
            while Focus is on.
          </span>
        </label>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={saveAdSettings}
            disabled={!isAdmin || adBusy}
            className="btn btn-primary"
          >
            {adBusy ? "Saving…" : "Save A&D settings"}
          </button>
          {adNote && (
            <p className="text-sm text-emerald-600 dark:text-emerald-300">
              {adNote}
            </p>
          )}
          {adError && (
            <p className="text-sm text-red-600 dark:text-red-300">{adError}</p>
          )}
        </div>
      </div>

      <FocusConfirmDialog
        open={dialogOpen}
        target={dialogTarget}
        impact={impact}
        busy={focusBusy}
        onConfirm={confirmFocusChange}
        onCancel={() => {
          if (!focusBusy) setDialogOpen(false);
        }}
      />
    </div>
  );
}
