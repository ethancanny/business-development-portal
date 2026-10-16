/**
 * ADHS public-databases ingest (healthcare spine enrichment, Oct 2026).
 *
 * Source: ADHS publishes monthly Excel snapshots of every licensed
 * facility database at
 *   https://www.azdhs.gov/documents/licensing/databases/{YYYY}/{monthname}/{CATEGORY}.xlsx
 * (run date = 1st of the month). Ethan filed records request #977847
 * for a licensee extract; ADHS closed it by pointing at these public
 * databases instead — same data, self-serve. The October 2026 set was
 * profiled by hand before this build: 11 of 12 categories parse clean
 * (~4,170 facilities, ~77.7K licensed units of capacity); the schema is
 * uniform (rundate, Bureau, Type/Subtype, facility ID, AccountName,
 * LicenseNumber, effective/expiration/issue dates, address, Capacity
 * or TotalCapacity, phone, CCN, lat/long) with per-file column-name
 * variants handled by header-name mapping below.
 *
 * What this module does:
 *  1. Maintains mi_adhs_licenses — one row per license, with
 *     first_seen_month / last_seen_month / months_seen so later builds
 *     (Phase 4 transition signals) can diff snapshots: new licenses,
 *     disappeared licenses, expiration movement.
 *  2. Stamps matched Healthcare companies in mi_companies with
 *     details.adhsUnits (summed licensed capacity) + adhsFacilities /
 *     adhsLicenseCount / adhsDataAsOf / adhsMatchBasis, then re-judges
 *     exactly those rows so computeFit's ADHS arm (adhsUnits × $58K,
 *     precedence 4 in the healthcare branch) fires. Matching order:
 *     (a) CCN exact (canonical-form intersection — company rows today
 *     carry no CCN field, so this arm is measured honestly in the
 *     xcheck and normally matches ~0), (b) normalized name + city,
 *     (c) normalized name alone when the name is unique statewide on
 *     both sides. Multi-facility operators aggregate.
 *  3. Logs adhs-xcheck every fresh-snapshot run (Ethan's rule — a
 *     silent check is a failed check): register counts reconcile
 *     against the parsed files, per-category diff vs the prior
 *     snapshot, facility counts vs the NPPES healthcare spine by
 *     category pattern, and the CCN match rate.
 *
 * Refresh: monthly data — wired into the daily 06:00 source=all run.
 * Cheap-idempotent: state remembers the ingested snapshot month; a
 * daily run whose month is unchanged verifies the company stamps are
 * still in place (a weekly spine rebuild wipes details, so the probe
 * count dropping is what triggers a restamp) and otherwise logs a
 * no-op and exits.
 */
import { neon } from "@neondatabase/serverless";
import * as XLSX from "xlsx";
import { logSync, rescoreCompaniesByIds } from "./market-db";
import { normalizeGroupName } from "./hospitality-ingest";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (ADHS ingest requires Postgres)");
  return neon(url);
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";
const DB_ROOT = "https://www.azdhs.gov/documents/licensing/databases";

/* ---------------- categories ----------------
 * `files` are tried in order at the snapshot month; the first that
 * returns real spreadsheet bytes (PK zip magic — ADHS answers its
 * "Page or Document Not Found" page with HTTP 200 for missing files,
 * so status alone proves nothing) wins. OUTPATIENT_TREATMENT_CENTER
 * served that not-found page for 2026-10: the category appears to have
 * been renamed (a COUNSELING.xlsx existed in 2025 snapshots), so the
 * outpatient slot carries rename candidates and the resolution —
 * or the failure to resolve — is logged every fresh run. */
