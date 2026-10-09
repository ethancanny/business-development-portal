/**
 * Market intelligence ingest jobs.
 * Each fetches a free public source and upserts rows into Neon.
 * Designed to run as a daily Vercel Cron hitting /api/market/ingest.
 */
import * as XLSX from "xlsx";
import {
  upsertAcquisitions,
  upsertEntities,
  upsertFilings,
  upsertIndicatorObs,
  upsertIndicatorObsBulk,
  getIndicatorSeries,
  upsertWarn,
  backfillWarnIndustries,
  clearNewBankruptcyNews,
  purgeNonAzFilings,
  addMultiple,
  deleteMultiples,
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
  { id: "QTAXTOTALQTAXCAT3AZNO", title: "Arizona State Tax Collections (Quarterly)" },
  // Commodity prices Arizona's economy depends on (mining, construction,
  // energy): IMF global prices via FRED + EIA energy + PPI lumber.
  { id: "PCOPPUSDM", title: "Copper — Global Price (IMF)" },
  { id: "MCOILWTICO", title: "WTI Crude Oil Price" },
  { id: "MHHNGSP", title: "Natural Gas — Henry Hub Price" },
  { id: "WPU081", title: "Lumber & Wood Products PPI" },
  { id: "WPU0121", title: "Hay & Forage PPI" },
  { id: "WPU01220101", title: "Raw Cotton PPI" },
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
  const failures: string[] = [];
  const results = await Promise.all(
    FRED_SERIES.map(async (s) => {
      try {
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
        return await upsertIndicatorObs(rows);
      } catch {
        // One dead/renamed series must not sink the whole refresh.
        failures.push(s.id);
        return 0;
      }
    })
  );
  total = results.reduce((a, b) => a + b, 0);
  await logSync("indicators", "ok", total, `FRED: ${FRED_SERIES.length} series refreshed${failures.length ? `; failed: ${failures.join(", ")}` : ""}`);
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

/** Exchange-listed? EDGAR puts the ticker in display_names for listed
 * filers: "Leslie's, Inc. (LESL) (CIK 0001821806)". */
function isListed(displayName: string): boolean {
  return /\([A-Z][A-Z0-9.\-]{0,5}\)\s*\(CIK/.test(displayName);
}

interface EdgarHit {
  _source?: {
    adsh?: string;
    ciks?: string[];
    display_names?: string[];
    form?: string;
    file_date?: string;
    file_description?: string;
    biz_states?: string[];
    items?: string[];
  };
}

const ITEM_LABELS: Record<string, string> = {
  "1.01": "Entry into a material definitive agreement",
  "1.02": "Termination of a material agreement",
  "1.03": "Bankruptcy or receivership",
  "1.05": "Material impairments",
  "2.01": "Completion of acquisition / disposition of assets",
  "2.03": "New direct financial obligation",
  "2.04": "Obligation accelerated / increased",
  "3.02": "Unregistered sale of equity securities",
  "5.01": "Change in control",
  "5.02": "Director / executive officer change",
  "5.03": "Amendments to charter or bylaws",
  "7.01": "Regulation FD disclosure",
  "8.01": "Other events",
  "9.01": "Financial statements and exhibits",
};

/** Human summary for a filing from its 8-K items / form — EDGAR's raw
 * file_description is exhibit noise ("EX-10.2"), never show that. */
function filingSummary(s: EdgarHit["_source"]): string {
  const items = (s?.items ?? []).filter((i) => ITEM_LABELS[i]);
  if (items.length)
    return items.map((i) => `Item ${i} — ${ITEM_LABELS[i]}`).join(" · ").slice(0, 300);
  const form = (s?.form ?? "").toUpperCase();
  if (form.startsWith("D")) return "Form D — notice of exempt securities offering";
  if (form.includes("10-K")) return "Annual report (Form 10-K)";
  if (form.includes("10-Q")) return "Quarterly report (Form 10-Q)";
  const d = s?.file_description ?? "";
  return /^EX[\s-]|EXHIBIT/i.test(d) ? "" : d;
}

export async function ingestFilings(): Promise<number> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  let total = 0;
  for (const q of EDGAR_QUERIES) {
    const url =
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q.q)}` +
      `&forms=${encodeURIComponent(q.forms)}&startdt=${start}&enddt=${end}`;
    let hits: EdgarHit[] = [];
    try {
      const res = await fetch(url, { headers: EDGAR_UA, signal: AbortSignal.timeout(25000) });
      if (!res.ok) {
        await logSync("filings", "error", total, `EDGAR ${q.category}: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { hits?: { hits?: EdgarHit[] } };
      hits = data.hits?.hits ?? [];
    } catch (e) {
      await logSync("filings", "error", total, `EDGAR ${q.category}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const rows: FilingInput[] = [];
    for (const h of hits) {
      const s = h._source ?? {};
      const cik = (s.ciks ?? [])[0]?.replace(/^0+/, "") ?? "";
      const adsh = (s.adsh ?? "").replace(/-/g, "");
      const name = (s.display_names ?? [])[0] ?? "";
      // Arizona-based? EDGAR tags every search hit with the filer's
      // business state(s), so no per-company lookup is needed. (The old
      // design verified each filer with a separate submissions-API call —
      // up to ~100 per query — and that loop is what timed this ingest out.)
      const azCompany = (s.biz_states ?? []).some((st) => st.toUpperCase() === "AZ");
      // Arizona-based filers ONLY, every category — no national exception
      // (Ethan, Oct 2026): material events at big non-AZ companies reach the
      // portal as news / Major Events articles, not as raw filings.
      if (!azCompany) continue;
      if (q.category === "bankruptcy") {
        // Must be an actual bankruptcy report (8-K Item 1.03), not a
        // boilerplate text match.
        if (!(s.items ?? []).includes("1.03")) continue;
      }
      rows.push({
        form: s.form ?? "",
        company: name,
        cik,
        filingDate: s.file_date ?? "",
        accession: s.adsh ?? "",
        category: q.category,
        summary: filingSummary(s),
        url: cik && adsh ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh}/` : "",
        azCompany,
        majorEvent: q.category === "bankruptcy",
      });
    }
    total += await upsertFilings(rows);
  }
  const purged = await purgeNonAzFilings().catch(() => 0);
  await logSync(
    "filings",
    "ok",
    total,
    `EDGAR: ${EDGAR_QUERIES.length} queries, 30d window, AZ-based filers via biz_states${purged ? ` · purged ${purged} non-AZ rows` : ""}`
  );
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

// Word-boundary keyword matching (Ethan, Oct 2026 — a resort deal was tagged
// "Healthcare" because the old substring match found "hospital" inside
// "hospitality"). Words ending in * are prefix stems (fabricat* →
// fabrication); all others must match as whole words. Order matters: the
// first matching category wins, and Hospitality sits above Healthcare so
// hotels/resorts can never fall into the hospital bucket.
const INDUSTRY_KEYWORDS: { industry: string; words: string[] }[] = [
  { industry: "Hospitality & Leisure", words: ["hospitality", "hotel*", "resort*", "casino*", "restaurant*", "lodging", "tourism", "nightclub*", "brewery", "winery"] },
  { industry: "Aerospace & Defense", words: ["aerospace", "defense", "avionics", "missile*", "spacecraft", "aircraft", "defence"] },
  { industry: "Advanced Manufacturing", words: ["manufacturing", "semiconductor*", "chips", "chipmaker*", "fabricat*", "machining", "industrial"] },
  { industry: "Healthcare", words: ["healthcare", "health care", "hospitals", "hospital", "clinics", "clinic", "pharma*", "biotech", "medical", "dental", "veterinary", "senior living", "assisted living"] },
  { industry: "Specialty Trades & Construction", words: ["construction", "contractors", "contractor", "hvac", "plumbing", "electrical", "roofing", "paving", "concrete"] },
  { industry: "Real Estate", words: ["real estate", "multifamily", "apartment*", "homebuilder*", "land development", "self-storage", "warehouse*", "industrial park"] },
  { industry: "Energy & Utilities", words: ["solar", "utility", "utilities", "power plant", "battery storage", "energy storage", "wind farm", "electric cooperative"] },
  { industry: "Financial Services", words: ["bank", "banks", "insurance", "fintech", "wealth management", "credit union*", "mortgage"] },
  { industry: "Technology", words: ["software", "data center*", "artificial intelligence", "cybersecurity", "semiconductor*"] },
  { industry: "Consumer & Retail", words: ["retail", "grocery", "e-commerce", "consumer brands", "franchise*"] },
];

/** Whole-word / prefix-stem keyword test: "hospital" must NOT match inside
 * "hospitality"; words ending in * match word prefixes (fabricat*). */
function kwMatch(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return word.endsWith("*")
    ? new RegExp(`\\b${esc.slice(0, -2)}`, "i").test(text)
    : new RegExp(`\\b${esc}\\b`, "i").test(text);
}

