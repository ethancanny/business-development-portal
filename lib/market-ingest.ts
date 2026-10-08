/**
 * Market intelligence ingest jobs.
 * Each fetches a free public source and upserts rows into Neon.
 * Designed to run as a daily Vercel Cron hitting /api/market/ingest.
 */
import {
  upsertAcquisitions,
  upsertEntities,
  upsertFilings,
  upsertIndicatorObs,
  upsertWarn,
  backfillWarnIndustries,
  clearNewBankruptcyNews,
  addMultiple,
  getMultiples,
  logSync,
  type AcquisitionInput,
  type FilingInput,
  type IndicatorInput,
  type WarnInput,
} from "./market-db";
import type { MiIndicatorSource } from "./types";

/* ---------------- FRED indicators ---------------- */

const FRED_SERIES: { id: string; title: string }[] = [
  { id: "AZUR", title: "Arizona Unemployment Rate" },
  { id: "UNRATE", title: "US Unemployment Rate" },
  { id: "AZNA", title: "Arizona Total Nonfarm Employment" },
  { id: "PAYEMS", title: "US Total Nonfarm Employment" },
  { id: "AZMFG", title: "Arizona Manufacturing Employment" },
  { id: "MANEMP", title: "US Manufacturing Employment" },
  { id: "AZCONS", title: "Arizona Construction Employment" },
  { id: "USCONS", title: "US Construction Employment" },
  { id: "AZBPPRIV", title: "Arizona New Private Housing Permits" },
  { id: "PERMIT", title: "US New Private Housing Permits" },
  { id: "AZSTHPI", title: "Arizona House Price Index (FHFA)" },
  { id: "USSTHPI", title: "US House Price Index (FHFA)" },
  { id: "AZPBSV", title: "Arizona Professional & Business Services Employment" },
  { id: "SMS04000006562000001", title: "Arizona Health Care & Social Assistance Employment" },
  { id: "CEU6500000001", title: "US Education & Health Services Employment" },
];

interface FredObsResponse {
  observations?: { date: string; value: string }[];
}

export async function ingestIndicators(): Promise<number> {
  const key = process.env.FRED_API_KEY;
  if (!key) {
    await logSync("indicators", "skipped", 0, "FRED_API_KEY not set");
    return 0;
  }
  const start = new Date();
  start.setFullYear(start.getFullYear() - 10);
  const startStr = start.toISOString().slice(0, 10);
  // Series metadata (proper units/frequency) — cached per run
  const metaCache = new Map<string, { units: string; frequency: string }>();
  async function getSeriesMeta(id: string): Promise<{ units: string; frequency: string }> {
    const cached = metaCache.get(id);
    if (cached) return cached;
    const fallback = { units: "", frequency: "" };
    try {
      const res = await fetch(
        `https://api.stlouisfed.org/fred/series?series_id=${id}&api_key=${key}&file_type=json`
      );
      if (!res.ok) return fallback;
      const data = (await res.json()) as { seriess?: { units?: string; frequency?: string }[] };
      const s = data.seriess?.[0];
      const meta = { units: s?.units ?? "", frequency: s?.frequency ?? "" };
      metaCache.set(id, meta);
      return meta;
    } catch {
      return fallback;
    }
  }
  let total = 0;
  const results = await Promise.all(
    FRED_SERIES.map(async (s) => {
      const meta = await getSeriesMeta(s.id);
      const url =
        `https://api.stlouisfed.org/fred/series/observations?series_id=${s.id}` +
        `&api_key=${key}&file_type=json&observation_start=${startStr}&sort_order=asc&limit=100000`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`FRED ${s.id}: HTTP ${res.status}`);
      const data = (await res.json()) as FredObsResponse;
      const rows: IndicatorInput[] = (data.observations ?? [])
        .filter((o) => o.value !== ".")
        .map((o) => ({
          source: "fred" as const,
          seriesId: s.id,
          title: s.title,
          units: meta.units,
          frequency: meta.frequency,
          obsDate: o.date,
          value: Number(o.value),
        }));
      return upsertIndicatorObs(rows);
    })
  );
  total = results.reduce((a, b) => a + b, 0);
  await logSync("indicators", "ok", total, `FRED: ${FRED_SERIES.length} series refreshed`);
  return total;
}