interface AdhsCategory {
  key: string;
  label: string;
  files: string[];
}
const CATEGORIES: AdhsCategory[] = [
  { key: "ASSISTED_LIVING_HOME", label: "Assisted Living Homes", files: ["ASSISTED_LIVING_HOME"] },
  { key: "ASSISTED_LIVING_CENTER", label: "Assisted Living Centers", files: ["ASSISTED_LIVING_CENTER"] },
  { key: "NURSING_HOME", label: "Nursing Care Institutions", files: ["NURSING_HOME"] },
  { key: "BEHAVIORAL_HEALTH_RESIDENTIAL_FACILITY", label: "Behavioral Health Residential", files: ["BEHAVIORAL_HEALTH_RESIDENTIAL_FACILITY"] },
  { key: "BEHAVIORAL_HEALTH_INPATIENT", label: "Behavioral Health Inpatient", files: ["BEHAVIORAL_HEALTH_INPATIENT"] },
  { key: "SOBER_LIVING_HOMES", label: "Sober Living Homes", files: ["SOBER_LIVING_HOMES"] },
  { key: "HOSPICE", label: "Hospice", files: ["HOSPICE"] },
  { key: "HOME_HEALTH_AGENCIES_REPORT", label: "Home Health Agencies", files: ["HOME_HEALTH_AGENCIES_REPORT"] },
  { key: "ADULT_DAY_HEALTH_CARE", label: "Adult Day Health Care", files: ["ADULT_DAY_HEALTH_CARE"] },
  { key: "RECOVERY_CARE_CENTER", label: "Recovery Care Centers", files: ["RECOVERY_CARE_CENTER"] },
  { key: "SUBSTANCE_ABUSE_TRANSITIONAL_FACILITY", label: "Substance Abuse Transitional", files: ["SUBSTANCE_ABUSE_TRANSITIONAL_FACILITY"] },
  {
    key: "OUTPATIENT",
    label: "Outpatient Treatment Centers",
    files: ["OUTPATIENT_TREATMENT_CENTER", "COUNSELING", "BEHAVIORAL_HEALTH_OUTPATIENT", "OUTPATIENT_TREATMENT_CENTERS", "OUTPATIENT"],
  },
];
const PROBE_FILE = "ASSISTED_LIVING_HOME";

/* ---------------- schema ---------------- */

let ensured = false;
async function ensureAdhsTables(): Promise<void> {
  if (ensured) return;
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS mi_adhs_licenses (
      license_number TEXT PRIMARY KEY,
      facility_id TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      name_norm TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      facility_type TEXT NOT NULL DEFAULT '',
      subtype TEXT NOT NULL DEFAULT '',
      bureau TEXT NOT NULL DEFAULT '',
      capacity INTEGER,
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      zip TEXT NOT NULL DEFAULT '',
      county TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      ccn TEXT NOT NULL DEFAULT '',
      effective_date DATE,
      expiration_date DATE,
      issue_date DATE,
      snapshot_month TEXT NOT NULL DEFAULT '',
      months_seen JSONB NOT NULL DEFAULT '[]'::jsonb,
      first_seen_month TEXT NOT NULL DEFAULT '',
      last_seen_month TEXT NOT NULL DEFAULT '',
      first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
      fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await db`
    CREATE INDEX IF NOT EXISTS mi_adhs_licenses_norm_idx ON mi_adhs_licenses (name_norm, city)`;
  await db`
    CREATE TABLE IF NOT EXISTS mi_adhs_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  ensured = true;
}

async function getState(key: string): Promise<string | null> {
  const db = sql();
  const rows = await db`SELECT value FROM mi_adhs_state WHERE key = ${key}`;
  return rows.length ? String(rows[0].value) : null;
}

async function setState(key: string, value: string): Promise<void> {
  const db = sql();
  await db`INSERT INTO mi_adhs_state (key, value) VALUES (${key}, ${value})
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/* ---------------- snapshot resolution ---------------- */

const MONTH_NAMES = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function phoenixYearMonth(): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "0");
  return { year, month };
}

function monthSegments(year: number, month: number, hintFirst?: string | null): string[] {
  const full = MONTH_NAMES[month - 1];
  const all = [
    full,
    full.charAt(0).toUpperCase() + full.slice(1),
    String(month).padStart(2, "0"),
    full.slice(0, 3),
  ];
  const uniq = Array.from(new Set(all));
  if (hintFirst && uniq.includes(hintFirst)) {
    return [hintFirst, ...uniq.filter((s) => s !== hintFirst)];
  }
  return uniq;
}

interface SnapshotRef {
  year: number;
  month: number;
  ym: string; // "2026-10"
  segment: string;
}

async function fetchXlsx(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(45000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Real .xlsx is a zip (PK\x03\x04). ADHS soft-404s missing files
    // with an HTML page at HTTP 200 — magic bytes are the only proof.
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) return null;
    return buf;
  } catch {
    return null;
  }
}

async function resolveSnapshot(): Promise<SnapshotRef | null> {
  const hint = await getState("month_segment");
  const now = phoenixYearMonth();
  for (let back = 0; back <= 3; back++) {
    let { year, month } = now;
    month -= back;
    while (month < 1) {
      month += 12;
      year -= 1;
    }
    for (const segment of monthSegments(year, month, back === 0 ? hint : null)) {
      const buf = await fetchXlsx(`${DB_ROOT}/${year}/${segment}/${PROBE_FILE}.xlsx`);
      if (buf) {
        return { year, month, ym: `${year}-${String(month).padStart(2, "0")}`, segment };
      }
    }
  }
  return null;
}