function classifyIndustry(text: string): string {
  for (const { industry, words } of INDUSTRY_KEYWORDS) {
    if (words.some((w) => kwMatch(text, w))) return industry;
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
  description: string;
}

function parseRss(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const decode = (s: string) =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
      .replace(/&nbsp;/g, " ");
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/g) ?? [];
  for (const b of blocks) {
    const get = (tag: string) => {
      const m = b.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return m ? decode(m[1].trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")) : "";
    };
    items.push({ title: get("title"), link: get("link"), pubDate: get("pubDate"), source: get("source"), description: get("description") });
  }
  return items;
}

const DEAL_VERBS = /\b(acquir|merger|merges|buys|bought|takeover|stake in)\b/i;

/** Arizona relevance for news items: Google News returns loosely-related
 * national stories even for Arizona queries, so require an Arizona place
 * term in the headline or an Arizona news outlet as the source. */
const AZ_TERMS =
  /\b(arizona|phoenix|scottsdale|tempe|mesa|tucson|chandler|gilbert|glendale|peoria|surprise|flagstaff|yuma|prescott|avondale|goodyear|buckeye|queen creek|maricopa|pinal|sedona|lake havasu)\b/i;
const AZ_OUTLETS =
  /(arizona republic|azcentral|phoenix business journal|arizona daily star|ktar|abc15|12 ?news|fox 10 phoenix|arizona capitol times|tucson sentinel|arizona mirror|daily independent|east valley tribune|arizona family|kjzz)/i;
function isArizonaStory(title: string, source: string): boolean {
  return AZ_TERMS.test(title) || AZ_OUTLETS.test(source);
}

/** Strict Arizona relevance: the headline itself names an Arizona place. */
function hasPlace(title: string): boolean {
  return AZ_TERMS.test(title);
}

/** Headline text minus the " - Publisher" suffix: a one-line brief of the event. */
function headlineSummary(title: string): string {
  return title.replace(/\s+-\s+[^-]+$/, "").trim().slice(0, 300);
}

/** Structured brief for a major-event card (Ethan's spec: name the companies
 * involved, dollar amounts, jobs, size, place — not just the headline).
 * Facts are extracted from the headline itself. Google News RSS
 * descriptions carry no article prose (only links to related stories),
 * so they are deliberately NOT used — a related headline is not a lede. */
function buildEventBrief(opts: {
  title: string;
  acquirer?: string;
  target?: string;
}): string {
  const { title, acquirer, target } = opts;
  const cleanTitle = headlineSummary(title);
  const hay = title;
  const facts: string[] = [];
  if (acquirer && target) facts.push(`${acquirer} → ${target}`);
  else if (target) facts.push(target);
  const money = Array.from(hay.matchAll(/\$\s?[\d,.]+\s?(?:billion|million|bn|m|b)\b/gi)).map((m) =>
    m[0].replace(/\$\s?/, "$").replace(/\s+/g, " ").trim()
  );
  for (const m of Array.from(new Set(money)).slice(0, 2)) facts.push(m);
  const jobs = hay.match(/[\d,]+\s+(?:new\s+)?jobs/i);
  if (jobs) facts.push(jobs[0].replace(/\s+/g, " "));
  const sqft = hay.match(/[\d,]+\s*-?\s*(?:square[- ]feet|sq\.?\s?ft)/i);
  if (sqft) facts.push(sqft[0].replace(/\s+/g, " "));
  const loc = hay.match(AZ_TERMS);
  if (loc) facts.push(loc[0].charAt(0).toUpperCase() + loc[0].slice(1));
  // The facts line only wins when it actually says something: a company
  // name, or at least two hard facts. Otherwise the headline is better.
  const informative = Boolean(acquirer || target) || facts.length >= 2;
  return (informative && facts.length > 0 ? facts.join(" · ") : cleanTitle).slice(0, 340);
}

/** Non-event noise: commentary, advice, stock-price moves, legal/political drama. */
const JUNK_HEADLINE =
  /\b(how to|what to know|opinion|editorial|podcast|webinar|sponsored|price target|dividend|earnings call|top \d+|best stocks?|stocks? to (buy|watch)|shares? (rise|risen|fall|fell|jump|drop|surge|plunge|slide|soar|climb|dip)|stock is trending|trending stocks?|lawsuit|indicted|arrested|coupon|giveaway|campaign|endorses?|endorsement|poll (shows|says|finds)|slams|blasts|feud|scandal)\b/i;
function isJunkHeadline(title: string): boolean {
  return JUNK_HEADLINE.test(title);
}

/** Market-policy gate: a policy story qualifies only if it is about money,
 * markets, or economic regulation — budgets, taxes, spending, incentives,
 * water/infrastructure funding — not political drama. */
const MARKET_POLICY =
  /\b(budget|spending|tax|funding|funds|bond|incentive|appropriation|infrastructure|water|housing|economic|business|jobs|tariff|zoning|permit|development|revenue|fiscal|subsid|grant|loan|credit|semiconductor|energy|broadband)\b/i;

/** Scale gate for expansion/investment/relocation: the event must show size —
 * money, jobs, or a physical facility — to count as "major". */
const SCALE_SIGNAL =
  /(million|billion|\$\s?\d|\d[\d,]*\s*(jobs|employees|square|sq\.?\s?ft)|plant|facility|headquarters|campus|factory|warehouse|data center|distribution center|manufacturing|semiconductor|\bfab\b|acre)/i;

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
      // Acquisitions must be Arizona deals: the headline itself must name an
      // Arizona place. An AZ outlet covering a national deal (Paramount–Warner
      // Bros. via AZ papers) does NOT qualify — that fallback lives on in the
      // econ-events and bankruptcy ingests, not here.
      if (!hasPlace(item.title)) continue;
      if (isJunkHeadline(item.title)) continue;
      const { acquirer, target } = parseDealHeadline(item.title);
      const announced = item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : "";
      rows.push({
        acquirer,
        target,
        industry: classifyIndustry(item.title),
        dealValue: parseHeadlineValue(item.title),
        announcedDate: announced,
        sourceUrl: item.link,
        publisher: item.source,
        headline: headlineSummary(item.title),
        summary: buildEventBrief({ title: item.title, acquirer, target }),
      });
    }
    total += await upsertAcquisitions(rows);
    // be polite to Google News
    await new Promise((r) => setTimeout(r, 1500));
  }
  await logSync("news", "ok", total, `Google News: ${NEWS_QUERIES.length} queries`);
  return total;
}

/* ---------------- Economic-event news (expansions, contracts, relocations, IPOs) ---------------- */

type EconEventType = "expansion" | "contract" | "relocation" | "ipo" | "policy" | "investment";

const ECONOMIC_EVENT_QUERIES: { eventType: EconEventType; q: string; verbs: RegExp }[] = [
  {
    eventType: "expansion",
    q: 'Arizona (semiconductor OR chip OR "data center" OR manufacturing) (expansion OR "new fab" OR groundbreaking OR "new facility" OR "new plant") when:30d',
    verbs: /\b(expansion|expands|opens|opening|groundbreaking|new facility|new plant|\bfab\b)\b/i,
  },
  {
    eventType: "expansion",
    q: '(Phoenix OR Scottsdale OR Tempe OR Chandler OR Tucson) (headquarters OR "distribution center") (opens OR opening OR expansion) when:30d',
    verbs: /\b(opens|opening|expansion|headquarters|distribution center)\b/i,
  },
  {
    eventType: "contract",
    q: 'Arizona (defense OR aerospace) (contract ("awarded" OR "award" OR wins)) when:30d',
    verbs: /\b(awarded|award|wins|contract)\b/i,
  },
  {
    eventType: "relocation",
    q: 'company (relocating OR relocation OR "moving headquarters") (Arizona OR Phoenix OR Scottsdale) when:30d',
    verbs: /\b(relocat|moving|headquarters)\b/i,
  },
  {
    eventType: "ipo",
    q: 'Arizona (company OR startup) (IPO OR "goes public" OR "files for IPO") when:30d',
    verbs: /\b(IPO|goes public|public offering|files for IPO)\b/i,
  },
  {
    eventType: "policy",
    q: 'Arizona (budget OR "spending bill" OR legislature) (approved OR approves OR signed OR signs OR passes OR enacted) when:30d',
    verbs: /\b(approv|signed|signs|passes|enacted|budget|veto)\b/i,
  },
  {
    eventType: "policy",
    q: '("Governor Hobbs" OR "Arizona legislature") (bill OR law OR funding) (economic OR business OR tax OR water OR housing) when:30d',
    verbs: /\b(bill|law|funding|signs|approves|veto)\b/i,
  },
  {
    eventType: "investment",
    q: 'Arizona (company OR corporation OR manufacturer) (invests OR "will invest" OR investing) (million OR billion OR plant OR facility OR headquarters) when:30d',
    verbs: /\b(invest|investment)\b/i,
  },
  {
    eventType: "investment",
    q: '("new investment" OR "capital investment") (Arizona OR Phoenix) (facility OR plant OR jobs OR expansion) when:30d',
    verbs: /\b(investment)\b/i,
  },
];

/** Extract a dollar value from a headline, in USD. */
function parseHeadlineValue(headline: string): number | null {
  const m = headline.match(/\$([\d,.]+)\s*(billion|million|trillion|\bb\b|\bm\b)/i);
  if (!m) return null;
  const num = parseFloat(m[1].replace(/,/g, ""));
  if (!Number.isFinite(num)) return null;
  const unit = m[2].toLowerCase();
  const mult = unit.startsWith("b") ? 1e9 : unit.startsWith("t") ? 1e12 : 1e6;
  return Math.round(num * mult);
}

/** Best-effort company/subject extraction: text before the event verb, cleaned up. */
function parseEventSubject(headline: string, verbs: RegExp): string {
  const h = headline.replace(/\s+-\s+[^-]+$/, "").trim(); // strip " - Publisher"
  const idx = h.search(verbs);
  const subject = (idx > 0 ? h.slice(0, idx) : h).trim()
    .replace(/^(the|a)\s+/i, "")
    .replace(/[,.;:]+$/, "");
  return subject.length > 80 ? subject.slice(0, 80).trim() : subject;
}

