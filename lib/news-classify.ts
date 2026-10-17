/**
 * News sector classifier + deal relevance model (News & Intelligence
 * overhaul, Oct 17, 2026). Pure functions, no DB imports — the ingest,
 * the reclassify pass, and the offline test harness all run the SAME
 * code, so what is tested is what ships.
 *
 * Sector classification (Ethan's spec): read headline + summary + body
 * text (the RSS snippet is the body text the ingest actually holds) —
 * never the source name, never a single keyword, never geography.
 * Weighted keywords AND entities; headline hits weigh 3×, summary 2×,
 * body 1×. One primary sector; other sectors with real evidence ride
 * along as secondary tags. Confidence comes from the winner's evidence
 * mass and its margin over the runner-up; low confidence → "Other"
 * (with lowConfidence flagged) rather than a guess.
 *
 * Relevance (Ethan's spec): scored for a lower-middle-market AZ /
 * Southwest acquirer ($0–50M, owner-operated) hunting in the five focus
 * sectors. Deal signals (M&A, sales/succession, PE/financing,
 * expansions, contract awards, distress, consolidation) boost; politics,
 * CSR, and unanchored national stories sink. A named set of categories
 * is HARD-EXCLUDED — a school district budget override must never reach
 * the feed, by rule, not by score.
 */

export const NEWS_MIN_RELEVANCE = 35;

export const NEWS_SECTORS = [
  "Aerospace & Defense",
  "Healthcare",
  "Advanced Manufacturing",
  "Specialty Trades & Construction",
  "Hospitality",
  "Other",
] as const;
export type NewsSector = (typeof NEWS_SECTORS)[number];

/* ---------------- text helpers ---------------- */

/** Whole-word / prefix-stem presence (mirrors kwMatch semantics in
 * industry-classify: a trailing * matches a word prefix, so "hospital"
 * can never match inside "hospitality"). */
function termHit(text: string, term: string): boolean {
  const esc = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return term.endsWith("*")
    ? new RegExp(`\\b${esc.slice(0, -2)}`, "i").test(text)
    : new RegExp(`\\b${esc}\\b`, "i").test(text);
}

/** Strip a wire-style dateline ("SEOUL, South Korea — ", "PHOENIX
 * (AP) — ") so place words in the dateline never vote on the sector —
 * Ethan's dateline-trap rule. Only strips when the prefix is short and
 * mostly uppercase. */