/* ---------------- parsing ---------------- */

interface AdhsLicenseRow {
  licenseNumber: string;
  facilityId: string;
  name: string;
  nameNorm: string;
  category: string;
  facilityType: string;
  subtype: string;
  bureau: string;
  capacity: number | null;
  address: string;
  city: string;
  state: string;
  zip: string;
  county: string;
  phone: string;
  ccn: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  issueDate: string | null;
}

const s = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v).trim();
};

function dateVal(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel serial (with cellDates off / raw numeric cells)
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const t = String(v).trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const parsed = Date.parse(t);
  if (Number.isFinite(parsed)) return new Date(parsed).toISOString().slice(0, 10);
  return null;
}

function capVal(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  const n = Number(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && String(v ?? "").trim() !== "" ? Math.round(n) : null;
}

function zipVal(v: unknown): string {
  const digits = s(v).replace(/\D/g, "");
  if (!digits) return "";
  return digits.slice(0, 5).padStart(5, "0");
}

/** Match normalization shared by both sides of the company match:
 * the hospitality group normalizer, plus a trailing standalone "AZ"
 * token dropped symmetrically (ADHS writes "Banner Home Care Az";
 * NPPES writes "Banner Home Care"). */
export function adhsNormName(name: string): string {
  return normalizeGroupName(name ?? "").replace(/\s+AZ$/, "").trim();
}

function parseWorkbook(buf: Buffer, categoryKey: string): AdhsLicenseRow[] {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const ws = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  if (!grid.length) return [];
  const header = (grid[0] as unknown[]).map((h) => s(h).toLowerCase());
  const col = (...names: string[]): number => {
    for (const n of names) {
      const i = header.indexOf(n.toLowerCase());
      if (i >= 0) return i;
    }
    return -1;
  };
  const cFacId = col("ExternalFacilityID", "ExternalFacilitySearchID");
  const cName = col("AccountName");
  const cLic = col("LicenseNumber");
  const cType = col("Type");
  const cSub = col("Subtype");
  const cBureau = col("Bureau");
  const cEff = col("EffectiveDate");
  const cExp = col("ExpirationDate");
  const cIssue = col("IssueDate");
  const cAddr = col("Street", "Address");
  const cCity = col("City");
  const cState = col("State");
  const cZip = col("Zip");
  const cCounty = col("County");
  const cCap = col("Capacity", "TotalCapacity");
  const cPhone = col("Phone");
  const cCcn = col("CCN");
  if (cLic < 0 || cName < 0) return [];
  const at = (r: unknown[], i: number): unknown => (i >= 0 ? r[i] : undefined);
  const out: AdhsLicenseRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i] as unknown[];
    if (!r || r.every((v) => v === null || v === undefined || v === "")) continue;
    const licenseNumber = s(at(r, cLic));
    if (!licenseNumber || seen.has(licenseNumber)) continue;
    seen.add(licenseNumber);
    const rawCcn = s(at(r, cCcn));
    out.push({
      licenseNumber,
      facilityId: s(at(r, cFacId)),
      name: s(at(r, cName)),
      nameNorm: adhsNormName(s(at(r, cName))),
      category: categoryKey,
      facilityType: s(at(r, cType)),
      subtype: s(at(r, cSub)),
      bureau: s(at(r, cBureau)),
      capacity: capVal(at(r, cCap)),
      address: s(at(r, cAddr)),
      city: s(at(r, cCity)).toUpperCase(),
      state: s(at(r, cState)).toUpperCase(),
      zip: zipVal(at(r, cZip)),
      county: s(at(r, cCounty)),
      phone: s(at(r, cPhone)).replace(/\D/g, ""),
      ccn: rawCcn === "-" ? "" : rawCcn,
      effectiveDate: dateVal(at(r, cEff)),
      expirationDate: dateVal(at(r, cExp)),
      issueDate: dateVal(at(r, cIssue)),
    });
  }
  return out;
}

/* ---------------- register upsert ---------------- */