export async function ingestEconomicEvents(): Promise<number> {
  let total = 0;
  const seen = new Set<string>();
  for (const { eventType, q, verbs } of ECONOMIC_EVENT_QUERIES) {
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
      if (!verbs.test(item.title)) continue;
      if (!isArizonaStory(item.title, item.source)) continue;
      if (isJunkHeadline(item.title)) continue;
      // Policy counts only when it is a market policy, not political drama.
      if (eventType === "policy" && !MARKET_POLICY.test(item.title)) continue;
      // Expansions, investments, and relocations must show major scale.
      if (
        (eventType === "expansion" || eventType === "investment" || eventType === "relocation") &&
        !SCALE_SIGNAL.test(item.title)
      )
        continue;
      // skip obvious bankruptcy noise in expansion/contract feeds
      if (/\b(bankruptcy|chapter 11)\b/i.test(item.title)) continue;
      const announced = item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : "";
      const subject = parseEventSubject(item.title, verbs);
      rows.push({
        acquirer: "",
        target: subject,
        industry: classifyIndustry(item.title),
        dealValue: parseHeadlineValue(item.title),
        announcedDate: announced,
        sourceUrl: item.link,
        publisher: item.source,
        eventType,
        headline: headlineSummary(item.title),
        summary: buildEventBrief({ title: item.title, target: subject }),
      });
    }
    total += await upsertAcquisitions(rows);
    await new Promise((r) => setTimeout(r, 1500));
  }
  await logSync("econ_events", "ok", total, `Google News: ${ECONOMIC_EVENT_QUERIES.length} economic-event queries`);
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
      if (!isArizonaStory(item.title, item.source)) continue;
      if (isJunkHeadline(item.title)) continue;
      const company = parseBankruptcyHeadline(item.title);
      if (!company || company.length < 3) continue;
      const announced = item.pubDate ? new Date(item.pubDate).toISOString().slice(0, 10) : "";
      rows.push({
        acquirer: "",
        target: company,
        industry: classifyIndustry(item.title),
        dealValue: parseHeadlineValue(item.title),
        announcedDate: announced,
        sourceUrl: item.link,
        publisher: item.source,
        eventType: "bankruptcy",
        headline: headlineSummary(item.title),
        summary: buildEventBrief({ title: item.title, target: company }),
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
    if (words.some((w) => kwMatch(e, w))) return industry;
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

const VERTICAL_TO_INDUSTRY: Record<string, [string, string]> = {
  "aerospace": ["Aerospace & Defense", "Aerospace"],
  "industrial-equipment": ["Advanced Manufacturing", "Industrial Equipment"],
  "metal-fabrication": ["Advanced Manufacturing", "Metal Fabrication"],
  "electronics": ["Advanced Manufacturing", "Electronics"],
  "auto-parts": ["Advanced Manufacturing", "Auto Parts"],
  "beverage-manufacturing": ["Advanced Manufacturing", "Beverage Manufacturing"],
  "food-manufacturing": ["Advanced Manufacturing", "Food Manufacturing"],
  "packaging": ["Advanced Manufacturing", "Packaging"],
  "plastics": ["Advanced Manufacturing", "Plastics"],
  "medical-devices": ["Healthcare", "Medical Devices"],
  "durable-medical-equipment": ["Healthcare", "Durable Medical Equipment"],
  "home-health": ["Healthcare", "Home Health"],
  "healthcare-it": ["Healthcare", "Healthcare IT"],
  "healthtech": ["Healthcare", "HealthTech"],
  "ambulatory-surgery-center": ["Healthcare", "Ambulatory Surgery Centers"],
  "dental-practice": ["Healthcare", "Dental Practices"],
  "hospice": ["Healthcare", "Hospice"],
  "laboratory-services": ["Healthcare", "Laboratory Services"],
  "medical-practice-primary-care": ["Healthcare", "Primary Care Practices"],
  "medical-practice-specialty": ["Healthcare", "Specialty Practices"],
  "mental-health": ["Healthcare", "Mental Health"],
  "pharmacy": ["Healthcare", "Pharmacies"],
  "physical-therapy": ["Healthcare", "Physical Therapy"],
  "veterinary-practice": ["Healthcare", "Veterinary Practices"],
  "specialty-contractor": ["Specialty Trades & Construction", "Specialty Contractors"],
  "advertising-agency": ["Business Services", "Advertising Agencies"],
  "consulting": ["Business Services", "Consulting"],
  "it-services": ["Business Services", "IT Services"],
  "apparel": ["Consumer & Retail", "Apparel"],
  "auto-dealership": ["Consumer & Retail", "Auto Dealerships"],
  "consumer-products": ["Consumer & Retail", "Consumer Products"],
  "gaming": ["Consumer & Retail", "Gaming"],
  "restaurant-qsr": ["Consumer & Retail", "Restaurants (QSR)"],
  "specialty-retail": ["Consumer & Retail", "Specialty Retail"],
  "digital-media": ["Technology & Media", "Digital Media"],
  "ecommerce": ["Technology & Media", "E-Commerce"],
  "radio-television": ["Technology & Media", "Radio & Television"],
  "saas": ["Technology & Media", "SaaS"],
  "software-enterprise": ["Technology & Media", "Enterprise Software"],
  "electrical-utility": ["Energy & Utilities", "Electrical Utilities"],
  "oil-gas-services": ["Energy & Utilities", "Oil & Gas Services"],
  "insurance-agency": ["Financial Services", "Insurance Agencies"],
  "food-distribution": ["Transportation & Logistics", "Food Distribution"],
  "freight-brokerage": ["Transportation & Logistics", "Freight Brokerage"],
  "trucking": ["Transportation & Logistics", "Trucking"],
  "wholesale-distribution": ["Transportation & Logistics", "Wholesale Distribution"],
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

  // Replace this vintage wholesale (idempotent; also heals label changes).
  await deleteMultiples("ExitValue.ai M&A Multiples Index", period);

  let added = 0;
  for (const [vertical, brackets] of Object.entries(data)) {
    const mapped = VERTICAL_TO_INDUSTRY[vertical];
    if (!mapped) continue;
    for (const [bracket, metrics] of Object.entries(brackets)) {
      const ebitda = metrics["ev_ebitda"];
      const rev = metrics["ev_revenue"];
      if (!ebitda && !rev) continue;
      await addMultiple({
        sourceReport: "ExitValue.ai M&A Multiples Index",
        period,
        industry: `${mapped[0]} — ${mapped[1]}`,
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

/**
 * Damodaran (NYU Stern) public-company EV/EBITDA by industry — the standard
 * public-comps benchmark, republished every January as an Excel dataset.
 * Stored as sizeBand "Public comps" alongside the private-deal multiples.
 */
export async function ingestDamodaranMultiples(): Promise<number> {
  const SOURCE = "Damodaran (NYU Stern) — Public Multiples";
  const res = await fetch("https://pages.stern.nyu.edu/~adamodar/pc/datasets/vebitda.xls", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CannyCapitalPortal/1.0)" },
  });
  if (!res.ok) {
    await logSync("multiples", "error", 0, `Damodaran: HTTP ${res.status}`);
    return 0;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets["Industry Averages"];
  if (!ws) {
    await logSync("multiples", "error", 0, "Damodaran: 'Industry Averages' sheet missing");
    return 0;
  }
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1 });
  // Vintage from the sheet's "Date updated:" Excel serial (fallback: file header).
  let period = "";
  const serial = Number(rows[0]?.[1]);
  if (Number.isFinite(serial) && serial > 30000) {
    const d = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    period = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (!period) {
    const lm = res.headers.get("last-modified");
    const d = lm ? new Date(lm) : new Date();
    period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  // Replace this vintage wholesale (idempotent).
  await deleteMultiples(SOURCE, period);
  const headerIdx = rows.findIndex((r) => r[0] === "Industry Name");
  if (headerIdx < 0) {
    await logSync("multiples", "error", 0, "Damodaran: header row not found");
    return 0;
  }
  const ebitdaCol = (rows[headerIdx] as unknown[]).indexOf("EV/EBITDA");
  let added = 0;
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] as unknown[];
    const industry = String(r[0] ?? "").trim();
    if (!industry || industry.startsWith("Total Market")) continue;
    const firms = Number(r[1]);
    const evEbitda = Number(r[ebitdaCol]);
    if (!Number.isFinite(evEbitda) || evEbitda <= 0 || evEbitda >= 100) continue;
    await addMultiple({
      sourceReport: SOURCE,
      period,
      industry,
      sizeBand: "Public comps",
      evEbitdaLow: null,
      evEbitdaHigh: null,
      evEbitdaMedian: Math.round(evEbitda * 100) / 100,
      evRevenueMedian: null,
      notes: `Aggregate EV/EBITDA across ${Number.isFinite(firms) ? firms : "?"} US public companies; NYU Stern dataset, updated ${period}.`,
    });
    added++;
  }

  // EBITDA margins (EBITDA/Sales) from Damodaran's companion margin dataset,
  // aggregated to the portal's focus sectors (lower median across the mapped
  // public industries). These convert the SUSB revenue bands into the
  // $500K–$2M EBITDA target band on the size-profile chart.
  let marginNote = "";
  try {
    const mRes = await fetch("https://pages.stern.nyu.edu/~adamodar/pc/datasets/margin.xls", {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CannyCapitalPortal/1.0)" },
    });
    if (!mRes.ok) throw new Error(`HTTP ${mRes.status}`);
    const mBuf = Buffer.from(await mRes.arrayBuffer());
    const mWb = XLSX.read(mBuf, { type: "buffer" });
    const mWs = mWb.Sheets["Industry Averages"];
    if (!mWs) throw new Error("'Industry Averages' sheet missing");
    const mRows = XLSX.utils.sheet_to_json<unknown[]>(mWs, { header: 1 });
    const mHdr = mRows.findIndex((r) => String(r[0]).includes("Industry"));
    if (mHdr < 0) throw new Error("header row not found");
    const mCol = (mRows[mHdr] as unknown[]).indexOf("EBITDA/Sales");
    if (mCol < 0) throw new Error("EBITDA/Sales column not found");
    const groups: Record<string, { name: string; test: (n: string) => boolean }> = {
      "3364": { name: "Aerospace & Defense", test: (n) => /^aerospace/i.test(n) },
      "62": { name: "Healthcare", test: (n) => /health|hospital|medical|drug|biotech/i.test(n) },
      "23": { name: "Specialty Trades & Construction", test: (n) => /engineering\/construction|homebuilding/i.test(n) },
      "3133": {
        name: "Advanced Manufacturing",
        test: (n) =>
          /machinery|electrical|electronics|semiconductor|auto|chemical|steel|metals|mining|packaging|industrial|paper|rubber/i.test(n) &&
          !/^aerospace/i.test(n),
      },
    };
    const byGroup = new Map<string, number[]>();
    for (let i = mHdr + 1; i < mRows.length; i++) {
      const r = mRows[i] as unknown[];
      const name = String(r[0] ?? "").trim();
      const m = Number(r[mCol]);
      if (!name || !Number.isFinite(m) || m <= 0 || m >= 0.6) continue;
      for (const [slug, g] of Object.entries(groups)) {
        if (g.test(name)) {
          if (!byGroup.has(slug)) byGroup.set(slug, []);
          byGroup.get(slug)!.push(m);
          break;
        }
      }
    }
    const mObs: IndicatorInput[] = [];
    const parts: string[] = [];
    for (const [slug, g] of Object.entries(groups)) {
      const xs = (byGroup.get(slug) ?? []).slice().sort((a, b) => a - b);
      if (!xs.length) continue;
      const lowerMedian = xs[Math.floor((xs.length - 1) / 2)];
      mObs.push({
        source: "damodaran",
        seriesId: `DAMO_EBITDA_MARGIN_${slug}`,
        title: `Damodaran EBITDA margin — ${g.name} (public comps)`,
        units: "% of sales",
        frequency: "Annual",
        obsDate: `${period}-01`,
        value: Math.round(lowerMedian * 1000) / 10,
      });
      parts.push(`${g.name} ${(lowerMedian * 100).toFixed(1)}% (n=${xs.length})`);
    }
    if (mObs.length) await upsertIndicatorObs(mObs);
    marginNote = parts.length ? ` · EBITDA margins: ${parts.join(" · ")}` : "";
    if (parts.length < 4) throw new Error(`only ${parts.length}/4 sector margins mapped`);
  } catch (err) {
    await logSync("damodaran_margins", "error", 0, `margin.xls: ${err instanceof Error ? err.message : String(err)}`);
  }
  await logSync("multiples", "ok", added, `Damodaran ${period}: ${added} public-comp industries${marginNote}`);
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
    const monthlyByFy = new Map<number, number>();
    for (const r of data.results ?? []) {
      const fy = Number(r.time_period?.fiscal_year ?? 0);
      const fm = Number(r.time_period?.month ?? 0);
      const val = r.Contract_Obligations;
      if (!fy || !fm || val === null || val === undefined) continue;
      monthlyByFy.set(fy, (monthlyByFy.get(fy) ?? 0) + val);
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
    // Cross-reference (Ethan's standing rule, Oct 2026): the monthly figures
    // must reconcile with USASpending's own fiscal-year aggregation of the
    // same filters — an independent aggregation path over the source data.
    // Mismatches are logged loudly in mi_sync_log (defense-xcheck).
    try {
      const fyRes = await fetch("https://api.usaspending.gov/api/v2/search/spending_over_time/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group: "fiscal_year",
          filters: {
            time_period: [{ start_date: start, end_date: end }],
            place_of_performance_locations: [{ country: "USA", state: "AZ" }],
            ...s.filters,
          },
        }),
      });
      if (fyRes.ok) {
        const fyData = (await fyRes.json()) as {
          results?: { time_period?: { fiscal_year?: string }; Contract_Obligations?: number | null }[];
        };
        const bad: string[] = [];
        for (const r of fyData.results ?? []) {
          const fy = Number(r.time_period?.fiscal_year ?? 0);
          const fyTotal = r.Contract_Obligations ?? 0;
          const mSum = monthlyByFy.get(fy) ?? 0;
          if ((fyTotal === 0 && mSum === 0) || fyTotal === 0) continue;
          if (Math.abs(mSum - fyTotal) / fyTotal > 0.01)
            bad.push(`FY${fy}: monthly sum $${Math.round(mSum).toLocaleString()} vs FY total $${Math.round(fyTotal).toLocaleString()}`);
        }
        await logSync(
          "defense-xcheck",
          bad.length ? "error" : "ok",
          0,
          bad.length
            ? `${s.id} cross-check MISMATCH — ${bad.join("; ")}`
            : `${s.id} cross-check OK: monthly sums reconcile with USASpending fiscal-year totals`
        );
      } else {
        await logSync("defense-xcheck", "error", 0, `${s.id} cross-check could not run: USASpending FY query HTTP ${fyRes.status}`);
      }
    } catch {
      // A cross-check that silently doesn't run is worse than none — log it.
      try {
        await logSync("defense-xcheck", "error", 0, `${s.id} cross-check could not run (fetch failed)`);
      } catch {
        /* logging itself failed; the ingest result stands */
      }
    }
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

/* ---------- Census CBP: AZ establishments by sector (target universe) --- */

/** NAICS sectors tracked for the "Arizona companies by sector" census.
 * slug sanitizes the code for series ids ("31-33" -> "3133"). */
const CBP_SECTORS: { code: string; slug: string; name: string }[] = [
  { code: "11", slug: "11", name: "Agriculture & Forestry" },
  { code: "21", slug: "21", name: "Mining & Oil/Gas" },
  { code: "22", slug: "22", name: "Utilities" },
  { code: "23", slug: "23", name: "Construction" },
  { code: "31-33", slug: "3133", name: "Manufacturing" },
  { code: "3364", slug: "3364", name: "Aerospace & Defense" },
  { code: "42", slug: "42", name: "Wholesale Trade" },
  { code: "44-45", slug: "4445", name: "Retail Trade" },
  { code: "48-49", slug: "4849", name: "Transportation & Warehousing" },
  { code: "51", slug: "51", name: "Information" },
  { code: "52", slug: "52", name: "Finance & Insurance" },
  { code: "53", slug: "53", name: "Real Estate" },
  { code: "54", slug: "54", name: "Professional & Technical Services" },
  { code: "55", slug: "55", name: "Management of Companies" },
  { code: "56", slug: "56", name: "Administrative & Waste Services" },
  { code: "61", slug: "61", name: "Educational Services" },
  { code: "62", slug: "62", name: "Healthcare & Social Assistance" },
  { code: "71", slug: "71", name: "Arts, Entertainment & Recreation" },
  { code: "72", slug: "72", name: "Accommodation & Food Services" },
  { code: "81", slug: "81", name: "Other Services" },
];

/** How many companies (employer establishments) operate in each Arizona
 * sector — the acquisition target universe. Census County Business
 * Patterns, annual; stored as CBP_AZ_SEC_<slug>_ESTAB / _EMP series.
 * Every run refreshes the latest two published years; history back to
 * 2017 (for the sector trend chart) is fetched only when missing, so
 * the daily `all` run stays fast. Runs in the daily `all` ingest. */
export async function ingestSectorCounts(): Promise<number> {
  const key = process.env.CENSUS_KEY;
  if (!key) {
    await logSync("sector_counts", "skipped", 0, "CENSUS_KEY not set");
    return 0;
  }
  const fetchSector = async (year: number, code: string) => {
    const url =
      `https://api.census.gov/data/${year}/cbp?get=NAME,ESTAB,EMP&for=state:04` +
      `&NAICS2017=${encodeURIComponent(code)}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as string[][];
    if (!Array.isArray(data) || data.length < 2) return null;
    const headers = data[0];
    const vals = data[1];
    const get = (c: string) => {
      const i = headers.indexOf(c);
      return i >= 0 && vals[i] ? Number(vals[i]) : null;
    };
    return { estab: get("ESTAB"), emp: get("EMP") };
  };
  // Find the latest published CBP year (probe with Construction).
  const thisYear = new Date().getFullYear();
  let latestYear = 0;
  for (const y of [thisYear - 2, thisYear - 3, thisYear - 4]) {
    try {
      if (await fetchSector(y, "23")) {
        latestYear = y;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!latestYear) {
    await logSync("sector_counts", "error", 0, "No published CBP year found");
    return 0;
  }
  // Latest two years always; older years (to 2017) only when not stored.
  const existing = await getIndicatorSeries(["CBP_AZ_SEC_23_ESTAB"]).catch(() => []);
  const haveYears = new Set(existing.map((o) => Number(o.obsDate.slice(0, 4))));
  const years: number[] = [latestYear, latestYear - 1];
  for (let y = latestYear - 2; y >= 2017; y--) {
    if (!haveYears.has(y)) years.push(y);
  }
  const jobs: { year: number; s: (typeof CBP_SECTORS)[number] }[] = [];
  for (const year of years) for (const s of CBP_SECTORS) jobs.push({ year, s });
  let total = 0;
  for (let i = 0; i < jobs.length; i += 6) {
    const batch = jobs.slice(i, i + 6);
    const results = await Promise.all(
      batch.map(async ({ year, s }) => {
        try {
          const v = await fetchSector(year, s.code);
          if (!v) return [] as IndicatorInput[];
          const rows: IndicatorInput[] = [];
          if (v.estab !== null)
            rows.push({
              source: "census",
              seriesId: `CBP_AZ_SEC_${s.slug}_ESTAB`,
              title: `${s.name} — AZ Establishments`,
              units: "Establishments",
              frequency: "Annual",
              obsDate: `${year}-01-01`,
              value: v.estab,
            });
          if (v.emp !== null)
            rows.push({
              source: "census",
              seriesId: `CBP_AZ_SEC_${s.slug}_EMP`,
              title: `${s.name} — AZ Employment`,
              units: "Employees",
              frequency: "Annual",
              obsDate: `${year}-01-01`,
              value: v.emp,
            });
          return rows;
        } catch {
          return [] as IndicatorInput[];
        }
      })
    );
    total += await upsertIndicatorObs(results.flat());
  }
  await logSync("sector_counts", "ok", total, `CBP sector establishments, ${Math.min(...years)}–${latestYear}`);
  return total;
}

/** Arizona state government revenue & expenditure from the Census Annual Survey
 *  of State and Local Government Finances (timeseries/govslocalfin), GOVTYPE=002
 *  (state government only). Requires CENSUS_KEY. LF0001 = Total Revenue,
 *  LF0090 = Total Expenditure. (govsstatefin only exposes revenue aggregates.) */
export async function ingestCensusStateFin(): Promise<number> {
  const key = process.env.CENSUS_KEY;
  if (!key) {
    await logSync("census-fin", "skipped", 0, "CENSUS_KEY not set");
    return 0;
  }
  const series: { code: string; seriesId: string; title: string }[] = [
    { code: "LF0001", seriesId: "AZ_STATE_REVENUE", title: "Arizona State Government Total Revenue (Census)" },
    { code: "LF0090", seriesId: "AZ_STATE_EXPENDITURE", title: "Arizona State Government Total Expenditure (Census)" },
    { code: "LF0123", seriesId: "AZ_SPEND_WELFARE", title: "AZ State Spending — Public Welfare (Census)" },
    { code: "LF0107", seriesId: "AZ_SPEND_EDUCATION", title: "AZ State Spending — Education (Census)" },
    { code: "LF0222", seriesId: "AZ_SPEND_INSURANCE", title: "AZ State Spending — Insurance Trust / Retirement (Census)" },
    { code: "LF0141", seriesId: "AZ_SPEND_HIGHWAYS", title: "AZ State Spending — Highways (Census)" },
    { code: "LF0159", seriesId: "AZ_SPEND_CORRECTIONS", title: "AZ State Spending — Corrections (Census)" },
    { code: "LF0132", seriesId: "AZ_SPEND_HEALTH", title: "AZ State Spending — Health (Census)" },
  ];
  try {
    // Base range is the Census dataset's confirmed coverage (2017–2024).
    // Wider ranges return no matching aggregates from this API, so newer
    // years are probed one at a time: a year with no data yet is a harmless
    // empty response, and FY2025+ lands automatically once Census publishes.
    const base =
      `https://api.census.gov/data/timeseries/govslocalfin?get=AGG_DESC,AMOUNT&for=state:04&GOVTYPE=002&key=${key}`;
    const probes: { label: string; url: string }[] = [
      { label: "base17-24", url: `${base}&time=from+2017+to+2024` },
    ];
    const thisYear = new Date().getFullYear();
    for (let y = 2025; y <= thisYear; y++)
      probes.push({ label: String(y), url: `${base}&time=${y}` });
    const byCode = new Map(series.map((s) => [s.code, s]));
    const rows: IndicatorInput[] = [];
    const attempts: string[] = [];
    for (const { label, url } of probes) {
      let data: string[][];
      try {
        const res = await fetch(url);
        if (!res.ok) {
          attempts.push(`${label}:http${res.status}`);
          continue;
        }
        const text = await res.text();
        if (!text.trim()) {
          attempts.push(`${label}:empty`);
          continue;
        }
        data = JSON.parse(text) as string[][];
      } catch (err) {
        attempts.push(`${label}:err(${err instanceof Error ? err.message : "?"})`);
        continue;
      }
      if (!Array.isArray(data) || data.length < 2) {
        attempts.push(`${label}:rows=${Array.isArray(data) ? data.length : "na"}`);
        continue;
      }
      const headers = data[0];
      const iTime = headers.indexOf("time");
      const iDesc = headers.indexOf("AGG_DESC");
      const iAmt = headers.indexOf("AMOUNT");
      let matched = 0;
      for (const r of data.slice(1)) {
        const s = byCode.get((r[iDesc] || "").trim());
        if (!s) continue;
        const amt = Number((r[iAmt] || "").replace(/,/g, ""));
        if (!Number.isFinite(amt)) continue;
        matched++;
        rows.push({
          source: "census" as MiIndicatorSource,
          seriesId: s.seriesId,
          title: s.title,
          units: "Thousands of dollars",
          frequency: "Annual",
          obsDate: `${r[iTime]}-01-01`,
          value: amt,
        });
      }
      attempts.push(`${label}:rows=${data.length - 1},matched=${matched}`);
    }
    if (rows.length === 0) {
      await logSync("census-fin", "error", 0, `No matches [${attempts.join(" | ")}]`);
      return 0;
    }
    const total = await upsertIndicatorObs(rows);
    await logSync(
      "census-fin",
      "ok",
      total,
      `Census state finance: ${rows.length} obs matched, ${total} new [${attempts.join(" | ")}]`
    );
    return total;
  } catch (err) {
    await logSync("census-fin", "error", 0, err instanceof Error ? err.message : String(err));
    return 0;
  }
}

/* ---------------- Orchestrator ---------------- */

/* ---------------- U of A EBRC (dataZoa): county housing permits ----------------
 * The University of Arizona's Economic and Business Research Center publishes
 * monthly county tables (via dataZoa) whose last two columns are Census
 * Building Permits Survey counts: Total units and Single-Family units.
 * Each county table has a public CSV export endpoint keyed by its embed hash.
 */

const COUNTY_PERMIT_TABLES: { county: string; slug: string; hashes: string[] }[] = [
  { county: "Apache", slug: "APACHE", hashes: ["18575CA960"] },
  { county: "Cochise", slug: "COCHISE", hashes: ["A53FB2362B"] },
  { county: "Coconino", slug: "COCONINO", hashes: ["F0CD76A943"] },
  { county: "Gila", slug: "GILA", hashes: ["8BBFE78881"] },
  { county: "Graham", slug: "GRAHAM", hashes: ["5D7A5FFE60"] },
  { county: "Greenlee", slug: "GREENLEE", hashes: ["99EC13529F"] },
  { county: "La Paz", slug: "LAPAZ", hashes: ["BF3A677BA4"] },
  { county: "Maricopa", slug: "MARICOPA", hashes: ["380B9E931D"] },
  { county: "Mohave", slug: "MOHAVE", hashes: ["F9A24CD7A3"] },
  { county: "Navajo", slug: "NAVAJO", hashes: ["081D067E8B"] },
  { county: "Pima", slug: "PIMA", hashes: ["95E515957E"] },
  { county: "Pinal", slug: "PINAL", hashes: ["0EA7D0310A"] },
  { county: "Santa Cruz", slug: "SANTACRUZ", hashes: ["C85FABD7D9"] },
  { county: "Yavapai", slug: "YAVAPAI", hashes: ["84F517B20F"] },
  { county: "Yuma", slug: "YUMA", hashes: ["895CEE7B87"] },
];

/** Minimal RFC4180 CSV parser (dataZoa exports quote fields with embedded commas/newlines). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Extract monthly (date, total units, single-family units) from a county export. */
function parseCountyPermits(csvText: string): { date: string; total: number | null; sf: number | null }[] {
  const rows = parseCsv(csvText.replace(/^﻿/, ""));
  if (!rows.length) return [];
  // Column titles vary slightly by county (e.g. " Single Family" with a space);
  // the permits columns are the LAST "Total" / "Single Family" pair in the table.
  const titles = rows[0].map((c) => c.trim());
  const sfIdx = titles.lastIndexOf("Single Family");
  // The total column sits immediately before Single Family; counties title it
  // either "Total" or "Total Units" (Pima's variant also adds sales columns).
  const totalIdx =
    sfIdx > 0 && (titles[sfIdx - 1] === "Total" || titles[sfIdx - 1] === "Total Units")
      ? sfIdx - 1
      : titles.lastIndexOf("Total");
  const dateRow = rows.findIndex((r) => r[0] === "DATE");
  if (totalIdx < 0 || sfIdx < 0 || dateRow < 0) return [];
  const out: { date: string; total: number | null; sf: number | null }[] = [];
  const num = (s: string | undefined) => {
    const v = parseFloat((s ?? "").replace(/,/g, ""));
    return Number.isFinite(v) ? v : null;
  };
  for (let i = dateRow + 1; i < rows.length; i++) {
    const m = (rows[i][0] ?? "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!m) continue;
    const date = `${m[3]}-${m[1].padStart(2, "0")}-01`;
    out.push({ date, total: num(rows[i][totalIdx]), sf: num(rows[i][sfIdx]) });
  }
  return out;
}

export async function ingestCountyPermits(): Promise<number> {
  const since = "2020-01-01"; // display window is 5 years; keep ingest lean

  async function processCounty(c: (typeof COUNTY_PERMIT_TABLES)[number]): Promise<number> {
    // Some counties keep permits in a second table; use the first that yields rows.
    let parsed: { date: string; total: number | null; sf: number | null }[] = [];
    for (const hash of c.hashes) {
      const url = `https://www.datazoa.com/publish/export.asp?hash=${hash}&glname=&dzuuid=1068&alttitle=&altextsrc=&a=exportcsv`;
      const res = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CannyCapitalPortal/1.0)" },
      });
      if (!res.ok) {
        await logSync("county_permits", "error", 0, `dataZoa ${c.county}: HTTP ${res.status}`);
        continue;
      }
      parsed = parseCountyPermits(await res.text());
      if (parsed.some((r) => r.total !== null)) break;
      parsed = [];
    }
    if (!parsed.length) {
      // EBRC publishes no permits series for Apache, Graham, Greenlee, La Paz —
      // expected state, not an error (verified on their county pages Oct 2026).
      await logSync("county_permits", "skipped", 0, `dataZoa ${c.county}: no permits published by EBRC`);
      return 0;
    }
    const rows: IndicatorInput[] = [];
    for (const r of parsed) {
      if (r.date < since) continue;
      if (r.total !== null)
        rows.push({
          source: "ebrc",
          seriesId: `AZPERMIT_${c.slug}`,
          title: `${c.county} County Housing Permits — Total Units`,
          units: "Units",
          frequency: "Monthly",
          obsDate: r.date,
          value: r.total,
        });
      if (r.sf !== null)
        rows.push({
          source: "ebrc",
          seriesId: `AZPERMIT_SF_${c.slug}`,
          title: `${c.county} County Housing Permits — Single-Family Units`,
          units: "Units",
          frequency: "Monthly",
          obsDate: r.date,
          value: r.sf,
        });
    }
    return upsertIndicatorObsBulk(rows);
  }

  // dataZoa generates each CSV slowly (~5-7s); fetch/process 5 counties at a time.
  let total = 0;
  for (let i = 0; i < COUNTY_PERMIT_TABLES.length; i += 5) {
    const batch = COUNTY_PERMIT_TABLES.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(async (c) => {
        try {
          return await processCounty(c);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          await logSync("county_permits", "error", 0, `dataZoa ${c.county}: ${msg.slice(0, 300)}`);
          return 0;
        }
      })
    );
    total += results.reduce((a, b) => a + b, 0);
  }
  await logSync("county_permits", "ok", total, `U of A EBRC/dataZoa: county housing permits`);
  return total;
}

