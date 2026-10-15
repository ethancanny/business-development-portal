/**
 * Commercial / industrial building-permit ingest (Phase 3).
 * Split out of market-ingest.ts like filings-ingest.ts — one module
 * per source family.
 *
 * Adapters (all verified live 2026-10-14 — see
 * permits-cities-scoping-2026-10-14.md):
 *  - Mesa:    Socrata SODA dzpk-hxfb, permit_type = COM.
 *  - Phoenix: ArcGIS MapServer Planning_Permit layer 1,
 *             SCOPE_DESC LIKE 'COMMERCIAL%'. No valuation or sqft is
 *             published by this source (count-only cross-check).
 *  - Tempe:   AGOL FeatureServer building_permits layer 0, Type in
 *             the commercial / tenant-improvement / multi-family set.
 *  - Gilbert: ArcGIS MapServer Growth_Development_Tables_1 layer 3
 *             (EnergovPermitData), PermitType in the commercial set.
 *             No contractor field exists in this source.
 * Chandler is NOT wired: its only public GIS layer is a high-profile
 * projects tracker (stalled since ~Oct 2025) and the full per-permit
 * route (CLICS) is account-gated.
 *
 * All rows land in the city-keyed mi_permits_ci table, windowed to
 * permits issued/applied on or after 2019-01-01. This supersedes the
 * Census BPS county housing-permit series (county_permits) as the
 * portal's permit signal: BPS counts residential units by county;
 * this is per-permit commercial / industrial activity with
 * valuations, contractors and addresses where the source has them.
 *
 * Cross-reference (Ethan's standing rule): after each city's pull, an
 * independent aggregate over the identical filter (row count, plus
 * the valuation sum where the source publishes one) is reconciled
 * against what was fetched and logged as permits-ci-xcheck — one line
 * per city, including when the check itself cannot run (a silent
 * check is a failed check). A per-city failure never fails the other
 * cities: it is caught, logged, and the run continues.
 */
import { neon } from "@neondatabase/serverless";
import { logSync } from "./market-db";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (permits ingest requires Postgres)");
  return neon(url);
}

/* ---------------- Schema ---------------- */