async function upsertRegister(rows: AdhsLicenseRow[], ym: string): Promise<void> {
  if (!rows.length) return;
  const db = sql();
  // Preserve each license's snapshot history (months_seen) across upserts.
  const monthsByLicense = new Map<string, string[]>();
  const CHUNK = 300;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => r.licenseNumber);
    const existing = await db.query(
      `SELECT license_number, months_seen FROM mi_adhs_licenses WHERE license_number = ANY($1)`,
      [chunk]
    );
    for (const e of existing as { license_number: string; months_seen: unknown }[]) {
      const arr = Array.isArray(e.months_seen) ? (e.months_seen as string[]) : [];
      monthsByLicense.set(String(e.license_number), arr.map(String));
    }
  }
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const prior = monthsByLicense.get(r.licenseNumber) ?? [];
      const months = Array.from(new Set([...prior, ym])).sort();
      const b = j * 23;
      values.push(
        `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, $${b + 16}, $${b + 17}, $${b + 18}, $${b + 19}, $${b + 20}, $${b + 21}, $${b + 22}::jsonb, $${b + 23})`
      );
      params.push(
        r.licenseNumber, r.facilityId, r.name, r.nameNorm, r.category, r.facilityType,
        r.subtype, r.bureau, r.capacity, r.address, r.city, r.state, r.zip, r.county,
        r.phone, r.ccn, r.effectiveDate, r.expirationDate, r.issueDate, ym,
        JSON.stringify(months), ym, ym
      );
    });
    await db.query(
      `INSERT INTO mi_adhs_licenses (license_number, facility_id, name, name_norm, category,
         facility_type, subtype, bureau, capacity, address, city, state, zip, county, phone, ccn,
         effective_date, expiration_date, issue_date, snapshot_month, months_seen,
         first_seen_month, last_seen_month)
       VALUES ${values.join(", ")}
       ON CONFLICT (license_number) DO UPDATE SET
         facility_id = EXCLUDED.facility_id, name = EXCLUDED.name, name_norm = EXCLUDED.name_norm,
         category = EXCLUDED.category, facility_type = EXCLUDED.facility_type, subtype = EXCLUDED.subtype,
         bureau = EXCLUDED.bureau, capacity = EXCLUDED.capacity, address = EXCLUDED.address,
         city = EXCLUDED.city, state = EXCLUDED.state, zip = EXCLUDED.zip, county = EXCLUDED.county,
         phone = EXCLUDED.phone, ccn = EXCLUDED.ccn, effective_date = EXCLUDED.effective_date,
         expiration_date = EXCLUDED.expiration_date, issue_date = EXCLUDED.issue_date,
         snapshot_month = EXCLUDED.snapshot_month, months_seen = EXCLUDED.months_seen,
         last_seen_month = EXCLUDED.last_seen_month, last_seen = now(), fetched_at = now()`,
      params
    );
  }
}

/* ---------------- company stamping ---------------- */

/** Canonical CCN comparison forms (ADHS stores bare numbers like
 * 35250 or 1565; CMS CCNs are 6 chars with the AZ "03" prefix, e.g.
 * 035250 for nursing, 031565 for hospice). Two values match when
 * their form sets intersect. */
function ccnForms(raw: string): string[] {
  const d = (raw ?? "").replace(/\D/g, "");
  if (!d || d.length > 6) return [];
  const forms = new Set<string>([d, d.padStart(6, "0")]);
  if (d.length === 4) forms.add(`03${d}`);
  return Array.from(forms);
}

interface StampAgg {
  units: number;
  facilities: Set<string>;
  licenses: string[];
  categories: Set<string>;
  bases: Set<string>;
}

function newAgg(): StampAgg {
  return { units: 0, facilities: new Set(), licenses: [], categories: new Set(), bases: new Set() };
}

interface CompanyRowLite {
  id: string;
  dedupKey: string;
  name: string;
  city: string;
  source: string;
  details: string;
}

export interface AdhsStampResult {
  intended: number;
  applied: number;
  changedCompanies: number;
  rescoredChanged: number;
  ccnFacilities: number;
  companiesWithCcn: number;
  nameCityGroups: number;
  nameOnlyGroups: number;
  staleCleared: number;
  unparseable: number;
  deferred: boolean;
}

const ADHS_DETAIL_KEYS = [
  "adhsUnits", "adhsFacilities", "adhsLicenseCount", "adhsDataAsOf",
  "adhsCategories", "adhsMatchBasis", "adhsLicenseNumbers",
];

async function countStamped(ym: string): Promise<number> {
  const db = sql();
  const rows = await db`SELECT count(*)::int AS n FROM mi_companies
    WHERE sector = 'Healthcare' AND details LIKE ${`%"adhsDataAsOf":"${ym}"%`}`;
  return Number(rows[0]?.n ?? 0);
}