/** Commodity spot prices (Yahoo Finance futures: COMEX copper, NYMEX WTI &
 * natural gas, ICE cotton) plus the standing cross-reference rule (Ethan,
 * Oct 2026): every run, each futures series is reconciled against its FRED
 * monthly benchmark (IMF/EIA/BLS) and the verdict is logged as
 * commodity-xcheck. Lumber and hay have no exchange-traded price (the CME
 * lumber contract was delisted), so they remain BLS PPI indexes and are
 * reported as index-only rather than silently unchecked. */
const SPOT_DEFS: {
  symbol: string;
  seriesId: string;
  title: string;
  units: string;
  fredId: string;
  toFred: ((v: number) => number) | null;
  label: string;
}[] = [
  { symbol: "HG=F", seriesId: "SPOT_COPPER", title: "Copper — COMEX front month", units: "Dollars per pound", fredId: "PCOPPUSDM", toFred: (v) => v * 2204.62, label: "Copper" },
  { symbol: "CL=F", seriesId: "SPOT_WTI", title: "WTI Crude Oil — NYMEX front month", units: "Dollars per barrel", fredId: "MCOILWTICO", toFred: (v) => v, label: "WTI" },
  { symbol: "NG=F", seriesId: "SPOT_NATGAS", title: "Natural Gas — NYMEX front month", units: "Dollars per MMBtu", fredId: "MHHNGSP", toFred: (v) => v, label: "NatGas" },
  { symbol: "CT=F", seriesId: "SPOT_COTTON", title: "Cotton — ICE front month", units: "Cents per pound", fredId: "WPU01220101", toFred: null, label: "Cotton" },
];

