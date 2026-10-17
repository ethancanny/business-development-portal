import { neon } from "@neondatabase/serverless";
import { ensureSchema, newId } from "./db-postgres";
import type {
  MiAcquisition,
  MiEntity,
  MiFiling,
  MiFilingCategory,
  MiIndicatorObs,
  MiIndicatorSource,
  MiListing,
  MiCompany,
  MiMultiple,
  MiSyncLog,
  MiWarnNotice,
} from "./types";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (market intel requires Postgres)");
  return neon(url);
}

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
const str = (v: unknown): string => String(v ?? "");

/* ---------------- Indicators ---------------- */

export interface IndicatorInput {
  source: MiIndicatorSource;
  seriesId: string;
  title: string;
  units: string;
  frequency: string;
  obsDate: string; // YYYY-MM-DD
  value: number | null;
}

export async function upsertIndicatorObs(rows: IndicatorInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  let added = 0;
  for (const r of rows) {
    const res = await db`
      INSERT INTO mi_indicators (id, source, series_id, title, units, frequency, obs_date, value)
      VALUES (${newId()}, ${r.source}, ${r.seriesId}, ${r.title}, ${r.units}, ${r.frequency}, ${r.obsDate}, ${r.value})
      ON CONFLICT (source, series_id, obs_date) DO UPDATE SET
        value = EXCLUDED.value, title = EXCLUDED.title, units = EXCLUDED.units, frequency = EXCLUDED.frequency
      RETURNING (xmax = 0) AS inserted`;
    if (res[0]?.inserted) added++;
  }
  return added;
}

/** Bulk variant for large ingests (hundreds of rows per statement, chunked). */
export async function upsertIndicatorObsBulk(rows: IndicatorInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  const CHUNK = 400;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * 8;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`);
      params.push(newId(), r.source, r.seriesId, r.title, r.units, r.frequency, r.obsDate, r.value);
    });
    await db.query(
      `INSERT INTO mi_indicators (id, source, series_id, title, units, frequency, obs_date, value)
       VALUES ${values.join(", ")}
       ON CONFLICT (source, series_id, obs_date) DO UPDATE SET
         value = EXCLUDED.value, title = EXCLUDED.title, units = EXCLUDED.units, frequency = EXCLUDED.frequency`,
      params
    );
  }
  return rows.length;
}

export async function getIndicatorSeries(seriesIds: string[]): Promise<MiIndicatorObs[]> {
  await ensureSchema();
  const db = sql();
  if (!seriesIds.length) return [];
  const rows = await db`
    SELECT id, source, series_id, title, units, frequency,
           to_char(obs_date, 'YYYY-MM-DD') AS obs_date, value
    FROM mi_indicators
    WHERE series_id = ANY(${seriesIds})
    ORDER BY obs_date ASC`;
  return rows.map((r) => ({
    id: str(r.id),
    source: str(r.source) as MiIndicatorSource,
    seriesId: str(r.series_id),
    title: str(r.title),
    units: str(r.units),
    frequency: str(r.frequency),
    obsDate: str(r.obs_date),
    value: numOrNull(r.value),
  }));
}

export async function getLatestIndicators(): Promise<
  { seriesId: string; title: string; units: string; obsDate: string; value: number | null }[]
> {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT DISTINCT ON (series_id) series_id, title, units,
           to_char(obs_date, 'YYYY-MM-DD') AS obs_date, value
    FROM mi_indicators
    ORDER BY series_id, obs_date DESC`;
  return rows.map((r) => ({
    seriesId: str(r.series_id),
    title: str(r.title),
    units: str(r.units),
    obsDate: str(r.obs_date),
    value: numOrNull(r.value),
  }));
}

/* ---------------- Listings ---------------- */

export interface ListingInput {
  title: string;
  price?: number | null;
  revenue?: number | null;
  cashFlow?: number | null;
  industry?: string;
  location?: string;
  broker?: string;
  url: string;
  source?: string;
  description?: string;
}

export async function upsertListings(rows: ListingInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  let added = 0;
  for (const r of rows) {
    if (!r.url) continue;
    const res = await db`
      INSERT INTO mi_listings (id, title, price, revenue, cash_flow, industry, location, broker, url, source, description, last_seen)
      VALUES (${newId()}, ${r.title ?? ""}, ${r.price ?? null}, ${r.revenue ?? null}, ${r.cashFlow ?? null},
              ${r.industry ?? ""}, ${r.location ?? ""}, ${r.broker ?? ""}, ${r.url}, ${r.source ?? ""}, ${r.description ?? ""}, NOW())
      ON CONFLICT (url) DO UPDATE SET
        title = EXCLUDED.title, price = EXCLUDED.price, revenue = EXCLUDED.revenue,
        cash_flow = EXCLUDED.cash_flow, industry = EXCLUDED.industry, location = EXCLUDED.location,
        last_seen = NOW(), updated_at = NOW()
      RETURNING (xmax = 0) AS inserted`;
    if (res[0]?.inserted) added++;
  }
  return added;
}

export async function getListings(status?: string): Promise<MiListing[]> {
  await ensureSchema();
  const db = sql();
  const rows = status && status !== "all"
    ? await db`SELECT * FROM mi_listings WHERE status = ${status} ORDER BY last_seen DESC`
    : await db`SELECT * FROM mi_listings ORDER BY last_seen DESC`;
  return rows.map((r) => ({
    id: str(r.id), title: str(r.title), price: numOrNull(r.price),
    revenue: numOrNull(r.revenue), cashFlow: numOrNull(r.cash_flow),
    industry: str(r.industry), location: str(r.location), broker: str(r.broker),
    url: str(r.url), source: str(r.source), description: str(r.description),
    status: str(r.status) as MiListing["status"],
    firstSeen: String(r.first_seen), lastSeen: String(r.last_seen),
    createdAt: String(r.created_at), updatedAt: String(r.updated_at),
  }));
}

export async function setListingStatus(id: string, status: MiListing["status"]): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mi_listings SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;
}

/* ---------------- Companies (registry-spine profiles) ---------------- */

export interface CompanyInput {
  dedupKey: string;
  name: string;
  sector: string;
  subsector?: string;
  naics?: string;
  city?: string;
  state?: string;
  address?: string;
  zip?: string;
  contactName?: string;
  contactTitle?: string;
  phone?: string;
  website?: string;
  formedDate?: string;
  employees?: number | null;
  signalValue?: number | null;
  signalLabel?: string;
  source: string;
  sourceUrl?: string;
  details?: string;
}

/* ---------------- Fit pipeline stage (Ethan, Oct 16, 2026) -------------
 * "Fit" is a pipeline STAGE on the company record (status = 'fit'), not
 * just the details.fit stamp. status lifecycle:
 *   new → fit → (dismissed | added); a fit marked Keep stays status
 *   'fit' with details.kept = true, so the mark survives the stage.
 * details.fit remains the fit-rule verdict (re-judged at import and by
 * the rescore paths); status tracks where the record sits. Dismissed
 * is sticky: NO ingest, rescore, or consolidation may flip a dismissed
 * row back to fit — importCompanies carries the dismissal through
 * resets and re-applies it to the same company arriving under a new
 * source identity (normalized name + website domain, or ACC entity
 * ID when a record carries one). date_added is written once at
 * creation and is never overwritten by later syncs; the Fit Targets
 * section lists active fits newest-date_added-first, capped at
 * FITS_DISPLAY_LIMIT (the single config value for that cap). */
export const FITS_DISPLAY_LIMIT = 25;

let fitStageMigration: Promise<void> | null = null;

/** One-time, idempotent migration to the fit-stage model: backfill
 * date_added from the created/first-seen timestamp, fold Keep-marked
 * fits into status='fit' (mark preserved as details.kept), and promote
 * untouched fits (status='new'/'keep' with a fit stamp) to
 * status='fit'. Fits already 'added' (advanced into the deal
 * pipeline) or 'dismissed' keep their status — no data is lost. Runs
 * once per process; the UPDATEs no-op once applied; the counts are
 * written to the sync log by the first run that changes anything. */
export function runFitStageMigration(): Promise<void> {
  if (!fitStageMigration) {
    fitStageMigration = (async () => {
      await ensureSchema();
      const db = sql();
      const backfilled = await db`
        UPDATE mi_companies SET date_added = COALESCE(first_seen, created_at)
        WHERE date_added IS NULL
        RETURNING id`;
      const keptFits = await db`
        UPDATE mi_companies
        SET details = (details::jsonb || '{"kept":true}'::jsonb)::text
        WHERE status = 'keep' AND details LIKE '{%'
          AND (details::jsonb ->> 'fit') = 'true'
        RETURNING id`;
      const promoted = await db`
        UPDATE mi_companies SET status = 'fit'
        WHERE status IN ('new', 'keep') AND details LIKE '{%'
          AND (details::jsonb ->> 'fit') = 'true'
        RETURNING id`;
      const missing = await db`
        SELECT COUNT(*)::int AS c FROM mi_companies WHERE date_added IS NULL`;
      const fitTotal = await db`
        SELECT COUNT(*)::int AS c FROM mi_companies WHERE status = 'fit'`;
      if (backfilled.length || keptFits.length || promoted.length) {
        await logSync(
          "fits-stage-migration",
          "ok",
          promoted.length,
          `Fit stage migration: date_added backfilled on ${backfilled.length} rows (${numOrNull(missing[0]?.c) ?? 0} still missing); ${promoted.length} fits promoted to status='fit' (${keptFits.length} carried a Keep mark, preserved as details.kept); status='fit' total now ${numOrNull(fitTotal[0]?.c) ?? 0}. Fits already added/dismissed kept their status.`
        );
      }
    })().catch((err) => {
      fitStageMigration = null;
      throw err;
    });
  }
  return fitStageMigration;
}

/** Bare domain (host, no protocol/www) from a website string. */
const domainOf = (website: string): string => {
  const m = (website || "")
    .toLowerCase()
    .match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/);
  return m ? m[1] : "";
};

/** ACC entity ID from a details JSON, when the record carries one.
 * No spine stores one today, so this arm is dormant until one does
 * (same posture as the ADHS CCN match). */
const accIdOfDetails = (detailsJson: string): string => {
  try {
    const d = JSON.parse(detailsJson || "{}") as Record<string, unknown>;
    const v = d.accEntityId ?? d.accId ?? d.entityId;
    return typeof v === "string" && v.trim() ? v.trim() : "";
  } catch {
    return "";
  }
};

/** Import a registry snapshot. With reset=true the source's existing rows
 * are replaced wholesale (triage status and first_seen are preserved by
 * dedup key); without it, rows upsert by (source, dedup_key). Used by the
 * weekly spine builders (SAM.gov, AZ ROC, NPPES, EPA FRS). */
/* Hospitality fit thresholds are portal SETTINGS (Ethan, Oct 15, 2026 —
 * §2 of the hospitality build): stored in mi_hospitality_state by the
 * hospitality settings API, defaulting to 3 locations / $3M hotel-venue
 * revenue. computeFit is synchronous, so the values live in a module
 * cache refreshed (5-min TTL) by the async write paths before they
 * judge rows. */
