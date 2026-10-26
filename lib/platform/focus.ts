import { sql, str, num, iso } from "./db";
import { bumpDatasets } from "./versions";

/**
 * Focus & Theme system (Ethan, Oct 26, 2026).
 *
 * Two independent switches:
 * - Focus — workspace-wide, admin-only: "ad" (Aerospace & Defense, the
 *   default) or "all" (All sectors). Stored as a singleton row in
 *   core.focus_settings alongside the editable A&D sub-segment taxonomy
 *   and the A&D NAICS sourcing list. Changing Focus hides (never
 *   deletes) out-of-focus records behind a per-list toggle, pauses the
 *   other sectors' pulls, and switches defaults/copy to A&D.
 * - Theme — per user: "desert" (Aerospace Desert, the default) or
 *   "classic" (the pre-Oct-26 look, tokens untouched). Stored in
 *   core.user_preferences keyed by email, so it follows the user across
 *   devices; the client also caches it in localStorage to paint the
 *   right theme before first render.
 *
 * Every focus write lands in core.audit_log and bumps the
 * `focus_theme` dataset version, so version-gated clients refetch the
 * settings (and only the settings) on the next versions check —
 * per-dataset rule, never a global stamp.
 */

// Types + the sector-name constant live in ./focus-shared (client-safe,
// no server imports) and are re-exported here for server consumers.
export type {
  FocusMode,
  NamedTheme,
  TaxonomySegment,
  NaicsEntry,
  FocusSettings,
  FocusImpact,
} from "./focus-shared";
export { AD_SECTOR_NAME } from "./focus-shared";
import type {
  FocusMode,
  NamedTheme,
  TaxonomySegment,
  NaicsEntry,
  FocusSettings,
  FocusImpact,
} from "./focus-shared";
import { AD_SECTOR_NAME } from "./focus-shared";

/** Default A&D sub-segment taxonomy (spec §2; editable in Settings). */
export const AD_TAXONOMY_DEFAULT: TaxonomySegment[] = [
  { slug: "precision-machining", label: "Precision machining & machine shops" },
  { slug: "castings-forgings", label: "Castings & forgings" },
  { slug: "aerostructures-composites", label: "Aerostructures & composites" },
  { slug: "avionics-electronics", label: "Avionics & electronics" },
  { slug: "special-processes", label: "Special processes (heat treat, plating, coatings, NDT)" },
  { slug: "testing-certification", label: "Testing & certification services" },
  { slug: "mro", label: "MRO (maintenance, repair & overhaul)" },
  { slug: "tooling-fixtures", label: "Tooling & fixtures" },
  { slug: "space-systems", label: "Space systems & components" },
  { slug: "uas-drones", label: "UAS & drones" },
  { slug: "defense-electronics", label: "Defense electronics" },
];

/**
 * Default A&D fit-sourcing NAICS list (spec §2). Every code verified
 * against the official NAICS 2022 list on Oct 26, 2026 — see the build
 * checkpoint for the verification table. Editable in Settings.
 */
export const AD_NAICS_DEFAULT: NaicsEntry[] = [
  { code: "336411", title: "Aircraft Manufacturing" },
  { code: "336412", title: "Aircraft Engine and Engine Parts Manufacturing" },
  { code: "336413", title: "Other Aircraft Parts and Auxiliary Equipment Manufacturing" },
  { code: "336414", title: "Guided Missile and Space Vehicle Manufacturing" },
  { code: "336415", title: "Guided Missile and Space Vehicle Propulsion Unit and Propulsion Unit Parts Manufacturing" },
  { code: "336419", title: "Other Guided Missile and Space Vehicle Parts and Auxiliary Equipment Manufacturing" },
  { code: "332710", title: "Machine Shops" },
  { code: "332721", title: "Precision Turned Product Manufacturing" },
  { code: "332811", title: "Metal Heat Treating" },
  { code: "332813", title: "Electroplating, Plating, Polishing, Anodizing, and Coloring" },
  { code: "334511", title: "Search, Detection, Navigation, Guidance, Aeronautical, and Nautical System and Instrument Manufacturing" },
  { code: "488190", title: "Other Support Activities for Air Transportation" },
  { code: "541380", title: "Testing Laboratories and Services" },
  { code: "541330", title: "Engineering Services" },
];

