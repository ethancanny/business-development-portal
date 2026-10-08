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
        value = EXCLUDED.value, title = EXCLUDED.title, units = EXCLUDED.units
      RETURNING (xmax = 0) AS inserted`;
    if (res[0]?.inserted) added++;
  }
  return added;
}

export async function getIndicatorSeries(seriesIds: string[]): Promise<MiIndicatorObs[]> {
  await ensureSchema();
  const db = sql();
  if (!seriesIds.length) return [];
  const rows = await db`
    SELECT * FROM mi_indicators
    WHERE series_id = ANY(${seriesIds})
    ORDER BY obs_date ASC`;
  return rows.map((r) => ({
    id: str(r.id),
    source: str(r.source) as MiIndicatorSource,
    seriesId: str(r.series_id),
    title: str(r.title),
    units: str(r.units),
    frequency: str(r.frequency),
    obsDate: String(r.obs_date).slice(0, 10),
    value: numOrNull(r.value),
  }));
}

export async function getLatestIndicators(): Promise<
  { seriesId: string; title: string; units: string; obsDate: string; value: number | null }[]
> {
  await ensureSchema();
  const db = sql();
  const rows = await db`
    SELECT DISTINCT ON (series_id) series_id, title, units, obs_date, value
    FROM mi_indicators
    ORDER BY series_id, obs_date DESC`;
  return rows.map((r) => ({
    seriesId: str(r.series_id),
    title: str(r.title),
    units: str(r.units),
    obsDate: String(r.obs_date).slice(0, 10),
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
}

export async function upsertAcquisitions(rows: AcquisitionInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  let added = 0;
  for (const r of rows) {
    if (!r.sourceUrl) continue;
    const res = await db`
      INSERT INTO mi_acquisitions (id, acquirer, target, target_location, industry, deal_value, announced_date, source_url, publisher)
      VALUES (${newId()}, ${r.acquirer ?? ""}, ${r.target ?? ""}, ${r.targetLocation ?? ""}, ${r.industry ?? ""},
              ${r.dealValue ?? null}, ${r.announcedDate ?? ""}, ${r.sourceUrl}, ${r.publisher ?? ""})
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
    status: str(r.status) as MiAcquisition["status"], createdAt: String(r.created_at),
  }));
}

export async function setAcquisitionStatus(id: string, status: MiAcquisition["status"]): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mi_acquisitions SET status = ${status} WHERE id = ${id}`;
}

/* ---------------- Filings ---------------- */

export interface FilingInput {
  form: string;
  company: string;
  cik?: string;
  filingDate?: string;
  accession: string;
  category: MiFilingCategory;
  summary?: string;
  url?: string;
}

export async function upsertFilings(rows: FilingInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  let added = 0;
  for (const r of rows) {
    if (!r.accession) continue;
    const res = await db`
      INSERT INTO mi_filings (id, form, company, cik, filing_date, accession, category, summary, url)
      VALUES (${newId()}, ${r.form}, ${r.company ?? ""}, ${r.cik ?? ""}, ${r.filingDate ?? ""},
              ${r.accession}, ${r.category}, ${r.summary ?? ""}, ${r.url ?? ""})
      ON CONFLICT (accession) DO NOTHING
      RETURNING (xmax = 0) AS inserted`;
    if (res[0]?.inserted) added++;
  }
  return added;
}

export async function getFilings(category?: string, status?: string): Promise<MiFiling[]> {
  await ensureSchema();
  const db = sql();
  let rows;
  if (category && category !== "all" && status && status !== "all")
    rows = await db`SELECT * FROM mi_filings WHERE category = ${category} AND status = ${status} ORDER BY filing_date DESC LIMIT 200`;
  else if (category && category !== "all")
    rows = await db`SELECT * FROM mi_filings WHERE category = ${category} ORDER BY filing_date DESC LIMIT 200`;
  else if (status && status !== "all")
    rows = await db`SELECT * FROM mi_filings WHERE status = ${status} ORDER BY filing_date DESC LIMIT 200`;
  else rows = await db`SELECT * FROM mi_filings ORDER BY filing_date DESC LIMIT 200`;
  return rows.map((r) => ({
    id: str(r.id), form: str(r.form), company: str(r.company), cik: str(r.cik),
    filingDate: str(r.filing_date), accession: str(r.accession),
    category: str(r.category) as MiFilingCategory, summary: str(r.summary), url: str(r.url),
    status: str(r.status) as MiFiling["status"], createdAt: String(r.created_at),
  }));
}

export async function setFilingStatus(id: string, status: MiFiling["status"]): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mi_filings SET status = ${status} WHERE id = ${id}`;
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
    source: str(r.source),
    createdAt: String(r.created_at),
  }));
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

export async function getSyncLog(limit = 20): Promise<MiSyncLog[]> {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM mi_sync_log ORDER BY ran_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: str(r.id), job: str(r.job), ranAt: String(r.ran_at),
    status: str(r.status) as MiSyncLog["status"], added: Number(r.added ?? 0),
    message: str(r.message),
  }));
}
