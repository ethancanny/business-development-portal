/**
 * Sector tailwind scores (Hospitality §4 + Phase 5 remainder,
 * Oct 17, 2026).
 *
 * Each focus sector gets a 0–100 tailwind score built ONLY from
 * measured component movements (mostly YoY % changes):
 *
 *     sub-score = clamp(50 + 4 × movementPct, 2, 98)
 *     sector score = weighted mean of sub-scores over LIVE components
 *
 * (50 = flat; a component moving +12.5% saturates at 98, −12.5% at 2.)
 * Weights are the nominal weights declared per sector below; when a
 * component is not live its weight is removed and the rest renormalize
 * — the score never silently rides on stale data. A component is
 * dropped as stale when its latest period is older than its
 * per-source staleness window (each source's real publication lag +
 * grace, declared next to the component). A sector with fewer than 2
 * live components shows NO score at all.
 *
 * Components come from two places:
 *  - datasets the tailwind ingest fetches itself (lib/tailwind-ingest:
 *    Mesa city TPT, BLS QCEW 721/722, Census SUSB size distribution,
 *    AOT airport + lodging PDF reports, FRED AZPOP), stored as
 *    observations in mi_tailwind_obs;
 *  - series the portal already ingests (FRED sector employment,
 *    USASpending defense obligations, Census CBP sector employment,
 *    city permit feeds, the ADHS license register), read live from
 *    mi_indicators / mi_permits_ci / mi_adhs_licenses at compute time.
 *
 * Score history lives in mi_tailwind_scores — one row per sector per
 * DISTINCT computation (a fingerprint of the included components,
 * their periods and movements), so re-running over unchanged inputs
 * appends nothing. "What changed" is generated against the previous
 * stored row. Fetch bookkeeping for the ingest's staleness guards
 * lives in mi_tailwind_state.
 */
import { createHash } from "crypto";
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { getIndicatorSeries, logSync } from "./market-db";

type Sql = NeonQueryFunction<false, false>;
let cached: Sql | null = null;
function sql(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (tailwind requires Postgres)");
    cached = neon(url);
  }
  return cached;
}