export interface HospitalityThresholds {
  minLocations: number;
  hotelMinRevenue: number;
}
export const HOSPITALITY_THRESHOLDS_DEFAULT: HospitalityThresholds = {
  minLocations: 3,
  hotelMinRevenue: 3_000_000,
};
let hospitalityThreshCache: { value: HospitalityThresholds; at: number } | null = null;

export function hospitalityThresholds(): HospitalityThresholds {
  return hospitalityThreshCache?.value ?? HOSPITALITY_THRESHOLDS_DEFAULT;
}

export async function refreshHospitalityThresholds(force = false): Promise<HospitalityThresholds> {
  if (!force && hospitalityThreshCache && Date.now() - hospitalityThreshCache.at < 300_000) {
    return hospitalityThreshCache.value;
  }
  const value: HospitalityThresholds = { ...HOSPITALITY_THRESHOLDS_DEFAULT };
  try {
    const db = sql();
    await db`CREATE TABLE IF NOT EXISTS mi_hospitality_state (
      key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`;
    const rows = await db`SELECT key, value FROM mi_hospitality_state WHERE key IN ('fit_min_locations', 'fit_hotel_min_revenue')`;
    for (const r of rows) {
      const n = Number(r.value);
      if (str(r.key) === "fit_min_locations" && Number.isFinite(n) && n >= 1) value.minLocations = Math.round(n);
      if (str(r.key) === "fit_hotel_min_revenue" && Number.isFinite(n) && n > 0) value.hotelMinRevenue = Math.round(n);
    }
  } catch {
    // Settings table unreachable (e.g. pre-§1 dev database) — defaults apply.
  }
  hospitalityThreshCache = { value, at: Date.now() };
  return value;
}

/** Acquisition-fit heuristic, computed at import so every spine (and the
 * weekly refresh) gets it for free. A "fit" is an established, right-sized
 * target — not a startup, not a whale. The reasoning is stored on the row
 * (details.fitWhy) and the UI highlights fit rows in gold. */
function computeFit(r: CompanyInput): { fit: boolean; why: string; unscored?: boolean; estRevenue?: number | null } {
  let details: Record<string, unknown> = {};
  try {
    details = r.details ? (JSON.parse(r.details) as Record<string, unknown>) : {};
  } catch {
    details = {};
  }
  if (String(details.excludedFromFederalContracting ?? "") === "YES") return { fit: false, why: "" };
  const formed = r.formedDate && /^\d{4}-\d{2}-\d{2}/.test(r.formedDate) ? new Date(r.formedDate) : null;
  const age = formed ? (Date.now() - formed.getTime()) / 31_557_600_000 : null;
  const yr = formed ? formed.getUTCFullYear() : null;
  const sig = r.signalValue ?? null;
  const money = (v: number) =>
    v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;
  // Fit v2 (Ethan, Oct 2026): never a fit if the company — or its parent — is a
  // corporate giant, whatever a single subsidiary/location's numbers look like.
  const GIANTS = [
    "HONEYWELL", "RAYTHEON", "RTX CORPORATION", "BOEING", "LOCKHEED", "NORTHROP", "GENERAL DYNAMICS",
    "L3HARRIS", "BAE SYSTEMS", "LEIDOS", "BOOZ ALLEN", "PERATON", "COLLINS AEROSPACE", "PRATT & WHITNEY",
    "AEROJET", "TEXTRON", "ROLLS ROYCE", "SAFRAN", "INTEL", "TAIWAN SEMICONDUCTOR", "MICROSOFT", "AMAZON",
    "GOOGLE", "ORACLE", "WALMART", "TARGET CORPORATION", "CVS", "WALGREENS", "UNITEDHEALTH", "OPTUM",
    "ELEVANCE", "AETNA", "CIGNA", "HUMANA", "KAISER", "BANNER HEALTH", "DIGNITY HEALTH", "COMMONSPIRIT",
    "HONORHEALTH", "MAYO CLINIC", "PHOENIX CHILDREN", "TENET HEALTH", "HCA HEALTH", "UNIVERSAL HEALTH",
    "PCL CONSTRUCTION", "SUNDT", "MORTENSON", "HENSEL PHELPS", "SKANSKA", "TURNER CONSTRUCTION", "BECHTEL",
    "FLUOR", "AECOM", "JACOBS", "CATERPILLAR", "EATON CORPORATION", "PARKER HANNIFIN", "EMERSON ELECTRIC",
  ];
  const hay = [r.name ?? "", String(details.parentName ?? ""), String(details.dbaName ?? "")].join(" ").toUpperCase();
  if (GIANTS.some((g) => hay.includes(g))) return { fit: false, why: "" };
  // Holistic size evidence when enrichment has supplied it: estimated annual
  // revenue (details.revenueEstimate) and employee count — hard caps beat any
  // single-signal band.
  const rev = typeof details.revenueEstimate === "number" ? details.revenueEstimate : null;
  const emp = r.employees ?? (typeof details.employeesEstimate === "number" ? details.employeesEstimate : null);
  if (rev !== null && rev > 150_000_000) return { fit: false, why: "" };
  if (emp !== null && emp > 1500) return { fit: false, why: "" };
  const locN = typeof details.locationCount === "number" ? details.locationCount : 1;
  const locBit = locN > 1 ? ` · ${locN} locations` : "";
  const evBits = [
    rev !== null ? `est. revenue ${money(rev)}` : "",
    emp !== null ? `~${emp.toLocaleString()} employees` : "",
  ].filter(Boolean).join(" · ");
  const evBit = evBits ? ` · ${evBits}` : "";
  const src = r.source ?? "";
  if ((src.includes("USASpending") || src.includes("SAM")) && sig !== null) {
    const inBand = sig >= 250_000 && sig <= 100_000_000;
    return {
      fit: inBand && (age === null || age >= 3),
      why: inBand ? `${money(sig)} federal awards FY23–26${yr ? ` · est. ${yr}` : ""}${locBit}${evBit}` : "",
    };
  }
  if (src.includes("SAM")) {
    const evInBand = (rev !== null && rev >= 1_000_000 && rev <= 150_000_000) || (emp !== null && emp >= 8 && emp <= 1500);
    const fit = (age !== null && age >= 5) || (age !== null && age >= 3 && evInBand);
    return {
      fit,
      why: fit ? `Est. ${yr} · SAM-registered ${r.subsector || "supplier"}${locBit}${evBit}` : "",
    };
  }
  if (src.includes("NPPES")) {
    // Healthcare fit (Ethan, Oct 14, 2026): a fit REQUIRES estimated revenue
    // of at least $1M. Estimate derivation, in precedence order:
    //   1. recorded revenueEstimate (enrichment, e.g. Cortera)
    //   2. employees × specialty revenue-per-employee (model rates below)
    //   3. SBA loan jobs-reported (details.sbaJobs, Phase 3 join) × rate
    //   4. ADHS licensed capacity (details.adhsUnits, Phase 3) × $58K/unit
    // No derivable estimate → the company is UNSCORED: held out of fits
    // (details.fitUnscored) until SBA/ADHS data scores it. ADHS facility
    // licensing is the primary healthcare source going forward; NPPES rows
    // remain until the ADHS spine replaces them.
    const sub = (r.subsector ?? "").toLowerCase();
    const rate =
      sub.includes("behavioral") || sub.includes("mental") ? 130_000 :
      sub.includes("home health") ? 115_000 :
      sub.includes("hospice") ? 160_000 :
      sub.includes("assisted") || sub.includes("nursing") ? 150_000 : 180_000;
    let est: number | null = rev;
    if (est === null && emp !== null) est = Math.round(emp * rate);
    if (est === null && typeof details.sbaJobs === "number" && details.sbaJobs > 0) est = Math.round(details.sbaJobs * rate);
    if (est === null && typeof details.adhsUnits === "number" && details.adhsUnits > 0) est = Math.round(details.adhsUnits * 58_000);
    if (est === null) return { fit: false, why: "", unscored: true, estRevenue: null };
    const fit = est >= 1_000_000;
    return {
      fit,
      estRevenue: est,
      why: fit ? `Est. revenue ${money(est)} · ${r.subsector || "healthcare provider"}${yr ? ` · operating since ${yr}` : ""}${locBit}` : "",
    };
  }
  if (src.includes("ROC")) {
    const n = typeof details.licenseCount === "number" ? details.licenseCount : 1;
    const fit = age !== null && age >= 7 && (n >= 2 || /General|Engineering/.test(r.subsector ?? ""));
    return { fit, why: fit ? `Licensed since ${yr} · ${n} license${n > 1 ? "s" : ""} on file${locBit}${evBit}` : "" };
  }
  if (src.includes("Hospitality")) {
    // Hospitality fit (Ethan, Oct 15, 2026 — hospitality build §2):
    // operator groups resolved from county food-establishment permits
    // (plus DLLC liquor licenses the day that route exists — the sync
    // stamps liquorLicensedVenue only when license rows are present, so
    // the hotel/venue arm activates automatically with the data).
    // Thresholds are portal settings (see hospitalityThresholds above).
    // Ownership exclusions are stamped by the hospitality sync from a
    // conservative national-brand/institutional name match; "unknown"
    // is NOT excluded. Revenue is a modeled estimate (locations ×
    // per-location range by concept), always labeled low confidence.
    const th = hospitalityThresholds();
    const ownership = String(details.ownership ?? "unknown").toLowerCase();
    if (
      ownership === "franchise" ||
      ownership === "chain" ||
      ownership === "institutional" ||
      ownership === "subsidiary"
    ) {
      return { fit: false, why: "", estRevenue: rev };
    }
    const locs = typeof details.locationCount === "number" ? details.locationCount : 0;
    const concept = String(details.concept ?? "");
    if (locs >= th.minLocations) {
      return {
        fit: true,
        estRevenue: rev,
        why: `${locs} locations${concept ? ` · ${concept.toLowerCase()}` : ""} · ${rev !== null ? `est. revenue ${money(rev)} (modeled, low confidence)` : "revenue not modeled"}`,
      };
    }
    if (details.liquorLicensedVenue === true && rev !== null && rev >= th.hotelMinRevenue) {
      return {
        fit: true,
        estRevenue: rev,
        why: `Liquor-licensed ${concept ? concept.toLowerCase() : "venue"} · est. revenue ${money(rev)} (modeled, low confidence) · ${locs} location${locs === 1 ? "" : "s"}`,
      };
    }
    return { fit: false, why: "", estRevenue: rev };
  }
  return { fit: false, why: "" };
}

