/**
 * SEC EDGAR + bankruptcy-court filings ingest (Filings tab).
 * Split out of market-ingest.ts (Oct 14, 2026) — the combined file
 * outgrew the GitHub push channel's payload cap.
 *
 * Ethan's rules (Oct 14, 2026 rework): no periodic reports (10-K/10-Q);
 * 8-Ks only with material items (M&A 1.01/2.01/5.01 for the acquisition
 * category); no SPV/funding-vehicle filers; "AZ company" = Arizona
 * principal place of business (EDGAR submissions business address) AND
 * a focus-sector SIC; Form D enriched from its XML and tagged
 * (Competing capital / Operating company raise / Other); bankruptcies
 * come from the U.S. Bankruptcy Court for the District of Arizona via
 * CourtListener RECAP, not from the SEC.
 */
import {
  upsertFilings,
  purgeNonAzFilings,
  getFilerProfiles,
  upsertFilerProfile,
  sicToSector,
  isSpvFiler,
  cleanFilerName,
  getFilingsNeedingDetails,
  updateFilingDetails,
  setFilingStatus,
  retireSecBankruptcyFilings,
  logSync,
  type FilingInput,
  type FilerProfile,
} from "./market-db";
import { classifyIndustry } from "./industry-classify";

/* ---------------- SEC EDGAR ---------------- */

const EDGAR_UA = {
  "User-Agent": "CannyCapitalPortal/1.0 (ethan@cannycapitalpartners.com)",
  Accept: "application/json",
};

const EDGAR_QUERIES: { category: "acquisition" | "form_d" | "expansion"; q: string; forms: string }[] = [
  { category: "acquisition", q: '"acquisition" OR "merger" OR "acquire"', forms: "8-K" },
  { category: "form_d", q: "Arizona", forms: "D,D/A" },
  { category: "expansion", q: '"expansion" OR "new facility" OR "new headquarters"', forms: "8-K" },
];
// Bankruptcy coverage is court-sourced now (CourtListener, U.S.
// Bankruptcy Court for the District of Arizona) — see
// ingestCourtBankruptcies. Periodic reports (10-K / 10-Q) are never
// ingested: Ethan's Filings tab is event filings only (Oct 14, 2026).

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

const MA_ITEMS = ["1.01", "2.01", "5.01"];
const PROFILE_FETCH_CAP = 40;

/** Resolve EDGAR filer profiles (principal-place state + SIC + sector),
 * cached in mi_filer_profiles; fetches at most PROFILE_FETCH_CAP new
 * profiles per run from the submissions API so the ingest stays fast. */