let ensured = false;
export async function ensureTailwindSchema(): Promise<void> {
  if (ensured) return;
  const db = sql();
  await db`CREATE TABLE IF NOT EXISTS mi_tailwind_obs (
    dataset TEXT NOT NULL,
    series_key TEXT NOT NULL,
    period_date TEXT NOT NULL,
    value DOUBLE PRECISION NOT NULL,
    source_name TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (dataset, series_key, period_date)
  )`;
  await db`CREATE TABLE IF NOT EXISTS mi_tailwind_scores (
    id BIGSERIAL PRIMARY KEY,
    sector TEXT NOT NULL,
    score DOUBLE PRECISION,
    what_changed TEXT NOT NULL DEFAULT '',
    fingerprint TEXT NOT NULL,
    components JSONB NOT NULL DEFAULT '[]',
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  await db`CREATE INDEX IF NOT EXISTS mi_tailwind_scores_sector_idx
    ON mi_tailwind_scores (sector, id DESC)`;
  await db`CREATE TABLE IF NOT EXISTS mi_tailwind_state (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`;
  ensured = true;
}

/* ---------------- observations + state ---------------- */

export interface TailwindObsRow {
  dataset: string;
  seriesKey: string;
  periodDate: string; // YYYY-MM-DD
  value: number;
  sourceName: string;
  sourceUrl: string;
}

export async function upsertTailwindObs(rows: TailwindObsRow[]): Promise<number> {
  await ensureTailwindSchema();
  if (!rows.length) return 0;
  const db = sql();
  let n = 0;
  for (const r of rows) {
    await db`INSERT INTO mi_tailwind_obs (dataset, series_key, period_date, value, source_name, source_url)
      VALUES (${r.dataset}, ${r.seriesKey}, ${r.periodDate}, ${r.value}, ${r.sourceName}, ${r.sourceUrl})
      ON CONFLICT (dataset, series_key, period_date)
      DO UPDATE SET value = EXCLUDED.value, source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url, fetched_at = now()`;
    n++;
  }
  return n;
}

export async function getTailwindObs(dataset: string, seriesKey?: string): Promise<TailwindObsRow[]> {
  await ensureTailwindSchema();
  const db = sql();
  const rows = seriesKey
    ? await db`SELECT dataset, series_key, period_date, value, source_name, source_url
        FROM mi_tailwind_obs WHERE dataset = ${dataset} AND series_key = ${seriesKey}
        ORDER BY period_date`
    : await db`SELECT dataset, series_key, period_date, value, source_name, source_url
        FROM mi_tailwind_obs WHERE dataset = ${dataset} ORDER BY series_key, period_date`;
  return (rows as Record<string, unknown>[]).map((r) => ({
    dataset: String(r.dataset),
    seriesKey: String(r.series_key),
    periodDate: String(r.period_date),
    value: Number(r.value),
    sourceName: String(r.source_name ?? ""),
    sourceUrl: String(r.source_url ?? ""),
  }));
}

export async function getTailwindState<T>(key: string): Promise<T | null> {
  await ensureTailwindSchema();
  const db = sql();
  const rows = await db`SELECT value FROM mi_tailwind_state WHERE key = ${key}`;
  if (!rows.length) return null;
  const v = (rows[0] as Record<string, unknown>).value;
  return (typeof v === "string" ? JSON.parse(v) : v) as T;
}

export async function setTailwindState(key: string, value: unknown): Promise<void> {
  await ensureTailwindSchema();
  const db = sql();
  const json = JSON.stringify(value);
  await db`INSERT INTO mi_tailwind_state (key, value, updated_at)
    VALUES (${key}, ${json}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/* ---------------- component model ---------------- */

export type TailwindComponentStatus = "live" | "dropped-stale" | "pending" | "gap";

export interface TailwindComponent {
  key: string;
  sector: string;
  label: string;
  valueText: string;
  movementPct: number | null;
  subScore: number | null;
  weight: number;
  effectiveWeight: number;
  status: TailwindComponentStatus;
  statusNote: string;
  asOf: string | null; // period end, YYYY-MM-DD
  source: string;
  sourceUrl: string;
  note: string;
  detail: { label: string; value: string }[];
}

export interface TailwindSectorReport {
  sector: string;
  score: number | null;
  qualifies: boolean;
  whatChanged: string;
  computedAt: string | null;
  components: TailwindComponent[];
}

export const TAILWIND_FORMULA =
  "Each component's movement (mostly YoY %) maps to a 0–100 sub-score — 50 = flat, ±12.5% saturates — and the sector score is the weighted mean over live components only. A component older than its source's publication lag + grace is dropped and its weight renormalized away; a sector needs at least 2 live components to show a score.";

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const subScoreFor = (movementPct: number) => clamp(50 + 4 * movementPct, 2, 98);
const yoyPct = (cur: number, prior: number): number | null =>
  prior ? ((cur / prior) - 1) * 100 : null;
export const fmtPct = (m: number) => `${m >= 0 ? "+" : ""}${m.toFixed(1)}%`;
const fmtInt = (v: number) => Math.round(v).toLocaleString("en-US");
const fmtMoney = (v: number) =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${fmtInt(v)}`;

function monthEnd(period: string): string {
  // period is YYYY-MM-DD (always the 1st for monthly series)
  const d = new Date(`${period.slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
}
function yearEnd(period: string): string {
  return `${period.slice(0, 4)}-12-31`;
}
function ageMonths(periodEnd: string, now: Date): number {
  const ms = now.getTime() - new Date(`${periodEnd}T00:00:00Z`).getTime();
  return ms / (30.44 * 86400_000);
}

interface BuiltComponent extends Omit<TailwindComponent, "effectiveWeight" | "status" | "statusNote" | "subScore"> {
  staleAfterMonths: number;
  /** "gap" when the source has no usable data at all; "pending" when
   * data exists but a movement cannot be computed yet. */
  emptyKind: "gap" | "pending";
  emptyNote: string;
}

function finalize(c: BuiltComponent, now: Date, ageOverrideMonths: number): TailwindComponent {
  let status: TailwindComponentStatus;
  let statusNote = "";
  if (c.movementPct === null || c.asOf === null) {
    status = c.emptyKind;
    statusNote = c.emptyNote;
  } else {
    const age = ageMonths(c.asOf, now) + ageOverrideMonths;
    if (age > c.staleAfterMonths) {
      status = "dropped-stale";
      statusNote = `Latest period ended ${c.asOf} — beyond this source's ${c.staleAfterMonths}-month freshness window, so it is excluded and its weight renormalized away.`;
    } else {
      status = "live";
    }
  }
  return {
    ...c,
    status,
    statusNote,
    subScore: status === "live" && c.movementPct !== null ? subScoreFor(c.movementPct) : null,
    effectiveWeight: 0,
  };
}

/* ---------------- component builders ---------------- */

type ObsMap = Map<string, TailwindObsRow[]>;
function bySeries(rows: TailwindObsRow[]): ObsMap {
  const m: ObsMap = new Map();
  for (const r of rows) {
    if (!m.has(r.seriesKey)) m.set(r.seriesKey, []);
    m.get(r.seriesKey)!.push(r);
  }
  return m;
}
const lastOf = (rows?: TailwindObsRow[]) => (rows && rows.length ? rows[rows.length - 1] : null);

async function buildCityTax(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "city_tax",
    sector,
    label: "City restaurant/bar + lodging tax (Mesa)",
    valueText: "—",
    movementPct: null,
    weight: 20,
    asOf: null,
    source: "City of Mesa Open Data — TPT by report month",
    sourceUrl: "https://data.mesaaz.gov/Financials/Citywide-Tax-Revenue-by-Report-Month/8y5v-kwui",
    note: "Mesa is the only one of the seven target cities (Phoenix, Scottsdale, Tempe, Mesa, Chandler, Gilbert, Tucson) publishing a machine-readable monthly tax-by-category series today — the other six are a documented gap, so this component tracks Mesa only and says so.",
    detail: [],
    staleAfterMonths: 7,
    emptyKind: "gap",
    emptyNote: "No Mesa TPT observations stored yet.",
  };
  const obs = bySeries(await getTailwindObs("city_tax"));
  const rest = obs.get("mesa_restaurants_bars") ?? [];
  const tlt = obs.get("mesa_lodging_tlt") ?? [];
  const months = new Map<string, number>();
  for (const r of [...rest, ...tlt]) months.set(r.periodDate, (months.get(r.periodDate) ?? 0) + r.value);
  const periods = Array.from(months.keys()).sort();
  if (periods.length < 24) {
    base.emptyNote = `Only ${periods.length} months of Mesa TPT history stored — 24 needed for a trailing-12-month YoY.`;
    return base;
  }
  const last12 = periods.slice(-12);
  const prev12 = periods.slice(-24, -12);
  const sum = (ps: string[], src: TailwindObsRow[]) => {
    const m = new Map(src.map((r) => [r.periodDate, r.value]));
    return ps.reduce((a, p) => a + (m.get(p) ?? 0), 0);
  };
  const ttm = last12.reduce((a, p) => a + (months.get(p) ?? 0), 0);
  const ttmPrior = prev12.reduce((a, p) => a + (months.get(p) ?? 0), 0);
  const restTtm = sum(last12, rest);
  const restPrior = sum(prev12, rest);
  const tltTtm = sum(last12, tlt);
  const tltPrior = sum(prev12, tlt);
  base.movementPct = yoyPct(ttm, ttmPrior);
  base.asOf = monthEnd(periods[periods.length - 1]);
  base.valueText = `${fmtMoney(ttm)} trailing 12 mo through ${periods[periods.length - 1].slice(0, 7)}`;
  base.detail = [
    { label: "Restaurants & bars TPT (TTM)", value: `${fmtMoney(restTtm)} (${fmtPct(yoyPct(restTtm, restPrior) ?? 0)} YoY)` },
    { label: "Lodging (TLT) (TTM)", value: `${fmtMoney(tltTtm)} (${fmtPct(yoyPct(tltTtm, tltPrior) ?? 0)} YoY)` },
    { label: "Cities covered", value: "Mesa only — Phoenix, Scottsdale, Tempe, Chandler, Gilbert, Tucson publish no machine-readable category series (gap)" },
  ];
  return base;
}

async function buildQcewHosp(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "qcew_hosp",
    sector,
    label: "Hospitality jobs — QCEW NAICS 721/722 (AZ)",
    valueText: "—",
    movementPct: null,
    weight: 15,
    asOf: null,
    source: "BLS Quarterly Census of Employment and Wages (QCEW), private ownership",
    sourceUrl: "https://www.bls.gov/cew/",
    note: "Annual average employment, NAICS 721 (accommodation) + 722 (food services) summed across Arizona. QCEW counts differ from CBP by design (coverage + disclosure rules) — the gap is tracked in the qcew_hosp-xcheck log.",
    detail: [],
    staleAfterMonths: 30,
    emptyKind: "gap",
    emptyNote: "No QCEW 721/722 observations stored yet.",
  };
  const obs = bySeries(await getTailwindObs("qcew_hosp"));
  const e721 = obs.get("emp_721") ?? [];
  const e722 = obs.get("emp_722") ?? [];
  const years = new Map<string, number>();
  for (const r of [...e721, ...e722]) years.set(r.periodDate, (years.get(r.periodDate) ?? 0) + r.value);
  const periods = Array.from(years.keys()).sort();
  if (periods.length < 2) {
    base.emptyNote = `Only ${periods.length} QCEW year(s) stored — two needed for a YoY movement.`;
    return base;
  }
  const cur = years.get(periods[periods.length - 1])!;
  const prior = years.get(periods[periods.length - 2])!;
  base.movementPct = yoyPct(cur, prior);
  base.asOf = yearEnd(periods[periods.length - 1]);
  base.valueText = `${fmtInt(cur)} jobs (${periods[periods.length - 1].slice(0, 4)})`;
  const countyRows = (await getTailwindObs("qcew_hosp")).filter(
    (r) => r.seriesKey.startsWith("emp_county_") && r.periodDate === periods[periods.length - 1]
  );
  base.detail = [
    { label: "NAICS 721 accommodation", value: `${fmtInt(lastOf(e721)?.value ?? 0)} jobs` },
    { label: "NAICS 722 food services", value: `${fmtInt(lastOf(e722)?.value ?? 0)} jobs` },
    ...countyRows
      .sort((a, b) => b.value - a.value)
      .map((r) => ({
        label: `${r.sourceName} (721+722)`,
        value: `${fmtInt(r.value)} jobs (${((r.value / cur) * 100).toFixed(1)}% of AZ)`,
      })),
  ];
  return base;
}

async function buildSusbFrag(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "susb_frag",
    sector,
    label: "Mid-size operator pool — establishments with 20–99 employees",
    valueText: "—",
    movementPct: null,
    weight: 10,
    asOf: null,
    source: "Census Statistics of U.S. Businesses (SUSB), built from County Business Patterns",
    sourceUrl: "https://www.census.gov/programs-surveys/susb.html",
    note: "Enterprise employment size classes for AZ NAICS 72. Fragmentation detail (share of establishments under 20 employees) is shown below; the scored movement is the growth of the 20–99-employee pool — the acquisition-relevant band.",
    detail: [],
    staleAfterMonths: 48,
    emptyKind: "gap",
    emptyNote: "No SUSB size-distribution observations stored yet.",
  };
  const obs = bySeries(await getTailwindObs("susb_frag"));
  const band = obs.get("estab_20_99") ?? [];
  if (band.length < 2) {
    base.emptyNote = `Only ${band.length} SUSB vintage(s) stored — two needed for a YoY movement.`;
    return base;
  }
  const cur = band[band.length - 1];
  const prior = band[band.length - 2];
  base.movementPct = yoyPct(cur.value, prior.value);
  base.asOf = yearEnd(cur.periodDate);
  const lt20 = lastOf((obs.get("estab_lt20") ?? []).filter((r) => r.periodDate === cur.periodDate));
  const total = lastOf((obs.get("estab_total") ?? []).filter((r) => r.periodDate === cur.periodDate));
  base.valueText = `${fmtInt(cur.value)} establishments (${cur.periodDate.slice(0, 4)})`;
  base.detail = [
    { label: "Establishments with 20–99 employees", value: `${fmtInt(cur.value)} (was ${fmtInt(prior.value)} in ${prior.periodDate.slice(0, 4)})` },
    ...(lt20 && total
      ? [{ label: "Share of establishments under 20 employees", value: `${((lt20.value / total.value) * 100).toFixed(1)}% of ${fmtInt(total.value)}` }]
      : []),
  ];
  return base;
}

