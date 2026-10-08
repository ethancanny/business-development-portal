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
  logSync,
  type AcquisitionInput,
  type FilingInput,
  type IndicatorInput,
  type WarnInput,
} from "./market-db";

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
  units?: string;
  frequency?: string;
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
  let total = 0;
  const results = await Promise.all(
    FRED_SERIES.map(async (s) => {
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
          units: data.units ?? "",
          frequency: data.frequency ?? "",
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

const EDGAR_QUERIES: { category: "acquisition" | "form_d" | "expansion"; q: string; forms: string }[] = [
  { category: "acquisition", q: '"acquisition" AND Arizona', forms: "8-K" },
  { category: "form_d", q: "Arizona", forms: "D,D/A" },
  { category: "expansion", q: '"Arizona" AND expansion', forms: "10-K" },
];

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
    const rows: FilingInput[] = hits.map((h) => {
      const s = h._source ?? {};
      const cik = (s.ciks ?? [])[0]?.replace(/^0+/, "") ?? "";
      const adsh = (s.adsh ?? "").replace(/-/g, "");
      return {
        form: s.form ?? "",
        company: (s.display_names ?? [])[0] ?? "",
        cik,
        filingDate: s.file_date ?? "",
        accession: s.adsh ?? "",
        category: q.category,
        summary: s.file_description ?? "",
        url: cik && adsh ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh}/` : "",
      };
    });
    total += await upsertFilings(rows);
  }
  await logSync("filings", "ok", total, `EDGAR: ${EDGAR_QUERIES.length} queries, 30d window`);
  return total;
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

/* ---------------- WARN notices ---------------- */

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
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
    rows.push({
      employer: c[idx("company")] ?? "",
      location: c[idx("location")] ?? "",
      headcount: c[idx("employees_affected")] ? Number(c[idx("employees_affected")]) : null,
      noticeDate,
      effectiveDate: c[idx("effective_date")] ?? "",
      source: "WARN Act notices (APVentureEngine)",
    });
  }
  const added = await upsertWarn(rows);
  await logSync("warn", "ok", added, `WARN: ${rows.length} AZ notices (12mo) processed`);
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

/* ---------------- Orchestrator ---------------- */

export type IngestSource = "indicators" | "filings" | "news" | "warn" | "entities" | "all";

export async function runMarketIngest(source: IngestSource): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const jobs: [IngestSource, () => Promise<number>][] = [
    ["indicators", ingestIndicators],
    ["filings", ingestFilings],
    ["news", ingestNews],
    ["warn", ingestWarn],
    ["entities", ingestEntities],
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
