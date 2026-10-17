import {
  applyScoring,
  listCandidates,
  logScoringRun,
  saveMatchState,
  type CandidateConflict,
  type CandidateMatch,
  type CandidateScoreComponent,
  type CandidateScoreFactors,
  type MatchState,
  type OperatorCandidate,
  type OperatorNeededEntry,
} from "./candidates-db";
import { getCompanies, getCompetingBuyers, getAcquisitions } from "./market-db";
import { getDeals } from "./db";
import type { Deal, MiCompany } from "./types";

/**
 * Operator candidate scoring + matching (Ethan's Operator Discovery &
 * Sourcing spec, Oct 15, 2026 — Build 2).
 *
 * SCORE (0–100) is computed ONLY from evidence stored on the candidate
 * record (title, company, industry, and the fitNotes text) — never from
 * outside knowledge — and every component's points + evidence are
 * stored in score_factors so the UI can show the contributing factors
 * beside the score. Components: title match 30 · company-size fit 20 ·
 * experience 15 · positive signals 20 · sector preference 15 (focus
 * sector full points; other sector reduced but NON-ZERO, per spec, so
 * a strong other-sector operator can outrank a weak focus-sector one).
 * Candidates with locationVerified=false are NOT scored (score null).
 *
 * MATCHING pairs each scored candidate with its top-3 fit targets /
 * active pipeline deals. Match score (0–100): sector relation 45 ·
 * Arizona location 20 · size comfort 35. Same-sector preferred;
 * adjacent and other-sector pairings are allowed and labeled.
 *
 * CONFLICTS: a candidate employed by a fit-target company, a pipeline
 * deal's company, or a known competing buyer/acquirer is FLAGGED —
 * never excluded (spec).
 */

export const OPERATOR_MATCH_STRONG = 50;
export const OPERATOR_MATCH_FLOOR = 25;
const POOL_FIT_CAP_PER_SECTOR = 2000;
const POOL_ROW_CAP_PER_SECTOR = 40000;
const OPERATOR_NEEDED_STORED = 200;

export const FOCUS_SECTORS = [
  "Aerospace & Defense",
  "Healthcare",
  "Advanced Manufacturing",
  "Specialty Trades & Construction",
  "Hospitality",
] as const;

/* ---------------- sector helpers ---------------- */

export function sectorFromText(text: string): string | null {
  const t = (text ?? "").toLowerCase();
  if (/aerospace|defense|defence/.test(t)) return "Aerospace & Defense";
  // NB: \bhospital\b — bare /hospital/ would swallow "Hospitality".
  if (/healthcare|\bhealth\b|medical|\bhospital\b|senior living|behavioral|dental|clinic/.test(t))
    return "Healthcare";
  if (/manufacturing|machining|fabrication|industrial/.test(t))
    return "Advanced Manufacturing";
  if (/hospitality|restaurant|hotel|resort|gaming|casino|food & beverage/.test(t))
    return "Hospitality";
  if (/trades|construction|hvac|plumbing|electrical|contracting|home[ -]services/.test(t))
    return "Specialty Trades & Construction";
  return null;
}

export function candidateSector(c: OperatorCandidate): string {
  if (!c.focusSector) return "Other";
  return sectorFromText(c.industry) ?? sectorFromText(c.company) ?? "Other";
}

export function dealSector(d: Deal): string {
  return sectorFromText(d.industry) ?? "Other";
}

const ADJACENT: Record<string, string[]> = {
  "Aerospace & Defense": ["Advanced Manufacturing"],
  "Advanced Manufacturing": ["Aerospace & Defense", "Specialty Trades & Construction"],
  "Specialty Trades & Construction": ["Advanced Manufacturing", "Hospitality"],
  Hospitality: ["Specialty Trades & Construction", "Healthcare"],
  Healthcare: ["Hospitality"],
  Other: [],
};