export function stripDateline(text: string): string {
  if (!text) return text;
  const m = text.match(/^\s*([A-Z][A-Za-z0-9 .,'&()-]{1,48}?)\s*(?:\((?:AP|Reuters)\)\s*)?[—–-]\s+/);
  if (!m) return text;
  const prefix = m[1];
  const letters = prefix.replace(/[^A-Za-z]/g, "");
  if (!letters) return text;
  const upper = (prefix.match(/[A-Z]/g) ?? []).length;
  if (upper / letters.length < 0.6) return text;
  return text.slice(m[0].length);
}

const FIELD_WEIGHTS = { headline: 3, summary: 2, body: 1 } as const;

/* ---------------- sector dictionaries ----------------
 * Weights 1–5: named entities and unambiguous vocabulary sit at 4–5;
 * words that also live in other sectors' stories sit at 1–3 and only
 * matter in combination. GEOGRAPHY IS DELIBERATELY ABSENT: no country,
 * state, or city name appears below, so geography alone can never
 * decide a sector (the Korea rule). Korea enters A&D only through what
 * the story is ABOUT (drones, army, lasers, Hanwha) — plus the phrase
 * "korea defense", a topic, not a place vote. */

interface TermDef {
  t: string;
  w: number;
}

type FocusSector = Exclude<NewsSector, "Other">;

const SECTOR_TERMS: Record<FocusSector, TermDef[]> = {
  "Aerospace & Defense": [
    { t: "department of defense", w: 5 }, { t: "defense contract*", w: 5 },
    { t: "air defense", w: 5 }, { t: "missile*", w: 5 }, { t: "hanwha", w: 5 },
    { t: "lockheed", w: 5 }, { t: "raytheon", w: 5 }, { t: "northrop", w: 5 },
    { t: "korea defense", w: 5 }, { t: "korean defense", w: 5 },
    { t: "defense", w: 4 }, { t: "defence", w: 4 }, { t: "military", w: 4 },
    { t: "aerospace", w: 4 }, { t: "munitions", w: 4 }, { t: "avionics", w: 4 },
    { t: "drone*", w: 4 }, { t: "weapon*", w: 4 }, { t: "shipbuilding", w: 4 },
    { t: "pentagon", w: 4 }, { t: "air force", w: 4 }, { t: "directed energy", w: 4 },
    { t: "hypersonic*", w: 4 }, { t: "fighter jet*", w: 4 }, { t: "boeing", w: 4 },
    { t: "general dynamics", w: 4 }, { t: "l3harris", w: 4 }, { t: "bae systems", w: 4 },
    { t: "aircraft", w: 3 }, { t: "unmanned", w: 3 }, { t: "naval", w: 3 },
    { t: "army", w: 3 }, { t: "ordnance", w: 3 }, { t: "laser weapon*", w: 3 },
    { t: "rtx", w: 3 }, { t: "leidos", w: 3 },
    { t: "satellite*", w: 2 }, { t: "spacecraft", w: 2 }, { t: "helicopter*", w: 2 },
    { t: "radar", w: 2 }, { t: "soldier*", w: 2 },
  ],
  Healthcare: [
    { t: "banner health", w: 5 }, { t: "honorhealth", w: 5 },
    { t: "health system", w: 4 }, { t: "healthcare", w: 4 }, { t: "health care", w: 4 },
    { t: "hospital*", w: 4 }, { t: "pharma*", w: 4 }, { t: "biotech", w: 4 },
    { t: "senior living", w: 4 }, { t: "assisted living", w: 4 }, { t: "hospice", w: 4 },
    { t: "urgent care", w: 4 }, { t: "behavioral health", w: 4 }, { t: "dignity health", w: 4 },
    { t: "mayo clinic", w: 4 }, { t: "unitedhealth", w: 4 },
    { t: "clinic*", w: 3 }, { t: "medical", w: 3 }, { t: "dental", w: 3 },
    { t: "medicaid", w: 3 }, { t: "medicare", w: 3 }, { t: "physician*", w: 3 },
    { t: "veterinary", w: 3 }, { t: "telehealth", w: 3 },
    { t: "nursing", w: 2 }, { t: "patient*", w: 2 }, { t: "surgery", w: 2 },
    { t: "dentist*", w: 2 }, { t: "veterinarian*", w: 2 },
  ],
  "Advanced Manufacturing": [
    { t: "semiconductor*", w: 5 }, { t: "chip plant", w: 5 }, { t: "tsmc", w: 5 },
    { t: "semiconductor fab", w: 5 }, { t: "gigafactory", w: 4 }, { t: "chipmaker*", w: 4 },
    { t: "wafer*", w: 4 }, { t: "battery plant", w: 4 }, { t: "microchip", w: 4 },
    { t: "amkor", w: 4 }, { t: "onsemi", w: 4 },
    { t: "manufacturing", w: 3 }, { t: "machining", w: 3 }, { t: "cnc", w: 3 },
    { t: "fabricat*", w: 3 }, { t: "robotics", w: 3 }, { t: "3d printing", w: 3 },
    { t: "factory", w: 2 }, { t: "industrial", w: 2 }, { t: "automation", w: 2 },
    { t: "foundry", w: 2 },
  ],
  "Specialty Trades & Construction": [
    { t: "general contractor", w: 4 }, { t: "construction", w: 4 }, { t: "hvac", w: 4 },
    { t: "plumbing", w: 4 }, { t: "roofing", w: 4 }, { t: "skilled trades", w: 4 },
    { t: "electrical contractor*", w: 4 }, { t: "home services", w: 3 },
    { t: "contractor*", w: 3 }, { t: "subcontractor*", w: 3 }, { t: "paving", w: 3 },
    { t: "concrete", w: 3 }, { t: "sundt", w: 3 }, { t: "kitchell", w: 3 },
    { t: "electrical", w: 2 }, { t: "solar install*", w: 2 },
  ],
  Hospitality: [
    { t: "hospitality", w: 4 }, { t: "hotel*", w: 4 }, { t: "resort*", w: 4 },
    { t: "restaurant*", w: 4 }, { t: "lodging", w: 4 }, { t: "marriott", w: 4 },
    { t: "hilton", w: 4 }, { t: "hyatt", w: 4 }, { t: "four seasons", w: 4 },
    { t: "casino*", w: 3 }, { t: "tourism", w: 3 }, { t: "brewery", w: 3 },
    { t: "food hall", w: 3 }, { t: "motel*", w: 3 }, { t: "revpar", w: 3 },
    { t: "nightclub*", w: 3 },
    { t: "dining", w: 2 }, { t: "chef", w: 2 }, { t: "winery", w: 2 }, { t: "omni", w: 2 },
  ],
};

/** Minimum weighted evidence for a sector call at all. */
const MIN_SECTOR_EVIDENCE = 6;

export interface SectorCorrection {
  sector: string;
  terms: string[];
}

export interface SectorVerdict {
  sector: NewsSector;
  confidence: number;
  lowConfidence: boolean;
  tags: string[];
  scores: Record<string, number>;
  correctedBy: boolean;
}

export function classifySector(
  headline: string,
  summary: string,
  body: string,
  corrections: SectorCorrection[] = []
): SectorVerdict {
  const fields: [string, number][] = [
    [headline ?? "", FIELD_WEIGHTS.headline],
    [stripDateline(summary ?? ""), FIELD_WEIGHTS.summary],
    [stripDateline(body ?? ""), FIELD_WEIGHTS.body],
  ];
  const allText = fields.map(([t]) => t).join(" ");
  const scores: Record<string, number> = {};
  (Object.keys(SECTOR_TERMS) as FocusSector[]).forEach((s) => {
    scores[s] = 0;
  });
  for (const sector of Object.keys(SECTOR_TERMS) as FocusSector[]) {
    let total = 0;
    for (const def of SECTOR_TERMS[sector]) {
      for (const [text, w] of fields) {
        if (text && termHit(text, def.t)) total += def.w * w;
      }
    }
    scores[sector] = total;
  }
  // Learned corrections: Ethan's past "Wrong sector?" fixes vote with
  // entity weight. Two stored terms present — or one multiword entity —
  // pins the corrected sector's score at decisive mass.
  let correctedBy = false;
  for (const c of corrections) {
    if (!(c.sector in scores)) continue;
    let hits = 0;
    for (const term of c.terms) {
      if (!term) continue;
      if (termHit(allText, term)) hits += term.includes(" ") ? 2 : 1;
    }
    if (hits >= 2) {
      scores[c.sector] = Math.max(scores[c.sector], 30);
      correctedBy = true;
    }
  }
  const ranked = (Object.keys(scores) as FocusSector[])
    .map((s) => ({ s, v: scores[s] }))
    .sort((a, b) => b.v - a.v);
  const top = ranked[0];
  const second = ranked[1] ?? { s: "" as FocusSector, v: 0 };
  const mass = Math.min(1, top.v / 16);
  const margin = top.v > 0 ? (top.v - second.v) / top.v : 0;
  const confidence = Math.round((0.5 * mass + 0.5 * margin) * 100) / 100;
  const weakMargin = top.v - second.v < 3 && top.v < 14;
  if (top.v < MIN_SECTOR_EVIDENCE || weakMargin) {
    const tags =
      top.v >= MIN_SECTOR_EVIDENCE ? [top.s] : [];
    return { sector: "Other", confidence, lowConfidence: true, tags, scores, correctedBy };
  }
  const tags = ranked
    .slice(1)
    .filter((r) => r.v >= Math.max(MIN_SECTOR_EVIDENCE, top.v * 0.4))
    .slice(0, 2)
    .map((r) => r.s);
  return { sector: top.s, confidence, lowConfidence: false, tags, scores, correctedBy };
}

/* ---------------- relevance ---------------- */

const AZ_RE =
  /\b(arizona|phoenix|scottsdale|tempe|mesa|tucson|chandler|gilbert|glendale|peoria|surprise|flagstaff|yuma|prescott|avondale|goodyear|buckeye|queen creek|maricopa|pinal|sedona|lake havasu)\b/i;
const SW_RE = /\b(new mexico|albuquerque|santa fe|las cruces|nevada|las vegas|henderson|reno|utah|salt lake city|southwest)\b/i;

const DEAL_TERMS_RE =
  /\b(acqui\w+|merger|merged|merges|buyout|takeover|sold|sale of|will sell|to sell|funding|financing|raises? \$|investment|investor|expansion|expands|new (facility|plant|headquarters|campus)|groundbreak\w+|contract (award|win)|awarded|bankrupt\w+|chapter 11|private equity)\b/i;

/** Categories that must NEVER reach the feed (Ethan, Oct 17, 2026).
 * Tested on headline + summary only — a passing mention deep in a
 * snippet cannot condemn a story, and a condemned category in the
 * headline cannot be rescued by snippet text. `school-district-override`
 * is absolute: it fires even when deal vocabulary is present, because
 * the override IS the story. */
export const HARD_EXCLUDE_RULES: {
  category: string;
  label: string;
  test: (headline: string, headPlusSummary: string) => boolean;
}[] = [
  {
    category: "school-district-override",
    label: "School district budget / override",
    test: (_h, hs) =>
      /\b(school|district|unified school|school board)\b/i.test(hs) &&
      /\b(override|levy|bond measure|budget)\b/i.test(hs),
  },
  {
    category: "ballot-measure",
    label: "Ballot measure / local government",
    test: (_h, hs) =>
      /\b(ballot|referendum|proposition \d+|goes to voters|voters (will|to) decide)\b/i.test(hs) &&
      !DEAL_TERMS_RE.test(hs),
  },
  {
    category: "crime",
    label: "Crime",
    test: (h) =>
      /\b(arrested|arrests|indicted|indictment|shooting|homicide|murder|robbery|kidnapping|embezzl\w+|drug bust|pleads? guilty|pleaded guilty|sentenced to \d)\b/i.test(h),
  },
  {
    category: "sports",
    label: "Sports",
    test: (h, hs) =>
      /\b(nfl|nba|mlb|nhl|mls|touchdown|playoffs?|super bowl|world series|fiesta bowl|spring training|march madness|final four)\b/i.test(h) &&
      !DEAL_TERMS_RE.test(hs),
  },
  {
    category: "weather",
    label: "Weather",
    test: (h, hs) =>
      /\b(hurricane|tornado|monsoon|wildfire|heat ?wave|flash flood|blizzard|winter storm)\b/i.test(h) &&
      !DEAL_TERMS_RE.test(hs),
  },
  {
    category: "obituary",
    label: "Obituary",
    test: (h) => /\b(obituary|obituaries|in memoriam|funeral services?|dies (at|aged) \d)\b/i.test(h),
  },
  {
    category: "education-institutional",
    label: "Education institution news",
    test: (_h, hs) =>
      /\b(university|college|school district|community college|school board)\b/i.test(hs) &&
      !/\b(teaching hospital|medical school|hospital)\b/i.test(hs) &&
      !DEAL_TERMS_RE.test(hs),
  },
  {
    category: "consumer-promo",
    label: "Consumer promotion",
    test: (h, hs) =>
      /\b(celebrat\w+|giveaway|coupon|party hits|deals are back|what you get)\b/i.test(h) &&
      !DEAL_TERMS_RE.test(hs),
  },
];

interface DealClass {
  key: string;
  label: string;
  pts: number;
  re: RegExp;
  countsForTopEvent: boolean;
}

const DEAL_CLASSES: DealClass[] = [
  { key: "acquisition", label: "Acquisition / M&A", pts: 26, countsForTopEvent: true, re: /\b(acqui\w+|merger|merged|merges|buyout|takeover)\b/i },
  { key: "sale", label: "Business sale / succession", pts: 22, countsForTopEvent: true, re: /\b(will sell|sells (its|the|a)\b|sale of|for sale|succession|retiring|retirement)\b/i },
  { key: "pe", label: "PE / financing", pts: 18, countsForTopEvent: true, re: /\b(private equity|growth equity|recapitali\w+|capital raise|funding round|venture capital|financing)\b/i },
  { key: "expansion", label: "Expansion / new facility", pts: 16, countsForTopEvent: true, re: /\b(expansion|expands?|new (facility|plant|headquarters|campus|distribution center)|groundbreak\w+|relocat\w+|invests? \$|investment of)\b/i },
  { key: "contract", label: "Contract award", pts: 16, countsForTopEvent: true, re: /\b(contract (award|win|extension)|awarded|wins? .{0,24}contract|secures? .{0,24}contract|task order)\b/i },
  { key: "distress", label: "Distress / bankruptcy", pts: 14, countsForTopEvent: true, re: /\b(bankrupt\w+|chapter 11|receivership|liquidat\w+|shutters?|winds? down)\b/i },
  { key: "consolidation", label: "Consolidation", pts: 12, countsForTopEvent: true, re: /\b(consolidat\w+|roll-?up|platform acquisition)\b/i },
  { key: "regulatory", label: "Regulatory / supply chain", pts: 8, countsForTopEvent: false, re: /\b(fda (approval|clearance|clears?)|tariffs?|supply chain)\b/i },
];

export function recencyBonus(publishedAt: Date | null): number {
  if (!publishedAt) return 0;
  const ageH = (Date.now() - publishedAt.getTime()) / 3600e3;
  if (ageH <= 6) return 10;
  if (ageH <= 24) return 6;
  if (ageH <= 72) return 3;
  return 0;
}

export interface RelevanceInput {
  headline: string;
  summary: string;
  snippet: string;
  sector: string;
  matchedTypes: string[];
  publishedAt: string | null;
}

export interface RelevanceVerdict {
  score: number;
  reason: string;
  dealSignal: boolean;
  hardExclude: { category: string; label: string } | null;
}

export function scoreRelevance(input: RelevanceInput): RelevanceVerdict {
  const headline = input.headline ?? "";
  const summary = input.summary ?? "";
  const hs = `${headline} ${summary}`;
  for (const rule of HARD_EXCLUDE_RULES) {
    if (rule.test(headline, hs)) {
      return {
        score: 0,
        reason: `Excluded: ${rule.label}`,
        dealSignal: false,
        hardExclude: { category: rule.category, label: rule.label },
      };
    }
  }
  const all = `${hs} ${input.snippet ?? ""}`;
  const entityHit = input.matchedTypes.some((t) =>
    ["company", "deal", "operator", "investor", "hospitality"].includes(t)
  );
  const watchlistHit = input.matchedTypes.includes("watchlist");
  const azHit = AZ_RE.test(all);
  const swHit = !azHit && SW_RE.test(all);

  let score = 8;
  const notes: string[] = [];
  let bestClass: DealClass | null = null;
  for (const c of DEAL_CLASSES) {
    if (c.re.test(all)) {
      score += c.pts;
      if (!bestClass || c.pts > bestClass.pts) bestClass = c;
    }
  }
  if (bestClass) notes.push(bestClass.label);
  if (entityHit) {
    score += 30;
    notes.push(input.matchedTypes.includes("hospitality") ? "Tracked group" : "Tracked name");
  }
  if (watchlistHit) {
    score += 12;
    notes.push("Watchlist match");
  }
  const money = hs.match(/\$\s?(\d+(?:\.\d+)?)\s?(billion|million|B|M)\b/i);
  if (money) {
    const v = Number(money[1]) * (/b/i.test(money[2]) ? 1000 : 1);
    if (v >= 1000) score += 10;
    else if (v >= 100) score += 6;
    else if (v >= 10) score += 3;
  }
  if (input.sector && input.sector !== "Other") {
    score += 8;
    notes.push(input.sector);
  }
  if (azHit) {
    score += 10;
    notes.push("Arizona");
  } else if (swHit) {
    score += 5;
    notes.push("Southwest");
  }
  const pub = input.publishedAt ? new Date(input.publishedAt) : null;
  score += recencyBonus(pub && Number.isFinite(pub.getTime()) ? pub : null);

  // Soft penalties.
  if (/\b(campaign|election|governor|legislat\w+|senator|congressman|republican|democrat|city council|mayor)\b/i.test(hs) && !DEAL_TERMS_RE.test(hs)) {
    score -= 22;
    notes.push("Politics / government −22");
  }
  if (/\b(donates?|donation|pledges? \$|charity|fundraiser)\b/i.test(hs) && !bestClass) {
    score -= 14;
    notes.push("Community / CSR −14");
  }
  if (/\b(how to|tips for|what to know|opinion|editorial)\b/i.test(headline)) {
    score -= 18;
    notes.push("Advice / opinion −18");
  }
  // An unanchored story — no tracked name, no sector, no Arizona or
  // Southwest tie — cannot clear the bar no matter its vocabulary.
  if (!entityHit && (!input.sector || input.sector === "Other")) {
    score = Math.min(score, 34);
  }
  if (!entityHit && !azHit && !swHit && (!input.sector || input.sector === "Other")) {
    score = Math.min(score, 20);
  }
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reason: notes.slice(0, 4).join(" · ") || "Sector watch",
    dealSignal: !!bestClass && bestClass.countsForTopEvent,
    hardExclude: null,
  };
}

/* ---------------- feedback learning ---------------- */

const TOKEN_STOPWORDS = new Set([
  "the", "and", "for", "with", "its", "new", "says", "will", "from", "that",
  "this", "are", "has", "have", "inc", "llc", "corp", "company", "about",
  "after", "over", "into", "more", "than", "their", "they", "been", "were",
]);

/** Distinctive headline tokens used both to RECORD "Not relevant"
 * feedback (topic adjustments) and to APPLY it to similar stories. */
export function distinctiveTokens(text: string, max = 8): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of (text ?? "").toLowerCase().split(/[^a-z0-9']+/)) {
    const t = raw.replace(/^'+|'+$/g, "");
    if (t.length < 5 || /^\d+$/.test(t) || TOKEN_STOPWORDS.has(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** Terms stored with a sector correction: distinctive tokens plus any
 * capitalized multiword names from the headline ("Hanwha Systems"). */
export function extractCorrectionTerms(headline: string, summary: string): string[] {
  const terms = new Set<string>();
  const nameMatches = `${headline} ${summary}`.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,2}\b/g) ?? [];
  for (const n of nameMatches.slice(0, 3)) terms.add(n.toLowerCase());
  for (const t of distinctiveTokens(headline, 6)) terms.add(t);
  return Array.from(terms).slice(0, 8);
}

/** Score adjustment from accumulated "Not relevant" feedback: the
 * story's source penalty plus penalties for its distinctive topic
 * tokens. Adjustments are stored deltas (negative); clamped so one
 * noisy topic can never bury a source outright. */
export function feedbackDelta(
  sourceName: string,
  headline: string,
  adjustments: Map<string, number>
): number {
  let d = adjustments.get(`source:${sourceName}`) ?? 0;
  for (const t of distinctiveTokens(headline)) {
    d += adjustments.get(`topic:${t}`) ?? 0;
  }
  return Math.max(-32, Math.min(0, d));
}