/* ---------------- SEC EDGAR ---------------- */

const EDGAR_UA = {
  "User-Agent": "CannyCapitalPortal/1.0 (ethan@cannycapitalpartners.com)",
  Accept: "application/json",
};

const EDGAR_QUERIES: { category: "acquisition" | "form_d" | "expansion" | "bankruptcy"; q: string; forms: string; national?: boolean }[] = [
  { category: "acquisition", q: '"acquisition" AND Arizona', forms: "8-K" },
  { category: "form_d", q: "Arizona", forms: "D,D/A" },
  { category: "expansion", q: '"Arizona" AND expansion', forms: "10-K" },
  // Major-event exception: public-company bankruptcies are rare and newsworthy — track nationally,
  // keep only exchange-listed filers ("good sized corps").
  { category: "bankruptcy", q: '"bankruptcy" OR "chapter 11"', forms: "8-K", national: true },
];

/** CIK -> { business state, exchange-listed? } via EDGAR submissions API, cached per run. */
const cikInfoCache = new Map<string, { state: string; listed: boolean }>();
async function getCikInfo(cik: string): Promise<{ state: string; listed: boolean }> {
  const cached = cikInfoCache.get(cik);
  if (cached) return cached;
  const fallback = { state: "", listed: false };
  if (!cik) return fallback;
  try {
    const padded = cik.replace(/^0+/, "").padStart(10, "0");
    const res = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, { headers: EDGAR_UA });
    if (!res.ok) return fallback;
    const data = (await res.json()) as {
      addresses?: { business?: { stateOrCountry?: string } };
      exchanges?: string[];
    };
    const info = {
      state: (data.addresses?.business?.stateOrCountry ?? "").toUpperCase(),
      listed: (data.exchanges ?? []).some((e) => /NYSE|Nasdaq/i.test(e)),
    };
    cikInfoCache.set(cik, info);
    return info;
  } catch {
    return fallback;
  }
}

interface EdgarHit {
  _source?: {
    adsh?: string;
    ciks?: string[];
    display_names?: string[];
    form?: string;
    file_date?: string;
    file_description?: string;
  };
}

export async function ingestFilings(): Promise<number> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  let total = 0;
  for (const q of EDGAR_QUERIES) {
    const url =
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q.q)}` +
      `&forms=${encodeURIComponent(q.forms)}&startdt=${start}&enddt=${end}`;
    const res = await fetch(url, { headers: EDGAR_UA });
    if (!res.ok) {
      await logSync("filings", "error", total, `EDGAR ${q.category}: HTTP ${res.status}`);
      continue;
    }
    const data = (await res.json()) as { hits?: { hits?: EdgarHit[] } };
    const hits = data.hits?.hits ?? [];
    // Resolve CIK info concurrently (EDGAR allows ~10 req/sec)
    const ciks = Array.from(new Set(hits.map((h) => (h._source?.ciks ?? [])[0]?.replace(/^0+/, "") ?? "").filter(Boolean)));
    await mapLimit(ciks, 5, getCikInfo);
    const rows: FilingInput[] = [];
    for (const h of hits) {
      const s = h._source ?? {};
      const cik = (s.ciks ?? [])[0]?.replace(/^0+/, "") ?? "";
      const adsh = (s.adsh ?? "").replace(/-/g, "");
      const info = cikInfoCache.get(cik) ?? { state: "", listed: false };
      // Bankruptcy exception: only exchange-listed filers (sizable public companies).
      if (q.category === "bankruptcy" && !info.listed) continue;
      rows.push({
        form: s.form ?? "",
        company: (s.display_names ?? [])[0] ?? "",
        cik,
        filingDate: s.file_date ?? "",
        accession: s.adsh ?? "",
        category: q.category,
        summary: s.file_description ?? "",
        url: cik && adsh ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh}/` : "",
        azCompany: info.state === "AZ",
        majorEvent: q.category === "bankruptcy",
      });
    }
    total += await upsertFilings(rows);
  }
  await logSync("filings", "ok", total, `EDGAR: ${EDGAR_QUERIES.length} queries, 30d window`);
  return total;
}