function sectorRelation(
  a: string,
  b: string
): { relation: CandidateMatch["relation"]; points: number; label: string } {
  if (a === b && a !== "Other")
    return { relation: "same", points: 45, label: `Same sector — ${a}` };
  if (a === "Other" && b === "Other")
    return {
      relation: "other",
      points: 12,
      label: "Both outside the five focus sectors",
    };
  if ((ADJACENT[a] ?? []).includes(b))
    return {
      relation: "adjacent",
      points: 25,
      label: `Adjacent sector — target ${b}, candidate ${a}`,
    };
  return {
    relation: "other",
    points: 10,
    label: `Other sector — target ${b}, candidate ${a}`,
  };
}

/* ---------------- location helpers ---------------- */

const PHX_METRO = new Set([
  "phoenix", "scottsdale", "tempe", "mesa", "chandler", "gilbert",
  "glendale", "peoria", "surprise", "goodyear", "avondale", "buckeye",
  "queen creek", "apache junction", "paradise valley", "fountain hills",
  "cave creek", "carefree", "litchfield park", "tolleson", "el mirage",
  "guadalupe", "sun city", "sun city west", "anthem", "new river",
]);
const TUCSON_METRO = new Set([
  "tucson", "oro valley", "marana", "sahuarita", "south tucson", "vail",
  "catalina foothills", "green valley", "picture rocks",
]);