export async function ingestCommoditySpot(): Promise<number> {
  let total = 0;
  let bad = false;
  const parts: string[] = [];
  const fredObs = await getIndicatorSeries(SPOT_DEFS.map((d) => d.fredId)).catch(
    () => [] as { seriesId: string; obsDate: string; value: number | null }[]
  );
  for (const def of SPOT_DEFS) {
    let closes: { date: string; value: number }[] = [];
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(def.symbol)}?range=1y&interval=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" } }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as {
        chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] };
      };
      const r = json.chart?.result?.[0];
      const ts = r?.timestamp ?? [];
      const cl = r?.indicators?.quote?.[0]?.close ?? [];
      closes = ts
        .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), value: cl[i] ?? NaN }))
        .filter((x) => Number.isFinite(x.value));
    } catch {
      bad = true;
      parts.push(`${def.label}: futures fetch FAILED`);
      continue;
    }
    if (closes.length === 0) {
      bad = true;
      parts.push(`${def.label}: no futures data`);
      continue;
    }
    total += await upsertIndicatorObs(
      closes.map((c) => ({
        source: "yahoo" as MiIndicatorSource,
        seriesId: def.seriesId,
        title: def.title,
        units: def.units,
        frequency: "Daily",
        obsDate: c.date,
        value: Math.round(c.value * 10000) / 10000,
      }))
    );
    // Reconcile against the FRED monthly benchmark.
    const fred = fredObs
      .filter((o) => o.seriesId === def.fredId && o.value !== null)
      .sort((a, b) => a.obsDate.localeCompare(b.obsDate));
    const fLast = fred[fred.length - 1];
    if (!fLast || !fLast.value) {
      parts.push(`${def.label}: no FRED benchmark stored`);
      continue;
    }
    const month = fLast.obsDate.slice(0, 7);
    const inMonth = closes.filter((c) => c.date.startsWith(month));
    const conv = def.toFred;
    if (conv) {
      if (inMonth.length < 5) {
        parts.push(`${def.label}: insufficient ${month} futures days to cross-check`);
        continue;
      }
      const avg = inMonth.reduce((s, c) => s + conv(c.value), 0) / inMonth.length;
      const diff = ((avg - fLast.value) / fLast.value) * 100;
      const ok = Math.abs(diff) <= 8;
      if (!ok) bad = true;
      parts.push(`${def.label} ${ok ? "OK" : "MISMATCH"} (futures ${month} avg vs FRED ${diff >= 0 ? "+" : ""}${diff.toFixed(1)}%)`);
    } else {
      // Cotton's FRED benchmark is a PPI index (levels aren't prices), so the
      // reconciliation is directional: month-over-month moves must agree.
      const fPrev = fred[fred.length - 2];
      const prevMonth = fPrev ? fPrev.obsDate.slice(0, 7) : "";
      const inPrev = closes.filter((c) => c.date.startsWith(prevMonth));
      if (!fPrev || !fPrev.value || inMonth.length < 5 || inPrev.length < 5) {
        parts.push(`${def.label}: directional check n/a`);
        continue;
      }
      const ppiChg = ((fLast.value - fPrev.value) / fPrev.value) * 100;
      const futAvg = inMonth.reduce((s, c) => s + c.value, 0) / inMonth.length;
      const futPrevAvg = inPrev.reduce((s, c) => s + c.value, 0) / inPrev.length;
      const futChg = (futAvg / futPrevAvg - 1) * 100;
      const ok = Math.sign(ppiChg) === Math.sign(futChg) || Math.abs(ppiChg - futChg) <= 6;
      if (!ok) bad = true;
      parts.push(`${def.label} ${ok ? "OK" : "CHECK"} (PPI ${ppiChg >= 0 ? "+" : ""}${ppiChg.toFixed(1)}% vs futures ${futChg >= 0 ? "+" : ""}${futChg.toFixed(1)}% MoM)`);
    }
  }
  parts.push("Lumber/Hay: PPI index-only (no exchange benchmark exists)");
  await logSync("commodity-xcheck", bad ? "error" : "ok", total, parts.join(" · "));
  await logSync("commodity_spot", "ok", total, "Yahoo futures: copper/WTI/natgas/cotton daily spot, 1y window");
  return total;
}