/** Run async fn over items with a concurrency limit. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

/* ---------------- Google News RSS (AZ acquisitions) ---------------- */

const NEWS_QUERIES = [
  '"Arizona" (acquired OR acquisition OR merger) when:30d',
  'Arizona (aerospace OR defense) acquisition when:30d',
  '(Phoenix OR Scottsdale OR Tempe OR Tucson OR Mesa) "acquires" company when:30d',
  'Arizona manufacturing (acquired OR acquisition) when:30d',
  'Arizona (healthcare OR hospital) (merger OR acquisition) when:30d',
  'Arizona (construction OR contractor) (acquired OR acquisition) when:30d',
];

const INDUSTRY_KEYWORDS: { industry: string; words: string[] }[] = [
  { industry: "Aerospace & Defense", words: ["aerospace", "defense", "avionics", "missile", "spacecraft", "aircraft"] },
  { industry: "Advanced Manufacturing", words: ["manufacturing", "semiconductor", "chip", "fabricat", "machining", "industrial"] },
  { industry: "Healthcare", words: ["healthcare", "health care", "hospital", "clinic", "pharma", "biotech", "medical", "dental"] },
  { industry: "Specialty Trades & Construction", words: ["construction", "contractor", "hvac", "plumbing", "electrical", "roofing", "paving"] },
];

function classifyIndustry(text: string): string {
  const t = text.toLowerCase();
  for (const { industry, words } of INDUSTRY_KEYWORDS) {
    if (words.some((w) => t.includes(w))) return industry;
  }
  return "";
}

/** Naive acquirer/target extraction from deal headlines. */
function parseDealHeadline(headline: string): { acquirer: string; target: string } {
  const h = headline.replace(/\s+-\s+[^-]+$/, "").trim(); // strip " - Publisher"
  const patterns: RegExp[] = [
    /(.+?)\s+(?:to acquire|acquires|acquired|buys|bought|snaps up)\s+(.+)/i,
    /(.+?)\s+announces?\s+(?:the\s+)?acquisition of\s+(.+)/i,
    /(.+?)\s+completes?\s+(?:the\s+)?acquisition of\s+(.+)/i,
    /(.+?)\s+acquired by\s+(.+)/i, // reversed: target acquired by acquirer
    /merger (?:of|between)\s+(.+?)\s+and\s+(.+)/i,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = h.match(patterns[i]);
    if (m) {
      const a = m[1].trim().replace(/^(the|a)\s+/i, "");
      const b = m[2].trim().replace(/\s+(for|in|valued).*/i, "");
      if (i === 3) return { acquirer: b, target: a }; // "acquired by" is reversed
      return { acquirer: a, target: b };
    }
  }
  return { acquirer: "", target: h };
}

interface RssItem {
  title: string;
  link: string;
  pubDate: string;
  source: string;
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  for (const b of blocks) {
    const get = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? m[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1") : "";
    };
    items.push({ title: get("title"), link: get("link"), pubDate: get("pubDate"), source: get("source") });
  }
  return items;
}

const DEAL_VERBS = /\b(acquir|merger|merges|buys|bought|takeover|stake in)\b/i;

