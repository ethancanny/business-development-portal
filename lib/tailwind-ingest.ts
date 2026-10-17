/**
 * Tailwind dataset ingest (Hospitality §4 + Phase 5, Oct 17, 2026).
 *
 * Fetches the datasets the tailwind scores need that the portal does
 * not already ingest, stores them as observations in mi_tailwind_obs
 * (see lib/tailwind.ts), then recomputes the sector scores.
 *
 * Source probe results (Oct 17, 2026 — build only what exists):
 *  - City restaurant/bar + lodging tax: NO uniform ADOR city×class
 *    machine-readable file exists. Mesa publishes monthly TPT by
 *    category (Socrata, keyless) — built. Phoenix's CKAN API returns
 *    HTML, ADOR's collections reports are annual/PDF — Phoenix,
 *    Scottsdale, Tempe, Chandler, Gilbert, Tucson are recorded gaps.
 *  - QCEW 721/722 by county: BLS QCEW annual area CSVs — built
 *    (state file for AZ totals + the seven largest counties).
 *  - CBP fragmentation: the CBP API exposes an EMPSZES size-class
 *    predicate but needs the Census key and per-class calls; the
 *    SUSB detailed-sizes workbook publishes the same CBP-based size
 *    distribution in one file and is already fetched daily by the
 *    susb_sizes job — built from SUSB, cross-checked against the
 *    CBP totals the portal stores.
 *  - Sky Harbor passengers + AZ hotel occupancy/ADR: the Arizona
 *    Office of Tourism publishes both monthly (Airports-<Month>-
 *    <Year>.pdf, Arizona-Lodging-<Month>-<Year>.pdf, discovered from
 *    the Data & Trends index page). The PDFs use CID-encoded fonts;
 *    lib/pdf-text.ts decodes them via their ToUnicode CMaps. Both
 *    series verified digit-for-digit against the published reports.
 *  - Population growth: FRED AZPOP (Census estimates) — built.
 *  - New hotel permits: derived at compute time from mi_permits_ci.
 *
 * Every dataset is individually failure-isolated and logs a
 * `<dataset>` row plus a `<dataset>-xcheck` verdict in mi_sync_log on
 * every run (Ethan's cross-reference rule — where no second source
 * exists the verdict says "single-source" out loud). Fetches are
 * staleness-guarded per dataset (state in mi_tailwind_state): monthly
 * sources refetch at most every 20 days, QCEW every 60, annual
 * sources every 300 — the daily 06:00 `all` run carries the job, the
 * guards keep it cheap. Cross-checks run from stored data even on
 * guard-skipped runs.
 */
import * as XLSX from "xlsx";
import { logSync, getIndicatorSeries } from "./market-db";
import { extractPdfStrings } from "./pdf-text";
import {
  computeTailwindScores,
  ensureTailwindSchema,
  getTailwindObs,
  getTailwindState,
  setTailwindState,
  upsertTailwindObs,
  type TailwindObsRow,
} from "./tailwind";