async function stampCompanies(ym: string, freshSnapshot: boolean, deadline: number): Promise<AdhsStampResult> {
  const db = sql();
  const result: AdhsStampResult = {
    intended: 0, applied: 0, changedCompanies: 0, rescoredChanged: 0,
    ccnFacilities: 0, companiesWithCcn: 0, nameCityGroups: 0, nameOnlyGroups: 0,
    staleCleared: 0, unparseable: 0, deferred: false,
  };

  const regRows = (await db`
    SELECT license_number, facility_id, name_norm, city, capacity, category, ccn
    FROM mi_adhs_licenses WHERE last_seen_month = ${ym}`) as {
    license_number: string; facility_id: string; name_norm: string; city: string;
    capacity: number | null; category: string; ccn: string;
  }[];

  const compRows = (await db`
    SELECT id, dedup_key, name, city, source, details FROM mi_companies WHERE sector = 'Healthcare'`) as {
    id: string; dedup_key: string; name: string; city: string; source: string; details: string;
  }[];
  const companies: CompanyRowLite[] = compRows.map((r) => ({
    id: String(r.id), dedupKey: String(r.dedup_key ?? ""), name: String(r.name ?? ""),
    city: String(r.city ?? ""), source: String(r.source ?? ""), details: String(r.details ?? ""),
  }));
  const companyById = new Map<string, CompanyRowLite>();
  for (const c of companies) companyById.set(c.id, c);

  // Company (name, city) groups + CCN candidate index.
  const compGroups = new Map<string, CompanyRowLite[]>();
  const compNameIndex = new Map<string, Set<string>>(); // nameNorm -> group keys
  const ccnIndex = new Map<string, string>(); // ccn form -> company id
  for (const c of companies) {
    const nn = adhsNormName(c.name);
    if (!nn) continue;
    const key = `${nn}|${c.city.toUpperCase().trim()}`;
    const g = compGroups.get(key) ?? [];
    g.push(c);
    compGroups.set(key, g);
    if (!compNameIndex.has(nn)) compNameIndex.set(nn, new Set());
    compNameIndex.get(nn)?.add(key);
    let d: Record<string, unknown> = {};
    try {
      d = c.details ? (JSON.parse(c.details) as Record<string, unknown>) : {};
    } catch {
      d = {};
    }
    const candidates: string[] = [];
    for (const k of ["ccn", "CCN", "medicareCcn", "medicareId", "medicare_id"]) {
      if (d[k] !== undefined && d[k] !== null && String(d[k]) !== "") candidates.push(String(d[k]));
    }
    if (/^\d{5,6}$/.test(c.dedupKey)) candidates.push(c.dedupKey);
    if (candidates.length) result.companiesWithCcn++;
    for (const cand of candidates) {
      for (const f of ccnForms(cand)) {
        if (!ccnIndex.has(f)) ccnIndex.set(f, c.id);
      }
    }
  }

  const stampMap = new Map<string, StampAgg>();
  const aggFor = (companyId: string): StampAgg => {
    let a = stampMap.get(companyId);
    if (!a) {
      a = newAgg();
      stampMap.set(companyId, a);
    }
    return a;
  };
  const addFacility = (
    agg: StampAgg,
    r: { license_number: string; facility_id: string; capacity: number | null; category: string },
    basis: string
  ) => {
    agg.units += r.capacity ?? 0;
    if (r.facility_id) agg.facilities.add(r.facility_id);
    agg.licenses.push(r.license_number);
    agg.categories.add(r.category);
    agg.bases.add(basis);
  };

  // (a) CCN exact — per facility.
  const ccnAssigned = new Set<string>();
  for (const r of regRows) {
    if (!r.ccn) continue;
    let hit: string | undefined;
    for (const f of ccnForms(r.ccn)) {
      hit = ccnIndex.get(f);
      if (hit) break;
    }
    if (hit) {
      addFacility(aggFor(hit), r, "ccn");
      ccnAssigned.add(r.license_number);
      result.ccnFacilities++;
    }
  }

  // Register (name, city) aggregates from the remaining facilities.
  interface RegGroup {
    key: string;
    nameNorm: string;
    rows: typeof regRows;
  }
  const regGroups = new Map<string, RegGroup>();
  for (const r of regRows) {
    if (ccnAssigned.has(r.license_number) || !r.name_norm) continue;
    const key = `${r.name_norm}|${(r.city ?? "").toUpperCase().trim()}`;
    let g = regGroups.get(key);
    if (!g) {
      g = { key, nameNorm: r.name_norm, rows: [] };
      regGroups.set(key, g);
    }
    g.rows.push(r);
  }
  const regNameIndex = new Map<string, string[]>(); // nameNorm -> group keys
  regGroups.forEach((g) => {
    if (!regNameIndex.has(g.nameNorm)) regNameIndex.set(g.nameNorm, []);
    regNameIndex.get(g.nameNorm)?.push(g.key);
  });

  const pickRep = (rows: CompanyRowLite[]): CompanyRowLite =>
    [...rows].sort((a, b) => {
      const an = a.source.includes("NPPES") ? 0 : 1;
      const bn = b.source.includes("NPPES") ? 0 : 1;
      return an - bn || a.id.localeCompare(b.id);
    })[0];

  // (b) normalized name + city.
  const stampedRegKeys = new Set<string>();
  regGroups.forEach((g) => {
    const compGroup = compGroups.get(g.key);
    if (!compGroup || !compGroup.length) return;
    const rep = pickRep(compGroup);
    const agg = aggFor(rep.id);
    for (const r of g.rows) addFacility(agg, r, "name+city");
    stampedRegKeys.add(g.key);
    result.nameCityGroups++;
  });

  // (c) normalized name alone — only when the name resolves to exactly
  // one register group and exactly one company group statewide.
  regGroups.forEach((g) => {
    if (stampedRegKeys.has(g.key)) return;
    const regKeys = regNameIndex.get(g.nameNorm) ?? [];
    const compKeys = compNameIndex.get(g.nameNorm);
    if (regKeys.length !== 1 || !compKeys || compKeys.size !== 1) return;
    const compGroup = compGroups.get(Array.from(compKeys)[0]);
    if (!compGroup || !compGroup.length) return;
    const rep = pickRep(compGroup);
    if (stampMap.has(rep.id)) return; // already stamped via a city group
    const agg = aggFor(rep.id);
    for (const r of g.rows) addFacility(agg, r, "name");
    stampedRegKeys.add(g.key);
    result.nameOnlyGroups++;
  });

  result.intended = stampMap.size;

  // Apply stamps (+ clear stale ones on fresh snapshots), re-judge after.
  const changedIds: string[] = [];
  const applyOne = async (c: CompanyRowLite, agg: StampAgg | null): Promise<boolean> => {
    let d: Record<string, unknown>;
    try {
      d = c.details ? (JSON.parse(c.details) as Record<string, unknown>) : {};
    } catch {
      result.unparseable++;
      return false;
    }
    if (agg) {
      const next: Record<string, unknown> = {
        adhsUnits: agg.units,
        adhsFacilities: agg.facilities.size,
        adhsLicenseCount: agg.licenses.length,
        adhsDataAsOf: ym,
        adhsCategories: Array.from(agg.categories).sort(),
        adhsMatchBasis: Array.from(agg.bases).sort().join("+"),
        adhsLicenseNumbers: agg.licenses.slice(0, 60),
      };
      const same = ADHS_DETAIL_KEYS.every((k) => JSON.stringify(d[k]) === JSON.stringify(next[k]));
      if (same) return true;
      Object.assign(d, next);
    } else {
      for (const k of ADHS_DETAIL_KEYS) delete d[k];
    }
    await db`UPDATE mi_companies SET details = ${JSON.stringify(d)}, updated_at = now() WHERE id = ${c.id}`;
    changedIds.push(c.id);
    result.changedCompanies++;
    return true;
  };

  const stampEntries = Array.from(stampMap.entries());
  for (const [companyId, agg] of stampEntries) {
    if (Date.now() > deadline) {
      result.deferred = true;
      break;
    }
    const c = companyById.get(companyId);
    if (c && (await applyOne(c, agg))) result.applied++;
  }

  if (freshSnapshot && !result.deferred) {
    for (const c of companies) {
      if (stampMap.has(c.id)) continue;
      if (!c.details.includes('"adhsDataAsOf"')) continue;
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(c.details) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (d.adhsDataAsOf && d.adhsDataAsOf !== ym) {
        if (Date.now() > deadline) {
          result.deferred = true;
          break;
        }
        if (await applyOne(c, null)) result.staleCleared++;
      }
    }
  }

  if (changedIds.length) {
    result.rescoredChanged = await rescoreCompaniesByIds(changedIds);
  }
  if (!result.deferred) result.applied = await countStamped(ym);
  return result;
}