/** Business size profiles (Ethan, Oct 2026): how many Arizona companies in
 * each focus industry sit in the $5–20M revenue / $500K–$2M EBITDA target
 * bands vs smaller and bigger firms. Sources, cross-referenced every run:
 *  - Census SUSB (state file): AZ firm/establishment/employment/receipts
 *    totals by sector (actuals).
 *  - Census SUSB (US 6-digit receipts-size file): the receipts-class
 *    distribution per industry, applied to the AZ totals (modeled split —
 *    SUSB publishes receipts size nationally, not by state).
 *  - BLS QCEW (independent agency, UI records): AZ establishment counts by
 *    sector, stored alongside CBP so the three sources can be reconciled in
 *    the sector-xcheck log line every run. */
const SUSB_SECTORS: { naics: string; slug: string; name: string }[] = [
  { naics: "--", slug: "TOTAL", name: "All sectors" },
  { naics: "23", slug: "23", name: "Construction" },
  { naics: "31-33", slug: "3133", name: "Manufacturing" },
  { naics: "62", slug: "62", name: "Health Care & Social Assistance" },
];

/** Curated sub-sectors for the per-industry profile breakouts (Ethan,
 * Oct 2026). AZ bases come from CBP at these exact NAICS levels; the
 * revenue mix comes from the SUSB US receipts-size file (6-digit rows,
 * prefix-aggregated for the 4-digit codes). Mirrored on the client in
 * components/SizeProfileRows.tsx (SUBSECTORS_BY_PARENT). */
const SUSB_SUBSECTORS: { parent: string; naics: string; name: string }[] = [
  { parent: "3364", naics: "336411", name: "Aircraft Manufacturing" },
  { parent: "3364", naics: "336412", name: "Aircraft Engines & Engine Parts" },
  { parent: "3364", naics: "336413", name: "Other Aircraft Parts & Equipment" },
  { parent: "3364", naics: "336414", name: "Guided Missiles & Space Vehicles" },
  { parent: "3364", naics: "336415", name: "Missile & Space Propulsion Units/Parts" },
  { parent: "3364", naics: "336419", name: "Other Missile & Space Vehicle Parts" },
  { parent: "62", naics: "6211", name: "Offices of Physicians" },
  { parent: "62", naics: "6212", name: "Offices of Dentists" },
  { parent: "62", naics: "6213", name: "Other Health Practitioners" },
  { parent: "62", naics: "6214", name: "Outpatient Care Centers" },
  { parent: "62", naics: "6215", name: "Medical Laboratories & Imaging" },
  { parent: "62", naics: "6216", name: "Home Health Care Services" },
  { parent: "62", naics: "6221", name: "General Medical & Surgical Hospitals" },
  { parent: "62", naics: "6222", name: "Psychiatric & Substance Abuse Hospitals" },
  { parent: "62", naics: "6223", name: "Specialty Hospitals" },
  { parent: "62", naics: "6231", name: "Nursing Care Facilities" },
  { parent: "62", naics: "6233", name: "Continuing Care & Assisted Living" },
  { parent: "62", naics: "6244", name: "Child Care Services" },
  { parent: "3133", naics: "334413", name: "Semiconductor & Circuit Manufacturing" },
  { parent: "3133", naics: "334418", name: "Printed Circuit Assembly" },
  { parent: "3133", naics: "334511", name: "Navigation & Guidance Instruments" },
  { parent: "3133", naics: "333242", name: "Semiconductor Machinery Manufacturing" },
  { parent: "3133", naics: "332710", name: "Machine Shops" },
  { parent: "3133", naics: "332999", name: "Misc. Fabricated Metal Products" },
  { parent: "3133", naics: "339112", name: "Surgical & Medical Instruments" },
  { parent: "3133", naics: "333511", name: "Industrial Mold Manufacturing" },
  { parent: "3133", naics: "335929", name: "Other Communication & Energy Wire/Cable" },
  { parent: "3133", naics: "326199", name: "Other Plastics Products" },
  { parent: "23", naics: "236115", name: "New Single-Family Housing Construction" },
  { parent: "23", naics: "236220", name: "Commercial & Institutional Building Construction" },
  { parent: "23", naics: "237110", name: "Water, Sewer & Pipeline Construction" },
  { parent: "23", naics: "237310", name: "Highway, Street & Bridge Construction" },
  { parent: "23", naics: "237990", name: "Other Heavy & Civil Engineering Construction" },
  { parent: "23", naics: "238110", name: "Poured Concrete Contractors" },
  { parent: "23", naics: "238210", name: "Electrical Contractors" },
  { parent: "23", naics: "238220", name: "Plumbing & HVAC Contractors" },
  { parent: "23", naics: "238310", name: "Drywall & Insulation Contractors" },
  { parent: "23", naics: "238320", name: "Painting & Wall Covering Contractors" },
  { parent: "23", naics: "238910", name: "Site Preparation Contractors" },
];
const SUSB_SUB_NAICS = new Set(SUSB_SUBSECTORS.map((s) => s.naics));
/** Receipts-class edges in $K; class i (SUSB class i+2) spans [edges[i], edges[i+1]). */
const SUSB_CLASS_EDGES_K = [0, 100, 500, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 25000, 30000, 35000, 40000, 50000, 75000, 100000];