export async function importCompanies(source: string, rows: CompanyInput[], reset: boolean): Promise<{ received: number; total: number }> {
  await ensureSchema();
  await runFitStageMigration();
  await refreshHospitalityThresholds();
  const db = sql();
  const filtered = rows.filter((r) => r && r.dedupKey && r.name && r.source === source);
  // Dedupe by dedupKey (last occurrence wins). A multi-row
  // INSERT ... ON CONFLICT DO UPDATE aborts the entire statement when the
  // same (source, dedup_key) pair appears twice in one VALUES list
  // ("ON CONFLICT DO UPDATE command cannot affect row a second time") —
  // the failure behind the Oct 9, 2026 consolidation data loss.
  const byKey: Record<string, CompanyInput> = {};
  const keyOrder: string[] = [];
  for (const r of filtered) {
    if (!byKey[r.dedupKey]) keyOrder.push(r.dedupKey);
    byKey[r.dedupKey] = r;
  }
  const clean = keyOrder.map((k) => byKey[k]);
  for (const r of clean) {
    const { fit, why, unscored, estRevenue } = computeFit(r);
    (r as CompanyInput & { _fit?: boolean })._fit = fit;
    try {
      const d = r.details ? (JSON.parse(r.details) as Record<string, unknown>) : {};
      if (fit) {
        d.fit = true;
        d.fitWhy = why;
      } else {
        delete d.fit;
        delete d.fitWhy;
      }
      if (unscored) d.fitUnscored = true;
      else delete d.fitUnscored;
      if (typeof estRevenue === "number") d.estRevenue = estRevenue;
      else if (estRevenue === null) delete d.estRevenue;
      else if (typeof d.revenueEstimate === "number") d.estRevenue = d.revenueEstimate;
      r.details = JSON.stringify(d);
    } catch {
      // Details that claim to be a JSON object but do not parse (e.g. a
      // client-truncated document) must never reach the table: read paths
      // cast details::jsonb and one invalid row fails the whole sector
      // query. Plain non-JSON notes pass through untouched (the casts
      // skip anything not starting with '{').
      if (r.details && r.details.trim().startsWith("{")) r.details = "{}";
    }
  }
  // No-resurface guard (Ethan, Oct 16, 2026): a dismissed company must
  // never come back as a fit under a new source identity. Index the
  // existing dismissed records by normalized name + website domain
  // (and by ACC entity ID when one is stored); an incoming row that
  // matches inherits the dismissal — status and stamps — whatever
  // source/dedup key it arrives under. Read BEFORE any reset delete
  // below, so a dismissed row also matches itself here (its dedup-key
  // carry-over is the second layer).
  const dismissedRows = await db`
    SELECT name, website, details, dismissed_at, dismissed_reason
    FROM mi_companies WHERE status = 'dismissed'`;
  const dismissedByKey = new Map<string, { at: unknown; reason: string }>();
  for (const d of dismissedRows) {
    const nm = normCompanyName(str(d.name));
    if (!nm) continue;
    const entry = { at: d.dismissed_at, reason: str(d.dismissed_reason) };
    const dom = domainOf(str(d.website));
    if (dom) dismissedByKey.set(`${nm}|${dom}`, entry);
    const acc = accIdOfDetails(str(d.details));
    if (acc) dismissedByKey.set(`${nm}|acc:${acc}`, entry);
  }
  const dismissedMatch = (r: CompanyInput): { at: unknown; reason: string } | undefined => {
    const nm = normCompanyName(r.name);
    if (!nm) return undefined;
    const dom = domainOf(r.website ?? "");
    if (dom) {
      const hit = dismissedByKey.get(`${nm}|${dom}`);
      if (hit) return hit;
    }
    const acc = accIdOfDetails(r.details ?? "");
    if (acc) return dismissedByKey.get(`${nm}|acc:${acc}`);
    return undefined;
  };
  if (reset) {
    // Reset is scoped to the (source, sector) pairs present in this payload,
    // so one registry feeding several sector spines never wipes the others.
    const sectors = Array.from(new Set(clean.map((r) => r.sector).filter(Boolean)));
    const existing = sectors.length
      ? await db`SELECT dedup_key, status, first_seen, date_added, dismissed_at, dismissed_reason FROM mi_companies WHERE source = ${source} AND sector = ANY(${sectors})`
      : await db`SELECT dedup_key, status, first_seen, date_added, dismissed_at, dismissed_reason FROM mi_companies WHERE source = ${source}`;
    const statusByKey = new Map(existing.map((r) => [str(r.dedup_key), str(r.status)]));
    const firstSeenByKey = new Map(existing.map((r) => [str(r.dedup_key), r.first_seen]));
    const dateAddedByKey = new Map(existing.map((r) => [str(r.dedup_key), r.date_added]));
    const dismissedAtByKey = new Map(existing.map((r) => [str(r.dedup_key), r.dismissed_at]));
    const dismissedReasonByKey = new Map(existing.map((r) => [str(r.dedup_key), str(r.dismissed_reason)]));
    if (sectors.length) {
      await db`DELETE FROM mi_companies WHERE source = ${source} AND sector = ANY(${sectors})`;
    } else {
      await db`DELETE FROM mi_companies WHERE source = ${source}`;
    }
    for (const r of clean) {
      (r as CompanyInput & { _status?: string })._status = statusByKey.get(r.dedupKey);
      (r as CompanyInput & { _firstSeen?: unknown })._firstSeen = firstSeenByKey.get(r.dedupKey);
      (r as CompanyInput & { _dateAdded?: unknown })._dateAdded = dateAddedByKey.get(r.dedupKey);
      (r as CompanyInput & { _dismissedAt?: unknown })._dismissedAt = dismissedAtByKey.get(r.dedupKey);
      (r as CompanyInput & { _dismissedReason?: string })._dismissedReason = dismissedReasonByKey.get(r.dedupKey);
    }
  }
  const CHUNK = 300;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const chunk = clean.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * 26;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, $${b + 16}, $${b + 17}, $${b + 18}, $${b + 19}, $${b + 20}, $${b + 21}, $${b + 22}, $${b + 23}, $${b + 24}, $${b + 25}, $${b + 26})`);
      const rx = r as CompanyInput & {
        _fit?: boolean; _status?: string; _firstSeen?: unknown;
        _dateAdded?: unknown; _dismissedAt?: unknown; _dismissedReason?: string;
      };
      // Stage resolution (fit-stage model): a carried dismissal always
      // wins; a name+domain / ACC-ID match against a dismissed record
      // inherits that dismissal; carried keep/added (human triage)
      // survives; otherwise the stage follows this import's fit
      // verdict — fit rows enter the stage, rows that stop fitting
      // fall back to 'new'.
      const guard = rx._status === "dismissed" ? undefined : dismissedMatch(r);
      const status =
        rx._status === "dismissed"
          ? "dismissed"
          : guard
            ? "dismissed"
            : rx._status === "keep" || rx._status === "added"
              ? rx._status
              : rx._fit
                ? "fit"
                : "new";
      const dismissedAt =
        status === "dismissed"
          ? (rx._dismissedAt ?? guard?.at ?? new Date().toISOString())
          : null;
      const dismissedReason =
        status === "dismissed" ? (rx._dismissedReason ?? guard?.reason ?? "") : "";
      params.push(
        newId(), r.dedupKey, r.name, r.sector, r.subsector ?? "", r.naics ?? "",
        r.city ?? "", r.state ?? "AZ", r.address ?? "", r.zip ?? "",
        r.contactName ?? "", r.contactTitle ?? "", r.phone ?? "", r.website ?? "",
        r.formedDate ?? "", r.employees ?? null, r.signalValue ?? null, r.signalLabel ?? "",
        r.source, r.sourceUrl ?? "", r.details ?? "",
        status,
        rx._firstSeen ?? new Date().toISOString(),
        rx._dateAdded ?? rx._firstSeen ?? new Date().toISOString(),
        dismissedAt,
        dismissedReason
      );
    });
    await db.query(
      `INSERT INTO mi_companies (id, dedup_key, name, sector, subsector, naics, city, state, address, zip,
         contact_name, contact_title, phone, website, formed_date, employees, signal_value, signal_label,
         source, source_url, details, status, first_seen, date_added, dismissed_at, dismissed_reason)
       VALUES ${values.join(", ")}
       ON CONFLICT (source, dedup_key, sector) DO UPDATE SET
         name = EXCLUDED.name, sector = EXCLUDED.sector, subsector = EXCLUDED.subsector, naics = EXCLUDED.naics,
         city = EXCLUDED.city, address = EXCLUDED.address, zip = EXCLUDED.zip, contact_name = EXCLUDED.contact_name,
         contact_title = EXCLUDED.contact_title, phone = EXCLUDED.phone, website = EXCLUDED.website,
         formed_date = EXCLUDED.formed_date, employees = EXCLUDED.employees, signal_value = EXCLUDED.signal_value,
         signal_label = EXCLUDED.signal_label, source_url = EXCLUDED.source_url, details = EXCLUDED.details,
         status = CASE
           WHEN mi_companies.status IN ('dismissed', 'keep', 'added') THEN mi_companies.status
           ELSE EXCLUDED.status
         END,
         dismissed_at = CASE
           WHEN mi_companies.status IN ('dismissed', 'keep', 'added') THEN mi_companies.dismissed_at
           ELSE EXCLUDED.dismissed_at
         END,
         dismissed_reason = CASE
           WHEN mi_companies.status IN ('dismissed', 'keep', 'added') THEN mi_companies.dismissed_reason
           ELSE EXCLUDED.dismissed_reason
         END,
         last_seen = NOW(), updated_at = NOW()`,
      params
    );
  }
  // Ground-truth total for this source (the RETURNING-based insert count
  // proved unreliable through the HTTP driver on multi-row chunks).
  const sectors = Array.from(new Set(clean.map((r) => r.sector).filter(Boolean)));
  const cnt = sectors.length
    ? await db`SELECT count(*)::int AS n FROM mi_companies WHERE source = ${source} AND sector = ANY(${sectors})`
    : await db`SELECT count(*)::int AS n FROM mi_companies WHERE source = ${source}`;
  return { received: clean.length, total: numOrNull(cnt[0]?.n) ?? 0 };
}

export interface ConsolidateRow extends CompanyInput {
  /** "source|dedupKey" keys of the member rows this consolidated row replaces. */
  absorb: string[];
}

const STATUS_RANK: Record<string, number> = { new: 0, fit: 1, dismissed: 2, keep: 3, added: 4 };

/**
 * Replace groups of duplicate member rows (same company, many locations /
 * registrations, possibly spanning sectors and sources) with one consolidated
 * row per company. Fit is re-judged by computeFit on the consolidated numbers
 * at insert. Triage status carries over from the best-ranked absorbed row.
 */
export async function consolidateCompanies(rowsIn: ConsolidateRow[]): Promise<{ groups: number; absorbed: number }> {
  await ensureSchema();
  const db = sql();
  const keyOf = (s: string, d: string) => `${s}|${d}`;
  // (a) Dedupe the consolidated rows themselves by (source, dedupKey).
  // Two distinct groups can slugify to the same ENT key (long names share
  // a truncated slug); left in one payload they collide in the import's
  // multi-row INSERT and abort it. Merge their absorb lists into one row.
  const rowByKey: Record<string, ConsolidateRow> = {};
  const rowOrder: string[] = [];
  for (const r of rowsIn) {
    const k = keyOf(r.source, r.dedupKey);
    const prev = rowByKey[k];
    if (prev) {
      const abs: Record<string, true> = {};
      for (const a of prev.absorb ?? []) abs[a] = true;
      for (const a of r.absorb ?? []) abs[a] = true;
      prev.absorb = Object.keys(abs);
    } else {
      rowByKey[k] = r;
      rowOrder.push(k);
    }
  }
  const rows = rowOrder.map((k) => rowByKey[k]);
  // A consolidated row's own key is never deleted below: when a prior
  // consolidated row is re-absorbed into its own successor (same key), the
  // import updates it in place — deleting it would erase the replacement.
  const ownKeys: Record<string, true> = {};
  for (const k of rowOrder) ownKeys[k] = true;
  const seenStatus: Record<string, true> = {};
  const statusKeys: string[] = [];
  const seenKeys: Record<string, true> = {};
  const absorbKeys: string[] = [];
  for (const r of rows) {
    for (const k of r.absorb ?? []) {
      if (!seenStatus[k]) {
        seenStatus[k] = true;
        statusKeys.push(k);
      }
      if (!seenKeys[k] && !ownKeys[k]) {
        seenKeys[k] = true;
        absorbKeys.push(k);
      }
    }
  }
  // Read absorbed statuses before any write (triage carry-over).
  const statusByKey = new Map<string, string>();
  for (let i = 0; i < statusKeys.length; i += 1500) {
    const chunk = statusKeys.slice(i, i + 1500);
    const found = await db`SELECT source, dedup_key, status FROM mi_companies WHERE (source || '|' || dedup_key) = ANY(${chunk})`;
    for (const f of found as unknown as Record<string, unknown>[]) {
      statusByKey.set(keyOf(String(f.source), String(f.dedup_key)), String(f.status));
    }
  }
  // (b) Import the consolidated replacement rows FIRST. The absorbed
  // member rows are deleted only after every import has succeeded: a
  // failed import now leaves duplicates behind (the next consolidation
  // run re-groups and heals them) instead of the Oct 9, 2026 data loss,
  // where members were deleted first and a mid-import abort erased them.
  const bySource = new Map<string, ConsolidateRow[]>();
  const sourceOrder: string[] = [];
  for (const r of rows) {
    if (!bySource.has(r.source)) sourceOrder.push(r.source);
    const list = bySource.get(r.source) ?? [];
    list.push(r);
    bySource.set(r.source, list);
  }
  for (const source of sourceOrder) {
    await importCompanies(source, bySource.get(source) ?? [], false);
  }
  for (let i = 0; i < absorbKeys.length; i += 1500) {
    const chunk = absorbKeys.slice(i, i + 1500);
    await db`DELETE FROM mi_companies WHERE (source || '|' || dedup_key) = ANY(${chunk})`;
  }
  const keysByStatus = new Map<string, string[]>();
  const statusOrder: string[] = [];
  for (const r of rows) {
    let best = "new";
    for (const k of r.absorb ?? []) {
      const s = statusByKey.get(k);
      if (s && (STATUS_RANK[s] ?? 0) > (STATUS_RANK[best] ?? 0)) best = s;
    }
    if (best !== "new") {
      if (!keysByStatus.has(best)) statusOrder.push(best);
      const list = keysByStatus.get(best) ?? [];
      list.push(keyOf(r.source, r.dedupKey));
      keysByStatus.set(best, list);
    }
  }
  for (const status of statusOrder) {
    const keys = keysByStatus.get(status) ?? [];
    for (let i = 0; i < keys.length; i += 1500) {
      const chunk = keys.slice(i, i + 1500);
      await db`UPDATE mi_companies SET status = ${status} WHERE (source || '|' || dedup_key) = ANY(${chunk})`;
    }
  }
  return { groups: rows.length, absorbed: absorbKeys.length };
}

/** Active fits = rows in the fit STAGE (status='fit'). Since Oct 16,
 * 2026 this — not the details stamp — is the count every surface
 * reconciles to (Fit Targets pills, the section counter, Overview
 * tiles, hospitality meta). details.fit stays the rule verdict that
 * feeds the stage at import/rescore time. */
export async function countFits(sector?: string): Promise<number> {
  await ensureSchema();
  await runFitStageMigration();
  const db = sql();
  const rows = sector
    ? await db`SELECT COUNT(*)::int AS c FROM mi_companies WHERE sector = ${sector} AND status = 'fit'`
    : await db`SELECT COUNT(*)::int AS c FROM mi_companies WHERE status = 'fit'`;
  return Number((rows as unknown as { c: number }[])[0]?.c ?? 0);
}

/** Re-run the fit rules over EXISTING rows (paged, resumable) after a rule
 * change, without waiting for the weekly spine rebuild. Only the fit
 * stamps inside details are touched — fit / fitWhy / fitUnscored /
 * estRevenue; every other details key (consolidation, members, enrichment)
 * is preserved. The fit STAGE follows the verdict for rows in the
 * automatic stages ('new'/'fit'); human stages never move. Returns the
 * next offset, or -1 when the sector is done. */
function rowToCompanyInput(r: Record<string, unknown>): CompanyInput {
  return {
    dedupKey: str(r.dedup_key), name: str(r.name), sector: str(r.sector),
    subsector: str(r.subsector), naics: str(r.naics), city: str(r.city),
    state: str(r.state), address: str(r.address), zip: str(r.zip),
    contactName: str(r.contact_name), contactTitle: str(r.contact_title),
    phone: str(r.phone), website: str(r.website), formedDate: str(r.formed_date),
    employees: numOrNull(r.employees), signalValue: numOrNull(r.signal_value),
    signalLabel: str(r.signal_label), source: str(r.source), sourceUrl: str(r.source_url),
    details: str(r.details),
  };
}

/** Re-judge ONE company row's fit stamps in place. Returns the new
 * details JSON, whether the fit stamps changed, and the fit verdict
 * itself (the rescore paths use it to keep the fit STAGE in step —
 * only for rows in the automatic stages 'new'/'fit'; dismissed /
 * keep / added are human decisions an ingest never overrides).
 * Non-JSON details pass through untouched, as at import. */
function judgeDetails(input: CompanyInput): { details: string; changed: boolean; fit: boolean } {
  const { fit, why, unscored, estRevenue } = computeFit(input);
  let d: Record<string, unknown> = {};
  try {
    d = input.details ? (JSON.parse(input.details) as Record<string, unknown>) : {};
  } catch {
    return { details: input.details ?? "", changed: false, fit: false };
  }
  const before = JSON.stringify({ f: d.fit, w: d.fitWhy, u: d.fitUnscored, e: d.estRevenue });
  if (fit) { d.fit = true; d.fitWhy = why; } else { delete d.fit; delete d.fitWhy; }
  if (unscored) d.fitUnscored = true; else delete d.fitUnscored;
  if (typeof estRevenue === "number") d.estRevenue = estRevenue;
  else if (estRevenue === null) delete d.estRevenue;
  else if (typeof d.revenueEstimate === "number") d.estRevenue = d.revenueEstimate;
  const after = JSON.stringify({ f: d.fit, w: d.fitWhy, u: d.fitUnscored, e: d.estRevenue });
  return { details: JSON.stringify(d), changed: before !== after, fit };
}

/** The stage a re-judged row should hold: automatic stages follow the
 * fit verdict; human stages (dismissed / keep / added) never move. */
function stageAfterRejudge(current: string, fit: boolean): string {
  if (current === "new" || current === "fit") return fit ? "fit" : "new";
  return current;
}

export async function rescoreCompanies(sector: string | undefined, offset: number, pageSize = 1500): Promise<{ processed: number; changed: number; nextOffset: number }> {
  await ensureSchema();
  await runFitStageMigration();
  await refreshHospitalityThresholds();
  const db = sql();
  const rows = sector
    ? await db`SELECT * FROM mi_companies WHERE sector = ${sector} ORDER BY id LIMIT ${pageSize} OFFSET ${offset}`
    : await db`SELECT * FROM mi_companies ORDER BY id LIMIT ${pageSize} OFFSET ${offset}`;
  let changed = 0;
  for (const r of rows) {
    const input = rowToCompanyInput(r as Record<string, unknown>);
    const judged = judgeDetails(input);
    const stage = stageAfterRejudge(str(r.status), judged.fit);
    if (judged.changed || stage !== str(r.status)) {
      await db`UPDATE mi_companies SET details = ${judged.details}, status = ${stage} WHERE id = ${r.id}`;
      changed++;
    }
  }
  return { processed: rows.length, changed, nextOffset: rows.length < pageSize ? -1 : offset + rows.length };
}

/** Targeted re-judge of specific company rows (used by enrichment
 * stampers — e.g. the ADHS ingest — that change details inputs like
 * adhsUnits on a known set of rows and need their fit stamps refreshed
 * without paging the whole sector). Returns how many rows changed. */
export async function rescoreCompaniesByIds(ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  await ensureSchema();
  await runFitStageMigration();
  await refreshHospitalityThresholds();
  const db = sql();
  let changed = 0;
  const CHUNK = 400;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const rows = await db.query(`SELECT * FROM mi_companies WHERE id = ANY($1)`, [chunk]);
    for (const r of rows as Record<string, unknown>[]) {
      const input = rowToCompanyInput(r);
      const judged = judgeDetails(input);
      const stage = stageAfterRejudge(str(r.status), judged.fit);
      if (judged.changed || stage !== str(r.status)) {
        await db`UPDATE mi_companies SET details = ${judged.details}, status = ${stage} WHERE id = ${r.id as string}`;
        changed++;
      }
    }
  }
  return changed;
}

/** Companies held in the "unscored" bucket (no derivable revenue estimate —
 * see the healthcare branch of computeFit). */
export async function countUnscored(sector?: string): Promise<number> {
  await ensureSchema();
  const db = sql();
  const rows = sector
    ? await db`SELECT COUNT(*)::int AS c FROM mi_companies WHERE sector = ${sector} AND details LIKE '{%' AND (details::jsonb ->> 'fitUnscored') = 'true'`
    : await db`SELECT COUNT(*)::int AS c FROM mi_companies WHERE details LIKE '{%' AND (details::jsonb ->> 'fitUnscored') = 'true'`;
  return Number((rows as unknown as { c: number }[])[0]?.c ?? 0);
}

export interface UpdateItem {
  kind: "business" | "license" | "listing" | "operator" | "multiple" | "acquisition";
  title: string;
  detail: string;
  ts: string;
}

/**
 * "Updates" cards for Market Intel (Ethan, Oct 9, 2026): aggregate DELTA
 * cards only — never individual items. "+N new companies / licensed
 * contractors" per registry source (first_seen in the last 7 days;
 * consolidated merge rows excluded), "+N new businesses for sale",
 * "+N local acquisitions", and multiple moves between stored
 * vintages (shown as from → to so the move is self-verifying; fires
 * only when two distinct vintages exist). Companies merge into ONE
 * card per kind across all sources. Operators are NOT shown here
 * (Ethan, Oct 9, 2026).
 */
export async function getUpdates(): Promise<UpdateItem[]> {
  await ensureSchema();
  const db = sql();
  const items: UpdateItem[] = [];
  const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
  // Counts come from COUNT(*) aggregates — the old code counted a
  // LIMIT 400 sample, so the card silently capped at +400 whenever
  // more than 400 rows were new (e.g. after the Oct 9 rebuild).
  // Focus-sector counts only (Ethan, Oct 14, 2026): new companies and
  // new licenses count only in A&D, healthcare, advanced manufacturing,
  // specialty trades & construction, and hospitality — no all-sector totals.
  const FOCUS_SECTORS = ["Aerospace & Defense", "Healthcare", "Advanced Manufacturing", "Specialty Trades & Construction", "Hospitality"];
  const compAgg = (await db`
    SELECT (CASE WHEN source LIKE '%ROC%' THEN 'license' ELSE 'business' END) AS kind,
           COUNT(*)::int AS n, MAX(first_seen) AS latest
    FROM mi_companies
    WHERE first_seen >= ${cutoff} AND sector = ANY(${FOCUS_SECTORS}) AND details LIKE '{%' AND (details::jsonb ->> 'consolidated') IS DISTINCT FROM 'true'
    GROUP BY 1 ORDER BY latest DESC`) as unknown as Record<string, unknown>[];
  const compLatest = (await db`
    SELECT DISTINCT ON ((CASE WHEN source LIKE '%ROC%' THEN 'license' ELSE 'business' END))
           (CASE WHEN source LIKE '%ROC%' THEN 'license' ELSE 'business' END) AS kind,
           name, sector, city, first_seen
    FROM mi_companies
    WHERE first_seen >= ${cutoff} AND sector = ANY(${FOCUS_SECTORS}) AND details LIKE '{%' AND (details::jsonb ->> 'consolidated') IS DISTINCT FROM 'true'
    ORDER BY 1, first_seen DESC`) as unknown as Record<string, unknown>[];
  for (const agg of compAgg) {
    const kind = String(agg.kind) as UpdateItem["kind"];
    const top = compLatest.find((r) => String(r.kind) === kind);
    if (!top) continue;
    items.push({
      kind,
      title: `+${Number(agg.n)} new ${kind === "license" ? "licensed contractors" : "companies"}`,
      detail: `Latest: ${String(top.name)}${top.city ? ` · ${String(top.city)}` : ""} · ${String(top.sector)}`,
      ts: String(agg.latest ?? top.first_seen),
    });
  }
  const listAgg = (await db`SELECT COUNT(*)::int AS n, MAX(first_seen) AS latest FROM mi_listings WHERE first_seen >= ${cutoff}`) as unknown as Record<string, unknown>[];
  const listCount = Number(listAgg[0]?.n ?? 0);
  if (listCount > 0) {
    const listLatest = (await db`SELECT title FROM mi_listings WHERE first_seen >= ${cutoff} ORDER BY first_seen DESC LIMIT 1`) as unknown as Record<string, unknown>[];
    items.push({
      kind: "listing",
      title: `+${listCount} new businesses for sale`,
      detail: listLatest[0]?.title ? `Latest: ${String(listLatest[0].title)}` : "Added in the last 7 days",
      ts: String(listAgg[0]?.latest ?? cutoff),
    });
  }
  // The "+N local acquisitions" tile was REMOVED Oct 14, 2026 (Ethan):
  // replaced by the Competing Buyers table in the Acquisitions & Filings
  // tab (see getCompetingBuyers) and the tab's filings badge.
  const multRows = (await db`SELECT industry, size_band, period, ev_ebitda_median, ev_revenue_median, created_at FROM mi_multiples ORDER BY industry ASC, size_band ASC, period ASC`) as unknown as Record<string, unknown>[];
  const multKeys: string[] = [];
  const multGroups = new Map<string, Record<string, unknown>[]>();
  for (const r of multRows) {
    const key = `${String(r.industry)}|${String(r.size_band)}`;
    if (!multGroups.has(key)) multKeys.push(key);
    const list = multGroups.get(key) ?? [];
    list.push(r);
    multGroups.set(key, list);
  }
  for (const key of multKeys) {
    const list = multGroups.get(key) ?? [];
    if (list.length < 2) continue;
    const cur = list[list.length - 1];
    const prev = list[list.length - 2];
    for (const [field, label] of [["ev_ebitda_median", "EV/EBITDA"], ["ev_revenue_median", "EV/Revenue"]] as const) {
      const a = typeof prev[field] === "number" ? (prev[field] as number) : null;
      const b = typeof cur[field] === "number" ? (cur[field] as number) : null;
      if (a !== null && b !== null && Math.abs(b - a) >= 0.25) {
        const d = b - a;
        items.push({
          kind: "multiple",
          title: String(cur.industry),
          detail: `${label} ${a.toFixed(1)}× → ${b.toFixed(1)}× (${d >= 0 ? "+" : ""}${d.toFixed(1)}×) · ${String(cur.size_band)}`,
          ts: String(cur.created_at),
        });
        break;
      }
    }
  }
  // Operators intentionally NOT shown in Updates (Ethan, Oct 9, 2026).
  items.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  return items.slice(0, 14);
}

export async function countCompanies(sector?: string): Promise<number> {
  await ensureSchema();
  const db = sql();
  const rows = sector
    ? await db`SELECT count(*)::int AS n FROM mi_companies WHERE sector = ${sector}`
    : await db`SELECT count(*)::int AS n FROM mi_companies`;
  return numOrNull(rows[0]?.n) ?? 0;
}

function mapCompanyRow(r: Record<string, unknown>): MiCompany {
  return {
    id: str(r.id), dedupKey: str(r.dedup_key), name: str(r.name), sector: str(r.sector),
    subsector: str(r.subsector), naics: str(r.naics), city: str(r.city), state: str(r.state),
    address: str(r.address), zip: str(r.zip), contactName: str(r.contact_name),
    contactTitle: str(r.contact_title), phone: str(r.phone), website: str(r.website),
    formedDate: str(r.formed_date), employees: numOrNull(r.employees),
    signalValue: numOrNull(r.signal_value), signalLabel: str(r.signal_label),
    source: str(r.source), sourceUrl: str(r.source_url), details: str(r.details),
    status: str(r.status) as MiCompany["status"],
    firstSeen: String(r.first_seen), lastSeen: String(r.last_seen),
    dateAdded: String(r.date_added ?? r.first_seen ?? ""),
    dismissedAt: r.dismissed_at ? String(r.dismissed_at) : null,
    dismissedReason: str(r.dismissed_reason),
  };
}

export async function getCompanies(sector?: string, limit = 600, offset = 0): Promise<MiCompany[]> {
  await ensureSchema();
  const db = sql();
  const lim = Math.min(Math.max(limit, 1), 5000);
  const off = Math.max(offset, 0);
  const rows = sector
    ? await db`SELECT * FROM mi_companies WHERE sector = ${sector} ORDER BY signal_value DESC NULLS LAST, employees DESC NULLS LAST, name ASC LIMIT ${lim} OFFSET ${off}`
    : await db`SELECT * FROM mi_companies ORDER BY signal_value DESC NULLS LAST, employees DESC NULLS LAST, name ASC LIMIT ${lim} OFFSET ${off}`;
  return rows.map((r) => mapCompanyRow(r as Record<string, unknown>));
}

export async function setCompanyStatus(id: string, status: MiCompany["status"]): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mi_companies SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;
}

/** The Fit Targets section feed (Ethan, Oct 16, 2026): active fits
 * (status='fit') ONLY, ALWAYS newest date_added first — never sorted
 * by score — capped at FITS_DISPLAY_LIMIT. Backfill is inherent: the
 * query always returns the current top-N, so when a fit leaves the
 * stage the next most recently added fit slides in on the next read.
 * fitTotal is the uncapped count of active fits in the same scope. */
export async function getFitCompanies(sectors?: string[]): Promise<{ companies: MiCompany[]; fitTotal: number }> {
  await ensureSchema();
  await runFitStageMigration();
  const db = sql();
  const list = (sectors ?? []).filter(Boolean);
  const totalRows = list.length
    ? await db`SELECT COUNT(*)::int AS c FROM mi_companies WHERE status = 'fit' AND sector = ANY(${list})`
    : await db`SELECT COUNT(*)::int AS c FROM mi_companies WHERE status = 'fit'`;
  const rows = list.length
    ? await db`SELECT * FROM mi_companies WHERE status = 'fit' AND sector = ANY(${list}) ORDER BY date_added DESC NULLS LAST, first_seen DESC, id DESC LIMIT ${FITS_DISPLAY_LIMIT}`
    : await db`SELECT * FROM mi_companies WHERE status = 'fit' ORDER BY date_added DESC NULLS LAST, first_seen DESC, id DESC LIMIT ${FITS_DISPLAY_LIMIT}`;
  return {
    companies: rows.map((r) => mapCompanyRow(r as Record<string, unknown>)),
    fitTotal: Number((totalRows as unknown as { c: number }[])[0]?.c ?? 0),
  };
}

/** Dismiss a company (fit-stage exit with tracking): stamps
 * dismissed_at + the optional reason. Dismissal is sticky — see the
 * guards in importCompanies. */
export async function dismissCompany(id: string, reason = ""): Promise<void> {
  await ensureSchema();
  await runFitStageMigration();
  await sql()`
    UPDATE mi_companies
    SET status = 'dismissed', dismissed_at = NOW(),
        dismissed_reason = ${reason.trim().slice(0, 300)}, updated_at = NOW()
    WHERE id = ${id}`;
}

/** Restore a dismissed company: back to status='fit' when its fit
 * stamp still stands (else 'new'), dismissal stamps cleared. Its
 * date_added never moved, so it re-enters the section at its
 * original position. Returns the new status. */
export async function restoreCompany(id: string): Promise<MiCompany["status"]> {
  await ensureSchema();
  await runFitStageMigration();
  const db = sql();
  const rows = await db`SELECT details FROM mi_companies WHERE id = ${id}`;
  let fit = false;
  try {
    fit = (JSON.parse(str(rows[0]?.details || "{}")) as Record<string, unknown>).fit === true;
  } catch {
    fit = false;
  }
  const status = (fit ? "fit" : "new") as MiCompany["status"];
  await db`
    UPDATE mi_companies
    SET status = ${status}, dismissed_at = NULL, dismissed_reason = '', updated_at = NOW()
    WHERE id = ${id}`;
  return status;
}

/** Keep-mark a company. On a fit, the mark is details.kept and the
 * stage stays 'fit' (the record keeps its place in the fits
 * section); on any other row it is the classic status='keep'.
 * Returns the resulting status. */
export async function keepCompany(id: string): Promise<MiCompany["status"]> {
  await ensureSchema();
  await runFitStageMigration();
  const db = sql();
  const rows = await db`SELECT status, details FROM mi_companies WHERE id = ${id}`;
  if (!rows.length) return "new";
  if (str(rows[0].status) === "fit") {
    let d: Record<string, unknown> = {};
    try {
      d = JSON.parse(str(rows[0].details || "{}")) as Record<string, unknown>;
    } catch {
      d = {};
    }
    d.kept = true;
    await db`UPDATE mi_companies SET details = ${JSON.stringify(d)}, updated_at = NOW() WHERE id = ${id}`;
    return "fit";
  }
  await db`UPDATE mi_companies SET status = 'keep', updated_at = NOW() WHERE id = ${id}`;
  return "keep";
}

/* ---------------- Multiples ---------------- */

export interface MultipleInput {
  sourceReport: string;
  period: string;
  industry?: string;
  sizeBand?: string;
  evEbitdaLow?: number | null;
  evEbitdaHigh?: number | null;
  evEbitdaMedian?: number | null;
  evRevenueMedian?: number | null;
  notes?: string;
}

export async function addMultiple(m: MultipleInput): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO mi_multiples (id, source_report, period, industry, size_band, ev_ebitda_low, ev_ebitda_high, ev_ebitda_median, ev_revenue_median, notes)
    VALUES (${newId()}, ${m.sourceReport}, ${m.period}, ${m.industry ?? ""}, ${m.sizeBand ?? ""},
            ${m.evEbitdaLow ?? null}, ${m.evEbitdaHigh ?? null}, ${m.evEbitdaMedian ?? null},
            ${m.evRevenueMedian ?? null}, ${m.notes ?? ""})`;
}