/* ---------------- cross-reference ---------------- */

async function runAdhsXcheck(
  ym: string,
  parsedPerCategory: Map<string, number>,
  prior: { ym: string; per: Record<string, number> } | null,
  unresolvedLabels: string[],
  stamp: AdhsStampResult
): Promise<void> {
  const db = sql();
  const problems: string[] = [];
  const notes: string[] = [];

  // Leg 1: register rows for this snapshot reconcile with parsed files.
  const regCounts = (await db`
    SELECT category, count(*)::int AS n FROM mi_adhs_licenses WHERE last_seen_month = ${ym} GROUP BY category`) as {
    category: string; n: number;
  }[];
  const regByCat = new Map(regCounts.map((r) => [String(r.category), Number(r.n)]));
  let parsedTotal = 0;
  parsedPerCategory.forEach((n, key) => {
    parsedTotal += n;
    const inDb = regByCat.get(key) ?? 0;
    if (n > 0 && inDb !== n) problems.push(`${key}: parsed ${n} vs register ${inDb}`);
  });

  // Leg 2: diff vs the prior snapshot (baseline on first run).
  if (prior && prior.ym !== ym) {
    const movers: string[] = [];
    const keys = new Set([...Object.keys(prior.per), ...Array.from(parsedPerCategory.keys())]);
    keys.forEach((k) => {
      const before = prior.per[k] ?? 0;
      const after = parsedPerCategory.get(k) ?? 0;
      if (before !== after) movers.push(`${k} ${before}→${after} (${after - before >= 0 ? "+" : ""}${after - before})`);
    });
    notes.push(
      movers.length
        ? `vs ${prior.ym}: ${movers.slice(0, 6).join(" · ")}${movers.length > 6 ? ` · +${movers.length - 6} more` : ""}`
        : `vs ${prior.ym}: no per-category count changes`
    );
  } else {
    notes.push("first snapshot — baseline established (prior-month diff starts next month)");
  }

  // Leg 3: facility counts vs the NPPES healthcare spine by category.
  const nppesTotalRows = await db`
    SELECT count(*)::int AS n FROM mi_companies WHERE sector = 'Healthcare' AND source LIKE '%NPPES%'`;
  const nppesTotal = Number(nppesTotalRows[0]?.n ?? 0);
  if (nppesTotal === 0) problems.push("NPPES healthcare spine is empty — matching has no target universe");
  const patterns: [string, string][] = [
    ["nursing", "nursing"],
    ["hospice", "hospice"],
    ["home health", "home health"],
    ["assisted living", "assisted"],
    ["behavioral", "behavioral"],
  ];
  const nppesBits: string[] = [];
  for (const [label, pat] of patterns) {
    const rows = await db`
      SELECT count(*)::int AS n FROM mi_companies
      WHERE sector = 'Healthcare' AND source LIKE '%NPPES%' AND subsector ILIKE ${`%${pat}%`}`;
    nppesBits.push(`${label} ${Number(rows[0]?.n ?? 0)}`);
  }
  notes.push(`NPPES spine: ${nppesTotal} healthcare rows (subsector counts: ${nppesBits.join(" · ")}) vs ADHS ${parsedTotal} licensed facilities — different universes (NPPES counts individual practitioners), compared for spine health, not equality`);

  // Leg 4: CCN match rate.
  const ccnRows = await db`
    SELECT count(*)::int AS n FROM mi_adhs_licenses WHERE last_seen_month = ${ym} AND ccn <> ''`;
  const withCcn = Number(ccnRows[0]?.n ?? 0);
  notes.push(
    `CCN: ${withCcn} register licenses carry a real CCN; ${stamp.ccnFacilities} matched a company by CCN; ${stamp.companiesWithCcn} healthcare companies expose any CCN identifier (NPPES rows store none today — name matching carries the stamp)`
  );

  if (unresolvedLabels.length) {
    problems.push(`unresolved categories (no spreadsheet at any candidate filename): ${unresolvedLabels.join(", ")}`);
  }

  await logSync(
    "adhs-xcheck",
    problems.length ? "error" : "ok",
    parsedTotal,
    `ADHS ${ym}: register reconciles with parsed files${problems.length ? ` — PROBLEMS: ${problems.join("; ")}` : ""}. ${notes.join(". ")}.`
  );
}