let ensured = false;
async function ensurePermitsCiTable(): Promise<void> {
  if (ensured) return;
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS mi_permits_ci (
      id TEXT PRIMARY KEY,
      city TEXT NOT NULL DEFAULT '',
      permit_number TEXT NOT NULL DEFAULT '',
      property_address TEXT NOT NULL DEFAULT '',
      issued_date DATE,
      finaled_date DATE,
      status TEXT NOT NULL DEFAULT '',
      type_of_work TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'project',
      description TEXT NOT NULL DEFAULT '',
      valuation NUMERIC,
      sqft NUMERIC,
      contractor_name TEXT NOT NULL DEFAULT '',
      contractor_city TEXT NOT NULL DEFAULT '',
      parcel_number TEXT NOT NULL DEFAULT '',
      lat DOUBLE PRECISION,
      lng DOUBLE PRECISION,
      first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (city, permit_number)
    )`;
  ensured = true;
}

/* ---------------- Category mapping ---------------- */

export type PermitCategory = "project" | "subpermit" | "multifamily";

/** Trade sub-permits ride along with a parent project permit; they are
 * stored (contractor activity signal) but are not signal-grade project
 * volume for the tailwind score. */
const SUBPERMIT_MARKERS = [
  "Electrical",
  "Plumbing",
  "Mechanical",
  "Fire Alarm",
  "Fire Sprinkler",
  "Deferred",
  "Communications Tower",
  "Macro Cell Site",
  "Annual Facilities Permit",
  "Certificates of Occupancy",
  "Sign Permit",
];

export function permitCategory(typeOfWork: string): PermitCategory {
  const t = (typeOfWork ?? "").trim();
  if (t.startsWith("Com (MFR)") || t === "Multi-Family Residential") return "multifamily";
  for (const m of SUBPERMIT_MARKERS) if (t.includes(m)) return "subpermit";
  return "project";
}

function categoryCounts(rows: PermitRow[]): Record<PermitCategory, number> {
  const counts: Record<PermitCategory, number> = { project: 0, subpermit: 0, multifamily: 0 };
  for (const r of rows) counts[r.category] += 1;
  return counts;
}

/* ---------------- Row shaping ---------------- */

type SodaRow = Record<string, string | undefined>;

const numOrNull = (v: string | undefined): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
};

const dateOrNull = (v: string | undefined): string | null => {
  if (!v) return null;
  const d = v.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

interface PermitRow {
  id: string;
  city: string;
  permitNumber: string;
  propertyAddress: string;
  issuedDate: string | null;
  finaledDate: string | null;
  status: string;
  typeOfWork: string;
  category: PermitCategory;
  description: string;
  valuation: number | null;
  sqft: number | null;
  contractorName: string;
  contractorCity: string;
  parcelNumber: string;
  lat: number | null;
  lng: number | null;
  /** Valuation exactly as the source reports it (pre-threshold) —
   * the cross-check basis. Mesa: total_valuation; Tempe:
   * EstProjectCost; Gilbert: PermitValuation; Phoenix: null (the
   * source publishes no valuation). */
  totalValuation: number | null;
}

function shapeRow(city: string, r: SodaRow): PermitRow | null {
  const permitNumber = (r.permit_number ?? "").trim();
  if (!permitNumber) return null;
  const sqftRaw = numOrNull(r.total_square_feet);
  return {
    id: `${city}-${permitNumber}`,
    city,
    permitNumber,
    propertyAddress: (r.property_address ?? "").trim(),
    issuedDate: dateOrNull(r.issued_date),
    finaledDate: dateOrNull(r.finaled_date),
    status: (r.status ?? "").trim(),
    typeOfWork: (r.type_of_work ?? "").trim(),
    category: permitCategory(r.type_of_work ?? ""),
    description: (r.description_of_work ?? "").slice(0, 500),
    valuation: numOrNull(r.total_valuation) ?? numOrNull(r.icc_value) ?? numOrNull(r.job_value),
    sqft: sqftRaw === 0 ? null : sqftRaw,
    contractorName: (r.contractor_name ?? "").trim(),
    contractorCity: (r.contractor_city ?? "").trim(),
    parcelNumber: (r.parcel_number ?? "").trim(),
    lat: numOrNull(r.latitude),
    lng: numOrNull(r.longitude),
    totalValuation: numOrNull(r.total_valuation),
  };
}

/* ---------------- Upsert (shared by all cities) ---------------- */

async function upsertPermits(rows: PermitRow[]): Promise<number> {
  if (!rows.length) return 0;
  await ensurePermitsCiTable();
  const db = sql();
  const CHUNK = 500;
  const COLS = 17;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * COLS;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, $${b + 16}, $${b + 17})`);
      params.push(
        r.id, r.city, r.permitNumber, r.propertyAddress, r.issuedDate, r.finaledDate,
        r.status, r.typeOfWork, r.category, r.description, r.valuation, r.sqft,
        r.contractorName, r.contractorCity, r.parcelNumber, r.lat, r.lng
      );
    });
    await db.query(
      `INSERT INTO mi_permits_ci (id, city, permit_number, property_address, issued_date, finaled_date, status, type_of_work, category, description, valuation, sqft, contractor_name, contractor_city, parcel_number, lat, lng)
       VALUES ${values.join(", ")}
       ON CONFLICT (city, permit_number) DO UPDATE SET
         status = EXCLUDED.status, finaled_date = EXCLUDED.finaled_date,
         valuation = EXCLUDED.valuation, category = EXCLUDED.category,
         updated_at = now()`,
      params
    );
  }
  return rows.length;
}

export interface CiIngestResult {
  city: string;
  fetched: number;
  upserted: number;
}

/** Internal per-city result: the public shape plus what the combined
 * summary line needs. */
interface CityPull extends CiIngestResult {
  counts: Record<PermitCategory, number>;
  note?: string;
}

/* ---------------- Mesa (Socrata SODA) ---------------- */