export async function ingestNews(): Promise<number> {
  let total = 0;
  const seen = new Set<string>();
  for (const q of NEWS_QUERIES) {
    const url =
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}` + `&hl=en-US&gl=US&ceid=US:en`;
    let xml = "";
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; CannyCapitalPortal/1.0)" } });
      if (!res.ok) continue;
      xml = await res.text();
    } catch {
      continue;
    }
    const rows: AcquisitionInput[] = [];
    for (const item of parseRss(xml)) {
      if (!item.link || seen.has(item.link)) continue;
      seen.add(item.link);
      if (!DEAL_VERBS.test(item.title)) continue;
      const { acquirer, target } = parseDealHeadline(item.title);
      const announced = item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : "";
      rows.push({
        acquirer,
        target,
        industry: classifyIndustry(item.title),
        announcedDate: announced,
        sourceUrl: item.link,
        publisher: item.source,
      });
    }
    total += await upsertAcquisitions(rows);
    // be polite to Google News
    await new Promise((r) => setTimeout(r, 1500));
  }
  await logSync("news", "ok", total, `Google News: ${NEWS_QUERIES.length} queries`);
  return total;
}

/* ---------------- Bankruptcy news (private-company Chapter 11s) ---------------- */

const BANKRUPTCY_NEWS_QUERIES = [
  '"Arizona" (bankruptcy OR "chapter 11") when:30d',
  '"files for bankruptcy" (Phoenix OR Scottsdale OR Tucson OR Mesa OR Chandler OR Tempe) when:30d',
];

/** "Salad and Go files for Chapter 11 bankruptcy" -> "Salad and Go" */
function parseBankruptcyHeadline(title: string): string {
  const m = title.split(/files?\s+for\s+(chapter\s*11\s+)?bankruptcy/i)[0];
  return (m ?? title).replace(/\s+[-–|]\s+.*$/, "").trim().slice(0, 120);
}

export async function ingestBankruptcyNews(): Promise<number> {
  // Fresh feature: clear the first loose-filter batch, re-ingest tight.
  const cleared = await clearNewBankruptcyNews().catch(() => 0);
  let total = 0;
  const seen = new Set<string>();
  for (const q of BANKRUPTCY_NEWS_QUERIES) {
    const url =
      `https://news.google.com/rss/search?q=${encodeURIComponent(q)}` + `&hl=en-US&gl=US&ceid=US:en`;
    let xml = "";
    try {
      const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; CannyCapitalPortal/1.0)" } });
      if (!res.ok) continue;
      xml = await res.text();
    } catch {
      continue;
    }
    const rows: AcquisitionInput[] = [];
    for (const item of parseRss(xml)) {
      if (!item.link || seen.has(item.link)) continue;
      seen.add(item.link);
      // Require an actual filing event, not guides/commentary about bankruptcy.
      if (!/files?\s+for\s+(chapter\s*11\s+)?bankruptcy/i.test(item.title)) continue;
      const company = parseBankruptcyHeadline(item.title);
      if (!company || company.length < 3) continue;
      const announced = item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : "";
      rows.push({
        acquirer: "",
        target: company,
        industry: classifyIndustry(item.title),
        announcedDate: announced,
        sourceUrl: item.link,
        publisher: item.source,
        eventType: "bankruptcy",
      });
    }
    total += await upsertAcquisitions(rows);
    await new Promise((r) => setTimeout(r, 1500));
  }
  await logSync("bankruptcy_news", "ok", total, `Google News: ${BANKRUPTCY_NEWS_QUERIES.length} bankruptcy queries${cleared ? ` (cleared ${cleared} loose rows)` : ""}`);
  return total;
}

/* ---------------- WARN notices ---------------- */

/** Industry classification for WARN employers: known AZ employers first, then keyword fallback. */
export function classifyWarnIndustry(employer: string): string {
  const e = employer.toLowerCase();
  if (/infineon|intel\b|tsmc|microchip|onsemi|amkor|nxp semiconductors|semiconductor/i.test(e))
    return "Advanced Manufacturing";
  if (/honeywell|raytheon|boeing|northrop|general dynamics|l3harris|md helicopters|aerospace/i.test(e))
    return "Aerospace & Defense";
  if (/banner health|dignity health|abrazo|valleywise|carondelet|commonspirit|mayo clinic|becton|west pharmaceutical/i.test(e))
    return "Healthcare";
  for (const { industry, words } of INDUSTRY_KEYWORDS) {
    if (words.some((w) => e.includes(w))) return industry;
  }
  if (/\b(bank|credit union|mortgage|insurance|financial)\b/.test(e)) return "Financial Services";
  if (/\b(retail|grocery|restaurant|hotel|resort)\b/.test(e)) return "Retail & Hospitality";
  if (/\b(logistics|trucking|warehouse|freight|airline)\b/.test(e)) return "Transportation & Logistics";
  if (/\b(call center|staffing)\b/.test(e)) return "Business Services";
  return "";
}