async function buildAotAirports(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "aot_airports",
    sector,
    label: "Sky Harbor passenger traffic (PHX)",
    valueText: "—",
    movementPct: null,
    weight: 20,
    asOf: null,
    source: "Arizona Office of Tourism — Monthly Airport Passenger Traffic Report (airport activity reports, compiled by NAU AHRRC)",
    sourceUrl: "https://tourism.az.gov/data-trends/",
    note: "Single-source: PHX traffic is reported by the airport to AOT; no second machine-readable publisher exists. The report's own printed totals are consistency-checked in the aot_airports-xcheck log.",
    detail: [],
    staleAfterMonths: 5,
    emptyKind: "gap",
    emptyNote: "No AOT airport observations stored yet.",
  };
  const obs = bySeries(await getTailwindObs("aot_airports"));
  const ytd = lastOf(obs.get("phx_pax_ytd"));
  const ytdPrior = lastOf(obs.get("phx_pax_ytd_prior"));
  const month = lastOf(obs.get("phx_pax_month"));
  const monthPrior = lastOf(obs.get("phx_pax_month_prior"));
  if (!ytd || !ytdPrior) return base;
  base.movementPct = yoyPct(ytd.value, ytdPrior.value);
  base.asOf = monthEnd(ytd.periodDate);
  base.valueText = `${fmtInt(ytd.value)} passengers YTD through ${ytd.periodDate.slice(0, 7)}`;
  base.detail = [
    ...(month && monthPrior
      ? [{ label: `Latest month (${month.periodDate.slice(0, 7)})`, value: `${fmtInt(month.value)} passengers (${fmtPct(yoyPct(month.value, monthPrior.value) ?? 0)} YoY)` }]
      : []),
    { label: "YTD vs prior-year YTD", value: `${fmtInt(ytd.value)} vs ${fmtInt(ytdPrior.value)}` },
  ];
  return base;
}