/**
 * Ingest sources paused while Focus = A&D (spec §2: "pause pulls, news
 * feeds, and fit sourcing for the other sectors"). Only sources whose
 * entire payload serves a non-A&D sector are listed; all-sector
 * reference pulls (census, sector counts, multiples, indicators) keep
 * running because they also carry the A&D data, and A&D sources
 * (defense, news with the A&D query set) are never paused. The
 * confirmation dialog and the data dictionary read this same list.
 */
export const FOCUS_PAUSED_SOURCES: { source: string; label: string }[] = [
  { source: "hospitality", label: "Hospitality listings & operator pulls (Hospitality)" },
  { source: "adhs", label: "ADHS licensed-facility pulls (Healthcare)" },
];

function parseTaxonomy(v: unknown): TaxonomySegment[] {
  if (!Array.isArray(v)) return AD_TAXONOMY_DEFAULT;
  const out = v
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { slug: str(o.slug), label: str(o.label) };
    })
    .filter((x) => x.slug && x.label);
  return out.length ? out : AD_TAXONOMY_DEFAULT;
}

function parseNaics(v: unknown): NaicsEntry[] {
  if (!Array.isArray(v)) return AD_NAICS_DEFAULT;
  const out = v
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      return { code: str(o.code).replace(/\D/g, ""), title: str(o.title) };
    })
    .filter((x) => x.code.length === 6);
  return out.length ? out : AD_NAICS_DEFAULT;
}

export async function getFocusSettings(): Promise<FocusSettings> {
  const db = sql();
  const rows = await db`
    SELECT focus, taxonomy, naics, matching_boost, updated_at, updated_by
    FROM core.focus_settings WHERE id = 'workspace' LIMIT 1`;
  if (!rows.length) {
    // Materialize the spec defaults on first read.
    await db`
      INSERT INTO core.focus_settings (id, focus, taxonomy, naics, matching_boost)
      VALUES ('workspace', 'ad', ${JSON.stringify(AD_TAXONOMY_DEFAULT)}::jsonb,
        ${JSON.stringify(AD_NAICS_DEFAULT)}::jsonb, 10)
      ON CONFLICT (id) DO NOTHING`;
    return {
      focus: "ad",
      taxonomy: AD_TAXONOMY_DEFAULT,
      naics: AD_NAICS_DEFAULT,
      matchingBoost: 10,
      updatedAt: "",
      updatedBy: "",
    };
  }
  const r = rows[0] as Record<string, unknown>;
  return {
    focus: str(r.focus) === "all" ? "all" : "ad",
    taxonomy: parseTaxonomy(r.taxonomy),
    naics: parseNaics(r.naics),
    matchingBoost: Math.max(0, Math.min(50, num(r.matching_boost))),
    updatedAt: iso(r.updated_at),
    updatedBy: str(r.updated_by),
  };
}

async function writeFocusAudit(
  actor: string,
  action: string,
  changes: Record<string, unknown>
): Promise<void> {
  const db = sql();
  await db`
    INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
    VALUES ('workspace', 'focus_settings', ${actor}, ${action},
      ${JSON.stringify(changes)}::jsonb)`;
}

export interface FocusPatch {
  focus?: FocusMode;
  taxonomy?: TaxonomySegment[];
  naics?: NaicsEntry[];
  matchingBoost?: number;
}

export async function updateFocusSettings(
  actor: string,
  patch: FocusPatch
): Promise<FocusSettings> {
  const cur = await getFocusSettings();
  const next: FocusSettings = {
    focus: patch.focus === "all" || patch.focus === "ad" ? patch.focus : cur.focus,
    taxonomy: patch.taxonomy ? parseTaxonomy(patch.taxonomy) : cur.taxonomy,
    naics: patch.naics ? parseNaics(patch.naics) : cur.naics,
    matchingBoost:
      typeof patch.matchingBoost === "number"
        ? Math.max(0, Math.min(50, Math.round(patch.matchingBoost)))
        : cur.matchingBoost,
    updatedAt: cur.updatedAt,
    updatedBy: actor,
  };
  const db = sql();
  await db`
    INSERT INTO core.focus_settings (id, focus, taxonomy, naics, matching_boost, updated_at, updated_by)
    VALUES ('workspace', ${next.focus}, ${JSON.stringify(next.taxonomy)}::jsonb,
      ${JSON.stringify(next.naics)}::jsonb, ${next.matchingBoost}, now(), ${actor})
    ON CONFLICT (id) DO UPDATE SET
      focus = EXCLUDED.focus, taxonomy = EXCLUDED.taxonomy,
      naics = EXCLUDED.naics, matching_boost = EXCLUDED.matching_boost,
      updated_at = now(), updated_by = EXCLUDED.updated_by`;
  const focusChanged = next.focus !== cur.focus;
  await writeFocusAudit(actor, focusChanged ? "focus_changed" : "focus_settings_updated", {
    from: focusChanged ? cur.focus : undefined,
    to: next.focus,
    taxonomyCount: next.taxonomy.length,
    naicsCount: next.naics.length,
    matchingBoost: next.matchingBoost,
  });
  await bumpDatasets("focus_theme");
  return getFocusSettings();
}