/** Replace-vintage support: auto-ingests delete their period's rows before re-adding. */
export async function deleteMultiples(sourceReport: string, period: string): Promise<void> {
  await ensureSchema();
  await sql()`DELETE FROM mi_multiples WHERE source_report = ${sourceReport} AND period = ${period}`;
}

export async function getMultiples(): Promise<MiMultiple[]> {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM mi_multiples ORDER BY created_at DESC`;
  return rows.map((r) => ({
    id: str(r.id), sourceReport: str(r.source_report), period: str(r.period),
    industry: str(r.industry), sizeBand: str(r.size_band),
    evEbitdaLow: numOrNull(r.ev_ebitda_low), evEbitdaHigh: numOrNull(r.ev_ebitda_high),
    evEbitdaMedian: numOrNull(r.ev_ebitda_median), evRevenueMedian: numOrNull(r.ev_revenue_median),
    notes: str(r.notes), createdAt: String(r.created_at),
  }));
}

/* ---------------- Acquisitions ---------------- */

export interface AcquisitionInput {
  acquirer: string;
  target: string;
  targetLocation?: string;
  industry?: string;
  dealValue?: number | null;
  announcedDate?: string;
  sourceUrl: string;
  publisher?: string;
  eventType?: "acquisition" | "bankruptcy" | "expansion" | "contract" | "relocation" | "ipo" | "policy" | "investment";
  headline?: string;
  summary?: string;
}

function normName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|the|group|holdings)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function upsertAcquisitions(rows: AcquisitionInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  let added = 0;
  // Existing events for near-duplicate detection (same company + event type
  // within a few days = same story via a different publisher/URL).
  const existing = await db`
    SELECT target, acquirer, event_type, announced_date FROM mi_acquisitions
    WHERE announced_date >= to_char(CURRENT_DATE - INTERVAL '45 days', 'YYYY-MM-DD')`;
  const seenKeys = new Set(
    existing.map(
      (e) =>
        `${str(e.event_type)}|${normName(str(e.target))}|${str(e.announced_date).slice(0, 7)}`
    )
  );
  for (const r of rows) {
    if (!r.sourceUrl) continue;
    const key = `${r.eventType ?? "acquisition"}|${normName(r.target ?? "")}|${(r.announcedDate ?? "").slice(0, 7)}`;
    if (r.target && seenKeys.has(key)) continue;
    seenKeys.add(key);
    const res = await db`
      INSERT INTO mi_acquisitions (id, acquirer, target, target_location, industry, deal_value, announced_date, source_url, publisher, event_type, summary, headline)
      VALUES (${newId()}, ${r.acquirer ?? ""}, ${r.target ?? ""}, ${r.targetLocation ?? ""}, ${r.industry ?? ""},
              ${r.dealValue ?? null}, ${r.announcedDate ?? ""}, ${r.sourceUrl}, ${r.publisher ?? ""},
              ${r.eventType ?? "acquisition"}, ${r.summary ?? ""}, ${r.headline ?? ""})
      ON CONFLICT (source_url) DO NOTHING
      RETURNING (xmax = 0) AS inserted`;
    if (res[0]?.inserted) added++;
  }
  return added;
}

export async function getAcquisitions(status?: string): Promise<MiAcquisition[]> {
  await ensureSchema();
  const db = sql();
  const rows = status && status !== "all"
    ? await db`SELECT * FROM mi_acquisitions WHERE status = ${status} ORDER BY created_at DESC LIMIT 200`
    : await db`SELECT * FROM mi_acquisitions ORDER BY created_at DESC LIMIT 200`;
  return rows.map((r) => ({
    id: str(r.id), acquirer: str(r.acquirer), target: str(r.target),
    targetLocation: str(r.target_location), industry: str(r.industry),
    dealValue: numOrNull(r.deal_value), announcedDate: str(r.announced_date),
    sourceUrl: str(r.source_url), publisher: str(r.publisher),
    eventType: (str(r.event_type) || "acquisition") as MiAcquisition["eventType"],
    headline: str(r.headline),
    summary: str(r.summary),
    status: str(r.status) as MiAcquisition["status"], createdAt: String(r.created_at),
  }));
}

export async function setAcquisitionStatus(id: string, status: MiAcquisition["status"]): Promise<void> {  await ensureSchema();
  await sql()`UPDATE mi_acquisitions SET status = ${status} WHERE id = ${id}`;
}

/** Enriched summary written back by the events agent after reading the
 * source article (real amounts/jobs/details the headline omits). */
export async function updateAcquisitionSummary(
  id: string,
  summary: string,
  dealValue?: number | null,
  headline?: string
): Promise<void> {
  await ensureSchema();
  const db = sql();
  if (headline !== undefined && headline.trim()) {
    if (dealValue !== undefined && dealValue !== null) {
      await db`UPDATE mi_acquisitions SET summary = ${summary}, deal_value = ${dealValue}, headline = ${headline.trim()} WHERE id = ${id}`;
    } else {
      await db`UPDATE mi_acquisitions SET summary = ${summary}, headline = ${headline.trim()} WHERE id = ${id}`;
    }
  } else if (dealValue !== undefined && dealValue !== null) {
    await db`UPDATE mi_acquisitions SET summary = ${summary}, deal_value = ${dealValue} WHERE id = ${id}`;
  } else {
    await db`UPDATE mi_acquisitions SET summary = ${summary} WHERE id = ${id}`;
  }
}

export async function updateAcquisitionHeadline(id: string, headline: string): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mi_acquisitions SET headline = ${headline} WHERE id = ${id}`;
}