async function buildAotLodging(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "aot_lodging",
    sector,
    label: "Hotel occupancy & rates — Arizona statewide",
    valueText: "—",
    movementPct: null,
    weight: 20,
    asOf: null,
    source: "Arizona Office of Tourism — Monthly Lodging Report (CoStar data)",
    sourceUrl: "https://tourism.az.gov/data-trends/",
    note: "Single-source: statewide lodging performance is CoStar survey data published only via AOT. Internal consistency (RevPAR ≈ occupancy × ADR) is checked in the aot_lodging-xcheck log. Movement = mean of the YTD occupancy and ADR % changes.",
    detail: [],
    staleAfterMonths: 5,
    emptyKind: "gap",
    emptyNote: "No AOT lodging observations stored yet.",
  };
  const obs = bySeries(await getTailwindObs("aot_lodging"));
  const occYtd = lastOf(obs.get("occ_ytd"));
  const adrYtd = lastOf(obs.get("adr_ytd"));
  const occChg = lastOf(obs.get("occ_ytd_chg"));
  const adrChg = lastOf(obs.get("adr_ytd_chg"));
  const occM = lastOf(obs.get("occ_month"));
  const adrM = lastOf(obs.get("adr_month"));
  const revM = lastOf(obs.get("revpar_month"));
  if (!occYtd || !adrYtd || !occChg || !adrChg) return base;
  base.movementPct = (occChg.value + adrChg.value) / 2;
  base.asOf = monthEnd(occYtd.periodDate);
  base.valueText = `Occupancy ${occYtd.value.toFixed(1)}% · ADR $${adrYtd.value.toFixed(2)} (YTD ${occYtd.periodDate.slice(0, 7)})`;
  base.detail = [
    { label: "YTD occupancy % change", value: fmtPct(occChg.value) },
    { label: "YTD ADR % change", value: fmtPct(adrChg.value) },
    ...(occM && adrM && revM
      ? [{ label: `Latest month (${occM.periodDate.slice(0, 7)})`, value: `Occ ${occM.value.toFixed(1)}% · ADR $${adrM.value.toFixed(2)} · RevPAR $${revM.value.toFixed(2)}` }]
      : []),
  ];
  return base;
}

async function buildHotelPermits(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "hotel_permits",
    sector,
    label: "New hotel/motel project permits (city feeds)",
    valueText: "—",
    movementPct: null,
    weight: 10,
    asOf: null,
    source: "Portal city permit feeds (mi_permits_ci — Mesa, Phoenix, Tempe, Gilbert commercial permits)",
    sourceUrl: "https://portal.cannycapitalpartners.com/market-intel",
    note: "Derived from permits already ingested: project permits whose description/type mentions hotel, motel, resort, lodging or extended stay. No independent second source covers the same permits — stated plainly rather than dressed up.",
    detail: [],
    staleAfterMonths: 3,
    emptyKind: "gap",
    emptyNote: "No hotel/motel project permits found in the city feeds for the last 24 months.",
  };
  const db = sql();
  const reg = await db`SELECT to_regclass('mi_permits_ci') AS t`;
  if (!reg[0]?.t) {
    base.emptyNote = "City permit table (mi_permits_ci) does not exist yet.";
    return base;
  }
  const rows = await db`
    SELECT
      COUNT(*) FILTER (WHERE issued_date >= CURRENT_DATE - INTERVAL '12 months') AS cur,
      COUNT(*) FILTER (WHERE issued_date >= CURRENT_DATE - INTERVAL '24 months'
                       AND issued_date < CURRENT_DATE - INTERVAL '12 months') AS prior,
      MAX(issued_date) AS latest
    FROM mi_permits_ci
    WHERE category = 'project'
      AND (description ~* '(hotel|motel|resort|lodging|extended stay)'
           OR type_of_work ~* '(hotel|motel|resort|lodging|extended stay)')`;
  const cur = Number(rows[0]?.cur ?? 0);
  const prior = Number(rows[0]?.prior ?? 0);
  if (cur + prior === 0) return base;
  if (prior === 0) {
    base.emptyKind = "pending";
    base.emptyNote = `${cur} hotel/motel permits in the last 12 months but none in the prior 12 — no YoY baseline yet.`;
    base.valueText = `${cur} permits, trailing 12 mo`;
    return base;
  }
  base.movementPct = yoyPct(cur, prior);
  base.asOf = new Date().toISOString().slice(0, 10);
  base.valueText = `${cur} permits, trailing 12 mo (vs ${prior} prior)`;
  return base;
}