async function fetchSusbWorkbook(year: number, file: string): Promise<XLSX.WorkBook | null> {
  try {
    const res = await fetch(`https://www2.census.gov/programs-surveys/susb/tables/${year}/${file}_${year}.xlsx`);
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return XLSX.read(buf, { type: "array" });
  } catch {
    return null;
  }
}

function susbSheetRows(wb: XLSX.WorkBook, match: string): unknown[][] {
  const name = wb.SheetNames.find((n) => n.toLowerCase().includes(match)) ?? wb.SheetNames[0];
  return XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true }) as unknown[][];
}

function susbSectorKey(naics: string): string | null {
  if (!/^\d{6}$/.test(naics)) return null;
  if (naics.startsWith("3364")) return "3364";
  if (naics.startsWith("23")) return "23";
  if (/^(31|32|33)/.test(naics)) return "3133";
  if (naics.startsWith("62")) return "62";
  return null;
}

export async function ingestSusbSizes(): Promise<number> {
  // SUSB vintages lag ~3 years; try the newest plausible year first.
  const thisYear = new Date().getFullYear();
  let year = 0;
  let det: XLSX.WorkBook | null = null;
  let rcpt: XLSX.WorkBook | null = null;
  for (const y of [thisYear - 3, thisYear - 4, thisYear - 5]) {
    det = await fetchSusbWorkbook(y, "us_state_naics_detailedsizes");
    if (!det) continue;
    rcpt = await fetchSusbWorkbook(y, "us_6digitnaics_rcptsize");
    if (rcpt) {
      year = y;
      break;
    }
    det = null;
  }
  if (!det || !rcpt || !year) {
    await logSync("susb_sizes", "error", 0, "SUSB workbooks not found for any recent vintage");
    return 0;
  }
  const obsDate = `${year}-01-01`;
  const rows: IndicatorInput[] = [];
  const push = (seriesId: string, title: string, units: string, value: number | null, source: MiIndicatorSource = "census") => {
    if (value === null || !Number.isFinite(value)) return;
    rows.push({ source, seriesId, title, units, frequency: "Annual", obsDate, value: Math.round(value) });
  };

  // --- AZ actuals from the state detailed-sizes file ---
  const detRows = susbSheetRows(det, "detailed");
  const hdrIdx = detRows.findIndex((r) => String(r[0]) === "State");
  const azTotals = new Map<string, { firms: number; estab: number; emp: number; rcptK: number }>();
  if (hdrIdx >= 0) {
    for (const r of detRows.slice(hdrIdx + 1)) {
      if (String(r[0]) !== "04" || String(r[4]) !== "01: Total") continue;
      const sec = SUSB_SECTORS.find((s) => s.naics === String(r[2]));
      if (!sec) continue;
      azTotals.set(sec.slug, {
        firms: Number(r[5]) || 0,
        estab: Number(r[6]) || 0,
        emp: Number(r[7]) || 0,
        rcptK: Number(r[11]) || 0,
      });
    }
  }
  for (const sec of SUSB_SECTORS) {
    const t = azTotals.get(sec.slug);
    if (!t) continue;
    push(`SUSB_AZ_${sec.slug}_FIRMS`, `SUSB — AZ ${sec.name} firms`, "Firms", t.firms);
    push(`SUSB_AZ_${sec.slug}_ESTAB`, `SUSB — AZ ${sec.name} establishments`, "Establishments", t.estab);
    push(`SUSB_AZ_${sec.slug}_EMP`, `SUSB — AZ ${sec.name} employment`, "Employees", t.emp);
    push(`SUSB_AZ_${sec.slug}_RCPT`, `SUSB — AZ ${sec.name} receipts`, "Dollars", t.rcptK * 1000);
  }

  // --- US receipts-class distribution per industry (6-digit file) ---
  const rcptRows = susbSheetRows(rcpt, "6-digit");
  const rHdr = rcptRows.findIndex((r) => String(r[0]) === "NAICS");
  const classFirms = new Map<string, Map<number, number>>();
  if (rHdr >= 0) {
    for (const r of rcptRows.slice(rHdr + 1)) {
      const key = susbSectorKey(String(r[0]));
      if (!key) continue;
      const clsLabel = String(r[2]);
      const clsNum = Number(clsLabel.slice(0, 2));
      if (!Number.isFinite(clsNum) || clsNum < 2 || clsNum > 18) continue;
      if (!classFirms.has(key)) classFirms.set(key, new Map());
      const m = classFirms.get(key)!;
      m.set(clsNum, (m.get(clsNum) ?? 0) + (Number(r[3]) || 0));
    }
  }
  const modeledBase = new Map<string, number>();
  for (const sec of SUSB_SECTORS) {
    const t = azTotals.get(sec.slug);
    if (t && t.firms > 0 && sec.slug !== "TOTAL") modeledBase.set(sec.slug, t.firms);
  }
  // A&D has no state-level SUSB row (sector file only): use the latest CBP
  // 3364 establishment count as the firm base — labeled as a proxy.
  const cbp3364 = await getIndicatorSeries(["CBP_AZ_SEC_3364_ESTAB", "CBP_AZ_SEC_3364_EMP"]).catch(() => []);
  const latestOf = (sid: string) => {
    const s = cbp3364.filter((o) => o.seriesId === sid && o.value !== null).sort((a, b) => a.obsDate.localeCompare(b.obsDate));
    return s.length ? s[s.length - 1].value : null;
  };
  const adBase = latestOf("CBP_AZ_SEC_3364_ESTAB");
  if (adBase) {
    modeledBase.set("3364", adBase);
    push("SUSB_AZ_3364_FIRMS", "AZ Aerospace & Defense firms (CBP establishment proxy)", "Firms", adBase);
    push("SUSB_AZ_3364_ESTAB", "AZ Aerospace & Defense establishments (CBP)", "Establishments", adBase);
    push("SUSB_AZ_3364_EMP", "AZ Aerospace & Defense employment (CBP)", "Employees", latestOf("CBP_AZ_SEC_3364_EMP"));
  }
  for (const [slug, base] of Array.from(modeledBase.entries())) {
    const dist = classFirms.get(slug);
    if (!dist) continue;
    const tot = Array.from(dist.values()).reduce((a, b) => a + b, 0);
    if (!tot) continue;
    for (const [clsNum, firms] of Array.from(dist.entries())) {
      const id = `SUSB_AZ_${slug}_CLS${String(clsNum).padStart(2, "0")}`;
      push(id, `SUSB modeled — AZ firms by receipts class ${clsNum}`, "Firms (modeled)", (base * firms) / tot);
    }
  }

  // --- Sub-sector breakouts: CBP AZ bases × SUSB US receipts mix ---
  const subCbp = new Map<string, { parent: string; estab: number; emp: number | null }>();
  const qcewSub = new Map<string, { estab: number; emp: number; year: number }>();
  const censusKey = process.env.CENSUS_KEY;
  if (censusKey && rHdr >= 0) {
    // US receipts-class distribution per sub-sector code.
    const subDist = new Map<string, Map<number, number>>();
    for (const r of rcptRows.slice(rHdr + 1)) {
      const naics = String(r[0]);
      if (!/^\d{6}$/.test(naics)) continue;
      const sub = SUSB_SUBSECTORS.find((s) => naics === s.naics || (s.naics.length < 6 && naics.startsWith(s.naics)));
      if (!sub) continue;
      const clsNum = Number(String(r[2]).slice(0, 2));
      if (!Number.isFinite(clsNum) || clsNum < 2 || clsNum > 18) continue;
      if (!subDist.has(sub.naics)) subDist.set(sub.naics, new Map());
      const m = subDist.get(sub.naics)!;
      m.set(clsNum, (m.get(clsNum) ?? 0) + (Number(r[3]) || 0));
    }
    // Sector EBITDA margins (stored by the Damodaran ingest, which runs
    // earlier in the daily job list) for the sub-sector EBITDA-band counts.
    const marginObs = await getIndicatorSeries(["3364", "62", "3133", "23"].map((s) => `DAMO_EBITDA_MARGIN_${s}`)).catch(() => []);
    const marginOf = (parent: string): number | null => {
      const s = marginObs.filter((o) => o.seriesId === `DAMO_EBITDA_MARGIN_${parent}` && o.value !== null).sort((a, b) => a.obsDate.localeCompare(b.obsDate));
      const v = s.length ? s[s.length - 1].value : null;
      return v !== null && v > 1 && v < 60 ? v / 100 : null;
    };
    // Latest published CBP year (probe with Construction, as sector_counts).
    const fetchCbp = async (yr: number, code: string) => {
      const res = await fetch(
        `https://api.census.gov/data/${yr}/cbp?get=NAME,ESTAB,EMP&for=state:04&NAICS2017=${encodeURIComponent(code)}&key=${censusKey}`
      );
      if (!res.ok) return null;
      const data = (await res.json()) as string[][];
      if (!Array.isArray(data) || data.length < 2) return null;
      const get = (c: string) => {
        const i = data[0].indexOf(c);
        return i >= 0 && data[1][i] ? Number(data[1][i]) : null;
      };
      return { estab: get("ESTAB"), emp: get("EMP") };
    };
    let cbpYear = 0;
    for (const y of [thisYear - 2, thisYear - 3, thisYear - 4]) {
      try {
        if (await fetchCbp(y, "23")) {
          cbpYear = y;
          break;
        }
      } catch {
        continue;
      }
    }
    if (cbpYear) {
      for (let i = 0; i < SUSB_SUBSECTORS.length; i += 8) {
        const batch = SUSB_SUBSECTORS.slice(i, i + 8);
        await Promise.all(
          batch.map(async (sub) => {
            try {
              const v = await fetchCbp(cbpYear, sub.naics);
              if (!v || !v.estab) return;
              const estabN: number = v.estab;
              subCbp.set(sub.naics, { parent: sub.parent, estab: estabN, emp: v.emp });
              rows.push({ source: "census", seriesId: `CBP_AZ_SUB_${sub.naics}_ESTAB`, title: `${sub.name} — AZ Establishments (CBP)`, units: "Establishments", frequency: "Annual", obsDate: `${cbpYear}-01-01`, value: v.estab });
              if (v.emp !== null)
                rows.push({ source: "census", seriesId: `CBP_AZ_SUB_${sub.naics}_EMP`, title: `${sub.name} — AZ Employment (CBP)`, units: "Employees", frequency: "Annual", obsDate: `${cbpYear}-01-01`, value: v.emp });
              push(`SUSB_AZ_SUB_${sub.naics}_FIRMS`, `${sub.name} — AZ firms (CBP base)`, "Firms", v.estab);
              const dist = subDist.get(sub.naics);
              if (!dist) return;
              const dTot = Array.from(dist.values()).reduce((a, b) => a + b, 0);
              if (!dTot) return;
              const counts = SUSB_CLASS_EDGES_K.map((_, ci) => ((dist.get(ci + 2) ?? 0) / dTot) * estabN);
              const bandCount = counts.slice(5, 9).reduce((a, b) => a + b, 0);
              push(`SUSB_AZ_SUB_${sub.naics}_BAND`, `${sub.name} — AZ firms in $5–20M revenue band (modeled)`, "Firms (modeled)", bandCount);
              const mg = marginOf(sub.parent);
              if (mg) {
                const revLoK = 500 / mg;
                const revHiK = 2000 / mg;
                let est = 0;
                for (let ci = 0; ci < 17; ci++) {
                  const lo = SUSB_CLASS_EDGES_K[ci];
                  const hi = ci < 16 ? SUSB_CLASS_EDGES_K[ci + 1] : lo * 10;
                  if (revHiK <= lo || revLoK >= hi) continue;
                  est += counts[ci] * Math.max(0, Math.log(Math.min(hi, revHiK) / Math.max(lo, revLoK)) / Math.log(hi / lo));
                }
                push(`SUSB_AZ_SUB_${sub.naics}_EBD`, `${sub.name} — AZ firms in $500K–$2M EBITDA band (modeled)`, "Firms (modeled)", est);
              }
            } catch {
              return;
            }
          })
        );
      }
    }
  }

  // --- BLS QCEW cross-reference (independent source) ---
  const qcew = new Map<string, { estab: number; emp: number; year: number }>();
  for (const y of [thisYear - 1, thisYear - 2]) {
    try {
      const res = await fetch(`https://data.bls.gov/cew/data/api/${y}/a/area/04000.csv`);
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) continue;
      const hdr = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
      const ix = (n: string) => hdr.indexOf(n);
      const want: Record<string, { agg: string; slug: string }> = {
        "10": { agg: "51", slug: "TOTAL" },
        "23": { agg: "54", slug: "23" },
        "31-33": { agg: "54", slug: "3133" },
        "62": { agg: "54", slug: "62" },
        "3364": { agg: "56", slug: "3364" },
      };
      for (const line of lines.slice(1)) {
        const c = parseCsvLine(line);
        if (c[ix("own_code")] !== "5") continue;
        const code = c[ix("industry_code")];
        const w = want[code];
        if (w && c[ix("agglvl_code")] === w.agg) {
          qcew.set(w.slug, {
            estab: Number(c[ix("annual_avg_estabs")]) || 0,
            emp: Number(c[ix("annual_avg_emplvl")]) || 0,
            year: y,
          });
          continue;
        }
        if (SUSB_SUB_NAICS.has(code) && !qcewSub.has(code)) {
          qcewSub.set(code, {
            estab: Number(c[ix("annual_avg_estabs")]) || 0,
            emp: Number(c[ix("annual_avg_emplvl")]) || 0,
            year: y,
          });
        }
      }
      if (qcew.size) break;
    } catch {
      continue;
    }
  }
  for (const [slug, q] of Array.from(qcew.entries())) {
    const name = slug === "TOTAL" ? "All sectors" : slug === "3364" ? "Aerospace & Defense" : (SUSB_SECTORS.find((s) => s.slug === slug)?.name ?? slug);
    rows.push({ source: "bls", seriesId: `QCEW_AZ_${slug}_ESTAB`, title: `QCEW — AZ ${name} establishments`, units: "Establishments", frequency: "Annual", obsDate: `${q.year}-01-01`, value: q.estab });
    rows.push({ source: "bls", seriesId: `QCEW_AZ_${slug}_EMP`, title: `QCEW — AZ ${name} employment`, units: "Employees", frequency: "Annual", obsDate: `${q.year}-01-01`, value: q.emp });
  }
  for (const [naics, q] of Array.from(qcewSub.entries())) {
    const sub = SUSB_SUBSECTORS.find((s) => s.naics === naics);
    rows.push({ source: "bls", seriesId: `QCEW_AZ_SUB_${naics}_ESTAB`, title: `QCEW — AZ ${sub?.name ?? naics} establishments`, units: "Establishments", frequency: "Annual", obsDate: `${q.year}-01-01`, value: q.estab });
  }

  const total = await upsertIndicatorObs(rows);

  // --- sector-xcheck: CBP vs SUSB vs QCEW establishment counts ---
  const cbpIds = ["23", "3133", "62", "3364"].map((s) => `CBP_AZ_SEC_${s}_ESTAB`);
  const cbpObs = await getIndicatorSeries(cbpIds).catch(() => []);
  const cbpLatest = (slug: string) => {
    const s = cbpObs.filter((o) => o.seriesId === `CBP_AZ_SEC_${slug}_ESTAB` && o.value !== null).sort((a, b) => a.obsDate.localeCompare(b.obsDate));
    return s.length ? { v: s[s.length - 1].value ?? 0, y: s[s.length - 1].obsDate.slice(0, 4) } : null;
  };
  const parts: string[] = [];
  let xbad = false;
  for (const slug of ["23", "3133", "62", "3364"]) {
    const cbp = cbpLatest(slug);
    const susb = azTotals.get(slug)?.estab ?? (slug === "3364" ? adBase : undefined);
    const q = qcew.get(slug);
    if (!cbp || !q) {
      xbad = true;
      parts.push(`${slug}: cross-check incomplete (missing ${!cbp ? "CBP" : "QCEW"})`);
      continue;
    }
    const dq = ((q.estab - cbp.v) / cbp.v) * 100;
    parts.push(
      `${slug}: CBP ${cbp.v.toLocaleString()} (${cbp.y}) · SUSB ${susb ? susb.toLocaleString() : "n/a"} (${year}) · QCEW ${q.estab.toLocaleString()} (${q.year}, ${dq >= 0 ? "+" : ""}${dq.toFixed(0)}% vs CBP)`
    );
  }
  // Sub-sector reconciliation: summed CBP sub-sector establishments vs the
  // same codes summed from QCEW (like-for-like), plus parent coverage.
  const coverage: string[] = [];
  for (const slug of ["23", "3133", "62", "3364"]) {
    let cbpSum = 0;
    let qSum = 0;
    for (const [naics, v] of Array.from(subCbp.entries())) {
      if (v.parent !== slug) continue;
      cbpSum += v.estab;
      qSum += qcewSub.get(naics)?.estab ?? 0;
    }
    if (!cbpSum) continue;
    const parent = cbpLatest(slug);
    if (parent) coverage.push(`${slug} ${Math.round((cbpSum / parent.v) * 100)}%`);
    if (qSum) {
      const d = ((qSum - cbpSum) / cbpSum) * 100;
      parts.push(`subs ${slug}: CBP Σ ${cbpSum.toLocaleString()} vs QCEW Σ ${qSum.toLocaleString()} (${d >= 0 ? "+" : ""}${d.toFixed(0)}%)`);
    }
  }
  parts.push("QCEW counts UI reporting units (multi-establishment employers split) — gaps vs CBP are definitional and tracked here");
  await logSync("sector-xcheck", xbad ? "error" : "ok", 0, parts.join(" · "));
  await logSync(
    "susb_sizes",
    "ok",
    total,
    `SUSB ${year} AZ size profiles + QCEW ${qcew.size ? "cross-reference" : "UNAVAILABLE"} · sub-sectors: ${subCbp.size}/${SUSB_SUBSECTORS.length} with AZ establishments${coverage.length ? ` (CBP coverage of parent: ${coverage.join(" · ")})` : ""}`
  );
  return total;
}

export type IngestSource = "indicators" | "filings" | "news" | "econ_events" | "bankruptcy_news" | "warn" | "entities" | "multiples" | "defense" | "census" | "county_permits" | "sector_counts" | "commodity_spot" | "susb_sizes" | "all";

export async function runMarketIngest(source: IngestSource): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const jobs: [IngestSource, () => Promise<number>][] = [
    ["indicators", ingestIndicators],
    ["commodity_spot", ingestCommoditySpot],
    ["filings", ingestFilings],
    ["news", ingestNews],
    ["econ_events", ingestEconomicEvents],
    ["bankruptcy_news", ingestBankruptcyNews],
    ["warn", ingestWarn],
    ["entities", ingestEntities],
    ["multiples", ingestMultiples],
    ["multiples", ingestDamodaranMultiples],
    ["defense", ingestDefenseContracts],
    ["census", ingestCensus],
    ["census", ingestCensusStateFin],
    ["county_permits", ingestCountyPermits],
    ["sector_counts", ingestSectorCounts],
    ["susb_sizes", ingestSusbSizes],
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
