"use client";

/**
 * Investment Types settings (Step 1, Oct 23, 2026) — standalone card
 * mounted with a single line on the Settings page. Edits the bd
 * config through /api/platform/investment-types/config:
 *  - type enable/disable (Minority Growth ships defined but OFF;
 *    enabling it here is what makes it selectable on deals)
 *  - per-type stage lists (one stage per line; order = pipeline order)
 *  - metric-definition enable/disable
 *  - sector-pack enable/disable
 * Loads once on mount; saves are explicit per change (PUT returns the
 * authoritative config, which replaces local state).
 */

import { useEffect, useState } from "react";
import type {
  BdConfig,
  BdMetricDefinition,
  BdSectorPack,
  BdTypeConfig,
} from "@/components/InvestmentTypeBits";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8]";

/**
 * Metric-fields grouping (Oct 24, 2026): the ~53 definitions render
 * grouped by their form section key, collapsed by default, so the
 * card opens compact. SECTION_ORDER is the display order of the
 * known keys; SECTION_LABELS maps them to readable names (any key
 * not listed falls back to the raw key).
 */
const SECTION_ORDER = [
  "lbo_metrics",
  "addon_metrics",
  "round",
  "traction",
  "team_market",
  "investors_es",
  "es_basics",
  "sector_pack",
];
const SECTION_LABELS: Record<string, string> = {
  lbo_metrics: "LBO metrics",
  addon_metrics: "Add-on metrics",
  round: "Round",
  traction: "Traction",
  team_market: "Team & market",
  investors_es: "Investors (early stage)",
  es_basics: "Early stage basics",
  sector_pack: "Sector pack",
};