async function buildFredPop(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "fred_pop",
    sector,
    label: "Arizona population growth",
    valueText: "—",
    movementPct: null,
    weight: 5,
    asOf: null,
    source: "U.S. Census Bureau population estimates via FRED (AZPOP)",
    sourceUrl: "https://fred.stlouisfed.org/series/AZPOP",
    note: "Single-source: FRED republishes the Census Bureau's annual state population estimates; there is no independent second estimate series.",
    detail: [],
    staleAfterMonths: 30,
    emptyKind: "gap",
    emptyNote: "No AZPOP observations stored yet.",
  };
  const obs = bySeries(await getTailwindObs("fred_pop"));
  const pop = obs.get("az_pop") ?? [];
  if (pop.length < 2) {
    base.emptyNote = `Only ${pop.length} AZPOP year(s) stored — two needed for a YoY movement.`;
    return base;
  }
  const cur = pop[pop.length - 1];
  const prior = pop[pop.length - 2];
  base.movementPct = yoyPct(cur.value, prior.value);
  base.asOf = yearEnd(cur.periodDate);
  base.valueText = `${fmtInt(cur.value * 1000)} residents (${cur.periodDate.slice(0, 4)})`;
  return base;
}

/* ---- components derived from series the portal already ingests ---- */

interface IndicatorPoint { obsDate: string; value: number | null }
async function indicatorPoints(seriesId: string): Promise<{ date: string; value: number }[]> {
  const rows = await getIndicatorSeries([seriesId]).catch(() => []);
  return (rows as IndicatorPoint[])
    .filter((r) => r.value !== null && Number.isFinite(r.value))
    .map((r) => ({ date: r.obsDate, value: r.value as number }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function fredMonthlyEmp(params: {
  key: string; sector: string; label: string; seriesId: string; weight: number; source: string; sourceUrl: string;
}): () => Promise<BuiltComponent> {
  return async () => {
    const base: BuiltComponent = {
      key: params.key,
      sector: params.sector,
      label: params.label,
      valueText: "—",
      movementPct: null,
      weight: params.weight,
      asOf: null,
      source: params.source,
      sourceUrl: params.sourceUrl,
      note: "Monthly FRED series (state employment), movement = latest month vs the same month a year earlier.",
      detail: [],
      staleAfterMonths: 4,
      emptyKind: "gap",
      emptyNote: `No observations stored for FRED series ${params.seriesId} yet.`,
    };
    const pts = await indicatorPoints(params.seriesId);
    if (pts.length < 13) {
      base.emptyNote = `Only ${pts.length} monthly observations for ${params.seriesId} — 13 needed for a YoY.`;
      return base;
    }
    const cur = pts[pts.length - 1];
    const targetDate = `${Number(cur.date.slice(0, 4)) - 1}${cur.date.slice(4)}`;
    const prior = pts.find((p) => p.date === targetDate) ?? pts[pts.length - 13];
    base.movementPct = yoyPct(cur.value, prior.value);
    base.asOf = monthEnd(cur.date);
    base.valueText = `${cur.value.toLocaleString("en-US")}K jobs (${cur.date.slice(0, 7)})`;
    return base;
  };
}

function cbpEmp(params: {
  key: string; sector: string; label: string; seriesId: string; weight: number;
}): () => Promise<BuiltComponent> {
  return async () => {
    const base: BuiltComponent = {
      key: params.key,
      sector: params.sector,
      label: params.label,
      valueText: "—",
      movementPct: null,
      weight: params.weight,
      asOf: null,
      source: "Census County Business Patterns (CBP), AZ employment",
      sourceUrl: "https://www.census.gov/programs-surveys/cbp.html",
      note: "Annual series; CBP publishes with a ~2-year lag, so the freshness window is set to the source's real cadence. Cross-checked against QCEW/SUSB in the nightly sector-xcheck log.",
      detail: [],
      staleAfterMonths: 48,
      emptyKind: "gap",
      emptyNote: `No observations stored for CBP series ${params.seriesId} yet.`,
    };
    const pts = await indicatorPoints(params.seriesId);
    if (pts.length < 2) {
      base.emptyNote = `Only ${pts.length} CBP year(s) stored for ${params.seriesId} — two needed for a YoY.`;
      return base;
    }
    const cur = pts[pts.length - 1];
    const prior = pts[pts.length - 2];
    base.movementPct = yoyPct(cur.value, prior.value);
    base.asOf = yearEnd(cur.date);
    base.valueText = `${fmtInt(cur.value)} jobs (${cur.date.slice(0, 4)})`;
    return base;
  };
}

async function buildDefenseTtm(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "defense_ttm",
    sector,
    label: "AZ DoD contract obligations (trailing 12 mo)",
    valueText: "—",
    movementPct: null,
    weight: 60,
    asOf: null,
    source: "USASpending — DoD contract obligations, place of performance AZ",
    sourceUrl: "https://www.usaspending.gov",
    note: "Trailing-12-month sum ending two months before the latest reported month (the newest months are partial as awards post). Monthly sums are reconciled against USASpending's fiscal-year totals in the nightly defense-xcheck log.",
    detail: [],
    staleAfterMonths: 4,
    emptyKind: "gap",
    emptyNote: "No USASpending AZ_DOD_CONTRACTS observations stored yet.",
  };
  const pts = await indicatorPoints("AZ_DOD_CONTRACTS");
  if (pts.length < 25) {
    base.emptyNote = `Only ${pts.length} monthly defense observations — 25 needed for two full trailing years.`;
    return base;
  }
  // Last month with a positive value, then step back one more month so
  // the window ends on a fully-reported month.
  let lastPos = pts.length - 1;
  while (lastPos > 0 && pts[lastPos].value <= 0) lastPos--;
  const endIdx = lastPos - 1;
  if (endIdx < 23) return base;
  const sum = (a: number, b: number) => pts.slice(a, b + 1).reduce((s, p) => s + p.value, 0);
  const ttm = sum(endIdx - 11, endIdx);
  const ttmPrior = sum(endIdx - 23, endIdx - 12);
  base.movementPct = yoyPct(ttm, ttmPrior);
  base.asOf = monthEnd(pts[endIdx].date);
  base.valueText = `${fmtMoney(ttm)} trailing 12 mo through ${pts[endIdx].date.slice(0, 7)}`;
  base.detail = [{ label: "Prior trailing 12 mo", value: fmtMoney(ttmPrior) }];
  return base;
}

async function buildCiPermitsTrend(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "ci_permits",
    sector,
    label: "Commercial project permits (city feeds)",
    valueText: "—",
    movementPct: null,
    weight: 35,
    asOf: null,
    source: "Portal city permit feeds (mi_permits_ci — Mesa, Phoenix, Tempe, Gilbert)",
    sourceUrl: "https://portal.cannycapitalpartners.com/market-intel",
    note: "Count of category='project' commercial permits issued in the trailing 12 months vs the prior 12, across the four wired city feeds.",
    detail: [],
    staleAfterMonths: 3,
    emptyKind: "gap",
    emptyNote: "City permit table (mi_permits_ci) does not exist yet.",
  };
  const db = sql();
  const reg = await db`SELECT to_regclass('mi_permits_ci') AS t`;
  if (!reg[0]?.t) return base;
  const rows = await db`
    SELECT
      COUNT(*) FILTER (WHERE issued_date >= CURRENT_DATE - INTERVAL '12 months') AS cur,
      COUNT(*) FILTER (WHERE issued_date >= CURRENT_DATE - INTERVAL '24 months'
                       AND issued_date < CURRENT_DATE - INTERVAL '12 months') AS prior,
      MAX(issued_date) AS latest
    FROM mi_permits_ci WHERE category = 'project'`;
  const cur = Number(rows[0]?.cur ?? 0);
  const prior = Number(rows[0]?.prior ?? 0);
  if (prior === 0) {
    base.emptyNote = `No prior-12-month permit baseline (current ${cur}, prior ${prior}).`;
    return base;
  }
  base.movementPct = yoyPct(cur, prior);
  base.asOf = new Date().toISOString().slice(0, 10);
  base.valueText = `${fmtInt(cur)} project permits, trailing 12 mo (vs ${fmtInt(prior)} prior)`;
  return base;
}

async function buildAdhsUnits(sector: string): Promise<BuiltComponent> {
  const base: BuiltComponent = {
    key: "adhs_units",
    sector,
    label: "Licensed healthcare capacity (ADHS register)",
    valueText: "—",
    movementPct: null,
    weight: 15,
    asOf: null,
    source: "ADHS licensing register (monthly snapshots ingested by the portal)",
    sourceUrl: "https://www.azdhs.gov/licensing/index.php#databases",
    note: "Total licensed units (capacity) across facilities present in the register, reconstructed per snapshot month from each license's first/last-seen months.",
    detail: [],
    staleAfterMonths: 3,
    emptyKind: "pending",
    emptyNote: "ADHS register holds a single snapshot month so far — a YoY movement needs a snapshot from 12 months earlier in the register's history.",
  };
  const db = sql();
  const reg = await db`SELECT to_regclass('mi_adhs_licenses') AS t`;
  if (!reg[0]?.t) {
    base.emptyNote = "ADHS license register (mi_adhs_licenses) does not exist yet.";
    return base;
  }
  const monthRows = await db`SELECT MAX(last_seen_month) AS latest, MIN(first_seen_month) AS earliest FROM mi_adhs_licenses`;
  const latest = String(monthRows[0]?.latest ?? "");
  const earliest = String(monthRows[0]?.earliest ?? "");
  if (!latest) return base;
  const [ly, lm] = latest.split("-").map(Number);
  const priorDate = new Date(Date.UTC(ly, lm - 1 - 12, 1));
  const priorMonth = `${priorDate.getUTCFullYear()}-${String(priorDate.getUTCMonth() + 1).padStart(2, "0")}`;
  if (!earliest || earliest > priorMonth) {
    base.emptyNote = `ADHS register history starts ${earliest || "—"}; a YoY movement needs the ${priorMonth} snapshot month in range.`;
    const tot = await db`SELECT COALESCE(SUM(capacity), 0) AS units, COUNT(*) AS n FROM mi_adhs_licenses WHERE last_seen_month = ${latest}`;
    base.valueText = `${fmtInt(Number(tot[0]?.units ?? 0))} licensed units across ${fmtInt(Number(tot[0]?.n ?? 0))} licenses (${latest})`;
    return base;
  }
  const unitsAt = async (month: string) => {
    const r = await db`SELECT COALESCE(SUM(capacity), 0) AS units, COUNT(*) AS n FROM mi_adhs_licenses
      WHERE first_seen_month <= ${month} AND last_seen_month >= ${month}`;
    return { units: Number(r[0]?.units ?? 0), n: Number(r[0]?.n ?? 0) };
  };
  const cur = await unitsAt(latest);
  const prior = await unitsAt(priorMonth);
  base.movementPct = yoyPct(cur.units, prior.units);
  base.asOf = monthEnd(`${latest}-01`);
  base.valueText = `${fmtInt(cur.units)} licensed units (${latest})`;
  base.detail = [{ label: `Units in ${priorMonth}`, value: fmtInt(prior.units) }];
  return base;
}

/* ---------------- sector assembly + scoring ---------------- */

const SECTOR_BUILDERS: { sector: string; builders: ((s: string) => Promise<BuiltComponent>)[] }[] = [
  {
    sector: "Hospitality",
    builders: [buildCityTax, buildAotAirports, buildAotLodging, buildQcewHosp, buildSusbFrag, buildHotelPermits, buildFredPop],
  },
  {
    sector: "Aerospace & Defense",
    builders: [
      buildDefenseTtm,
      cbpEmp({ key: "cbp_ad_emp", sector: "Aerospace & Defense", label: "Aerospace employment — CBP NAICS 3364 (AZ)", seriesId: "CBP_AZ_SEC_3364_EMP", weight: 40 }),
    ],
  },
  {
    sector: "Advanced Manufacturing",
    builders: [
      fredMonthlyEmp({
        key: "fred_mfg_emp", sector: "Advanced Manufacturing", label: "AZ manufacturing employment (FRED AZMFG)",
        seriesId: "AZMFG", weight: 60, source: "FRED — Arizona Manufacturing Employment (BLS via FRED)",
        sourceUrl: "https://fred.stlouisfed.org/series/AZMFG",
      }),
      cbpEmp({ key: "cbp_mfg_emp", sector: "Advanced Manufacturing", label: "Manufacturing employment — CBP NAICS 31-33 (AZ)", seriesId: "CBP_AZ_SEC_3133_EMP", weight: 40 }),
    ],
  },
  {
    sector: "Healthcare",
    builders: [
      fredMonthlyEmp({
        key: "fred_health_emp", sector: "Healthcare", label: "AZ healthcare employment (FRED)",
        seriesId: "SMS04000006562000001", weight: 55, source: "FRED — Arizona Health Care & Social Assistance Employment (BLS via FRED)",
        sourceUrl: "https://fred.stlouisfed.org/series/SMS04000006562000001",
      }),
      cbpEmp({ key: "cbp_health_emp", sector: "Healthcare", label: "Healthcare employment — CBP NAICS 62 (AZ)", seriesId: "CBP_AZ_SEC_62_EMP", weight: 30 }),
      buildAdhsUnits,
    ],
  },
  {
    sector: "Specialty Trades & Construction",
    builders: [
      fredMonthlyEmp({
        key: "fred_cons_emp", sector: "Specialty Trades & Construction", label: "AZ construction employment (FRED AZCONS)",
        seriesId: "AZCONS", weight: 40, source: "FRED — Arizona Construction Employment (BLS via FRED)",
        sourceUrl: "https://fred.stlouisfed.org/series/AZCONS",
      }),
      buildCiPermitsTrend,
      cbpEmp({ key: "cbp_trades_emp", sector: "Specialty Trades & Construction", label: "Construction employment — CBP NAICS 23 (AZ)", seriesId: "CBP_AZ_SEC_23_EMP", weight: 25 }),
    ],
  },
];

export const TAILWIND_SECTORS = SECTOR_BUILDERS.map((s) => s.sector);

function fingerprint(sector: string, comps: TailwindComponent[]): string {
  const parts = comps.map((c) =>
    [c.key, c.status, c.asOf ?? "", c.movementPct === null ? "" : c.movementPct.toFixed(3), c.valueText].join(":")
  );
  return createHash("sha256").update(`${sector}|${parts.join("|")}`).digest("hex").slice(0, 24);
}

function whatChangedLine(
  sector: string,
  prev: { score: number | null; components: TailwindComponent[] } | null,
  comps: TailwindComponent[],
  score: number | null
): string {
  if (!prev) return "Baseline — first computed score for this sector.";
  const prevByKey = new Map(prev.components.map((c) => [c.key, c]));
  const notes: string[] = [];
  for (const c of comps) {
    const p = prevByKey.get(c.key);
    if (!p && c.status === "live") notes.push(`${c.label} is now counted`);
    if (p && p.status === "live" && c.status === "dropped-stale") notes.push(`${c.label} dropped out (stale)`);
    if (p && p.status !== "live" && c.status === "live") notes.push(`${c.label} is back in the score`);
  }
  const movers: { label: string; delta: number; movement: number }[] = [];
  for (const c of comps) {
    const p = prevByKey.get(c.key);
    if (!p || c.subScore === null || p.subScore === null) continue;
    const delta = c.subScore - p.subScore;
    if (Math.abs(delta) >= 2) movers.push({ label: c.label, delta, movement: c.movementPct ?? 0 });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  const moverText = movers
    .slice(0, 2)
    .map((m) => `${m.label} ${m.delta > 0 ? "▲" : "▼"} (movement now ${fmtPct(m.movement)} YoY)`)
    .join("; ");
  const head =
    score !== null && prev.score !== null
      ? `Score ${prev.score.toFixed(0)} → ${score.toFixed(0)}.`
      : score !== null
        ? `Score now ${score.toFixed(0)}.`
        : "Still no score — fewer than 2 live components.";
  const body = moverText || "No component moved materially since the last reading.";
  return [head, body, ...notes].join(" ").trim();
}

export interface ComputeOpts {
  /** Test hook: pretend these components are N months older (months by
   * component key) so the staleness drop can be proven live. */
  ageOverrides?: Record<string, number>;
  now?: Date;
}

/** Build all components, score every sector, and append score-history
 * rows for sectors whose computation actually changed. Returns the
 * full report (same shape the API serves). */
export async function computeTailwindScores(opts: ComputeOpts = {}): Promise<TailwindSectorReport[]> {
  await ensureTailwindSchema();
  const now = opts.now ?? new Date();
  const db = sql();
  const reports: TailwindSectorReport[] = [];
  for (const { sector, builders } of SECTOR_BUILDERS) {
    const built: TailwindComponent[] = [];
    for (const b of builders) {
      try {
        const c = await b(sector);
        built.push(finalize(c, now, opts.ageOverrides?.[c.key] ?? 0));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        built.push({
          key: b.name || "unknown",
          sector,
          label: b.name || "component",
          valueText: "—",
          movementPct: null,
          subScore: null,
          weight: 0,
          effectiveWeight: 0,
          status: "gap",
          statusNote: `Component failed to build: ${msg.slice(0, 200)}`,
          asOf: null,
          source: "",
          sourceUrl: "",
          note: "",
          detail: [],
        });
      }
    }
    const live = built.filter((c) => c.status === "live" && c.subScore !== null);
    const totalWeight = live.reduce((a, c) => a + c.weight, 0);
    for (const c of built) {
      c.effectiveWeight = c.status === "live" && totalWeight > 0 ? c.weight / totalWeight : 0;
    }
    const qualifies = live.length >= 2;
    const score = qualifies
      ? Math.round(live.reduce((a, c) => a + (c.subScore ?? 0) * c.weight, 0) / totalWeight)
      : null;
    const fp = fingerprint(sector, built);
    const prevRows = await db`SELECT score, components, fingerprint, computed_at FROM mi_tailwind_scores
      WHERE sector = ${sector} ORDER BY id DESC LIMIT 1`;
    const prev = prevRows.length
      ? {
          score: (prevRows[0] as Record<string, unknown>).score === null ? null : Number((prevRows[0] as Record<string, unknown>).score),
          components: (typeof (prevRows[0] as Record<string, unknown>).components === "string"
            ? JSON.parse(String((prevRows[0] as Record<string, unknown>).components))
            : (prevRows[0] as Record<string, unknown>).components) as TailwindComponent[],
          fingerprint: String((prevRows[0] as Record<string, unknown>).fingerprint),
          computedAt: String((prevRows[0] as Record<string, unknown>).computed_at),
        }
      : null;
    let whatChanged: string;
    let computedAt: string;
    if (prev && prev.fingerprint === fp) {
      // Idempotence: identical inputs → no new history row.
      whatChanged = whatChangedLine(sector, null, built, score);
      // Keep the stored what-changed from the row that set this state:
      const stored = await db`SELECT what_changed FROM mi_tailwind_scores WHERE sector = ${sector} ORDER BY id DESC LIMIT 1`;
      whatChanged = String((stored[0] as Record<string, unknown>)?.what_changed ?? whatChanged);
      computedAt = prev.computedAt;
    } else {
      whatChanged = whatChangedLine(sector, prev, built, score);
      await db`INSERT INTO mi_tailwind_scores (sector, score, what_changed, fingerprint, components)
        VALUES (${sector}, ${score}, ${whatChanged}, ${fp}, ${JSON.stringify(built)}::jsonb)`;
      computedAt = new Date().toISOString();
    }
    reports.push({ sector, score, qualifies, whatChanged, computedAt, components: built });
  }
  return reports;
}

/** The report the API serves: the latest stored computation per sector
 * (no recompute — the ingest keeps it fresh daily). */
export async function getTailwindReport(): Promise<{ computedAt: string | null; formula: string; sectors: TailwindSectorReport[] }> {
  await ensureTailwindSchema();
  const db = sql();
  const sectors: TailwindSectorReport[] = [];
  let latest: string | null = null;
  for (const sector of TAILWIND_SECTORS) {
    const rows = await db`SELECT score, what_changed, components, computed_at FROM mi_tailwind_scores
      WHERE sector = ${sector} ORDER BY id DESC LIMIT 1`;
    if (!rows.length) {
      sectors.push({ sector, score: null, qualifies: false, whatChanged: "Not computed yet — the tailwind ingest has not run.", computedAt: null, components: [] });
      continue;
    }
    const r = rows[0] as Record<string, unknown>;
    const comps = (typeof r.components === "string" ? JSON.parse(r.components) : r.components) as TailwindComponent[];
    const live = comps.filter((c) => c.status === "live").length;
    sectors.push({
      sector,
      score: r.score === null ? null : Number(r.score),
      qualifies: live >= 2 && r.score !== null,
      whatChanged: String(r.what_changed ?? ""),
      computedAt: String(r.computed_at),
      components: comps,
    });
    if (!latest || String(r.computed_at) > latest) latest = String(r.computed_at);
  }
  return { computedAt: latest, formula: TAILWIND_FORMULA, sectors };
}

export { logSync };