function parseCsvLine(line: string): string[] {  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { out.push(cur); cur = ""; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export async function ingestWarn(): Promise<number> {
  const url = "https://raw.githubusercontent.com/APVentureEngine/warn-act-notices/main/data/by-state/az.csv";
  const res = await fetch(url);
  if (!res.ok) {
    await logSync("warn", "error", 0, `WARN CSV: HTTP ${res.status}`);
    return 0;
  }
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return 0;
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const idx = (name: string) => headers.indexOf(name);
  const rows: WarnInput[] = [];
  const cutoff = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    const noticeDate = c[idx("notice_date")] ?? "";
    if (noticeDate < cutoff) continue; // keep the last 12 months
    const rowState = (c[idx("state")] ?? "").toUpperCase();
    if (rowState && rowState !== "AZ") continue; // purely Arizona
    rows.push({
      employer: c[idx("company")] ?? "",
      location: c[idx("location")] ?? "",
      headcount: c[idx("employees_affected")] ? Number(c[idx("employees_affected")]) : null,
      noticeDate,
      effectiveDate: c[idx("effective_date")] ?? "",
      industry: classifyWarnIndustry(c[idx("company")] ?? ""),
      source: "WARN Act notices (APVentureEngine)",
    });
  }
  const added = await upsertWarn(rows);
  const backfilled = await backfillWarnIndustries(classifyWarnIndustry);
  await logSync("warn", "ok", added, `WARN: ${rows.length} AZ notices (12mo) processed${backfilled ? `, ${backfilled} backfilled` : ""}`);
  return added;
}

/* ---------------- OpenCorporates (new AZ entities) ---------------- */

export async function ingestEntities(): Promise<number> {
  const token = process.env.OPENCORP_TOKEN;
  if (!token) {
    await logSync("entities", "skipped", 0, "OPENCORP_TOKEN not set");
    return 0;
  }
  const url =
    `https://api.opencorporates.com/v0.4/companies/search?jurisdiction_code=us_az` +
    `&order=incorporation_date%7Cdesc&per_page=100&api_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    await logSync("entities", "error", 0, `OpenCorporates: HTTP ${res.status}`);
    return 0;
  }
  const data = (await res.json()) as {
    results?: { companies?: { company?: {
      name?: string; company_type?: string; incorporation_date?: string;
      registered_agent_name?: string; registered_address_in_full?: string;
    } }[] };
  };
  const companies = data.results?.companies ?? [];
  const added = await upsertEntities(
    companies.map((w) => {
      const c = w.company ?? {};
      return {
        name: c.name ?? "",
        entityType: c.company_type ?? "",
        formationDate: c.incorporation_date ?? "",
        agent: c.registered_agent_name ?? "",
        address: c.registered_address_in_full ?? "",
        source: "OpenCorporates",
      };
    })
  );
  await logSync("entities", "ok", added, "OpenCorporates: newest 100 AZ entities");
  return added;
}

/* ---------------- ExitValue.ai multiples ---------------- */

const VERTICAL_TO_INDUSTRY: Record<string, string> = {
  "aerospace": "Aerospace & Defense",
  "industrial-equipment": "Advanced Manufacturing",
  "metal-fabrication": "Advanced Manufacturing",
  "electronics": "Advanced Manufacturing",
  "medical-devices": "Healthcare",
  "durable-medical-equipment": "Healthcare",
  "home-health": "Healthcare",
  "healthcare-it": "Healthcare",
  "specialty-contractor": "Specialty Trades & Construction",
};

const BRACKET_LABEL: Record<string, string> = {
  "under_5m_ev": "EV < $5M",
  "5m_25m_ev": "EV $5–25M",
  "25m_100m_ev": "EV $25–100M",
  "100m_500m_ev": "EV $100–500M",
  "over_500m_ev": "EV > $500M",
};

interface ExitValueData {
  generated_at?: string;
  data?: Record<string, Record<string, Record<string, { n?: number; p25?: number; p50?: number; p75?: number }>>>;
}

export async function ingestMultiples(): Promise<number> {
  const res = await fetch("https://raw.githubusercontent.com/rpesposito/multiples/main/multiples.json");
  if (!res.ok) {
    await logSync("multiples", "error", 0, `ExitValue.ai: HTTP ${res.status}`);
    return 0;
  }
  const json = (await res.json()) as ExitValueData;
  const period = (json.generated_at ?? new Date().toISOString()).slice(0, 10);
  const data = json.data ?? {};

  // skip if this vintage is already loaded
  const existing = await getMultiples();
  if (existing.some((m) => m.sourceReport.startsWith("ExitValue.ai") && m.period === period)) {
    await logSync("multiples", "skipped", 0, `ExitValue.ai ${period} already loaded`);
    return 0;
  }

  let added = 0;
  for (const [vertical, brackets] of Object.entries(data)) {
    const industry = VERTICAL_TO_INDUSTRY[vertical];
    if (!industry) continue;
    for (const [bracket, metrics] of Object.entries(brackets)) {
      const ebitda = metrics["ev_ebitda"];
      const rev = metrics["ev_revenue"];
      if (!ebitda && !rev) continue;
      await addMultiple({
        sourceReport: "ExitValue.ai M&A Multiples Index",
        period,
        industry: `${industry} — ${vertical}`,
        sizeBand: BRACKET_LABEL[bracket] ?? bracket,
        evEbitdaLow: ebitda?.p25 ?? null,
        evEbitdaHigh: ebitda?.p75 ?? null,
        evEbitdaMedian: ebitda?.p50 ?? null,
        evRevenueMedian: rev?.p50 ?? null,
        notes: `n=${ebitda?.n ?? rev?.n ?? "?"} disclosed deals; CC-BY-4.0 open data`,
      });
      added++;
    }
  }
  await logSync("multiples", "ok", added, `ExitValue.ai ${period}: ${added} industry×size cells`);
  return added;
}

/* ---------------- USASpending: AZ defense contracts ---------------- */

function fyToCalendar(fyYear: number, fyMonth: number): string {
  const calMonth = ((fyMonth + 8) % 12) + 1;
  const calYear = fyMonth >= 4 ? fyYear : fyYear - 1;
  return `${calYear}-${String(calMonth).padStart(2, "0")}-01`;
}

interface USASpendingMonth {
  time_period?: { fiscal_year?: string; month?: string };
  Contract_Obligations?: number | null;
}

export async function ingestDefenseContracts(): Promise<number> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 3 * 365 * 864e5).toISOString().slice(0, 10);
  const series: { id: string; title: string; filters: Record<string, unknown> }[] = [
    {
      id: "AZ_DOD_CONTRACTS",
      title: "Arizona DoD Contract Obligations",
      filters: { agencies: [{ type: "awarding", tier: "toptier", name: "Department of Defense" }] },
    },
    {
      id: "AZ_AEROSPACE_CONTRACTS",
      title: "Arizona Aerospace Mfg (NAICS 3364) Contract Obligations",
      filters: { naics_codes: ["3364"] },
    },
  ];
  let total = 0;
  for (const s of series) {
    const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_over_time/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        group: "month",
        filters: {
          time_period: [{ start_date: start, end_date: end }],
          place_of_performance_locations: [{ country: "USA", state: "AZ" }],
          ...s.filters,
        },
      }),
    });
    if (!res.ok) {
      await logSync("defense", "error", total, `USASpending ${s.id}: HTTP ${res.status}`);
      continue;
    }
    const data = (await res.json()) as { results?: USASpendingMonth[] };
    const rows: IndicatorInput[] = [];
    for (const r of data.results ?? []) {
      const fy = Number(r.time_period?.fiscal_year ?? 0);
      const fm = Number(r.time_period?.month ?? 0);
      const val = r.Contract_Obligations;
      if (!fy || !fm || val === null || val === undefined) continue;
      rows.push({
        source: "usaspending",
        seriesId: s.id,
        title: s.title,
        units: "Dollars",
        frequency: "Monthly",
        obsDate: fyToCalendar(fy, fm),
        value: Math.round(val),
      });
    }
    total += await upsertIndicatorObs(rows);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await logSync("defense", "ok", total, `USASpending: ${series.length} AZ contract series`);
  return total;
}

/* ---------------- Census CBP: AZ aerospace establishments ---------------- */

export async function ingestCensus(): Promise<number> {
  const key = process.env.CENSUS_KEY;
  if (!key) {
    await logSync("census", "skipped", 0, "CENSUS_KEY not set");
    return 0;
  }
  const metrics = [
    { col: "ESTAB", seriesId: "CBP_AZ_3364_ESTAB", title: "AZ Aerospace Mfg Establishments (NAICS 3364)" },
    { col: "EMP", seriesId: "CBP_AZ_3364_EMP", title: "AZ Aerospace Mfg Employment (NAICS 3364)" },
    { col: "PAYANN", seriesId: "CBP_AZ_3364_PAY", title: "AZ Aerospace Mfg Annual Payroll $000s (NAICS 3364)" },
  ];
  let total = 0;
  const thisYear = new Date().getFullYear();
  for (let year = thisYear - 6; year <= thisYear - 2; year++) {
    try {
      const url =
        `https://api.census.gov/data/${year}/cbp?get=NAME,ESTAB,EMP,PAYANN&for=state:04&NAICS2017=3364&key=${key}`;
      const res = await fetch(url);
      if (!res.ok) continue;
      const data = (await res.json()) as string[][];
      if (!Array.isArray(data) || data.length < 2) continue;
      const headers = data[0];
      const vals = data[1];
      const get = (c: string) => {
        const i = headers.indexOf(c);
        return i >= 0 && vals[i] ? Number(vals[i]) : null;
      };
      const rows: IndicatorInput[] = metrics.map((m) => ({
        source: "census" as MiIndicatorSource,
        seriesId: m.seriesId,
        title: m.title,
        units: m.col === "PAYANN" ? "Thousands of dollars" : m.col === "ESTAB" ? "Establishments" : "Employees",
        frequency: "Annual",
        obsDate: `${year}-01-01`,
        value: get(m.col),
      }));
      total += await upsertIndicatorObs(rows.filter((r) => r.value !== null));
    } catch {
      continue;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  await logSync("census", "ok", total, "Census CBP: AZ NAICS 3364 series");
  return total;
}

/* ---------------- Orchestrator ---------------- */

export type IngestSource = "indicators" | "filings" | "news" | "bankruptcy_news" | "warn" | "entities" | "multiples" | "defense" | "census" | "all";

export async function runMarketIngest(source: IngestSource): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const jobs: [IngestSource, () => Promise<number>][] = [
    ["indicators", ingestIndicators],
    ["filings", ingestFilings],
    ["news", ingestNews],
    ["bankruptcy_news", ingestBankruptcyNews],
    ["warn", ingestWarn],
    ["entities", ingestEntities],
    ["multiples", ingestMultiples],
    ["defense", ingestDefenseContracts],
    ["census", ingestCensus],
  ];
  for (const [name, fn] of jobs) {
    if (source !== "all" && source !== name) continue;
    try {
      out[name] = await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await logSync(name, "error", 0, msg.slice(0, 500));
      out[name] = -1;
    }
  }
  return out;
}