export async function updateAcquisitionIndustry(id: string, industry: string): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mi_acquisitions SET industry = ${industry} WHERE id = ${id}`;
}

/** Remove un-triaged bankruptcy news rows (used to re-ingest with a tighter filter). */
export async function clearNewBankruptcyNews(): Promise<number> {
  await ensureSchema();
  const res = (await sql()`DELETE FROM mi_acquisitions WHERE event_type = 'bankruptcy' AND status = 'new'`) as unknown as { count?: number };
  return Number(res.count ?? 0);
}

/* ---------------- Filings ---------------- */


/* ---------- Filing classification (Ethan, Oct 14, 2026 rework) ----------
 * "AZ company" = Arizona PRINCIPAL place of business (EDGAR submissions
 * business address), and the filer must map to one of the five focus
 * sectors via SIC. Asset-backed / funding-vehicle filers are excluded. */
export const FILING_FOCUS_SECTORS = ["Aerospace & Defense", "Healthcare", "Advanced Manufacturing", "Specialty Trades & Construction", "Hospitality"];

export function sicToSector(sicRaw: string): string {
  const sic = parseInt(String(sicRaw || "").replace(/\D/g, ""), 10);
  if (!sic || Number.isNaN(sic)) return "";
  if (sic >= 1500 && sic <= 1799) return "Specialty Trades & Construction";
  if ((sic >= 5800 && sic <= 5899) || (sic >= 7000 && sic <= 7099) || (sic >= 7900 && sic <= 7999)) return "Hospitality";
  if (sic >= 8000 && sic <= 8099) return "Healthcare";
  if (sic >= 2833 && sic <= 2836) return "Healthcare"; // pharmaceuticals
  if (sic >= 3841 && sic <= 3851) return "Healthcare"; // medical / dental instruments & supplies
  if (sic === 8731) return "Healthcare"; // biotech R&D
  if ((sic >= 3720 && sic <= 3729) || (sic >= 3760 && sic <= 3769) || (sic >= 3480 && sic <= 3489) || sic === 3812)
    return "Aerospace & Defense";
  if (sic >= 2000 && sic <= 3999) return "Advanced Manufacturing";
  return "";
}

/** SPV / asset-backed issuer screen (Ethan's rule): funding vehicles,
 * receivables trusts and issuers, plus SIC 6189 / 6199 (asset-backed). */
export function isSpvFiler(name: string, sic: string): boolean {
  if (sic === "6189" || sic === "6199") return true;
  return /\b(Funding|Receivables|Trust|Issuer)\b/i.test(name || "");
}

export interface FilerProfile {
  cik: string;
  name: string;
  sic: string;
  sicDesc: string;
  bizState: string;
  mailState: string;
  sector: string;
}

export async function getFilerProfiles(ciks: string[]): Promise<Map<string, FilerProfile>> {
  const out = new Map<string, FilerProfile>();
  if (!ciks.length) return out;
  await ensureSchema();
  const rows = (await sql()`SELECT * FROM mi_filer_profiles WHERE cik = ANY(${ciks})`) as unknown as Record<string, unknown>[];
  for (const r of rows)
    out.set(str(r.cik), {
      cik: str(r.cik), name: str(r.name), sic: str(r.sic), sicDesc: str(r.sic_desc),
      bizState: str(r.biz_state), mailState: str(r.mail_state), sector: str(r.sector),
    });
  return out;
}

export async function upsertFilerProfile(p: FilerProfile): Promise<void> {
  await ensureSchema();
  await sql()`
    INSERT INTO mi_filer_profiles (cik, name, sic, sic_desc, biz_state, mail_state, sector, updated_at)
    VALUES (${p.cik}, ${p.name}, ${p.sic}, ${p.sicDesc}, ${p.bizState}, ${p.mailState}, ${p.sector}, NOW())
    ON CONFLICT (cik) DO UPDATE SET name = EXCLUDED.name, sic = EXCLUDED.sic, sic_desc = EXCLUDED.sic_desc,
      biz_state = EXCLUDED.biz_state, mail_state = EXCLUDED.mail_state, sector = EXCLUDED.sector, updated_at = NOW()`;
}

/** Strip EDGAR display-name decorations: "Foo, Inc. (FOO) (CIK 0001234)". */
export function cleanFilerName(displayName: string): string {
  return String(displayName || "")
    .replace(/\s*\(CIK\s+\d+\)\s*$/i, "")
    .replace(/\s*\([A-Z][A-Z0-9.\-]{0,5}\)\s*$/, "")
    .trim();
}

export interface FilingInput {
  form: string;
  company: string;
  cik?: string;
  filingDate?: string;
  accession: string;
  category: MiFilingCategory;
  summary?: string;
  url?: string;
  azCompany?: boolean;
  majorEvent?: boolean;
  sector?: string;
  tag?: string;
  why?: string;
  details?: string;
  sic?: string;
}

export async function upsertFilings(rows: FilingInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  let added = 0;
  for (const r of rows) {
    if (!r.accession) continue;
    const res = await db`
      INSERT INTO mi_filings (id, form, company, cik, filing_date, accession, category, summary, url, az_company, major_event, sector, tag, why, details, sic)
      VALUES (${newId()}, ${r.form}, ${r.company ?? ""}, ${r.cik ?? ""}, ${r.filingDate ?? ""},
              ${r.accession}, ${r.category}, ${r.summary ?? ""}, ${r.url ?? ""},
              ${r.azCompany ?? false}, ${r.majorEvent ?? false},
              ${r.sector ?? ""}, ${r.tag ?? ""}, ${r.why ?? ""}, ${r.details ?? ""}, ${r.sic ?? ""})
      ON CONFLICT (accession) DO UPDATE SET
        az_company = CASE WHEN NOT mi_filings.az_company THEN EXCLUDED.az_company ELSE mi_filings.az_company END,
        major_event = CASE WHEN NOT mi_filings.major_event THEN EXCLUDED.major_event ELSE mi_filings.major_event END,
        summary = CASE WHEN EXCLUDED.summary <> '' THEN EXCLUDED.summary ELSE mi_filings.summary END,
        sector = CASE WHEN EXCLUDED.sector <> '' THEN EXCLUDED.sector ELSE mi_filings.sector END,
        tag = CASE WHEN EXCLUDED.tag <> '' THEN EXCLUDED.tag ELSE mi_filings.tag END,
        why = CASE WHEN EXCLUDED.why <> '' THEN EXCLUDED.why ELSE mi_filings.why END,
        details = CASE WHEN EXCLUDED.details <> '' THEN EXCLUDED.details ELSE mi_filings.details END,
        sic = CASE WHEN EXCLUDED.sic <> '' THEN EXCLUDED.sic ELSE mi_filings.sic END
      RETURNING (xmax = 0) AS inserted`;
    if (res[0]?.inserted) added++;
  }
  return added;
}

/** Filings are Arizona-based companies only (Ethan, Oct 2026): rows whose
 * filer isn't AZ-based are removed so the table can never drift back to
 * national filers. Big non-AZ companies surface via news / Major Events. */
export async function purgeNonAzFilings(): Promise<number> {
  await ensureSchema();
  const res = (await sql()`DELETE FROM mi_filings WHERE az_company IS NOT TRUE`) as unknown as { count?: number };
  return res.count ?? 0;
}

export async function getFilings(category?: string, status?: string, days?: number): Promise<MiFiling[]> {
  await ensureSchema();
  const db = sql();
  // Auto-dismiss rows that match Ethan's exclusion rules (Oct 14, 2026) so
  // legacy rows self-clean: periodic reports and SPV/funding-vehicle
  // names. Court bankruptcy rows are pre-filtered at ingest and exempt
  // from the name screen. Only "new" rows flip — a human Keep wins.
  await db`UPDATE mi_filings SET status = 'dismissed'
    WHERE status = 'new' AND category <> 'bankruptcy' AND (
      form IN ('10-K', '10-Q') OR company ~* '\\y(Funding|Receivables|Trust|Issuer)\\y')`;
  // Pre-rework SEC rows (inserted before Oct 15, 2026) that carry no
  // sector and no tag were never verified under the new gates — retire
  // them so the tab only shows classified filings. (Form D rows are
  // exempt: their classification lands via the enrichment pass.)
  await db`UPDATE mi_filings SET status = 'dismissed'
    WHERE status = 'new' AND category IN ('acquisition', 'expansion')
      AND sector = '' AND tag = '' AND created_at < '2026-10-15T00:00:00Z'`;
  const cutoff = days && days > 0 ? new Date(Date.now() - days * 864e5).toISOString().slice(0, 10) : null;
  let rows;
  if (category && category !== "all" && status && status !== "all")
    rows = await db`SELECT * FROM mi_filings WHERE category = ${category} AND status = ${status} AND (${cutoff}::text IS NULL OR filing_date >= ${cutoff}) ORDER BY filing_date DESC LIMIT 500`;
  else if (category && category !== "all")
    rows = await db`SELECT * FROM mi_filings WHERE category = ${category} AND (${cutoff}::text IS NULL OR filing_date >= ${cutoff}) ORDER BY filing_date DESC LIMIT 500`;
  else if (status && status !== "all")
    rows = await db`SELECT * FROM mi_filings WHERE status = ${status} AND (${cutoff}::text IS NULL OR filing_date >= ${cutoff}) ORDER BY filing_date DESC LIMIT 500`;
  else rows = await db`SELECT * FROM mi_filings WHERE (${cutoff}::text IS NULL OR filing_date >= ${cutoff}) ORDER BY filing_date DESC LIMIT 500`;
  return rows.map((r) => ({
    id: str(r.id), form: str(r.form), company: str(r.company), cik: str(r.cik),
    filingDate: str(r.filing_date), accession: str(r.accession),
    category: str(r.category) as MiFilingCategory, summary: str(r.summary), url: str(r.url),
    azCompany: Boolean(r.az_company), majorEvent: Boolean(r.major_event),
    status: str(r.status) as MiFiling["status"], createdAt: String(r.created_at),
    sector: str(r.sector), tag: str(r.tag), why: str(r.why), details: str(r.details), sic: str(r.sic),
  }));
}

/** Patch a filing's enrichment fields (Form D pass fills details/tag/
 * summary/why/sector after the base row lands). */
export async function updateFilingDetails(
  id: string,
  patch: { details?: string; tag?: string; summary?: string; why?: string; sector?: string }
): Promise<void> {
  await ensureSchema();
  const db = sql();
  const rows = (await db`SELECT details, tag, summary, why, sector FROM mi_filings WHERE id = ${id}`) as unknown as Record<string, unknown>[];
  if (!rows.length) return;
  const cur = rows[0];
  await db`UPDATE mi_filings SET
    details = ${patch.details ?? str(cur.details)},
    tag = ${patch.tag ?? str(cur.tag)},
    summary = ${patch.summary ?? str(cur.summary)},
    why = ${patch.why ?? str(cur.why)},
    sector = ${patch.sector ?? str(cur.sector)}
    WHERE id = ${id}`;
}

/** Form D rows still missing their enrichment payload (details = ''),
 * newest first — the ingest's Form D pass works through these. */
export async function getFilingsNeedingDetails(limit = 20): Promise<{ id: string; cik: string; accession: string; company: string; filingDate: string }[]> {
  await ensureSchema();
  const rows = (await sql()`SELECT id, cik, accession, company, filing_date FROM mi_filings
    WHERE category = 'form_d' AND details = '' ORDER BY filing_date DESC LIMIT ${limit}`) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: str(r.id), cik: str(r.cik), accession: str(r.accession),
    company: str(r.company), filingDate: str(r.filing_date),
  }));
}

/** The Filings tab's bankruptcy coverage is court-sourced now (Oct 14,
 * 2026) — retire un-triaged SEC 8-K bankruptcy rows so the category shows
 * only Arizona federal court filings. Human keeps are left alone. */
export async function retireSecBankruptcyFilings(): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mi_filings SET status = 'dismissed'
    WHERE category = 'bankruptcy' AND status = 'new' AND form = '8-K'`;
}