/* ------------------------------ theme ------------------------------ */

export async function getUserTheme(email: string): Promise<NamedTheme> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return "desert";
  const db = sql();
  const rows = await db`
    SELECT theme FROM core.user_preferences WHERE email = ${e} LIMIT 1`;
  if (!rows.length) return "desert";
  return str(rows[0].theme) === "classic" ? "classic" : "desert";
}

export async function setUserTheme(
  email: string,
  theme: NamedTheme
): Promise<NamedTheme> {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return theme;
  const db = sql();
  await db`
    INSERT INTO core.user_preferences (email, theme, updated_at)
    VALUES (${e}, ${theme}, now())
    ON CONFLICT (email) DO UPDATE SET theme = EXCLUDED.theme, updated_at = now()`;
  await db`
    INSERT INTO core.audit_log (entity_kind, entity_id, actor, action, changes)
    VALUES ('user', ${e}, ${e}, 'theme_changed',
      ${JSON.stringify({ theme })}::jsonb)`;
  await bumpDatasets("focus_theme");
  return theme;
}

/* --------------------- out-of-focus derivation --------------------- */

/** A record is out of focus when its sector is set and is not A&D. */
export function isOutOfFocusSector(sector: string | null | undefined): boolean {
  const s = (sector ?? "").trim();
  return s !== "" && s !== AD_SECTOR_NAME;
}

/**
 * Counts + copy for the pre-apply confirmation (spec §1: list what will
 * be hidden or paused and what will be restored). Counts are read live
 * from the same tables the lists read; nothing is written here.
 */
export async function getFocusImpact(): Promise<FocusImpact> {
  const db = sql();
  let deals = 0;
  let companies = 0;
  let fits = 0;
  try {
    const d = await db`
      SELECT count(*)::int AS n FROM deals
      WHERE industry <> '' AND industry <> ${AD_SECTOR_NAME}`;
    deals = num((d[0] as Record<string, unknown>)?.n);
  } catch { /* deals table read is best-effort for the dialog */ }
  try {
    const c = await db`
      SELECT count(*)::int AS n FROM mi_companies
      WHERE sector <> '' AND sector <> ${AD_SECTOR_NAME}`;
    companies = num((c[0] as Record<string, unknown>)?.n);
    const f = await db`
      SELECT count(*)::int AS n FROM mi_companies
      WHERE status = 'fit' AND sector <> '' AND sector <> ${AD_SECTOR_NAME}`;
    fits = num((f[0] as Record<string, unknown>)?.n);
  } catch { /* same */ }
  return {
    dealsOutOfFocus: deals,
    companiesOutOfFocus: companies,
    fitTargetsOutOfFocus: fits,
    pausedSources: FOCUS_PAUSED_SOURCES,
    willHide: [
      `${deals} deal${deals === 1 ? "" : "s"} outside Aerospace & Defense (flagged "Out of focus", hidden unless the list toggle is on)`,
      `${companies} companies and ${fits} fit targets outside Aerospace & Defense (same flag and toggle)`,
      "Sector selectors, Market Intel and the Overview show Aerospace & Defense and its sub-segments only",
    ],
    willPause: [
      ...FOCUS_PAUSED_SOURCES.map((s) => s.label),
      "News and fit sourcing narrow to defense budgets and awards, the aerospace supply chain, FAA/DoD announcements and Arizona A&D companies",
    ],
    willRestore: [
      "Every hidden record returns exactly as it was — Focus never deletes or alters records",
      "Paused pulls resume on their existing schedules",
      "All-sector selectors, copy and defaults return",
    ],
  };
}