const MESA_SODA = "https://citydata.mesaaz.gov/resource/dzpk-hxfb.json";
const MESA_SINCE = "2019-01-01T00:00:00";
const MESA_WHERE = `permit_type = 'COM' AND issued_date >= '${MESA_SINCE}'`;
const MESA_SELECT = [
  "permit_number", "property_address", "issued_date", "finaled_date", "status",
  "description_of_work", "icc_value", "job_value", "total_valuation", "type_of_work",
  "contractor_name", "contractor_city", "parcel_number", "total_square_feet",
  "latitude", "longitude",
].join(",");
const PAGE = 5000;

async function fetchSoda(params: Record<string, string>): Promise<unknown> {
  const res = await fetch(`${MESA_SODA}?${new URLSearchParams(params).toString()}`, {
    headers: { "User-Agent": "CannyCapitalPortal/1.0 (ethan@cannycapitalpartners.com)" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`Mesa SODA HTTP ${res.status}`);
  return res.json();
}

async function ingestMesaPermits(): Promise<CityPull> {
  const city = "Mesa";
  // Page the full COM set since 2019, deduped by permit_number.
  const byPermit = new Map<string, PermitRow>();
  let fetched = 0;
  let offset = 0;
  for (;;) {
    const page = (await fetchSoda({
      $select: MESA_SELECT,
      $where: MESA_WHERE,
      $order: ":id",
      $limit: String(PAGE),
      $offset: String(offset),
    })) as SodaRow[];
    if (!Array.isArray(page)) throw new Error("Mesa SODA returned a non-array page");
    fetched += page.length;
    for (const raw of page) {
      const row = shapeRow(city, raw);
      if (row) byPermit.set(row.permitNumber, row);
    }
    if (page.length < PAGE) break;
    offset += PAGE;
  }
  const rows = Array.from(byPermit.values());
  const upserted = await upsertPermits(rows);

  // Cross-reference: independent SODA aggregate over the same filter
  // vs the distinct permits actually fetched (1% tolerance both axes).
  let aggCount: number | null = null;
  let aggVal: number | null = null;
  try {
    const agg = (await fetchSoda({
      $select: "count(*) as n, sum(total_valuation) as val",
      $where: MESA_WHERE,
    })) as { n?: string; val?: string }[];
    if (Array.isArray(agg) && agg.length) {
      aggCount = numOrNull(agg[0].n);
      aggVal = numOrNull(agg[0].val);
    }
  } catch {
    /* logged below as a failed check */
  }
  if (aggCount === null) {
    await logSync("permits-ci-xcheck", "error", 0, "Mesa SODA cross-check could not run: aggregate query failed");
  } else {
    const fetchedVal = rows.reduce((sum, r) => sum + (r.totalValuation ?? 0), 0);
    const countDiff = Math.abs(rows.length - aggCount);
    const countOk = countDiff <= Math.max(1, aggCount * 0.01);
    const valDiff = aggVal === null ? null : Math.abs(fetchedVal - aggVal);
    const valOk = valDiff === null || aggVal === 0 || valDiff <= Math.abs(aggVal as number) * 0.01;
    await logSync(
      "permits-ci-xcheck",
      countOk && valOk ? "ok" : "error",
      0,
      `Mesa COM permits since 2019: fetched ${rows.length} distinct / $${Math.round(fetchedVal).toLocaleString()} total_valuation vs SODA aggregate ${aggCount} / ${aggVal === null ? "n/a" : `$${Math.round(aggVal).toLocaleString()}`} — count diff ${countDiff}${valDiff === null ? "" : `, valuation diff $${Math.round(valDiff).toLocaleString()}`}`
    );
  }
  return { city, fetched, upserted, counts: categoryCounts(rows) };
}

/* ---------------- ArcGIS helpers (Phoenix / Tempe / Gilbert) ---------------- */

type GisAttrs = Record<string, string | number | null | undefined>;

const gisStr = (v: string | number | null | undefined): string =>
  v === null || v === undefined ? "" : String(v).trim();

const gisNum = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isNaN(n) ? null : n;
};

/** ArcGIS date fields arrive as epoch milliseconds → YYYY-MM-DD. */
const epochDate = (v: string | number | null | undefined): string | null => {
  const ms = gisNum(v);
  if (ms === null) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const joinDesc = (parts: string[]): string =>
  parts.map((p) => p.trim()).filter(Boolean).join(" — ").slice(0, 500);

const GIS_PAGE = 2000; // every verified layer caps maxRecordCount at 2000
const SINCE_EPOCH = Date.UTC(2019, 0, 1);

async function arcgisQuery(
  layerUrl: string,
  params: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${layerUrl}/query?${new URLSearchParams(params).toString()}`, {
    headers: { "User-Agent": "CannyCapitalPortal/1.0 (ethan@cannycapitalpartners.com)" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`ArcGIS HTTP ${res.status} (${layerUrl})`);
  const json = (await res.json()) as Record<string, unknown>;
  const err = json.error as { code?: number; message?: string } | undefined;
  if (err) throw new Error(`ArcGIS error ${err.code ?? "?"}: ${err.message ?? "unknown"} (${layerUrl})`);
  return json;
}

/** Page a layer query until a short page comes back. Attributes only —
 * geometry is never requested. */
async function arcgisFetchAll(
  layerUrl: string,
  where: string,
  outFields: string
): Promise<GisAttrs[]> {
  const out: GisAttrs[] = [];
  let offset = 0;
  for (;;) {
    const json = await arcgisQuery(layerUrl, {
      where,
      outFields,
      orderByFields: "OBJECTID ASC",
      resultOffset: String(offset),
      resultRecordCount: String(GIS_PAGE),
      returnGeometry: "false",
      f: "json",
    });
    const feats = Array.isArray(json.features)
      ? (json.features as { attributes?: GisAttrs }[])
      : [];
    for (const f of feats) out.push(f.attributes ?? {});
    if (feats.length < GIS_PAGE || json.exceededTransferLimit === false) break;
    offset += feats.length;
  }
  return out;
}

async function arcgisCount(layerUrl: string, where: string): Promise<number | null> {
  try {
    const json = await arcgisQuery(layerUrl, {
      where,
      returnCountOnly: "true",
      f: "json",
    });
    return typeof json.count === "number" ? json.count : null;
  } catch {
    return null;
  }
}

/** Independent aggregate (row count + valuation sum) over a filter —
 * the cross-check basis for the ArcGIS cities that publish value. */
async function arcgisAggregate(
  layerUrl: string,
  where: string,
  countField: string,
  sumField: string
): Promise<{ count: number | null; sum: number | null }> {
  try {
    const outStatistics = JSON.stringify([
      { statisticType: "count", onStatisticField: countField, outStatisticFieldName: "n" },
      { statisticType: "sum", onStatisticField: sumField, outStatisticFieldName: "val" },
    ]);
    const json = await arcgisQuery(layerUrl, {
      where,
      outStatistics,
      returnGeometry: "false",
      f: "json",
    });
    const feats = Array.isArray(json.features)
      ? (json.features as { attributes?: GisAttrs }[])
      : [];
    const attrs = feats.length ? feats[0].attributes ?? {} : {};
    return { count: gisNum(attrs.n), sum: gisNum(attrs.val) };
  } catch {
    return { count: null, sum: null };
  }
}

/** Count + valuation-sum cross-check, same shape/tolerance as Mesa's. */
async function logCountSumXcheck(
  city: string,
  fieldLabel: string,
  rows: PermitRow[],
  agg: { count: number | null; sum: number | null },
  note?: string
): Promise<void> {
  if (agg.count === null) {
    await logSync("permits-ci-xcheck", "error", 0, `${city}: cross-check could not run: aggregate query failed`);
    return;
  }
  const fetchedVal = rows.reduce((sum, r) => sum + (r.totalValuation ?? 0), 0);
  const countDiff = Math.abs(rows.length - agg.count);
  const countOk = countDiff <= Math.max(1, agg.count * 0.01);
  const valDiff = agg.sum === null ? null : Math.abs(fetchedVal - agg.sum);
  const valOk = valDiff === null || agg.sum === 0 || valDiff <= Math.abs(agg.sum as number) * 0.01;
  await logSync(
    "permits-ci-xcheck",
    countOk && valOk ? "ok" : "error",
    0,
    `${city} permits since 2019: fetched ${rows.length} distinct / $${Math.round(fetchedVal).toLocaleString()} ${fieldLabel} vs service aggregate ${agg.count} / ${agg.sum === null ? "n/a" : `$${Math.round(agg.sum).toLocaleString()}`} — count diff ${countDiff}${valDiff === null ? "" : `, valuation diff $${Math.round(valDiff).toLocaleString()}`}${note ? ` (${note})` : ""}`
  );
}

interface GisPull {
  /** Rows inside the 2019+ window — what gets upserted. */
  rows: PermitRow[];
  /** Distinct rows before the window filter (equals rows when the
   * server applied the date filter) — the cross-check basis. */
  rawRows: PermitRow[];
  fetched: number;
  /** The where clause that actually succeeded (full or type-only). */
  whereUsed: string;
  serverSideDate: boolean;
}

/**
 * Shared ArcGIS pull: try the full where (type filter + server-side
 * DATE-literal window) first; if the server rejects it, fall back to
 * the type-only where and apply the window client-side on each row's
 * window-date epoch. Either way the result reconciles against an
 * aggregate over the where that actually ran.
 */
async function pullGisCity(
  layerUrl: string,
  outFields: string,
  fullWhere: string,
  typeWhere: string,
  windowEpoch: (a: GisAttrs) => number | null,
  shape: (a: GisAttrs) => PermitRow | null
): Promise<GisPull> {
  let whereUsed = fullWhere;
  let serverSideDate = true;
  let attrs: GisAttrs[];
  try {
    attrs = await arcgisFetchAll(layerUrl, fullWhere, outFields);
  } catch {
    serverSideDate = false;
    whereUsed = typeWhere;
    attrs = await arcgisFetchAll(layerUrl, typeWhere, outFields);
  }
  const rawByPermit = new Map<string, PermitRow>();
  for (const a of attrs) {
    const row = shape(a);
    if (row) rawByPermit.set(row.permitNumber, row);
  }
  const rawRows = Array.from(rawByPermit.values());
  let rows = rawRows;
  if (!serverSideDate) {
    const keep = new Set<string>();
    for (const a of attrs) {
      const num = gisStr(a.PermitNum ?? a.PermitNumber ?? a.PER_NUM);
      const ms = windowEpoch(a);
      if (num && ms !== null && ms >= SINCE_EPOCH) keep.add(num);
    }
    rows = rawRows.filter((r) => keep.has(r.permitNumber));
  }
  return { rows, rawRows, fetched: attrs.length, whereUsed, serverSideDate };
}

const CLIENT_DATE_NOTE = "2019+ window applied client-side; server rejected the DATE literal";

/* ---------------- Phoenix (ArcGIS MapServer) ---------------- */

const PHOENIX_LAYER =
  "https://maps.phoenix.gov/pub/rest/services/Public/Planning_Permit/MapServer/1";
const PHOENIX_OUT =
  "PER_NUM,STREET_FULL_NAME,PER_ISSUE_DATE,PER_ENT_DATE,PERMIT_STAT,SCOPE_DESC,PERMIT_NAME,PER_TYPE_DESC,MOD_DESC,PROFESS_NAME";
const PHOENIX_TYPE_WHERE = "SCOPE_DESC LIKE 'COMMERCIAL%'";
const PHOENIX_FULL_WHERE = `${PHOENIX_TYPE_WHERE} AND PER_ENT_DATE >= DATE '2019-01-01'`;

function shapePhoenixRow(a: GisAttrs): PermitRow | null {
  const permitNumber = gisStr(a.PER_NUM);
  if (!permitNumber) return null;
  const scope = gisStr(a.SCOPE_DESC);
  return {
    id: `Phoenix-${permitNumber}`,
    city: "Phoenix",
    permitNumber,
    propertyAddress: gisStr(a.STREET_FULL_NAME),
    // PER_ISSUE_DATE is null while a permit is still OPEN — the entry
    // date is the fallback (and always the window basis).
    issuedDate: epochDate(a.PER_ISSUE_DATE) ?? epochDate(a.PER_ENT_DATE),
    finaledDate: null,
    status: gisStr(a.PERMIT_STAT),
    typeOfWork: scope,
    // Sign reviews are the one sub-permit class Phoenix scopes expose.
    // Multi-family is NOT distinguishable in this source — apartments
    // sit inside the COMMERCIAL scopes, so never guess "multifamily".
    category: scope.toUpperCase().includes("SIGN") ? "subpermit" : "project",
    description: joinDesc([gisStr(a.PERMIT_NAME), gisStr(a.PER_TYPE_DESC), gisStr(a.MOD_DESC)]),
    valuation: null, // not published by this source
    sqft: null, // not published by this source
    contractorName: gisStr(a.PROFESS_NAME),
    contractorCity: "",
    parcelNumber: "",
    lat: null,
    lng: null,
    totalValuation: null,
  };
}

async function ingestPhoenixPermits(): Promise<CityPull> {
  const city = "Phoenix";
  const pull = await pullGisCity(
    PHOENIX_LAYER,
    PHOENIX_OUT,
    PHOENIX_FULL_WHERE,
    PHOENIX_TYPE_WHERE,
    (a) => gisNum(a.PER_ENT_DATE),
    shapePhoenixRow
  );
  const upserted = await upsertPermits(pull.rows);

  // Cross-reference is count-only: this source publishes no valuation
  // field at all, so there is no value figure to reconcile against.
  const aggCount = await arcgisCount(PHOENIX_LAYER, pull.whereUsed);
  if (aggCount === null) {
    await logSync("permits-ci-xcheck", "error", 0, "Phoenix: cross-check could not run: count query failed");
  } else {
    const countDiff = Math.abs(pull.rawRows.length - aggCount);
    const countOk = countDiff <= Math.max(1, aggCount * 0.01);
    await logSync(
      "permits-ci-xcheck",
      countOk ? "ok" : "error",
      0,
      `Phoenix commercial permits (SCOPE_DESC LIKE 'COMMERCIAL%', entered since 2019): fetched ${pull.rawRows.length} distinct vs service count ${aggCount} — count diff ${countDiff}. Valuation is not published by this source (no valuation field in the layer), so values are single-source / not reconcilable — count-only check.${pull.serverSideDate ? "" : ` (${CLIENT_DATE_NOTE})`}`
    );
  }
  return {
    city,
    fetched: pull.fetched,
    upserted,
    counts: categoryCounts(pull.rows),
    note: pull.serverSideDate ? undefined : CLIENT_DATE_NOTE,
  };
}

/* ---------------- Tempe (AGOL FeatureServer) ---------------- */

const TEMPE_LAYER =
  "https://services.arcgis.com/lQySeXwbBg53XWDi/arcgis/rest/services/building_permits/FeatureServer/0";
const TEMPE_OUT =
  "PermitNum,OriginalAddress1,IssuedDateDtm,AppliedDateDtm,CompletedDateDtm,StatusCurrent,Type,ProjectName,Description,EstProjectCost,TotalSqFt,ContractorCompanyName,Latitude,Longitude";
const TEMPE_TYPES = [
  "New Commercial",
  "Commercial",
  "Commercial Addition/Alteration",
  "Commercial Addition/Alteration/Remodel",
  "Tenant Improvement",
  "Tenant Improvement - Demolition",
  "Industrial Plant",
  "Mixed Use",
  "New Multi-Family",
  "Multi-Family",
];
const TEMPE_TYPE_WHERE = `Type IN (${TEMPE_TYPES.map((t) => `'${t}'`).join(",")})`;
const TEMPE_FULL_WHERE = `${TEMPE_TYPE_WHERE} AND (IssuedDateDtm >= DATE '2019-01-01' OR (IssuedDateDtm IS NULL AND AppliedDateDtm >= DATE '2019-01-01'))`;

function shapeTempeRow(a: GisAttrs): PermitRow | null {
  const permitNumber = gisStr(a.PermitNum);
  if (!permitNumber) return null;
  const type = gisStr(a.Type);
  const cost = gisNum(a.EstProjectCost);
  const sqftRaw = gisNum(a.TotalSqFt);
  return {
    id: `Tempe-${permitNumber}`,
    city: "Tempe",
    permitNumber,
    propertyAddress: gisStr(a.OriginalAddress1),
    issuedDate: epochDate(a.IssuedDateDtm) ?? epochDate(a.AppliedDateDtm),
    finaledDate: epochDate(a.CompletedDateDtm),
    status: gisStr(a.StatusCurrent),
    typeOfWork: type,
    category:
      type === "New Multi-Family" || type === "Multi-Family" ? "multifamily" : "project",
    description: joinDesc([gisStr(a.ProjectName), gisStr(a.Description)]),
    valuation: cost !== null && cost > 0 ? cost : null,
    sqft: sqftRaw !== null && sqftRaw > 0 ? sqftRaw : null,
    contractorName: gisStr(a.ContractorCompanyName),
    contractorCity: "",
    parcelNumber: "",
    lat: gisNum(a.Latitude),
    lng: gisNum(a.Longitude),
    totalValuation: cost,
  };
}

async function ingestTempePermits(): Promise<CityPull> {
  const city = "Tempe";
  const pull = await pullGisCity(
    TEMPE_LAYER,
    TEMPE_OUT,
    TEMPE_FULL_WHERE,
    TEMPE_TYPE_WHERE,
    (a) => gisNum(a.IssuedDateDtm) ?? gisNum(a.AppliedDateDtm),
    shapeTempeRow
  );
  const upserted = await upsertPermits(pull.rows);
  const agg = await arcgisAggregate(TEMPE_LAYER, pull.whereUsed, "PermitNum", "EstProjectCost");
  await logCountSumXcheck(
    city,
    "EstProjectCost",
    pull.rawRows,
    agg,
    pull.serverSideDate ? undefined : CLIENT_DATE_NOTE
  );
  return {
    city,
    fetched: pull.fetched,
    upserted,
    counts: categoryCounts(pull.rows),
    note: pull.serverSideDate ? undefined : CLIENT_DATE_NOTE,
  };
}

/* ---------------- Gilbert (ArcGIS MapServer table) ---------------- */

const GILBERT_LAYER =
  "https://maps.gilbertaz.gov/arcgis/rest/services/OD/Growth_Development_Tables_1/MapServer/3";
const GILBERT_OUT =
  "PermitNumber,AddressFull,IssuedDate,ApplyDate,FinalDate,PermitStatus,PermitType,WorkClass,ProjectName,PermitValuation,ParcelNumber,Latitude,Longitude";
const GILBERT_TYPES = [
  "Commercial Building",
  "Commercial Multi-Family",
  "Commercial Trades/Fire/Misc",
];
const GILBERT_TYPE_WHERE = `PermitType IN (${GILBERT_TYPES.map((t) => `'${t}'`).join(",")})`;
const GILBERT_FULL_WHERE = `${GILBERT_TYPE_WHERE} AND (IssuedDate >= DATE '2019-01-01' OR (IssuedDate IS NULL AND ApplyDate >= DATE '2019-01-01'))`;

function shapeGilbertRow(a: GisAttrs): PermitRow | null {
  const permitNumber = gisStr(a.PermitNumber);
  if (!permitNumber) return null;
  const ptype = gisStr(a.PermitType);
  const workClass = gisStr(a.WorkClass);
  const val = gisNum(a.PermitValuation);
  return {
    id: `Gilbert-${permitNumber}`,
    city: "Gilbert",
    permitNumber,
    propertyAddress: gisStr(a.AddressFull),
    issuedDate: epochDate(a.IssuedDate) ?? epochDate(a.ApplyDate),
    finaledDate: epochDate(a.FinalDate),
    status: gisStr(a.PermitStatus),
    typeOfWork: workClass ? `${ptype} — ${workClass}` : ptype,
    category:
      ptype === "Commercial Multi-Family"
        ? "multifamily"
        : ptype === "Commercial Trades/Fire/Misc"
          ? "subpermit"
          : "project",
    description: gisStr(a.ProjectName).slice(0, 500),
    valuation: val !== null && val > 0 ? val : null,
    sqft: null, // not published by this source
    contractorName: "", // no contractor/applicant field exists in this source
    contractorCity: "",
    parcelNumber: gisStr(a.ParcelNumber),
    lat: gisNum(a.Latitude),
    lng: gisNum(a.Longitude),
    totalValuation: val,
  };
}

async function ingestGilbertPermits(): Promise<CityPull> {
  const city = "Gilbert";
  const pull = await pullGisCity(
    GILBERT_LAYER,
    GILBERT_OUT,
    GILBERT_FULL_WHERE,
    GILBERT_TYPE_WHERE,
    (a) => gisNum(a.IssuedDate) ?? gisNum(a.ApplyDate),
    shapeGilbertRow
  );
  const upserted = await upsertPermits(pull.rows);
  const agg = await arcgisAggregate(GILBERT_LAYER, pull.whereUsed, "PermitNumber", "PermitValuation");
  await logCountSumXcheck(
    city,
    "PermitValuation",
    pull.rawRows,
    agg,
    pull.serverSideDate ? undefined : CLIENT_DATE_NOTE
  );
  return {
    city,
    fetched: pull.fetched,
    upserted,
    counts: categoryCounts(pull.rows),
    note: pull.serverSideDate ? undefined : CLIENT_DATE_NOTE,
  };
}

/* ---------------- Orchestrator ---------------- */

/** Commercial / industrial permits ingest (all wired cities). Runs in
 * the daily "all" ingest — reference data, per Ethan's refresh rule.
 * Each city is isolated: a failure is logged per city and the rest
 * still run; the combined permits_ci summary covers all four. */
export async function ingestCiPermits(): Promise<CiIngestResult[]> {
  const adapters: { name: string; run: () => Promise<CityPull> }[] = [
    { name: "Mesa", run: ingestMesaPermits },
    { name: "Phoenix", run: ingestPhoenixPermits },
    { name: "Tempe", run: ingestTempePermits },
    { name: "Gilbert", run: ingestGilbertPermits },
  ];
  const pulls: (CityPull | null)[] = [];
  let anyFailure = false;
  for (const a of adapters) {
    try {
      pulls.push(await a.run());
    } catch (e) {
      anyFailure = true;
      const msg = e instanceof Error ? e.message : String(e);
      await logSync("permits_ci", "error", 0, `${a.name}: ${msg}`.slice(0, 500));
      await logSync(
        "permits-ci-xcheck",
        "error",
        0,
        `${a.name}: cross-check could not run: pull failed (${msg.slice(0, 200)})`
      );
      pulls.push(null);
    }
  }
  const segments: string[] = [];
  let totalUpserted = 0;
  adapters.forEach((a, i) => {
    const p = pulls[i];
    if (!p) {
      segments.push(`${a.name}: FAILED (see error above)`);
      return;
    }
    totalUpserted += p.upserted;
    segments.push(
      `${a.name}: ${p.fetched} fetched, ${p.upserted} upserted (project ${p.counts.project}, multifamily ${p.counts.multifamily}, subpermit ${p.counts.subpermit})${p.note ? ` — ${p.note}` : ""}`
    );
  });
  await logSync(
    "permits_ci",
    anyFailure ? "error" : "ok",
    totalUpserted,
    `Commercial/industrial permits issued since 2019 — ${segments.join(" · ")}`.slice(0, 1000)
  );
  return adapters.map((a, i) => {
    const p = pulls[i];
    return p
      ? { city: p.city, fetched: p.fetched, upserted: p.upserted }
      : { city: a.name, fetched: 0, upserted: 0 };
  });
}