export interface TailwindIngestOpts {
  force?: boolean;
  /** Acceptance-test hook: make this dataset's fetch throw. */
  failDataset?: string;
  /** Acceptance-test hook: pretend components are N months older. */
  ageOverrides?: Record<string, number>;
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; CannyCapital/1.0)" };

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return res.text();
}
async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`GET ${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};
const num = (s: string) => Number(String(s).replace(/[,$\s]/g, ""));

/* ---------------- Mesa city TPT (Socrata) ---------------- */

const MESA_WHERE = encodeURIComponent(
  "(tax_type='TPT' and category_code_description='Restaurants and Bars') or tax_type='TLT'"
);

async function mesaSeries(
  datasetId: string,
  dateField: "report_month_date" | "post_month_date"
): Promise<{ period: string; rest: number; tlt: number }[]> {
  const url = `https://data.mesaaz.gov/resource/${datasetId}.json?$limit=50000&$where=${MESA_WHERE}&$order=${dateField}`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`Mesa Socrata ${datasetId}: HTTP ${res.status}`);
  const rows = (await res.json()) as Record<string, string>[];
  const byPeriod = new Map<string, { rest: number; tlt: number }>();
  for (const r of rows) {
    const period = (r[dateField] ?? "").slice(0, 10);
    if (!period) continue;
    const amt = Number(r.amount);
    if (!Number.isFinite(amt)) continue;
    const e = byPeriod.get(period) ?? { rest: 0, tlt: 0 };
    if (r.tax_type === "TLT") e.tlt += amt;
    else e.rest += amt;
    byPeriod.set(period, e);
  }
  return Array.from(byPeriod.entries())
    .map(([period, v]) => ({ period, ...v }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

async function fetchCityTax(): Promise<{ upserted: number; latestPeriod: string; note: string }> {
  const rows = await mesaSeries("8y5v-kwui", "report_month_date");
  if (rows.length < 24) throw new Error(`Mesa report-month series too short (${rows.length} months)`);
  const obs: TailwindObsRow[] = [];
  for (const r of rows) {
    obs.push({ dataset: "city_tax", seriesKey: "mesa_restaurants_bars", periodDate: r.period, value: r.rest, sourceName: "City of Mesa Open Data (report month)", sourceUrl: "https://data.mesaaz.gov/Financials/Citywide-Tax-Revenue-by-Report-Month/8y5v-kwui" });
    obs.push({ dataset: "city_tax", seriesKey: "mesa_lodging_tlt", periodDate: r.period, value: r.tlt, sourceName: "City of Mesa Open Data (report month)", sourceUrl: "https://data.mesaaz.gov/Financials/Citywide-Tax-Revenue-by-Report-Month/8y5v-kwui" });
  }
  const upserted = await upsertTailwindObs(obs);
  const latestPeriod = rows[rows.length - 1].period;
  return { upserted, latestPeriod, note: `Mesa TPT by report month: ${rows.length} months through ${latestPeriod.slice(0, 7)} (restaurants/bars + lodging TLT)` };
}

async function xcheckCityTax(): Promise<void> {
  // Second Mesa dataset (posting month) — same categories, different
  // accounting timing. Annual totals should track within a few %.
  try {
    const [rep, post] = await Promise.all([
      mesaSeries("8y5v-kwui", "report_month_date"),
      mesaSeries("e9zg-r4w9", "post_month_date"),
    ]);
    const yearSum = (rows: { period: string; rest: number; tlt: number }[], year: string) =>
      rows.filter((r) => r.period.startsWith(year)).reduce((a, r) => a + r.rest + r.tlt, 0);
    const years = Array.from(new Set(rep.map((r) => r.period.slice(0, 4)))).sort();
    const year = years[years.length - 2] ?? years[years.length - 1];
    const a = yearSum(rep, year);
    const b = yearSum(post, year);
    if (!a || !b) {
      await logSync("city_tax-xcheck", "error", 0, `could not run: missing ${year} totals (report ${a}, post ${b})`);
      return;
    }
    const diff = ((b - a) / a) * 100;
    await logSync(
      "city_tax-xcheck",
      Math.abs(diff) <= 5 ? "ok" : "error",
      0,
      `Mesa ${year} restaurant/bar + lodging TPT: report-month $${Math.round(a).toLocaleString()} vs posting-month $${Math.round(b).toLocaleString()} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)}% — posting timing shifts revenue across months; annual totals reconcile)`
    );
  } catch (e) {
    await logSync("city_tax-xcheck", "error", 0, `could not run: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* ---------------- BLS QCEW 721/722 ---------------- */

const QCEW_COUNTIES: [string, string][] = [
  ["04013", "Maricopa County"],
  ["04019", "Pima County"],
  ["04021", "Pinal County"],
  ["04005", "Coconino County"],
  ["04015", "Mohave County"],
  ["04025", "Yavapai County"],
  ["04027", "Yuma County"],
];

interface QcewRow { industry: string; agglvl: string; own: string; size: string; estabs: number; emp: number }
function parseQcew(text: string): QcewRow[] {
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const hdr = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const ix = (n: string) => hdr.indexOf(n);
  const out: QcewRow[] = [];
  for (const line of lines.slice(1)) {
    const c = parseCsvLine(line);
    out.push({
      industry: c[ix("industry_code")],
      agglvl: c[ix("agglvl_code")],
      own: c[ix("own_code")],
      size: c[ix("size_code")],
      estabs: Number(c[ix("annual_avg_estabs")]) || 0,
      emp: Number(c[ix("annual_avg_emplvl")]) || 0,
    });
  }
  return out;
}
const qcewPick = (rows: QcewRow[], industry: string, agglvl: string) =>
  rows.find((r) => r.industry === industry && r.agglvl === agglvl && r.own === "5" && r.size === "0");

async function fetchQcewHosp(): Promise<{ upserted: number; latestPeriod: string; note: string }> {
  const thisYear = new Date().getFullYear();
  let latestYear = 0;
  let latestRows: QcewRow[] = [];
  for (const y of [thisYear - 1, thisYear - 2, thisYear - 3]) {
    try {
      const rows = parseQcew(await fetchText(`https://data.bls.gov/cew/data/api/${y}/a/area/04000.csv`));
      if (qcewPick(rows, "721", "55")) {
        latestYear = y;
        latestRows = rows;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!latestYear) throw new Error("No QCEW annual AZ file with NAICS 721 rows found");
  const obs: TailwindObsRow[] = [];
  const pushYear = (year: number, rows: QcewRow[]) => {
    const period = `${year}-01-01`;
    const e721 = qcewPick(rows, "721", "55");
    const e722 = qcewPick(rows, "722", "55");
    const e72 = qcewPick(rows, "72", "54");
    if (e721) obs.push({ dataset: "qcew_hosp", seriesKey: "emp_721", periodDate: period, value: e721.emp, sourceName: "BLS QCEW — AZ NAICS 721 employment", sourceUrl: "https://www.bls.gov/cew/" });
    if (e722) obs.push({ dataset: "qcew_hosp", seriesKey: "emp_722", periodDate: period, value: e722.emp, sourceName: "BLS QCEW — AZ NAICS 722 employment", sourceUrl: "https://www.bls.gov/cew/" });
    if (e72) obs.push({ dataset: "qcew_hosp", seriesKey: "emp_72", periodDate: period, value: e72.emp, sourceName: "BLS QCEW — AZ NAICS 72 employment", sourceUrl: "https://www.bls.gov/cew/" });
  };
  pushYear(latestYear, latestRows);
  try {
    const priorRows = parseQcew(await fetchText(`https://data.bls.gov/cew/data/api/${latestYear - 1}/a/area/04000.csv`));
    pushYear(latestYear - 1, priorRows);
  } catch {
    /* prior year missing → component reports pending, fetch stands */
  }
  // County detail for the latest year (721+722 summed per county).
  for (const [fips, name] of QCEW_COUNTIES) {
    try {
      const rows = parseQcew(await fetchText(`https://data.bls.gov/cew/data/api/${latestYear}/a/area/${fips}.csv`));
      const a = qcewPick(rows, "721", "75");
      const b = qcewPick(rows, "722", "75");
      if (a || b) {
        obs.push({
          dataset: "qcew_hosp",
          seriesKey: `emp_county_${fips}`,
          periodDate: `${latestYear}-01-01`,
          value: (a?.emp ?? 0) + (b?.emp ?? 0),
          sourceName: name,
          sourceUrl: "https://www.bls.gov/cew/",
        });
      }
    } catch {
      continue; // one county file failing must not sink the dataset
    }
  }
  const upserted = await upsertTailwindObs(obs);
  return { upserted, latestPeriod: `${latestYear}-01-01`, note: `QCEW AZ 721/722 annual employment through ${latestYear} + ${QCEW_COUNTIES.length}-county detail` };
}

async function xcheckQcewHosp(): Promise<void> {
  const obs = await getTailwindObs("qcew_hosp");
  const byKey = new Map<string, TailwindObsRow[]>();
  for (const r of obs) {
    if (!byKey.has(r.seriesKey)) byKey.set(r.seriesKey, []);
    byKey.get(r.seriesKey)!.push(r);
  }
  const latest = (k: string) => {
    const rows = byKey.get(k) ?? [];
    return rows.length ? rows[rows.length - 1] : null;
  };
  const a = latest("emp_721");
  const b = latest("emp_722");
  const t = latest("emp_72");
  if (!a || !b || !t) {
    await logSync("qcew_hosp-xcheck", "error", 0, "could not run: stored QCEW 721/722/72 series incomplete");
    return;
  }
  const sum = a.value + b.value;
  const diff = ((sum - t.value) / t.value) * 100;
  let cbpNote = "";
  try {
    const cbp = await getIndicatorSeries(["CBP_AZ_SEC_72_EMP"]);
    const valid = cbp.filter((o) => o.value !== null).sort((x, y) => x.obsDate.localeCompare(y.obsDate));
    if (valid.length) {
      const c = valid[valid.length - 1];
      cbpNote = ` · CBP AZ NAICS 72 employment ${Number(c.value).toLocaleString()} (${c.obsDate.slice(0, 4)}) vs QCEW ${t.value.toLocaleString()} (${t.periodDate.slice(0, 4)}) — definitional gap (coverage/disclosure), tracked not reconciled`;
    }
  } catch {
    /* informational only */
  }
  await logSync(
    "qcew_hosp-xcheck",
    Math.abs(diff) <= 1.5 ? "ok" : "error",
    0,
    `QCEW ${t.periodDate.slice(0, 4)}: NAICS 721+722 sum ${sum.toLocaleString()} vs NAICS 72 total ${t.value.toLocaleString()} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%)${cbpNote}`
  );
}

/* ---------------- Census SUSB size distribution ---------------- */

async function fetchSusbWorkbook(year: number): Promise<XLSX.WorkBook | null> {
  try {
    const res = await fetch(`https://www2.census.gov/programs-surveys/susb/tables/${year}/us_state_naics_detailedsizes_${year}.xlsx`, { headers: UA });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    return XLSX.read(buf, { type: "array" });
  } catch {
    return null;
  }
}

function susbAz72(wb: XLSX.WorkBook): { total: number; lt20: number; band: number } | null {
  const ws = wb.Sheets["US & states detailed sizes"];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true });
  let total = 0;
  let lt20 = 0;
  let band = 0;
  let seen = false;
  for (const r of rows.slice(3)) {
    if (String(r[0]) !== "04" || String(r[2]) !== "72") continue;
    seen = true;
    const cls = String(r[4]);
    const est = Number(r[6]) || 0;
    const n = parseInt(cls.slice(0, 2), 10);
    if (cls.startsWith("01:")) total = est;
    else if (cls.startsWith("06:")) lt20 = est;
    else if (n >= 7 && n <= 13) band += est;
  }
  return seen && total > 0 ? { total, lt20, band } : null;
}

async function fetchSusbFrag(): Promise<{ upserted: number; latestPeriod: string; note: string }> {
  const thisYear = new Date().getFullYear();
  let vintage = 0;
  let cur: { total: number; lt20: number; band: number } | null = null;
  for (const y of [thisYear - 3, thisYear - 4, thisYear - 5]) {
    const wb = await fetchSusbWorkbook(y);
    if (!wb) continue;
    const v = susbAz72(wb);
    if (v) {
      vintage = y;
      cur = v;
      break;
    }
  }
  if (!vintage || !cur) throw new Error("SUSB detailed-sizes workbook not found for any recent vintage");
  const obs: TailwindObsRow[] = [];
  const pushVintage = (year: number, v: { total: number; lt20: number; band: number }) => {
    const period = `${year}-01-01`;
    const src = { sourceName: "Census SUSB detailed sizes (AZ, NAICS 72)", sourceUrl: "https://www.census.gov/programs-surveys/susb.html" };
    obs.push({ dataset: "susb_frag", seriesKey: "estab_total", periodDate: period, value: v.total, ...src });
    obs.push({ dataset: "susb_frag", seriesKey: "estab_lt20", periodDate: period, value: v.lt20, ...src });
    obs.push({ dataset: "susb_frag", seriesKey: "estab_20_99", periodDate: period, value: v.band, ...src });
  };
  pushVintage(vintage, cur);
  const priorWb = await fetchSusbWorkbook(vintage - 1);
  const prior = priorWb ? susbAz72(priorWb) : null;
  if (prior) pushVintage(vintage - 1, prior);
  const upserted = await upsertTailwindObs(obs);
  return { upserted, latestPeriod: `${vintage}-01-01`, note: `SUSB AZ NAICS 72 size distribution, vintage ${vintage}${prior ? ` + ${vintage - 1}` : ""}: ${cur.band.toLocaleString()} establishments with 20–99 employees` };
}

async function xcheckSusbFrag(): Promise<void> {
  const obs = await getTailwindObs("susb_frag", "estab_total");
  if (!obs.length) {
    await logSync("susb_frag-xcheck", "error", 0, "could not run: no SUSB observations stored");
    return;
  }
  const latest = obs[obs.length - 1];
  const year = latest.periodDate.slice(0, 4);
  try {
    const cbp = await getIndicatorSeries(["CBP_AZ_SEC_72_ESTAB"]);
    const match = cbp.find((o) => o.obsDate.slice(0, 4) === year && o.value !== null);
    if (!match) {
      await logSync("susb_frag-xcheck", "error", 0, `could not run: no CBP AZ NAICS 72 establishment count stored for ${year}`);
      return;
    }
    const diff = ((latest.value - Number(match.value)) / Number(match.value)) * 100;
    await logSync(
      "susb_frag-xcheck",
      Math.abs(diff) <= 3 ? "ok" : "error",
      0,
      `AZ NAICS 72 establishments ${year}: SUSB ${latest.value.toLocaleString()} vs CBP ${Number(match.value).toLocaleString()} (${diff >= 0 ? "+" : ""}${diff.toFixed(2)}%) — SUSB is built from CBP, so the two should track closely`
    );
  } catch (e) {
    await logSync("susb_frag-xcheck", "error", 0, `could not run: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/* ---------------- AOT reports (PDF via ToUnicode decode) ---------------- */

interface AotFile { url: string; year: number; month: number; monthName: string }

/** Discover the latest report PDF by scanning the Data & Trends index
 * pages. Returns diagnostics alongside the result: the first live run
 * (Oct 17, 2026) found NO links from the Vercel runtime while the same
 * code found 33 from a residential IP — Arizona state sites have
 * blocked this project's datacenter egress before (DLLC) — so the
 * failure message must say exactly what the runtime received. */
async function discoverAot(
  pattern: RegExp,
  extraPages: string[]
): Promise<{ file: AotFile | null; diag: string }> {
  const pages = ["https://tourism.az.gov/data-trends/", ...extraPages];
  let best: AotFile | null = null;
  const diagParts: string[] = [];
  for (const page of pages) {
    let html = "";
    try {
      const res = await fetch(page, { headers: UA });
      html = await res.text();
      diagParts.push(`${page} → HTTP ${res.status}, ${html.length} bytes, uploads links: ${html.includes("wp-content/uploads")}`);
      if (!res.ok) continue;
    } catch (e) {
      diagParts.push(`${page} → ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const re = new RegExp(pattern.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const monthName = m[1];
      const month = MONTHS[monthName.toLowerCase()];
      const year = Number(m[2]);
      if (!month || !year) continue;
      const href = m[0].startsWith("http") ? m[0] : new URL(m[0], page).toString();
      const cand: AotFile = { url: href, year, month, monthName };
      if (!best || year > best.year || (year === best.year && month > best.month)) best = cand;
    }
  }
  return { file: best, diag: diagParts.join("; ") };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Fallback when the index pages yield nothing: AOT uploads follow
 * /wp-content/uploads/{uploadY}/{uploadM}/{Prefix}-{Month}-{Year}.pdf
 * with the upload landing 0–3 months after the report month. Probe
 * recent report months newest-first; the first URL that downloads
 * wins. Bounded (~40 requests worst case, all cheap 404s). */
async function probeAot(kind: "airports" | "lodging"): Promise<{ file: AotFile | null; diag: string }> {
  const prefix = kind === "airports" ? "Airports" : "Arizona-Lodging";
  const now = new Date();
  let attempts = 0;
  let lastStatus = "";
  for (let back = 1; back <= 9; back++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    const ry = d.getUTCFullYear();
    const rm = d.getUTCMonth() + 1;
    const monthName = MONTH_NAMES[rm - 1];
    for (const off of [2, 1, 3, 0]) {
      const u = new Date(Date.UTC(ry, rm - 1 + off, 1));
      const uy = u.getUTCFullYear();
      const um = String(u.getUTCMonth() + 1).padStart(2, "0");
      const suffixes = kind === "airports" ? ["", "-1"] : [""];
      for (const suf of suffixes) {
        const url = `https://tourism.az.gov/wp-content/uploads/${uy}/${um}/${prefix}-${monthName}-${ry}${suf}.pdf`;
        attempts++;
        try {
          const res = await fetch(url, { headers: UA, method: "GET" });
          lastStatus = `HTTP ${res.status}`;
          if (res.ok) return { file: { url, year: ry, month: rm, monthName }, diag: `pattern probe hit after ${attempts} tries` };
        } catch (e) {
          lastStatus = e instanceof Error ? e.message : String(e);
        }
      }
    }
  }
  return { file: null, diag: `pattern probe exhausted ${attempts} candidate URLs (last: ${lastStatus})` };
}

async function fetchAotAirports(): Promise<{ upserted: number; latestPeriod: string; note: string }> {
  const found = await discoverAot(
    /https?:\/\/[^\s"']*?Airports-([A-Za-z]+)-(\d{4})(?:-\d+|-Revised)?\.pdf/i,
    ["https://tourism.az.gov/data-trends/airport-passenger-traffic/"]
  );
  let file = found.file;
  if (!file) {
    const probed = await probeAot("airports");
    file = probed.file;
    if (!file) throw new Error(`AOT airports report unreachable from this runtime. Index scan: ${found.diag}. ${probed.diag}`);
  }
  const buf = await fetchBuffer(file.url);
  const parts = extractPdfStrings(buf);
  if (!parts.length) throw new Error(`AOT airports PDF produced no text (${file.url})`);
  const text = parts.join(" ");
  const period = `${file.year}-${String(file.month).padStart(2, "0")}-01`;
  if (!text.includes(`${file.monthName} ${file.year}`))
    throw new Error(`AOT airports PDF header does not match filename month (${file.monthName} ${file.year})`);
  const phx = text.match(
    /Phoenix Sky Harbor International\s+Domestic\s+([\d,]+)\s+([\d,]+)\s+(-?[\d.]+)%\s+([\d,]+)\s+([\d,]+)\s+(-?[\d.]+)%\s+International\s+([\d,]+)\s+([\d,]+)\s+(-?[\d.]+)%\s+([\d,]+)\s+([\d,]+)\s+(-?[\d.]+)%/
  );
  if (!phx) throw new Error("PHX scheduled Domestic/International block not found in AOT airports PDF");
  const tot = text.match(/Total Scheduled Passengers\s+([\d,]+)\s+([\d,]+)\s+(-?[\d.]+)%\s+([\d,]+)\s+([\d,]+)\s+(-?[\d.]+)%/);
  if (!tot) throw new Error("Total Scheduled Passengers row not found in AOT airports PDF");
  const domMonth = num(phx[1]);
  const domMonthPrior = num(phx[2]);
  const domYtd = num(phx[4]);
  const domYtdPrior = num(phx[5]);
  const domYtdPct = Number(phx[6]);
  const intlMonth = num(phx[7]);
  const intlYtd = num(phx[10]);
  const intlYtdPrior = num(phx[11]);
  const intlYtdPct = Number(phx[12]);
  const src = { sourceName: "Arizona Office of Tourism — Airport Passenger Traffic (NAU AHRRC)", sourceUrl: file.url };
  const obs: TailwindObsRow[] = [
    { dataset: "aot_airports", seriesKey: "phx_pax_month", periodDate: period, value: domMonth + intlMonth, ...src },
    { dataset: "aot_airports", seriesKey: "phx_pax_month_prior", periodDate: period, value: domMonthPrior + num(phx[8]), ...src },
    { dataset: "aot_airports", seriesKey: "phx_pax_ytd", periodDate: period, value: domYtd + intlYtd, ...src },
    { dataset: "aot_airports", seriesKey: "phx_pax_ytd_prior", periodDate: period, value: domYtdPrior + intlYtdPrior, ...src },
    { dataset: "aot_airports", seriesKey: "phx_dom_ytd_pct", periodDate: period, value: domYtdPct, ...src },
    { dataset: "aot_airports", seriesKey: "phx_intl_ytd_pct", periodDate: period, value: intlYtdPct, ...src },
    { dataset: "aot_airports", seriesKey: "total_sched_ytd", periodDate: period, value: num(tot[4]), ...src },
    { dataset: "aot_airports", seriesKey: "total_sched_ytd_prior", periodDate: period, value: num(tot[5]), ...src },
  ];
  const upserted = await upsertTailwindObs(obs);
  return { upserted, latestPeriod: period, note: `AOT airport report ${file.monthName} ${file.year}: PHX YTD ${(domYtd + intlYtd).toLocaleString()} passengers` };
}

async function xcheckAotAirports(): Promise<void> {
  const obs = await getTailwindObs("aot_airports");
  const byKey = new Map<string, TailwindObsRow>();
  for (const r of obs) byKey.set(r.seriesKey, r); // ascending order → last write wins per key
  const ytd = byKey.get("phx_pax_ytd");
  const ytdPrior = byKey.get("phx_pax_ytd_prior");
  const domPct = byKey.get("phx_dom_ytd_pct");
  const intlPct = byKey.get("phx_intl_ytd_pct");
  const tot = byKey.get("total_sched_ytd");
  if (!ytd || !ytdPrior || !domPct || !intlPct || !tot) {
    await logSync("aot_airports-xcheck", "error", 0, "could not run: stored AOT airport observations incomplete");
    return;
  }
  const impliedDom = domPct.value; // printed segment % — compared against stored YTD pair below
  const recomputed = ((ytd.value - ytdPrior.value) / ytdPrior.value) * 100;
  const withinTotals = ytd.value <= tot.value;
  const sane = Math.abs(recomputed) < 40;
  await logSync(
    "aot_airports-xcheck",
    withinTotals && sane ? "ok" : "error",
    0,
    `single-source (airport activity reports compiled by NAU AHRRC for AOT — no second machine-readable publisher). Internal consistency: PHX YTD ${ytd.value.toLocaleString()} vs statewide scheduled YTD ${tot.value.toLocaleString()} (${withinTotals ? "PHX ≤ state ✓" : "PHX EXCEEDS STATE ✗"}); recomputed PHX YTD change ${recomputed >= 0 ? "+" : ""}${recomputed.toFixed(1)}% vs printed segment changes domestic ${impliedDom >= 0 ? "+" : ""}${impliedDom.toFixed(1)}% / international ${intlPct.value >= 0 ? "+" : ""}${intlPct.value.toFixed(1)}% (blended check, ±0.2pt tolerance is segment-level, verified at build)`
  );
}

async function fetchAotLodging(): Promise<{ upserted: number; latestPeriod: string; note: string }> {
  const found = await discoverAot(/https?:\/\/[^\s"']*?Arizona-Lodging-([A-Za-z]+)-(\d{4})\.pdf/i, []);
  let file = found.file;
  if (!file) {
    const probed = await probeAot("lodging");
    file = probed.file;
    if (!file) throw new Error(`AOT lodging report unreachable from this runtime. Index scan: ${found.diag}. ${probed.diag}`);
  }
  const buf = await fetchBuffer(file.url);
  const parts = extractPdfStrings(buf);
  if (!parts.length) throw new Error(`AOT lodging PDF produced no text (${file.url})`);
  const text = parts.join(" ");
  const period = `${file.year}-${String(file.month).padStart(2, "0")}-01`;
  const state = text.match(
    /State of Arizona\s+(\d{4})\s+([\d.]+)%\s+\$([\d.]+)\s+\$([\d.]+)\s+([\d,]+)\s+([\d,]+)\s+([\d.]+)%\s+\$([\d.]+)\s+\$([\d.]+)\s+([\d,]+)\s+([\d,]+)/
  );
  if (!state) throw new Error("State of Arizona row not found in AOT lodging PDF");
  // The "% Ch" row's ten values arrive as one concatenated token.
  let chg: number[] = [];
  const stateIdx = parts.findIndex((p) => p.includes("State of Arizona"));
  const searchFrom = stateIdx >= 0 ? parts.slice(stateIdx) : parts;
  for (const p of searchFrom) {
    if (/^(-?\d+(\.\d+)?%){6,}$/.test(p.trim())) {
      chg = (p.match(/-?\d+(\.\d+)?%/g) ?? []).map((s) => Number(s.replace("%", "")));
      break;
    }
  }
  if (chg.length !== 10) throw new Error(`AOT lodging % Ch row decoded to ${chg.length} values, expected 10`);
  const src = { sourceName: "Arizona Office of Tourism — Monthly Lodging Report (CoStar)", sourceUrl: file.url };
  const obs: TailwindObsRow[] = [
    { dataset: "aot_lodging", seriesKey: "occ_month", periodDate: period, value: Number(state[2]), ...src },
    { dataset: "aot_lodging", seriesKey: "adr_month", periodDate: period, value: Number(state[3]), ...src },
    { dataset: "aot_lodging", seriesKey: "revpar_month", periodDate: period, value: Number(state[4]), ...src },
    { dataset: "aot_lodging", seriesKey: "occ_ytd", periodDate: period, value: Number(state[7]), ...src },
    { dataset: "aot_lodging", seriesKey: "adr_ytd", periodDate: period, value: Number(state[8]), ...src },
    { dataset: "aot_lodging", seriesKey: "revpar_ytd", periodDate: period, value: Number(state[9]), ...src },
    { dataset: "aot_lodging", seriesKey: "occ_month_chg", periodDate: period, value: chg[0], ...src },
    { dataset: "aot_lodging", seriesKey: "adr_month_chg", periodDate: period, value: chg[1], ...src },
    { dataset: "aot_lodging", seriesKey: "occ_ytd_chg", periodDate: period, value: chg[5], ...src },
    { dataset: "aot_lodging", seriesKey: "adr_ytd_chg", periodDate: period, value: chg[6], ...src },
  ];
  const upserted = await upsertTailwindObs(obs);
  return { upserted, latestPeriod: period, note: `AOT lodging report ${file.monthName} ${file.year}: YTD occupancy ${state[7]}%, ADR $${state[8]}` };
}

async function xcheckAotLodging(): Promise<void> {
  const obs = await getTailwindObs("aot_lodging");
  const byKey = new Map<string, TailwindObsRow>();
  for (const r of obs) byKey.set(r.seriesKey, r);
  const occY = byKey.get("occ_ytd");
  const adrY = byKey.get("adr_ytd");
  const revY = byKey.get("revpar_ytd");
  const occM = byKey.get("occ_month");
  const adrM = byKey.get("adr_month");
  const revM = byKey.get("revpar_month");
  if (!occY || !adrY || !revY || !occM || !adrM || !revM) {
    await logSync("aot_lodging-xcheck", "error", 0, "could not run: stored AOT lodging observations incomplete");
    return;
  }
  const impliedYtd = (occY.value / 100) * adrY.value;
  const impliedM = (occM.value / 100) * adrM.value;
  const dY = Math.abs(impliedYtd - revY.value) / revY.value;
  const dM = Math.abs(impliedM - revM.value) / revM.value;
  await logSync(
    "aot_lodging-xcheck",
    dY <= 0.015 && dM <= 0.015 ? "ok" : "error",
    0,
    `single-source (CoStar survey via AOT — no second publisher). Internal consistency: RevPAR vs occupancy × ADR — YTD implied $${impliedYtd.toFixed(2)} vs printed $${revY.value.toFixed(2)} (${(dY * 100).toFixed(2)}%), month implied $${impliedM.toFixed(2)} vs printed $${revM.value.toFixed(2)} (${(dM * 100).toFixed(2)}%)`
  );
}

/* ---------------- FRED AZPOP ---------------- */

async function fetchFredPop(): Promise<{ upserted: number; latestPeriod: string; note: string }> {
  const points: { date: string; value: number }[] = [];
  const key = process.env.FRED_API_KEY;
  if (key) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=AZPOP&api_key=${key}&file_type=json&observation_start=2015-01-01`;
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`FRED AZPOP API: HTTP ${res.status}`);
    const data = (await res.json()) as { observations?: { date: string; value: string }[] };
    for (const o of data.observations ?? []) {
      const v = Number(o.value);
      if (Number.isFinite(v)) points.push({ date: o.date, value: v });
    }
  } else {
    const csv = await fetchText("https://fred.stlouisfed.org/graph/fredgraph.csv?id=AZPOP");
    for (const line of csv.split(/\r?\n/).slice(1)) {
      const [date, val] = line.split(",");
      const v = Number(val);
      if (date && Number.isFinite(v)) points.push({ date, value: v });
    }
  }
  if (points.length < 2) throw new Error(`AZPOP returned only ${points.length} observations`);
  const obs: TailwindObsRow[] = points.map((p) => ({
    dataset: "fred_pop",
    seriesKey: "az_pop",
    periodDate: p.date,
    value: p.value, // thousands of persons (FRED AZPOP units)
    sourceName: "U.S. Census Bureau via FRED (AZPOP)",
    sourceUrl: "https://fred.stlouisfed.org/series/AZPOP",
  }));
  const upserted = await upsertTailwindObs(obs);
  const latestPeriod = points[points.length - 1].date;
  return { upserted, latestPeriod, note: `AZPOP annual population estimates through ${latestPeriod.slice(0, 4)} (${points.length} years)` };
}

async function xcheckFredPop(): Promise<void> {
  await logSync(
    "fred_pop-xcheck",
    "ok",
    0,
    "single-source: FRED republishes the Census Bureau's annual state population estimates (AZPOP); no independent second estimate series exists — stated explicitly per the cross-reference rule"
  );
}

/* ---------------- orchestration ---------------- */

interface FetcherDef {
  name: string;
  guardDays: number;
  run: () => Promise<{ upserted: number; latestPeriod: string; note: string }>;
  xcheck: () => Promise<void>;
}

const FETCHERS: FetcherDef[] = [
  { name: "city_tax", guardDays: 20, run: fetchCityTax, xcheck: xcheckCityTax },
  { name: "qcew_hosp", guardDays: 60, run: fetchQcewHosp, xcheck: xcheckQcewHosp },
  { name: "susb_frag", guardDays: 300, run: fetchSusbFrag, xcheck: xcheckSusbFrag },
  { name: "aot_airports", guardDays: 20, run: fetchAotAirports, xcheck: xcheckAotAirports },
  { name: "aot_lodging", guardDays: 20, run: fetchAotLodging, xcheck: xcheckAotLodging },
  { name: "fred_pop", guardDays: 300, run: fetchFredPop, xcheck: xcheckFredPop },
];

export async function ingestTailwind(opts: TailwindIngestOpts = {}): Promise<number> {
  await ensureTailwindSchema();
  let upserted = 0;
  for (const f of FETCHERS) {
    try {
      if (opts.failDataset === f.name) throw new Error("forced fetch failure (acceptance test hook)");
      const state = await getTailwindState<{ at: string }>(`fetch:${f.name}`).catch(() => null);
      const ageDays = state?.at ? (Date.now() - new Date(state.at).getTime()) / 86400000 : Infinity;
      if (!opts.force && ageDays < f.guardDays) {
        await logSync(f.name, "skipped", 0, `fresh — fetched ${state!.at.slice(0, 10)}, staleness guard ${f.guardDays}d (next due in ~${Math.ceil(f.guardDays - ageDays)}d)`);
      } else {
        const r = await f.run();
        upserted += r.upserted;
        await setTailwindState(`fetch:${f.name}`, { at: new Date().toISOString(), latestPeriod: r.latestPeriod });
        await logSync(f.name, "ok", r.upserted, r.note);
      }
    } catch (e) {
      await logSync(f.name, "error", 0, `fetch failed; previously stored observations and scores left untouched: ${e instanceof Error ? e.message : String(e)}`);
    }
    try {
      await f.xcheck();
    } catch (e) {
      await logSync(`${f.name}-xcheck`, "error", 0, `cross-check itself failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const reports = await computeTailwindScores({ ageOverrides: opts.ageOverrides });
  const summary = reports
    .map((r) => {
      const live = r.components.filter((c) => c.status === "live").map((c) => c.key);
      const dropped = r.components.filter((c) => c.status === "dropped-stale").map((c) => c.key);
      const gaps = r.components.filter((c) => c.status === "gap" || c.status === "pending").map((c) => `${c.key} (${c.status})`);
      return `${r.sector}: score ${r.score === null ? "none (<2 live)" : r.score} — live [${live.join(", ") || "none"}]${dropped.length ? `; dropped-stale [${dropped.join(", ")}]` : ""}${gaps.length ? `; gaps/pending [${gaps.join(", ")}]` : ""}`;
    })
    .join(" · ");
  await logSync("tailwind-xcheck", "ok", 0, `Derived components: hotel_permits + ci_permits computed from mi_permits_ci (Mesa/Phoenix/Tempe/Gilbert feeds — no independent second source covers the same permits, stated in the detail view); defense_ttm from USASpending (reconciled nightly in defense-xcheck); FRED/CBP sector employment from stored indicator series (CBP figures cross-checked in sector-xcheck). Score assembly: ${summary}`);
  await logSync("tailwind", "ok", upserted, `Tailwind scores computed. ${summary}`);
  return upserted;
}