/** Best company-spine match for a free-text company name (normalized
 * exact / containment), or null. Used to sector bankruptcy debtors and
 * other name-only records against the focus-sector spine. */
export async function findCompanyMatchByName(name: string): Promise<{ sector: string; name: string } | null> {
  await ensureSchema();
  const db = sql();
  const norm = normCompanyName(cleanFilerName(name));
  if (!norm) return null;
  const probe = norm.split(" ").filter((w) => w.length >= 5).sort((a, b) => b.length - a.length)[0] ?? norm.split(" ")[0];
  if (!probe) return null;
  const cands = (await db`SELECT name, sector FROM mi_companies WHERE name ILIKE ${"%" + probe + "%"} LIMIT 200`) as unknown as Record<string, unknown>[];
  let hit = cands.find((c) => normCompanyName(str(c.name)) === norm);
  if (!hit)
    hit = cands.find((c) => {
      const cn = normCompanyName(str(c.name));
      return cn.length >= 4 && (cn.includes(norm) || norm.includes(cn));
    });
  return hit ? { sector: str(hit.sector), name: str(hit.name) } : null;
}

function normCompanyName(n: string): string {
  return n
    .toLowerCase()
    .replace(/\(cik[^)]*\)/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|lp|llp|plc|sa|nv|ag)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Triage a filing. On "keep" (Ethan, Oct 14, 2026): link the filer to a
 * company record — matching fit target or Directory company if one
 * exists, created from the filing if not and the sector is known — and
 * log the filing as a signal on that company. */