async function resolveFilerProfiles(ciks: string[]): Promise<Map<string, FilerProfile>> {
  const unique = Array.from(new Set(ciks.filter(Boolean)));
  const profiles = await getFilerProfiles(unique);
  let fetched = 0;
  for (const cik of unique) {
    if (profiles.has(cik) || fetched >= PROFILE_FETCH_CAP) continue;
    try {
      const res = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, {
        headers: EDGAR_UA,
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as {
        name?: string;
        sic?: string;
        sicDescription?: string;
        addresses?: { business?: { stateOrCountry?: string }; mailing?: { stateOrCountry?: string } };
      };
      const prof: FilerProfile = {
        cik,
        name: j.name ?? "",
        sic: j.sic ?? "",
        sicDesc: j.sicDescription ?? "",
        bizState: (j.addresses?.business?.stateOrCountry ?? "").toUpperCase(),
        mailState: (j.addresses?.mailing?.stateOrCountry ?? "").toUpperCase(),
        sector: sicToSector(j.sic ?? ""),
      };
      await upsertFilerProfile(prof);
      profiles.set(cik, prof);
      fetched++;
      await new Promise((r) => setTimeout(r, 120));
    } catch {
      /* profile fetch failed — retried on a later run */
    }
  }
  return profiles;
}

function formdSector(group: string): string {
  const g = (group || "").toLowerCase();
  if (!g || g.includes("pooled")) return "";
  if (g.includes("health") || g.includes("pharma") || g.includes("bio") || g.includes("medical") || g.includes("hospital")) return "Healthcare";
  if (g.includes("manufactur")) return "Advanced Manufacturing";
  if (g.includes("construction")) return "Specialty Trades & Construction";
  if (g.includes("restaurant") || g.includes("travel") || g.includes("tourism")) return "Hospitality";
  return "";
}

/** Form D enrichment: parse the filed Form D XML for industry group,
 * amounts, first-sale date and related persons; classify fund vs
 * operating company and tag accordingly (Ethan, Oct 14, 2026). */
async function enrichFormDs(): Promise<number> {
  const pending = await getFilingsNeedingDetails(20);
  let done = 0;
  for (const f of pending) {
    if (!f.cik || !f.accession) continue;
    try {
      const adsh = f.accession.replace(/-/g, "");
      const idxRes = await fetch(`https://www.sec.gov/Archives/edgar/data/${f.cik}/${adsh}/index.json`, {
        headers: EDGAR_UA,
        signal: AbortSignal.timeout(15000),
      });
      if (!idxRes.ok) continue;
      const idx = (await idxRes.json()) as { directory?: { item?: { name: string }[] } };
      const items = idx.directory?.item ?? [];
      const xmlItem =
        items.find((i) => i.name.toLowerCase().endsWith(".xml") && !i.name.toLowerCase().includes("index")) ??
        items.find((i) => i.name.toLowerCase().endsWith(".xml"));
      if (!xmlItem) continue;
      const xmlRes = await fetch(`https://www.sec.gov/Archives/edgar/data/${f.cik}/${adsh}/${xmlItem.name}`, {
        headers: EDGAR_UA,
        signal: AbortSignal.timeout(15000),
      });
      if (!xmlRes.ok) continue;
      const xml = await xmlRes.text();
      const grab = (tag: string) => {
        const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        return m ? m[1].trim() : "";
      };
      const industryGroup = grab("industryGroupType");
      const entityType = grab("entityType");
      const stateM = xml.match(/<issuerAddress>[\s\S]*?<stateOrCountry>([^<]+)<\/stateOrCountry>/);
      const state = (stateM ? stateM[1] : grab("stateOrCountry")).toUpperCase();
      if (state && state !== "AZ") {
        // The Form D itself says the principal place is not Arizona.
        await setFilingStatus(f.id, "dismissed");
        continue;
      }
      const num = (tag: string) => {
        const v = grab(tag);
        const n = Number(v);
        return v && !Number.isNaN(n) ? n : null;
      };
      const totalOffering = num("totalOfferingAmount");
      const totalSold = num("totalAmountSold");
      const firstSale = grab("dateOfFirstSale");
      const persons: string[] = [];
      const personRe = /<relatedPerson>[\s\S]*?<firstName>([^<]*)<\/firstName>[\s\S]*?<lastName>([^<]*)<\/lastName>/g;
      let pm: RegExpExecArray | null;
      while ((pm = personRe.exec(xml)) !== null && persons.length < 6) persons.push(`${pm[1]} ${pm[2]}`.trim());
      const isFund = /pooled investment fund/i.test(industryGroup);
      const sector = formdSector(industryGroup);
      const tag = isFund ? "Competing capital" : sector ? "Operating company raise" : "Other";
      const name = cleanFilerName(f.company);
      const money = (n: number | null) => (n === null ? "" : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1e3)}K`);
      const summary = (
        isFund
          ? `${name} is raising ${totalOffering ? money(totalOffering) : "an undisclosed amount"} for a pooled investment fund`
          : `${name} is raising ${totalOffering ? money(totalOffering) : "an undisclosed amount"}${industryGroup ? ` (${industryGroup})` : ""}`
      ) + `${totalSold ? ` — ${money(totalSold)} sold` : ""}${firstSale && firstSale !== "Yet to occur" ? ` since ${firstSale}` : ""}.`;
      const why = isFund
        ? "Competing sponsor raising capital in AZ — watch for platform buys in our sectors."
        : sector
          ? `AZ ${sector} company raising growth capital — possible future seller or add-on.`
          : "Raise outside the focus sectors.";
      await updateFilingDetails(f.id, {
        details: JSON.stringify({ industryGroup, entityType, totalOffering, totalSold, firstSale, relatedPersons: persons, isFund, state }),
        tag,
        summary: summary.slice(0, 300),
        why,
        sector,
      });
      done++;
      await new Promise((r) => setTimeout(r, 120));
    } catch {
      /* enrichment failed — details stay empty, retried next run */
    }
  }
  return done;
}

const BK_FOCUS = ["Aerospace & Defense", "Healthcare", "Advanced Manufacturing", "Specialty Trades & Construction", "Hospitality"];

/** Arizona bankruptcy court filings via CourtListener RECAP (court id
 * "arb" = U.S. Bankruptcy Court, D. Arizona), replacing SEC 8-K Item 1.03
 * coverage (Ethan, Oct 14, 2026). Business Chapter 7 / 11 (incl.
 * Subchapter V) debtors in focus sectors only. */
async function ingestCourtBankruptcies(): Promise<number> {
  const since = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  try {
    const res = await fetch(
      `https://www.courtlistener.com/api/rest/v4/search/?type=r&court=arb&filed_after=${since}&order_by=dateFiled%20desc&page_size=100`,
      { headers: { "User-Agent": "CannyCapitalPortal/1.0 (ethan@cannycapitalpartners.com)" }, signal: AbortSignal.timeout(25000) }
    );
    if (!res.ok) {
      await logSync("bankruptcy-xcheck", "error", 0, `CourtListener HTTP ${res.status}`);
      return 0;
    }
    const data = (await res.json()) as { count?: number; results?: Record<string, unknown>[] };
    const reported = data.count ?? 0;
    const rows: FilingInput[] = [];
    for (const r of data.results ?? []) {
      const chapter = String(r.chapter ?? "");
      if (chapter !== "7" && chapter !== "11") continue;
      const debtor = String(r.caseName ?? "").replace(/^In re:?\s*/i, "").trim();
      if (!debtor) continue;
      const entityLike = /\b(LLC|L\.L\.C\.|INC|CORP|COMPANY|CO\b|LP|LLP|LTD|DBA|GROUP|HOLDINGS|SERVICES|SYSTEMS|PROPERTIES|ENTERPRISES?|SOLUTIONS|MANAGEMENT)\b/i.test(debtor);
      if (!entityLike) continue;
      const sectorRaw = classifyIndustry(debtor);
      const sector = sectorRaw === "Hospitality & Leisure" ? "Hospitality" : sectorRaw;
      if (!BK_FOCUS.includes(sector)) continue;
      const subV = /subchapter\s*v/i.test(JSON.stringify(r));
      const filed = String(r.dateFiled ?? "");
      rows.push({
        form: `BK Ch. ${chapter}`,
        company: debtor,
        cik: "",
        filingDate: filed,
        accession: `CL-${String(r.docket_id ?? r.docketNumber ?? debtor)}`,
        category: "bankruptcy",
        summary: `${debtor} filed Chapter ${chapter}${subV ? " (Subchapter V)" : ""} in the U.S. Bankruptcy Court for the District of Arizona${filed ? ` on ${filed}` : ""}.`,
        url: r.docket_absolute_url ? `https://www.courtlistener.com${String(r.docket_absolute_url)}` : "",
        azCompany: true,
        majorEvent: chapter === "11",
        sector,
        tag: "Distress / asset sale",
        why: "Distress / asset sale — possible asset purchase, or a stressed competitor or customer.",
        details: JSON.stringify({ chapter, subV, court: "U.S. Bankruptcy Court, D. Arizona", docketNumber: String(r.docketNumber ?? "") }),
      });
    }
    const added = await upsertFilings(rows);
    await logSync(
      "bankruptcy-xcheck",
      "ok",
      added,
      `CourtListener reports ${reported} D. Arizona bankruptcy dockets filed in the last 30d; kept ${rows.length} business Ch. 7/11 cases in focus sectors (${added} new)`
    );
    return added;
  } catch (e) {
    await logSync("bankruptcy-xcheck", "error", 0, `CourtListener: ${e instanceof Error ? e.message : String(e)}`);
    return 0;
  }
}