export default function InvestmentTypesSettings() {
  const [cfg, setCfg] = useState<BdConfig | null>(null);
  const [failed, setFailed] = useState(false);
  const [busyKey, setBusyKey] = useState("");
  const [note, setNote] = useState("");
  const [stageDrafts, setStageDrafts] = useState<Record<string, string>>({});
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, string>>({});
  // Which metric-field section groups are expanded. All groups start
  // collapsed; keyed by section key ("" = no section set).
  const [openSections, setOpenSections] = useState<Record<string, boolean>>(
    {}
  );

  useEffect(() => {
    fetch("/api/platform/investment-types/bootstrap")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("http"))))
      .then((d: { config: BdConfig }) => {
        setCfg(d.config);
        setStageDrafts(
          Object.fromEntries(
            d.config.types.map((t) => [t.key, t.stages.join("\n")])
          )
        );
      })
      .catch(() => setFailed(true));
  }, []);

  const put = async (
    busy: string,
    body: Record<string, unknown>,
    okNote: string
  ) => {
    setBusyKey(busy);
    setNote("");
    try {
      const res = await fetch("/api/platform/investment-types/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNote(data.error ?? `Save failed (${res.status})`);
        return;
      }
      // The config PUT returns the config at the top level
      // ({types, definitions, sectorPacks}); the bootstrap GET wraps
      // it in {config}. Accept both — reading only data.config here
      // used to throw after every save and report a false failure.
      const nextCfg = (data.config ?? data) as BdConfig;
      setCfg(nextCfg);
      setStageDrafts(
        Object.fromEntries(
          nextCfg.types.map((t) => [t.key, t.stages.join("\n")])
        )
      );
      setNote(okNote);
    } catch {
      setNote("Save failed — network error.");
    } finally {
      setBusyKey("");
    }
  };

  if (failed) {
    return (
      <p className="text-sm text-slate-500 dark:text-white/50">
        Investment-type configuration could not be loaded.
      </p>
    );
  }
  if (!cfg) {
    return (
      <p className="text-sm text-slate-400 dark:text-white/40">
        Loading investment types…
      </p>
    );
  }

  const toggleType = (t: BdTypeConfig) =>
    put(
      `type:${t.key}`,
      { kind: "type", key: t.key, enabled: !t.enabled },
      `${t.label} ${!t.enabled ? "enabled" : "disabled"}.`
    );
  const saveStages = (t: BdTypeConfig) => {
    const stages = (stageDrafts[t.key] ?? "")
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);
    void put(
      `stages:${t.key}`,
      { kind: "type", key: t.key, stages },
      `${t.label} stages saved.`
    );
  };
  const toggleDef = (d: BdMetricDefinition) =>
    put(
      `def:${d.key}`,
      { kind: "definition", key: d.key, enabled: !d.enabled },
      `${d.label} ${!d.enabled ? "enabled" : "disabled"}.`
    );
  const saveSection = (d: BdMetricDefinition) => {
    const section = (sectionDrafts[d.key] ?? d.config.section ?? "").trim();
    void put(
      `section:${d.key}`,
      { definitions: [{ key: d.key, section: section === "" ? null : section }] },
      `${d.label} section ${section === "" ? "cleared" : `set to "${section}"`}.`
    );
  };
  const togglePack = (p: BdSectorPack) =>
    put(
      `pack:${p.key}`,
      { kind: "sectorPack", key: p.key, enabled: !p.enabled },
      `${p.label} ${!p.enabled ? "enabled" : "disabled"}.`
    );

  const toggleCls = (on: boolean) =>
    `rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
      on
        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200"
        : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/50"
    }`;

  // Group definitions by their SAVED section key, so a field moves
  // groups only when its new section is saved (matching how the
  // config PUT already worked) — never mid-typing in the row input.
  const sectionRank = (key: string) => {
    if (key === "") return SECTION_ORDER.length + 1;
    const i = SECTION_ORDER.indexOf(key);
    return i === -1 ? SECTION_ORDER.length : i;
  };
  const metricGroups: { key: string; defs: BdMetricDefinition[] }[] = [];
  for (const d of cfg.definitions) {
    const key = (d.config.section ?? "").trim();
    let group = metricGroups.find((g) => g.key === key);
    if (!group) {
      group = { key, defs: [] };
      metricGroups.push(group);
    }
    group.defs.push(d);
  }
  metricGroups.sort(
    (a, b) => sectionRank(a.key) - sectionRank(b.key) || a.key.localeCompare(b.key)
  );
  const sectionLabel = (key: string) =>
    key === "" ? "No section set" : SECTION_LABELS[key] ?? key;

  return (
    <div className="flex flex-col gap-6">
      {note && (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-white/5 dark:text-white/70">
          {note}
        </p>
      )}

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
          Types &amp; stages
        </h3>
        <div className="flex flex-col gap-4">
          {cfg.types.map((t) => (
            <div
              key={t.key}
              className="rounded-xl border border-slate-200 p-3 dark:border-white/10"
            >
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-slate-800 dark:text-[#e8dfc8]">
                  {t.label}
                  {t.key === "minority_growth" && !t.enabled && (
                    <span className="ml-2 text-xs font-normal text-slate-400 dark:text-white/40">
                      defined, not yet active
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={busyKey === `type:${t.key}`}
                  onClick={() => toggleType(t)}
                  className={toggleCls(t.enabled)}
                >
                  {t.enabled ? "Enabled" : "Disabled"}
                </button>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-white/50">
                  Stages — one per line, in pipeline order
                </span>
                <textarea
                  className={inputCls}
                  rows={Math.max(3, t.stages.length)}
                  value={stageDrafts[t.key] ?? ""}
                  onChange={(e) =>
                    setStageDrafts((d) => ({
                      ...d,
                      [t.key]: e.target.value,
                    }))
                  }
                />
              </label>
              <button
                type="button"
                disabled={busyKey === `stages:${t.key}`}
                onClick={() => saveStages(t)}
                className="btn btn-primary mt-2"
              >
                Save {t.label} stages
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
          Metric fields
        </h3>
        <p className="mb-2 text-xs text-slate-500 dark:text-white/50">
          Disabled fields stop appearing on deals; values already
          recorded are kept. The section key controls which section of
          the New investment form the field renders in (lbo_metrics,
          addon_metrics, round, traction, team_market, investors_es,
          es_basics, sector_pack). Fields are grouped by section
          below — expand a group to edit its fields.
        </p>
        <div className="flex flex-col gap-2">
          {metricGroups.map((g) => {
            const open = openSections[g.key] === true;
            const enabledCount = g.defs.filter((d) => d.enabled).length;
            return (
              <div
                key={g.key === "" ? "__no_section" : g.key}
                className="rounded-xl border border-slate-200 dark:border-white/10"
              >
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() =>
                    setOpenSections((s) => ({ ...s, [g.key]: !open }))
                  }
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
                >
                  <span className="text-sm font-semibold text-slate-800 dark:text-[#e8dfc8]">
                    {sectionLabel(g.key)}
                    <span className="ml-2 text-xs font-normal text-slate-400 dark:text-white/40">
                      {g.defs.length} field{g.defs.length === 1 ? "" : "s"}
                      {" · "}
                      {enabledCount} on
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-xs text-slate-400 dark:text-white/40"
                  >
                    {open ? "▾" : "▸"}
                  </span>
                </button>
                {open && (
                  <ul className="divide-y divide-slate-100 border-t border-slate-100 px-3 dark:divide-white/5 dark:border-white/10">
                    {g.defs.map((d) => (
                      <li
                        key={d.key}
                        className="flex items-center justify-between gap-2 py-1.5"
                      >
                        <span className="text-sm text-slate-700 dark:text-[#e8dfc8]">
                          {d.label}
                          <span className="ml-2 text-xs text-slate-400 dark:text-white/40">
                            {d.appliesTo.replace("type:", "").replace("sector:", "pack: ")}
                            {" · "}
                            {d.dataType}
                            {d.required ? " · required" : ""}
                          </span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <input
                            aria-label={`Form section for ${d.label}`}
                            className="w-32 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8]"
                            value={sectionDrafts[d.key] ?? d.config.section ?? ""}
                            onChange={(e) =>
                              setSectionDrafts((s) => ({ ...s, [d.key]: e.target.value }))
                            }
                            placeholder="section"
                          />
                          <button
                            type="button"
                            disabled={busyKey === `section:${d.key}`}
                            onClick={() => saveSection(d)}
                            className="btn btn-ghost btn-sm"
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            disabled={busyKey === `def:${d.key}`}
                            onClick={() => toggleDef(d)}
                            className={toggleCls(d.enabled)}
                          >
                            {d.enabled ? "On" : "Off"}
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">
          Sector packs
        </h3>
        <p className="mb-2 text-xs text-slate-500 dark:text-white/50">
          A pack applies automatically when a deal&apos;s industry
          matches the pack&apos;s industry.
        </p>
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {cfg.sectorPacks.map((p) => (
            <li
              key={p.key}
              className="flex items-center justify-between gap-2 py-1.5"
            >
              <span className="text-sm text-slate-700 dark:text-[#e8dfc8]">
                {p.label}
                <span className="ml-2 text-xs text-slate-400 dark:text-white/40">
                  industry: {p.industryMatch}
                </span>
              </span>
              <button
                type="button"
                disabled={busyKey === `pack:${p.key}`}
                onClick={() => togglePack(p)}
                className={toggleCls(p.enabled)}
              >
                {p.enabled ? "On" : "Off"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