export async function setFilingStatus(id: string, status: MiFiling["status"]): Promise<void> {
  await ensureSchema();
  const db = sql();
  await db`UPDATE mi_filings SET status = ${status} WHERE id = ${id}`;
  if (status !== "keep") return;
  try {
    const frows = (await db`SELECT * FROM mi_filings WHERE id = ${id}`) as unknown as Record<string, unknown>[];
    const f = frows[0];
    if (!f) return;
    const name = cleanFilerName(str(f.company));
    const norm = normCompanyName(name);
    if (!norm) return;
    const probe = norm.split(" ").filter((w) => w.length >= 5).sort((a, b) => b.length - a.length)[0] ?? norm.split(" ")[0];
    const cands = (await db`SELECT id, source, dedup_key, name, details FROM mi_companies WHERE name ILIKE ${"%" + probe + "%"} LIMIT 200`) as unknown as Record<string, unknown>[];
    let target = cands.find((c) => normCompanyName(str(c.name)) === norm);
    if (!target)
      target = cands.find((c) => {
        const cn = normCompanyName(str(c.name));
        return cn.length >= 4 && (cn.includes(norm) || norm.includes(cn));
      });
    let source = target ? str(target.source) : "";
    let dedupKey = target ? str(target.dedup_key) : "";
    if (!target && str(f.sector)) {
      dedupKey = `SEC-${str(f.cik) || norm.replace(/ /g, "-").slice(0, 40)}`;
      source = "SEC Filings";
      await importCompanies(
        "SEC Filings",
        [{
          dedupKey, name, sector: str(f.sector), state: "AZ", source,
          details: JSON.stringify({ createdFromFiling: str(f.accession) }),
        }],
        false
      );
      const back = (await db`SELECT id, source, dedup_key, name, details FROM mi_companies WHERE source = ${source} AND dedup_key = ${dedupKey} LIMIT 1`) as unknown as Record<string, unknown>[];
      target = back[0];
    }
    if (!target) return;
    let details: Record<string, unknown> = {};
    try {
      details = JSON.parse(str(target.details) || "{}") as Record<string, unknown>;
    } catch {
      details = {};
    }
    const signals = Array.isArray(details.signals) ? (details.signals as unknown[]) : [];
    // Dedupe on write (Ethan, Oct 14, 2026): re-keeping the same filing
    // (keep → dismiss → keep, or a double-fired action) must not stack a
    // second copy of the same signal on the company. Identity = the
    // filing's accession number, falling back to date + text.
    const sigText = str(f.why) || str(f.summary);
    const sigAccession = str(f.accession);
    const sigDupe = signals.some((sg) => {
      const o = (sg ?? {}) as Record<string, unknown>;
      if (sigAccession && String(o.accession ?? "") === sigAccession) return true;
      return String(o.text ?? "") === sigText && String(o.date ?? "") === str(f.filing_date);
    });
    if (!sigDupe) {
      signals.push({
        date: str(f.filing_date),
        kind: "filing",
        tag: str(f.tag),
        text: sigText,
        url: str(f.url),
        accession: sigAccession,
      });
    }
    details.signals = signals.slice(-20);
    await db`UPDATE mi_companies SET details = ${JSON.stringify(details).slice(0, 3900)} WHERE id = ${str(target.id)}`;
    let fdetails: Record<string, unknown> = {};
    try {
      fdetails = JSON.parse(str(f.details) || "{}") as Record<string, unknown>;
    } catch {
      fdetails = {};
    }
    fdetails.linkedCompany = { source, dedupKey };
    await db`UPDATE mi_filings SET details = ${JSON.stringify(fdetails)} WHERE id = ${id}`;
  } catch {
    /* keep still stands even if linking fails */
  }
}

