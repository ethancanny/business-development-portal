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

/** Import a registry snapshot. With reset=true the source's existing rows
 * are replaced wholesale (triage status and first_seen are preserved by
 * dedup key); without it, rows upsert by (source, dedup_key). Used by the
 * weekly spine builders (SAM.gov, AZ ROC, NPPES, EPA FRS). */
export async function importCompanies(source: string, rows: CompanyInput[], reset: boolean): Promise<number> {
  await ensureSchema();
  const db = sql();
  const clean = rows.filter((r) => r && r.dedupKey && r.name && r.source === source);
  if (reset) {
    // Reset is scoped to the (source, sector) pairs present in this payload,
    // so one registry feeding several sector spines never wipes the others.
    const sectors = [...new Set(clean.map((r) => r.sector).filter(Boolean))];
    const existing = sectors.length
      ? await db`SELECT dedup_key, status, first_seen FROM mi_companies WHERE source = ${source} AND sector = ANY(${sectors})`
      : await db`SELECT dedup_key, status, first_seen FROM mi_companies WHERE source = ${source}`;
    const statusByKey = new Map(existing.map((r) => [str(r.dedup_key), str(r.status)]));
    const firstSeenByKey = new Map(existing.map((r) => [str(r.dedup_key), r.first_seen]));
    if (sectors.length) {
      await db`DELETE FROM mi_companies WHERE source = ${source} AND sector = ANY(${sectors})`;
    } else {
      await db`DELETE FROM mi_companies WHERE source = ${source}`;
    }
    for (const r of clean) {
      (r as CompanyInput & { _status?: string })._status = statusByKey.get(r.dedupKey);
      (r as CompanyInput & { _firstSeen?: unknown })._firstSeen = firstSeenByKey.get(r.dedupKey);
    }
  }
  const CHUNK = 300;
  let added = 0;
  for (let i = 0; i < clean.length; i += CHUNK) {
    const chunk = clean.slice(i, i + CHUNK);
    const values: string[] = [];
    const params: unknown[] = [];
    chunk.forEach((r, j) => {
      const b = j * 23;
      values.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, $${b + 11}, $${b + 12}, $${b + 13}, $${b + 14}, $${b + 15}, $${b + 16}, $${b + 17}, $${b + 18}, $${b + 19}, $${b + 20}, $${b + 21}, $${b + 22}, $${b + 23})`);
      params.push(
        newId(), r.dedupKey, r.name, r.sector, r.subsector ?? "", r.naics ?? "",
        r.city ?? "", r.state ?? "AZ", r.address ?? "", r.zip ?? "",
        r.contactName ?? "", r.contactTitle ?? "", r.phone ?? "", r.website ?? "",
        r.formedDate ?? "", r.employees ?? null, r.signalValue ?? null, r.signalLabel ?? "",
        r.source, r.sourceUrl ?? "", r.details ?? "",
        (r as CompanyInput & { _status?: string })._status ?? "new",
        (r as CompanyInput & { _firstSeen?: unknown })._firstSeen ?? new Date().toISOString()
      );
    });
    const res = await db.query(
      `INSERT INTO mi_companies (id, dedup_key, name, sector, subsector, naics, city, state, address, zip,
         contact_name, contact_title, phone, website, formed_date, employees, signal_value, signal_label,
         source, source_url, details, status, first_seen)
       VALUES ${values.join(", ")}
       ON CONFLICT (source, dedup_key) DO UPDATE SET
         name = EXCLUDED.name, sector = EXCLUDED.sector, subsector = EXCLUDED.subsector, naics = EXCLUDED.naics,
         city = EXCLUDED.city, address = EXCLUDED.address, zip = EXCLUDED.zip, contact_name = EXCLUDED.contact_name,
         contact_title = EXCLUDED.contact_title, phone = EXCLUDED.phone, website = EXCLUDED.website,
         formed_date = EXCLUDED.formed_date, employees = EXCLUDED.employees, signal_value = EXCLUDED.signal_value,
         signal_label = EXCLUDED.signal_label, source_url = EXCLUDED.source_url, details = EXCLUDED.details,
         last_seen = NOW(), updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      params
    );
    added += (res as unknown[]).filter((x) => (x as { inserted?: boolean }).inserted).length;
  }
  return added;
}

export async function getCompanies(sector?: string, limit = 600): Promise<MiCompany[]> {
  await ensureSchema();
  const db = sql();
  const lim = Math.min(Math.max(limit, 1), 5000);
  const rows = sector
    ? await db`SELECT * FROM mi_companies WHERE sector = ${sector} ORDER BY signal_value DESC NULLS LAST, employees DESC NULLS LAST, name ASC LIMIT ${lim}`
    : await db`SELECT * FROM mi_companies ORDER BY signal_value DESC NULLS LAST, employees DESC NULLS LAST, name ASC LIMIT ${lim}`;
  return rows.map((r) => ({
    id: str(r.id), dedupKey: str(r.dedup_key), name: str(r.name), sector: str(r.sector),
    subsector: str(r.subsector), naics: str(r.naics), city: str(r.city), state: str(r.state),
    address: str(r.address), zip: str(r.zip), contactName: str(r.contact_name),
    contactTitle: str(r.contact_title), phone: str(r.phone), website: str(r.website),
    formedDate: str(r.formed_date), employees: numOrNull(r.employees),
    signalValue: numOrNull(r.signal_value), signalLabel: str(r.signal_label),
    source: str(r.source), sourceUrl: str(r.source_url), details: str(r.details),
    status: str(r.status) as MiCompany["status"],
    firstSeen: String(r.first_seen), lastSeen: String(r.last_seen),
  }));
}

export async function setCompanyStatus(id: string, status: MiCompany["status"]): Promise<void> {
  await ensureSchema();
  await sql()`UPDATE mi_companies SET status = ${status}, updated_at = NOW() WHERE id = ${id}`;
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
}

export async function upsertFilings(rows: FilingInput[]): Promise<number> {
  if (!rows.length) return 0;
  await ensureSchema();
  const db = sql();
  let added = 0;
  for (const r of rows) {
    if (!r.accession) continue;
    const res = await db`
      INSERT INTO mi_filings (id, form, company, cik, filing_date, accession, category, summary, url, az_company, major_event)
      VALUES (${newId()}, ${r.form}, ${r.company ?? ""}, ${r.cik ?? ""}, ${r.filingDate ?? ""},
              ${r.accession}, ${r.category}, ${r.summary ?? ""}, ${r.url ?? ""},
              ${r.azCompany ?? false}, ${r.majorEvent ?? false})
      ON CONFLICT (accession) DO UPDATE SET
        az_company = CASE WHEN NOT mi_filings.az_company THEN EXCLUDED.az_company ELSE mi_filings.az_company END,
        major_event = CASE WHEN NOT mi_filings.major_event THEN EXCLUDED.major_event ELSE mi_filings.major_event END,
        summary = CASE WHEN EXCLUDED.summary <> '' THEN EXCLUDED.summary ELSE mi_filings.summary END
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
    azCompany: Boolean(r.az_company), majorEvent: Boolean(r.major_event),
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

export async function getSyncLog(limit = 20): Promise<MiSyncLog[]> {
  await ensureSchema();
  const rows = await sql()`SELECT * FROM mi_sync_log ORDER BY ran_at DESC LIMIT ${limit}`;
  return rows.map((r) => ({
    id: str(r.id), job: str(r.job), ranAt: String(r.ran_at),
    status: str(r.status) as MiSyncLog["status"], added: Number(r.added ?? 0),
    message: str(r.message),
  }));
}