export async function ingestFilings(): Promise<number> {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10);
  // 1) Collect candidate hits with the cheap gates (form type, 8-K items).
  type Cand = { s: NonNullable<EdgarHit["_source"]>; category: FilingInput["category"] };
  const cands: Cand[] = [];
  for (const q of EDGAR_QUERIES) {
    const url =
      `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q.q)}` +
      `&forms=${encodeURIComponent(q.forms)}&startdt=${start}&enddt=${end}`;
    let hits: EdgarHit[] = [];
    try {
      const res = await fetch(url, { headers: EDGAR_UA, signal: AbortSignal.timeout(25000) });
      if (!res.ok) {
        await logSync("filings", "error", 0, `EDGAR ${q.category}: HTTP ${res.status}`);
        continue;
      }
      const data = (await res.json()) as { hits?: { hits?: EdgarHit[] } };
      hits = data.hits?.hits ?? [];
    } catch (e) {
      await logSync("filings", "error", 0, `EDGAR ${q.category}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    for (const h of hits) {
      const s = h._source ?? {};
      const form = (s.form ?? "").toUpperCase();
      if (form.includes("10-K") || form.includes("10-Q")) continue; // periodic reports: never
      if (q.category === "acquisition") {
        // M&A 8-Ks only: material agreement, completed acquisition /
        // disposition, or change in control. Routine-only 8-Ks (Items
        // 2.03 / 8.01 / 9.01 alone) never reach this list.
        if (!((s.items ?? []).some((i) => MA_ITEMS.includes(i)))) continue;
      }
      cands.push({ s, category: q.category });
    }
  }
  // 2) Filer profiles: AZ = principal place of business, sector via SIC.
  const profiles = await resolveFilerProfiles(
    cands.map((c) => (c.s.ciks ?? [])[0]?.replace(/^0+/, "") ?? "")
  );
  // 3) Full gates + row building.
  const rows: FilingInput[] = [];
  for (const { s, category } of cands) {
    const cik = (s.ciks ?? [])[0]?.replace(/^0+/, "") ?? "";
    const prof = profiles.get(cik);
    if (!prof) continue; // profile pending — a later run picks the filing up
    const rawName = (s.display_names ?? [])[0] ?? prof.name ?? "";
    const name = cleanFilerName(rawName) || prof.name;
    const adsh = (s.adsh ?? "").replace(/-/g, "");
    const url = cik && adsh ? `https://www.sec.gov/Archives/edgar/data/${cik}/${adsh}/` : "";
    if (category === "form_d") {
      if (prof.sic === "6189" || prof.sic === "6199") continue; // asset-backed issuers
      if (prof.bizState !== "AZ") continue; // principal place must be AZ (re-verified from the D XML)
      rows.push({
        form: s.form ?? "", company: rawName, cik, filingDate: s.file_date ?? "",
        accession: s.adsh ?? "", category, summary: filingSummary(s), url,
        azCompany: true, majorEvent: false, sic: prof.sic,
      });
      continue;
    }
    if (isSpvFiler(rawName, prof.sic)) continue; // funding vehicles / trusts / ABS issuers
    if (prof.bizState !== "AZ") continue;
    if (!prof.sector) continue; // focus sectors only
    if (category === "acquisition") {
      rows.push({
        form: s.form ?? "", company: rawName, cik, filingDate: s.file_date ?? "",
        accession: s.adsh ?? "", category, summary: filingSummary(s), url,
        azCompany: true, majorEvent: false, sector: prof.sector, sic: prof.sic,
        tag: "Possible exit buyer",
        why: `AZ ${prof.sector} filer reporting an acquisition event — possible exit buyer; repeat filers surface in Competing Buyers.`,
        details: JSON.stringify({ items: s.items ?? [] }),
      });
    } else {
      rows.push({
        form: s.form ?? "", company: rawName, cik, filingDate: s.file_date ?? "",
        accession: s.adsh ?? "", category,
        summary: `${name} — 8-K referencing Arizona expansion${(s.items ?? []).length ? ` (${filingSummary(s)})` : ""}`.slice(0, 300),
        url, azCompany: true, majorEvent: false, sector: prof.sector, sic: prof.sic,
        why: `Expanding AZ ${prof.sector} operator — growth signal; possible future seller or add-on.`,
        details: JSON.stringify({ items: s.items ?? [] }),
      });
    }
  }
  let total = await upsertFilings(rows);
  // 4) Form D enrichment + court bankruptcies.
  const enriched = await enrichFormDs();
  const courtAdded = await ingestCourtBankruptcies();
  total += courtAdded;
  await retireSecBankruptcyFilings();
  const purged = await purgeNonAzFilings().catch(() => 0);
  await logSync(
    "filings",
    "ok",
    total,
    `EDGAR rework: ${cands.length} candidates, ${rows.length} passed AZ-principal-place + focus-sector gates, ${enriched} Form Ds enriched, ${courtAdded} court bankruptcies${purged ? ` · purged ${purged} non-AZ rows` : ""}`
  );
  return total;
}