/* ---------------- WARN ---------------- */

export interface WarnInput {
  employer: string;
  location?: string;
  headcount?: number | null;
  noticeDate?: string;
  effectiveDate?: string;
  industry?: string;
  source?: string;
}

export async function upsertWarn(rows: WarnInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  let added = 0;
  for (const r of rows) {
    if (!r.employer) continue;
    const res = await db`
      INSERT INTO mi_warn (id, employer, location, headcount, notice_date, effective_date, industry, source)
      VALUES (${newId()}, ${r.employer}, ${r.location ?? ""}, ${r.headcount ?? null},
              ${r.noticeDate ?? ""}, ${r.effectiveDate ?? ""}, ${r.industry ?? ""}, ${r.source ?? ""})
      ON CONFLICT (employer, location, notice_date) DO UPDATE SET
        industry = CASE WHEN mi_warn.industry = '' THEN EXCLUDED.industry ELSE mi_warn.industry END
      RETURNING (xmax = 0) AS inserted`;
    if (res[0]?.inserted) added++;
  }
  return added;
}

/** Fill industry on rows that predate the industry column. */
export async function backfillWarnIndustries(classify: (employer: string) => string): Promise<number> {
  await ensureSchema();
  const db = sql();
  const rows = await db`SELECT id, employer FROM mi_warn WHERE industry = ''`;
  let updated = 0;
  for (const r of rows) {
    const industry = classify(String(r.employer));
    if (!industry) continue;
    await db`UPDATE mi_warn SET industry = ${industry} WHERE id = ${String(r.id)}`;
    updated++;
  }
  return updated;
}

export async function getWarn(limit = 100): Promise<MiWarnNotice[]> {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM mi_warn ORDER BY notice_date DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: str(r.id), employer: str(r.employer), location: str(r.location),
    headcount: numOrNull(r.headcount), noticeDate: str(r.notice_date),
    effectiveDate: str(r.effective_date), industry: str(r.industry),
    source: str(r.source), status: str(r.status) || "new",
    createdAt: String(r.created_at),
  }));
}

export async function setWarnStatus(id: string, status: string): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mi_warn SET status = ${status} WHERE id = ${id}`;
}

/* ---------------- Entities ---------------- */

export interface EntityInput {
  name: string;
  entityType?: string;
  formationDate?: string;
  agent?: string;
  address?: string;
  source?: string;
}

export async function upsertEntities(rows: EntityInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  let added = 0;
  for (const r of rows) {
    if (!r.name) continue;
    const res = await db`
      INSERT INTO mi_entities (id, name, entity_type, formation_date, agent, address, source)
      VALUES (${newId()}, ${r.name}, ${r.entityType ?? ""}, ${r.formationDate ?? ""},
              ${r.agent ?? ""}, ${r.address ?? ""}, ${r.source ?? ""})
      ON CONFLICT (name, formation_date) DO NOTHING
      RETURNING (xmax = 0) AS inserted`;
    if (res[0]?.inserted) added++;
  }
  return added;
}

export async function getEntities(status?: string): Promise<MiEntity[]> {
  await ensureSchema();
  const db = sql();
  const rows = status && status !== "all"
    ? await db`SELECT * FROM mi_entities WHERE status = ${status} ORDER BY formation_date DESC LIMIT 200`
    : await db`SELECT * FROM mi_entities ORDER BY formation_date DESC LIMIT 200`;
  return rows.map((r) => ({
    id: str(r.id), name: str(r.name), entityType: str(r.entity_type),
    formationDate: str(r.formation_date), agent: str(r.agent), address: str(r.address),
    source: str(r.source), status: str(r.status) as MiEntity["status"],
    createdAt: String(r.created_at),
  }));
}

/* ---------------- Sync log ---------------- */

export async function logSync(job: string, status: "ok" | "error" | "skipped", added: number, message: string): Promise<void> {
  await ensureSchema();
  await sql()`INSERT INTO mi_sync_log (id, job, status, added, message) VALUES (${newId()}, ${job}, ${status}, ${added}, ${message})`;
}

/** Latest sync-log row per job — feeds the Market Intel "Updated" labels
 * and the >48h / >7d staleness warnings on tabs and tiles (Oct 14, 2026
 * restructure replaced the Data freshness section with per-surface labels). */
export async function getSyncLogLatestByJob(): Promise<MiSyncLog[]> {
  await ensureSchema();
  const rows = await sql()`SELECT DISTINCT ON (job) * FROM mi_sync_log ORDER BY job, ran_at DESC`;
  return rows.map((r) => ({
    id: str(r.id), job: str(r.job), ranAt: String(r.ran_at),
    status: str(r.status) as MiSyncLog["status"], added: Number(r.added ?? 0),
    message: str(r.message),
  }));
}

export interface CompetingBuyer {
  acquirer: string;
  dealCount: number;
  totalValue: number | null;
  deals: { target: string; headline: string; industry: string; dealValue: number | null; announcedDate: string }[];
}

/** Competing buyers (Ethan, Oct 14, 2026): acquirers with 2+ Arizona deals
 * in the acquisitions feed over the last 12 months — the repeat buyers and
 * PE platforms most likely to bid against Canny on add-ons. Replaces the
 * old "+N local acquisitions" Updates tile. */
export async function getCompetingBuyers(): Promise<CompetingBuyer[]> {
  await ensureSchema();
  const db = sql();
  const since = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const rows = (await db`
    SELECT acquirer, target, headline, industry, deal_value, announced_date
    FROM mi_acquisitions
    WHERE event_type = 'acquisition' AND status <> 'dismissed'
      AND acquirer IS NOT NULL AND acquirer <> '' AND announced_date >= ${since}
    ORDER BY announced_date DESC`) as unknown as Record<string, unknown>[];
  const groups = new Map<string, CompetingBuyer>();
  for (const r of rows) {
    const name = String(r.acquirer).trim();
    if (!name) continue;
    const key = name.toUpperCase();
    let g = groups.get(key);
    if (!g) {
      g = { acquirer: name, dealCount: 0, totalValue: null, deals: [] };
      groups.set(key, g);
    }
    const dv = numOrNull(r.deal_value);
    g.dealCount += 1;
    if (dv !== null) g.totalValue = (g.totalValue ?? 0) + dv;
    g.deals.push({
      target: String(r.target ?? ""), headline: String(r.headline ?? ""),
      industry: String(r.industry ?? ""), dealValue: dv,
      announcedDate: String(r.announced_date ?? ""),
    });
  }
  // M&A 8-K filings feed the same table (Ethan, Oct 14, 2026): the filer
  // is the registrant on the deal — usually the acquirer — tagged as a
  // possible exit buyer / competing platform at ingest.
  const frows = (await db`
    SELECT company, summary, filing_date FROM mi_filings
    WHERE category = 'acquisition' AND status <> 'dismissed' AND filing_date >= ${since}
    ORDER BY filing_date DESC`) as unknown as Record<string, unknown>[];
  for (const r of frows) {
    const name = cleanFilerName(String(r.company ?? ""));
    if (!name) continue;
    const key = name.toUpperCase();
    let g = groups.get(key);
    if (!g) {
      g = { acquirer: name, dealCount: 0, totalValue: null, deals: [] };
      groups.set(key, g);
    }
    g.dealCount += 1;
    g.deals.push({
      target: "", headline: String(r.summary ?? ""), industry: "",
      dealValue: null, announcedDate: String(r.filing_date ?? ""),
    });
  }
  return Array.from(groups.values())
    .filter((g) => g.dealCount >= 2)
    .sort((a, b) => b.dealCount - a.dealCount || (b.totalValue ?? 0) - (a.totalValue ?? 0))
    .slice(0, 12);
}

export async function getSyncLog(limit = 20): Promise<MiSyncLog[]> {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM mi_sync_log ORDER BY ran_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: str(r.id), job: str(r.job), ranAt: String(r.ran_at),
    status: str(r.status) as MiSyncLog["status"], added: Number(r.added ?? 0),
    message: str(r.message),
  }));
}

/* ---------------- City commercial / industrial permits (Phase 3) ----------------
 * Rows live in mi_permits_ci, written by lib/permits-ingest.ts (the table
 * is created there, not in ensureSchema — hence the existence guard). */

export interface CiPermitSummary {
  city: string;
  category: string; // project | subpermit | multifamily
  currentCount: number; // trailing 12 months
  currentValuation: number | null;
  priorCount: number; // the 12 months before that
  priorValuation: number | null;
}

/** Per-city, per-category permit volume + valuation, trailing 12 months
 * vs the prior 12 — the raw material for the sector tailwind score. */
export async function getCiPermitSummary(): Promise<CiPermitSummary[]> {
  await ensureSchema();
  const db = sql();
  const reg = await db`SELECT to_regclass('mi_permits_ci') AS t`;
  if (!reg[0]?.t) return [];
  const rows = (await db`
    SELECT city, category,
      COUNT(*) FILTER (WHERE issued_date >= CURRENT_DATE - INTERVAL '12 months') AS cur_count,
      SUM(valuation) FILTER (WHERE issued_date >= CURRENT_DATE - INTERVAL '12 months') AS cur_val,
      COUNT(*) FILTER (WHERE issued_date >= CURRENT_DATE - INTERVAL '24 months'
                       AND issued_date < CURRENT_DATE - INTERVAL '12 months') AS prior_count,
      SUM(valuation) FILTER (WHERE issued_date >= CURRENT_DATE - INTERVAL '24 months'
                       AND issued_date < CURRENT_DATE - INTERVAL '12 months') AS prior_val
    FROM mi_permits_ci
    WHERE issued_date >= CURRENT_DATE - INTERVAL '24 months'
    GROUP BY city, category
    ORDER BY city, category`) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    city: str(r.city),
    category: str(r.category),
    currentCount: Number(r.cur_count ?? 0),
    currentValuation: numOrNull(r.cur_val),
    priorCount: Number(r.prior_count ?? 0),
    priorValuation: numOrNull(r.prior_val),
  }));
}