/* ---------------- main ingest ---------------- */

export async function ingestAdhs(): Promise<number> {
  await ensureAdhsTables();
  const t0 = Date.now();
  const deadline = t0 + 45000; // stay inside the 60s ingest-route budget

  const snap = await resolveSnapshot();
  if (!snap) {
    await logSync("adhs", "error", 0, "ADHS: no monthly snapshot resolved — probed the current and 3 prior months at azdhs.gov/documents/licensing/databases without finding a valid spreadsheet. Nothing ingested.");
    await logSync("adhs-xcheck", "error", 0, "ADHS cross-check could not run: snapshot resolution failed (see adhs log).");
    return 0;
  }
  await setState("month_segment", snap.segment);

  const lastMonth = await getState("last_snapshot_month");
  const completeFor = await getState("stamp_complete_for");
  const storedStamped = Number((await getState("stamped_company_count")) ?? "0") || 0;

  if (lastMonth === snap.ym) {
    const probe = await countStamped(snap.ym);
    if (completeFor === snap.ym && probe === storedStamped) {
      await logSync("adhs", "skipped", 0, `ADHS snapshot ${snap.ym} already ingested; ${probe} healthcare company stamps verified in place — no-op (snapshots publish monthly, run date 1st).`);
      await logSync("adhs-xcheck", "skipped", 0, `ADHS ${snap.ym} unchanged since ingest — cross-check verdict from the snapshot run stands; checks re-run when the next monthly snapshot lands.`);
      return 0;
    }
    // Stamps drifted (weekly spine rebuild replaces company details) — restamp only.
    const stamp = await stampCompanies(snap.ym, false, deadline);
    if (!stamp.deferred && stamp.applied === stamp.intended) {
      await setState("stamp_complete_for", snap.ym);
      await setState("stamped_company_count", String(stamp.applied));
    }
    await logSync("adhs", "ok", stamp.changedCompanies, `ADHS ${snap.ym}: company stamps drifted (${probe}/${storedStamped} present) — restamped ${stamp.applied}/${stamp.intended} matched healthcare companies, ${stamp.rescoredChanged} fit stamps changed. Snapshot itself unchanged.`);
    await logSync("adhs-xcheck", "skipped", 0, `ADHS ${snap.ym} restamp only — full cross-check ran at snapshot ingest.`);
    return stamp.changedCompanies;
  }

  // Fresh snapshot: read prior counts for the diff BEFORE overwriting.
  let prior: { ym: string; per: Record<string, number> } | null = null;
  try {
    const raw = await getState("counts_json");
    if (raw) prior = JSON.parse(raw) as { ym: string; per: Record<string, number> };
  } catch {
    prior = null;
  }

  const parsedPerCategory = new Map<string, number>();
  const unresolvedLabels: string[] = [];
  const allRows: AdhsLicenseRow[] = [];
  let outpatientResolution = "";
  for (const cat of CATEGORIES) {
    let rows: AdhsLicenseRow[] | null = null;
    for (const f of cat.files) {
      const buf = await fetchXlsx(`${DB_ROOT}/${snap.year}/${snap.segment}/${f}.xlsx`);
      if (buf) {
        rows = parseWorkbook(buf, cat.key);
        if (cat.key === "OUTPATIENT") outpatientResolution = f;
        break;
      }
    }
    if (rows === null) {
      unresolvedLabels.push(cat.label);
      parsedPerCategory.set(cat.key, 0);
      continue;
    }
    parsedPerCategory.set(cat.key, rows.length);
    allRows.push(...rows);
  }

  await upsertRegister(allRows, snap.ym);
  await setState("last_snapshot_month", snap.ym);

  const stamp = await stampCompanies(snap.ym, true, deadline);
  if (!stamp.deferred && stamp.applied === stamp.intended) {
    await setState("stamp_complete_for", snap.ym);
    await setState("stamped_company_count", String(stamp.applied));
  } else {
    await setState("stamp_complete_for", "");
    await setState("stamped_company_count", String(stamp.applied));
  }

  const units = allRows.reduce((acc, r) => acc + (r.capacity ?? 0), 0);
  const resolvedCount = CATEGORIES.length - unresolvedLabels.length;
  await logSync(
    "adhs",
    unresolvedLabels.length ? "error" : "ok",
    allRows.length,
    `ADHS ${snap.ym} snapshot: ${allRows.length} licenses across ${resolvedCount}/${CATEGORIES.length} categories, ${units.toLocaleString()} licensed units. ` +
      (unresolvedLabels.length
        ? `UNRESOLVED (no spreadsheet at any candidate filename): ${unresolvedLabels.join(", ")}. `
        : `Outpatient resolved as ${outpatientResolution}.xlsx. `) +
      `Stamped ${stamp.applied}/${stamp.intended} matched healthcare companies (${stamp.ccnFacilities} facilities via CCN, ${stamp.nameCityGroups} name+city groups, ${stamp.nameOnlyGroups} name-only groups, ${stamp.staleCleared} stale stamps cleared), ${stamp.rescoredChanged} fit stamps changed${stamp.deferred ? " — stamp pass hit the route budget and deferred the remainder to the next run" : ""}.`
  );
  await runAdhsXcheck(snap.ym, parsedPerCategory, prior, unresolvedLabels, stamp);
  await setState("counts_json", JSON.stringify({ ym: snap.ym, per: Object.fromEntries(parsedPerCategory) }));
  return allRows.length;
}