function cityKeys(raw: string): string[] {
  return (raw ?? "")
    .toLowerCase()
    .replace(/,\s*az\b/g, "")
    .replace(/,\s*arizona\b/g, "")
    .split(/[/,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function metroOf(city: string): string | null {
  if (PHX_METRO.has(city)) return "phoenix";
  if (TUCSON_METRO.has(city)) return "tucson";
  return null;
}

function locationPoints(
  candCity: string,
  targetCity: string,
  targetIsAz: boolean
): { points: number; label: string } {
  const cand = cityKeys(candCity);
  const tgt = cityKeys(targetCity);
  if (cand.length && tgt.length) {
    const same = tgt.find((t) => cand.includes(t));
    if (same) return { points: 20, label: `${cap(same)} — same city` };
    const cm = cand.map(metroOf).find(Boolean);
    const tm = tgt.map(metroOf).find(Boolean);
    if (cm && tm && cm === tm)
      return {
        points: 12,
        label: `${cap(tgt[0])} — same ${cm === "phoenix" ? "Phoenix" : "Tucson"} metro`,
      };
    if (targetIsAz)
      return { points: 6, label: `${cap(tgt[0])} — elsewhere in Arizona` };
    return { points: 3, label: `${cap(tgt[0])} — location fit unclear` };
  }
  return { points: 3, label: "Location fit unclear" };
}

const cap = (s: string): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : s;

/* ---------------- evidence parsing (from the record itself) -------- */

export interface SizeEvidence {
  rev: number | null;
  emp: number | null;
  loc: number | null;
  smallScale: boolean;
  labels: string[];
}

const WORD_NUM: Record<string, number> = {
  two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

export function parseSizeEvidence(text: string): SizeEvidence {
  const t = text ?? "";
  const labels: string[] = [];
  let rev: number | null = null;
  const revRe = /\$\s?([\d.]+)\s?([BM])\b/g;
  let rm: RegExpExecArray | null;
  while ((rm = revRe.exec(t)) !== null) {
    const v = parseFloat(rm[1]) * (rm[2] === "B" ? 1e9 : 1e6);
    if (Number.isFinite(v) && (rev === null || v > rev)) rev = v;
  }
  if (rev !== null) labels.push(`revenue evidence ~${money(rev)}`);
  let emp: number | null = null;
  const range = t.match(/([\d,]+)\s?[–—-]\s?([\d,]+)\s?-?\s?employees?\b/i);
  if (range) {
    emp = Math.round(
      (parseInt(range[1].replace(/,/g, ""), 10) +
        parseInt(range[2].replace(/,/g, ""), 10)) /
        2
    );
  } else {
    const single = t.match(/([\d,]+)\+?\s?employees?\b/i);
    if (single) emp = parseInt(single[1].replace(/,/g, ""), 10);
  }
  if (emp !== null) labels.push(`~${emp} employees`);
  let loc: number | null = null;
  const locNum = t.match(/([\d,]+)\s?(locations|shops|stores)\b/i);
  if (locNum) loc = parseInt(locNum[1].replace(/,/g, ""), 10);
  if (loc === null) {
    const unit = t.match(/([\d,]+)\s?-\s?unit\b/i);
    if (unit) loc = parseInt(unit[1], 10);
  }
  if (loc === null) {
    // Word-number counts can sit a few words from the noun ("six
    // Arizona senior-living communities") — allow a short window.
    const word = t.match(
      /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b[^.]{0,40}?\b(communities|locations|properties|resorts)\b/i
    );
    if (word) loc = WORD_NUM[word[1].toLowerCase()] ?? null;
  }
  if (loc !== null) labels.push(`${loc} locations/units`);
  const smallScale = /smaller (service )?businesses|below the scale|smaller scale/i.test(t);
  if (smallScale) labels.push("documented engagements below target scale");
  return { rev, emp, loc, smallScale, labels };
}

function parseExperienceYears(text: string): number | null {
  const t = text ?? "";
  const found: number[] = [];
  const range = t.match(/((?:19|20)\d{2})\s?[–—-]\s?((?:19|20)\d{2})/);
  if (range) found.push(parseInt(range[2], 10) - parseInt(range[1], 10));
  const yrsRe = /(\d+)\+?\s+years?\b/g;
  let ym: RegExpExecArray | null;
  while ((ym = yrsRe.exec(t)) !== null) found.push(parseInt(ym[1], 10));
  const since = t.match(/since\s+((?:19|20)\d{2})/i);
  if (since) found.push(new Date().getFullYear() - parseInt(since[1], 10));
  if (/over a decade/i.test(t)) found.push(11);
  else if (/for a decade/i.test(t)) found.push(10);
  if (/two decades/i.test(t)) found.push(20);
  const valid = found.filter((n) => Number.isFinite(n) && n > 0 && n <= 60);
  return valid.length ? Math.max(...valid) : null;
}

const money = (v: number): string =>
  v >= 1e9
    ? `$${(v / 1e9).toFixed(2)}B`
    : v >= 1e6
      ? `$${(v / 1e6).toFixed(1)}M`
      : `$${Math.round(v / 1e3)}K`;

/* ---------------- candidate score rubric ---------------- */

function titleComponent(c: OperatorCandidate): CandidateScoreComponent {
  const title = (c.currentTitle ?? "").toLowerCase();
  const notes = c.fitNotes ?? "";
  const base = { key: "title", label: "Title match", max: 30 };
  // Pure sales/marketing leadership is not an operator profile (spec).
  if (
    /(sales|marketing|business development|revenue|growth)/.test(title) &&
    !/(operations|operating)/.test(title)
  ) {
    return { ...base, points: 2, evidence: [`"${c.currentTitle}" is a sales/marketing title, not an operating seat`] };
  }
  if (/(former|ex-)/.test(title) && /(ceo|chief executive|president|founder)/.test(title))
    return { ...base, points: 28, evidence: [`"${c.currentTitle}" — exited / stepping-back chief executive`] };
  if (/(co-)?founder|owner/.test(title))
    return { ...base, points: 28, evidence: [`"${c.currentTitle}" — founder-operator`] };
  if (/chief executive|\bceo\b/.test(title))
    return { ...base, points: 28, evidence: [`"${c.currentTitle}" — chief executive seat`] };
  if (/chief operating|\bcoo\b/.test(title))
    return { ...base, points: 28, evidence: [`"${c.currentTitle}" — chief operating seat`] };
  if (/executive chairman|exec\.? chairman/.test(title)) {
    const wasCeo = /previously ceo|was (the )?ceo|served as ceo|formerly ceo|ceo & president|ceo and president/i.test(notes);
    return {
      ...base,
      points: wasCeo ? 26 : 24,
      evidence: [
        wasCeo
          ? `"${c.currentTitle}" with a prior CEO tenure in the record`
          : `"${c.currentTitle}" — chairman seat`,
      ],
    };
  }
  // GM before President/VP: "Vice President & General Manager" is a GM
  // seat, and bare /president/ would otherwise swallow every VP title.
  if (/general manager|\bgm\b/.test(title))
    return { ...base, points: 24, evidence: [`"${c.currentTitle}" — general manager (unit P&L seat)`] };
  if (/(vp|vice president)/.test(title) && /(operations|operating|mission critical|regional)/.test(title))
    return { ...base, points: 22, evidence: [`"${c.currentTitle}" — VP-level operations leadership`] };
  if (/division (head|president)|regional director/.test(title))
    return { ...base, points: 22, evidence: [`"${c.currentTitle}" — division/regional leadership`] };
  if (/president/.test(title) && !/vice/.test(title))
    return { ...base, points: 27, evidence: [`"${c.currentTitle}" — president (P&L seat)`] };
  if (/(vp|vice president)/.test(title))
    return { ...base, points: 16, evidence: [`"${c.currentTitle}" — VP, not clearly operations`] };
  if (/director/.test(title))
    return { ...base, points: 10, evidence: [`"${c.currentTitle}" — director level, below the target profile`] };
  if (!title)
    return { ...base, points: 4, evidence: ["No title on the record"] };
  return { ...base, points: 6, evidence: [`"${c.currentTitle}" — outside the target title profile`] };
}

function sizeComponent(c: OperatorCandidate, ev: SizeEvidence): CandidateScoreComponent {
  const base = { key: "size", label: "Company-size fit", max: 20 };
  const options: { points: number; label: string }[] = [];
  if (ev.rev !== null) {
    const r = ev.rev;
    const pts =
      r >= 5e6 && r <= 100e6 ? 20
      : r > 100e6 && r <= 250e6 ? 12
      : r > 250e6 ? 6
      : r >= 1e6 ? 10
      : 4;
    options.push({
      points: pts,
      label: `revenue evidence ~${money(r)} (target band $5–100M)`,
    });
  }
  if (ev.emp !== null) {
    const e = ev.emp;
    options.push({
      points: e >= 25 && e <= 500 ? 20 : e <= 1000 ? 12 : e >= 10 ? 10 : e > 1000 ? 8 : 5,
      label: `~${e} employees (target band 25–500)`,
    });
  }
  if (ev.loc !== null) {
    const l = ev.loc;
    options.push({
      points: l >= 10 ? 18 : l >= 3 ? 15 : l === 2 ? 10 : 5,
      label: `${l} locations/units operated`,
    });
  }
  if (ev.smallScale)
    options.push({ points: 5, label: "record notes engagements below target scale" });
  if (!options.length)
    return { ...base, points: 8, evidence: ["No size evidence in the record — neutral"] };
  options.sort((a, b) => b.points - a.points);
  return { ...base, points: options[0].points, evidence: [options[0].label] };
}

function experienceComponent(c: OperatorCandidate): CandidateScoreComponent {
  const base = { key: "experience", label: "Years of experience", max: 15 };
  const years = parseExperienceYears(c.fitNotes ?? "");
  if (years === null)
    return { ...base, points: 5, evidence: ["No tenure/experience figures in the record"] };
  const points = years >= 20 ? 15 : years >= 15 ? 12 : years >= 10 ? 10 : years >= 6 ? 7 : 5;
  return { ...base, points, evidence: [`~${years} years evidenced in the record (10+ is the positive signal)`] };
}

const SIGNAL_RULES: { key: string; label: string; patterns: RegExp[] }[] = [
  {
    key: "roleChange",
    label: "Recent role change / availability",
    patterns: [
      /stepping (into|back|down)/i, /stepped (down|back|aside)/i,
      /just handed/i, /handed the .* seat/i, /promoted/i, /brought in/i,
      /takes over/i, /successor takes over/i, /interim/i,
      /actively leaving/i, /openly available/i, /transitioning/i,
      /named (ceo|president|chief)/i, /newly appointed/i,
    ],
  },
  {
    key: "exitOwnership",
    label: "Company sale / exit / ownership history",
    patterns: [
      /search[- ]fund/i, /acquired the/i, /operator-investor/i,
      /post-merger/i, /\bexited\b/i, /sold the (business|company)/i,
      /owner-operator/i,
    ],
  },
  {
    key: "multiSite",
    label: "Multi-site / roll-up experience",
    patterns: [
      /multi-unit/i, /multi-site/i, /multi-program/i, /roll-up/i,
      /\blocations\b/i, /\bshops\b/i, /\bcommunities\b/i, /\bplatform\b/i,
      /phoenix \+ tucson/i, /across (four|three|two|\d+) markets/i,
    ],
  },
  {
    key: "pnl",
    label: "P&L ownership / accountable growth",
    patterns: [
      /p&l/i, /doubled revenue/i, /grew the (brand|business|company)/i,
      /grow the organization from/i, /revenue responsibility/i,
    ],
  },
];

function signalsComponent(c: OperatorCandidate): CandidateScoreComponent {
  const text = `${c.fitNotes ?? ""} ${c.currentTitle ?? ""}`;
  const hits: string[] = [];
  for (const rule of SIGNAL_RULES) {
    if (rule.patterns.some((p) => p.test(text))) hits.push(rule.label);
  }
  return {
    key: "signals",
    label: "Positive signals",
    max: 20,
    points: Math.min(20, hits.length * 5),
    evidence: hits.length ? hits : ["No positive signals evidenced in the record"],
  };
}

function sectorComponent(c: OperatorCandidate): CandidateScoreComponent {
  return {
    key: "sector",
    label: "Sector preference",
    max: 15,
    points: c.focusSector ? 15 : 6,
    evidence: [
      c.focusSector
        ? `Focus sector — ${c.industry || candidateSector(c)}`
        : `Other sector — ${c.industry || "not a focus sector"} (reduced, non-zero per spec)`,
    ],
  };
}

export function scoreCandidateRecord(
  c: OperatorCandidate
): CandidateScoreFactors | null {
  if (!c.locationVerified) return null;
  const ev = parseSizeEvidence(c.fitNotes ?? "");
  const components = [
    titleComponent(c),
    sizeComponent(c, ev),
    experienceComponent(c),
    signalsComponent(c),
    sectorComponent(c),
  ];
  const total = components.reduce((s, x) => s + x.points, 0);
  return { total: Math.max(0, Math.min(100, total)), components };
}

/* ---------------- matching ---------------- */

interface MatchTarget {
  type: "company" | "deal";
  id: string;
  name: string;
  sector: string;
  city: string;
  isAz: boolean;
  emp: number | null;
  rev: number | null;
  loc: number | null;
  dealValue: number | null;
  sizeRank: number; // for operator-needed ordering only
}

const numOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function companyTarget(co: MiCompany, det: Record<string, unknown>): MatchTarget {
  const emp = co.employees ?? numOrNull(det.employeesEstimate) ?? numOrNull(det.sbaJobs);
  const rev = numOrNull(det.revenueEstimate) ?? numOrNull(det.estRevenue);
  const loc = numOrNull(det.locationCount);
  return {
    type: "company",
    id: co.id,
    name: co.name,
    sector: (FOCUS_SECTORS as readonly string[]).includes(co.sector)
      ? co.sector
      : (sectorFromText(`${co.sector} ${co.subsector}`) ?? co.sector ?? "Other"),
    city: co.city ?? "",
    isAz: (co.state ?? "AZ").toUpperCase() === "AZ" || !co.state,
    emp,
    rev,
    loc,
    dealValue: null,
    sizeRank: emp ?? (rev !== null ? rev / 250000 : 0),
  };
}

function dealTarget(d: Deal): MatchTarget {
  const value = d.askingPrice ?? (d.dealValue || null);
  return {
    type: "deal",
    id: d.id,
    name: d.companyName,
    sector: dealSector(d),
    city: d.city ?? "",
    isAz: /,\s*AZ\b/i.test(d.city ?? "") || !d.city,
    emp: null,
    rev: d.revenue ?? null,
    loc: null,
    dealValue: value,
    sizeRank: value !== null ? value / 250000 : 0,
  };
}

function sizeComfort(
  ev: SizeEvidence,
  t: MatchTarget
): { points: number; label: string } {
  const ratioBand = (r: number, strong: number, partial: number) =>
    r >= 0.25 && r <= 4
      ? { points: strong, label: "" }
      : r >= 0.1 && r <= 10
        ? { points: partial, label: "" }
        : { points: 6, label: "" };
  if (ev.emp !== null && t.emp !== null) {
    const b = ratioBand(t.emp / ev.emp, 35, 20);
    return { ...b, label: `Size: target ~${t.emp} employees vs candidate's ~${ev.emp}-employee platform` };
  }
  if (ev.rev !== null && t.rev !== null) {
    const b = ratioBand(t.rev / ev.rev, 35, 20);
    return { ...b, label: `Size: target est. revenue ${money(t.rev)} vs candidate's ~${money(ev.rev)}` };
  }
  if (ev.loc !== null && t.loc !== null) {
    const r = t.loc / ev.loc;
    const pts = r >= 0.3 && r <= 3.5 ? 30 : r >= 0.1 && r <= 10 ? 18 : 6;
    return { points: pts, label: `Size: target ${t.loc} locations vs candidate's ${ev.loc}-location platform` };
  }
  if (t.emp !== null)
    return t.emp >= 25 && t.emp <= 500
      ? { points: 28, label: `Size: target ~${t.emp} employees — inside the 25–500 comfort band` }
      : t.emp >= 10 && t.emp <= 1000
        ? { points: 16, label: `Size: target ~${t.emp} employees — near the comfort band` }
        : { points: 6, label: `Size: target ~${t.emp} employees — outside the comfort band` };
  if (t.rev !== null)
    return t.rev >= 5e6 && t.rev <= 100e6
      ? { points: 28, label: `Size: target est. revenue ${money(t.rev)} — inside the $5–100M comfort band` }
      : t.rev >= 1e6 && t.rev <= 250e6
        ? { points: 16, label: `Size: target est. revenue ${money(t.rev)} — near the comfort band` }
        : { points: 6, label: `Size: target est. revenue ${money(t.rev)} — outside the comfort band` };
  if (t.loc !== null)
    return t.loc >= 3
      ? { points: 22, label: `Size: ${t.loc} locations — multi-unit scale` }
      : { points: 10, label: `Size: ${t.loc} location(s)` };
  if (t.dealValue !== null)
    return t.dealValue >= 2e6 && t.dealValue <= 50e6
      ? { points: 16, label: `Size: deal value ${money(t.dealValue)} — in platform range` }
      : t.dealValue >= 5e5 && t.dealValue <= 150e6
        ? { points: 10, label: `Size: deal value ${money(t.dealValue)} — near platform range` }
        : { points: 5, label: `Size: deal value ${money(t.dealValue)}` };
  return { points: 10, label: "Size: no published size evidence for the target" };
}

export function matchCandidate(
  c: OperatorCandidate,
  targets: MatchTarget[]
): { top: CandidateMatch[]; bestByTarget: Map<string, number> } {
  const ev = parseSizeEvidence(c.fitNotes ?? "");
  const cSector = candidateSector(c);
  const scored: CandidateMatch[] = [];
  const bestByTarget = new Map<string, number>();
  for (const t of targets) {
    const rel = sectorRelation(cSector, t.sector);
    const locPt = locationPoints(c.city, t.city, t.isAz);
    const size = sizeComfort(ev, t);
    const total = rel.points + locPt.points + size.points;
    const key = `${t.type}:${t.id}`;
    if ((bestByTarget.get(key) ?? -1) < total) bestByTarget.set(key, total);
    if (total < OPERATOR_MATCH_FLOOR) continue;
    scored.push({
      type: t.type,
      id: t.id,
      name: t.name,
      sector: t.sector,
      relation: rel.relation,
      city: t.city,
      matchScore: total,
      basis: `${rel.label} · ${locPt.label} · ${size.label}`,
    });
  }
  scored.sort((a, b) => b.matchScore - a.matchScore || a.name.localeCompare(b.name));
  return { top: scored.slice(0, 3), bestByTarget };
}

/* ---------------- conflicts ---------------- */

export function normCompanyName(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[.,'"’|/\\-]+/g, " ")
    .replace(/\b(llc|inc|corp|corporation|co|company|ltd|llp|pllc|the|group|holdings)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function employerAliases(company: string): string[] {
  const out = new Set<string>();
  const full = normCompanyName(company);
  if (full) out.add(full);
  const paren = (company ?? "").match(/\(([^)]+)\)/);
  if (paren) {
    const p = normCompanyName(paren[1]);
    if (p) out.add(p);
  }
  for (const seg of (company ?? "").split(/[|]|\s[—–-]\s/)) {
    const n = normCompanyName(seg);
    if (n) out.add(n);
  }
  return Array.from(out);
}

interface EmployerHit {
  id: string;
  name: string;
  fit: boolean;
  sector: string;
}

function nameMatches(alias: string, norm: string): boolean {
  if (!alias || !norm) return false;
  if (alias === norm) return true;
  if (alias.length >= 8 && norm.includes(alias)) return true;
  if (norm.length >= 8 && alias.includes(norm)) return true;
  return false;
}

function detectConflicts(
  c: OperatorCandidate,
  employerIndex: Map<string, EmployerHit>,
  deals: Deal[],
  buyerNames: Map<string, string>
): CandidateConflict[] {
  const out: CandidateConflict[] = [];
  if (!c.company) return out;
  const aliases = employerAliases(c.company);
  // Employer is itself a portal fit target.
  for (const hit of Array.from(employerIndex.values())) {
    if (!hit.fit) continue;
    if (aliases.some((a) => nameMatches(a, normCompanyName(hit.name)))) {
      out.push({
        type: "target_employer",
        name: hit.name,
        targetId: hit.id,
        detail: `${c.name} works at ${hit.name}, which is itself a portal fit target (${hit.sector}) — conflict flag per spec, not an exclusion.`,
      });
      break;
    }
  }
  // Employer is a pipeline deal's company.
  for (const d of deals) {
    if (aliases.some((a) => nameMatches(a, normCompanyName(d.companyName)))) {
      out.push({
        type: "deal_employer",
        name: d.companyName,
        targetId: d.id,
        detail: `${c.name} works at ${d.companyName}, a company with an active pipeline deal (stage ${d.stage}).`,
      });
      break;
    }
  }
  // Employer is a known competing buyer / acquirer.
  for (const pair of Array.from(buyerNames.entries())) {
    const norm = pair[0];
    const display = pair[1];
    if (aliases.some((a) => nameMatches(a, norm))) {
      out.push({
        type: "competing_buyer",
        name: display,
        detail: `${c.name}'s employer ${display} appears in the portal as an acquirer / competing buyer.`,
      });
      break;
    }
  }
  return out;
}

/* ---------------- pool collection ---------------- */

interface Pool {
  targets: MatchTarget[];
  employerIndex: Map<string, EmployerHit>;
  companyCount: number;
}

async function collectPool(): Promise<Pool> {
  const targets: MatchTarget[] = [];
  const employerIndex = new Map<string, EmployerHit>();
  for (const sector of FOCUS_SECTORS) {
    let offset = 0;
    let fetched = 0;
    let sectorFits = 0;
    while (fetched < POOL_ROW_CAP_PER_SECTOR) {
      const rows = await getCompanies(sector, 5000, offset);
      if (!rows.length) break;
      fetched += rows.length;
      for (const co of rows) {
        const key = normCompanyName(co.name);
        let det: Record<string, unknown> = {};
        let isFit = false;
        if (co.details && co.details.includes('"fit"')) {
          try {
            det = JSON.parse(co.details) as Record<string, unknown>;
            isFit = det.fit === true;
          } catch {
            det = {};
          }
        }
        if (key && !employerIndex.has(key)) {
          employerIndex.set(key, { id: co.id, name: co.name, fit: isFit, sector: co.sector });
        } else if (key && isFit) {
          const prev = employerIndex.get(key);
          if (prev && !prev.fit) employerIndex.set(key, { ...prev, fit: true });
        }
        if (isFit && sectorFits < POOL_FIT_CAP_PER_SECTOR) {
          targets.push(companyTarget(co, det));
          sectorFits++;
        }
      }
      if (rows.length < 5000) break;
      offset += 5000;
    }
  }
  return { targets, employerIndex, companyCount: targets.length };
}

/* ---------------- rescore orchestration ---------------- */

export interface RescoreResult {
  candidates: number;
  scored: number;
  unscored: number;
  changed: number;
  withMatches: number;
  conflictFlags: number;
  poolCompanies: number;
  poolDeals: number;
  operatorNeededTotal: number;
  strongThreshold: number;
}

const ACTIVE_DEAL_STAGES = new Set([
  "Sourcing",
  "Initial Contact",
  "Diligence",
  "Negotiation",
  "Closing",
]);

export async function rescoreAllCandidates(actor: string): Promise<RescoreResult> {
  const candidates = await listCandidates();
  const pool = await collectPool();
  const allDeals = await getDeals();
  const deals = allDeals.filter((d) => ACTIVE_DEAL_STAGES.has(d.stage));
  const targets: MatchTarget[] = [...pool.targets, ...deals.map(dealTarget)];

  // Competing-buyer / acquirer names from portal data.
  const buyerNames = new Map<string, string>();
  try {
    for (const b of await getCompetingBuyers()) {
      const n = normCompanyName(b.acquirer);
      if (n) buyerNames.set(n, b.acquirer);
    }
  } catch { /* feed unavailable — acquirer names below still apply */ }
  try {
    for (const a of await getAcquisitions()) {
      const n = normCompanyName(a.acquirer);
      if (n && !buyerNames.has(n)) buyerNames.set(n, a.acquirer);
    }
  } catch { /* feed unavailable */ }

  const bestByTarget = new Map<string, number>();
  let scored = 0;
  let unscored = 0;
  let changed = 0;
  let withMatches = 0;
  let conflictFlags = 0;
  const now = new Date().toISOString();

  for (const c of candidates) {
    const conflicts = detectConflicts(c, pool.employerIndex, deals, buyerNames);
    conflictFlags += conflicts.length;
    const factors = scoreCandidateRecord(c);
    if (factors === null) {
      unscored++;
      const did = await applyScoring(
        c.id,
        { score: null, scoreFactors: null, scoredAt: now, matchedTargets: [], conflicts },
        actor
      );
      if (did) changed++;
      continue;
    }
    scored++;
    const { top, bestByTarget: mine } = matchCandidate(c, targets);
    for (const pair of Array.from(mine.entries())) {
      if ((bestByTarget.get(pair[0]) ?? -1) < pair[1])
        bestByTarget.set(pair[0], pair[1]);
    }
    if (top.length) withMatches++;
    const did = await applyScoring(
      c.id,
      {
        score: factors.total,
        scoreFactors: factors,
        scoredAt: now,
        matchedTargets: top,
        conflicts,
      },
      actor
    );
    if (did) changed++;
  }

  // Operator needed: pool targets whose best candidate match is below
  // the strong threshold (or that no scored candidate matched at all).
  const needed: (OperatorNeededEntry & { sizeRank: number })[] = [];
  for (const t of targets) {
    const best = bestByTarget.get(`${t.type}:${t.id}`) ?? null;
    if (best === null || best < OPERATOR_MATCH_STRONG) {
      needed.push({
        type: t.type,
        id: t.id,
        name: t.name,
        sector: t.sector,
        city: t.city,
        bestMatchScore: best,
        sizeRank: t.sizeRank,
      });
    }
  }
  needed.sort((a, b) => b.sizeRank - a.sizeRank || a.name.localeCompare(b.name));
  const state: MatchState = {
    computedAt: now,
    strongThreshold: OPERATOR_MATCH_STRONG,
    poolCompanies: pool.companyCount,
    poolDeals: deals.length,
    operatorNeededTotal: needed.length,
    operatorNeeded: needed.slice(0, OPERATOR_NEEDED_STORED).map((n) => ({
      type: n.type,
      id: n.id,
      name: n.name,
      sector: n.sector,
      city: n.city,
      bestMatchScore: n.bestMatchScore,
    })),
  };
  await saveMatchState(state);
  await logScoringRun(
    actor,
    `${actor} ran operator rescore: ${scored} scored, ${unscored} unscored (location unverified), ${conflictFlags} conflict flag(s), ${state.operatorNeededTotal} targets operator-needed`
  );

  return {
    candidates: candidates.length,
    scored,
    unscored,
    changed,
    withMatches,
    conflictFlags,
    poolCompanies: pool.companyCount,
    poolDeals: deals.length,
    operatorNeededTotal: state.operatorNeededTotal,
    strongThreshold: OPERATOR_MATCH_STRONG,
  };
}
