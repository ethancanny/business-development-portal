/**
 * Commercial / industrial building-permit ingest (Phase 3).
 * Split out of market-ingest.ts like filings-ingest.ts — one module
 * per source family.
 *
 * First adapter: City of Mesa open data (Socrata SODA), dataset
 * dzpk-hxfb "Building Permits" — permit_type = COM rows only. The
 * mi_permits_ci table is city-keyed so Phoenix / Tempe / Chandler /
 * Gilbert adapters can join later without a schema change.
 *
 * This supersedes the Census BPS county housing-permit series
 * (county_permits) as the portal's permit signal: BPS counts
 * residential units by county; this is per-permit commercial /
 * industrial activity with valuations, contractors and addresses.
 *
 * Cross-reference (Ethan's standing rule): after each pull, an
 * independent SODA aggregate (row count + total_valuation sum over
 * the identical filter) is reconciled against what was fetched and
 * logged as permits-ci-xcheck — including when the check itself
 * cannot run (a silent check is a failed check).
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
  /** total_valuation as reported (pre-fallback) — the xcheck basis. */
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

async function ingestMesaPermits(): Promise<CiIngestResult> {
  const city = "Mesa";
  // 1) Page the full COM set since 2019, deduped by permit_number.
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

  const counts: Record<PermitCategory, number> = { project: 0, subpermit: 0, multifamily: 0 };
  for (const r of rows) counts[r.category] += 1;
  await logSync(
    "permits_ci",
    "ok",
    upserted,
    `Mesa (Socrata dzpk-hxfb) commercial permits issued since 2019: ${fetched} fetched, ${rows.length} distinct, ${upserted} upserted — project ${counts.project}, multifamily ${counts.multifamily}, subpermit ${counts.subpermit}`
  );

  // 2) Cross-reference: independent SODA aggregate over the same filter
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
  return { city, fetched, upserted };
}

/** Commercial / industrial permits ingest (all wired cities). Runs in
 * the daily "all" ingest — reference data, per Ethan's refresh rule. */
export async function ingestCiPermits(): Promise<CiIngestResult[]> {
  try {
    return [await ingestMesaPermits()];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logSync("permits_ci", "error", 0, `Mesa: ${msg}`.slice(0, 500));
    await logSync("permits-ci-xcheck", "error", 0, `Mesa SODA cross-check could not run: pull failed (${msg.slice(0, 200)})`);
    return [{ city: "Mesa", fetched: 0, upserted: 0 }];
  }
}
