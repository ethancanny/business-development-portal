import { chainTokens, stemToken, tokensContainSeq } from "./text-tokens";

/** First index of a token sequence in a token list, or -1. */
function seqIndex(hay: string[], needle: string[]): number {
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return i;
  }
  return -1;
}

/* ---------------- Institutional filter (Ethan, Oct 17, 2026) -------------
 * Companion to the chain filter, and it runs FIRST: Canny only wants
 * independent, privately owned, for-profit operating businesses, so
 * schools, nonprofits, government bodies, religious organizations,
 * cooperatives, correctional facilities, and dining operations inside
 * institutions are excluded from Fits on every spine. Architecture
 * mirrors the chain filter exactly: detection in the central write
 * path (importCompanies), the rescore/restore paths, and a batch pass
 * (runInstitutionalDetectionBatch). is_institutional rows leave the
 * fits feed + counts and list in Filtered Out with a plain-language
 * reason ("Institutional: school", "Institutional: nonprofit", ...);
 * they are never deleted. institutional_exempt (the "Not
 * institutional" override) is permanent, exactly like chain_exempt.
 * Dismissed records are never written by detection in any path.
 *
 * HARD signals (any one flags is_institutional):
 *   name      — an institutional term in the name (table below),
 *               matched on the chain tokenizer's word boundaries.
 *   entity    — a stored entity-type field says nonprofit / tax
 *               exempt / government / educational / cooperative.
 *               Sources the portal actually holds: SAM.gov's
 *               entityStructureDesc (details.structure). USASpending
 *               recipient types and NPPES carry no such field in
 *               storage today; ACC entity types are NOT consulted —
 *               the ACC search is human-check-gated and no live
 *               lookup is possible from the portal.
 *   ownership — the hospitality ownership detector stamped the group
 *               "institutional" (contract foodservice operators).
 *   facility  — the record's permitted locations are institutional
 *               facilities (stamped by the hospitality sync as
 *               institutionalLocationCount with zero commercial
 *               locations), or a stored permit/facility type is an
 *               institutional class (school / hospital / nursing /
 *               detention / church kitchen).
 * WEAK signals (never a hard flag alone; tag institutional_suspect =
 * "Possible institution", held out of Fits pending review): a term
 * with a plausible commercial reading — University (place name),
 * Temple (surname), Club (member-owned vs commercial), HOA (the
 * association vs its manager), a standalone VA or Base, Foundation
 * in the trades sector (structural foundations are a trade), and
 * "Senior Living" / "Care Center" outside Hospitality (care
 * OPERATORS are healthcare targets; only their dining arms are
 * institutional, and those surface in the Hospitality spine). Two or
 * more independent weak signals corroborate into a hard flag.
 * COMMERCIAL EXCEPTION (Ethan): "School" / "Academy" are NOT
 * automatic when the business is clearly commercial — Driving
 * School, Cooking School, Dance Academy, Music School, Swim School,
 * Tutoring. An exception phrase suppresses the school/academy name
 * signal only; every other arm still applies. */

export interface InstitutionalVerdict {
  isInstitutional: boolean;
  reason: string;
  suspect: boolean;
  suspectReason: string;
}

/** Commercial "school" businesses (Ethan's carve-out): judged on
 * entity type and ownership, never on the name alone. Matched as
 * phrases against the normalized (uppercase, punctuation-free) name. */
export const INSTITUTIONAL_COMMERCIAL_EXCEPTIONS: string[] = [
  "DRIVING SCHOOL",
  "COOKING SCHOOL",
  "CULINARY SCHOOL",
  "DANCE ACADEMY",
  "DANCE SCHOOL",
  "MUSIC SCHOOL",
  "MUSIC ACADEMY",
  "SWIM SCHOOL",
  "TUTORING",
  "MARTIAL ARTS ACADEMY",
  "MARTIAL ARTS SCHOOL",
];

/** Hard name signals: [token sequence, reason category, display term].
 * Reason categories are the plain-language buckets Ethan reviews:
 * "Institutional: school" etc. */
const INST_HARD_NAME_TERMS: { seq: string[]; cat: string; label: string; notAfter?: string[] }[] = [
  { seq: ["ELEMENTARY"], cat: "school", label: "Elementary" },
  { seq: ["HIGH", "SCHOOL"], cat: "school", label: "High School" },
  { seq: ["PRESCHOOL"], cat: "school", label: "Preschool" },
  { seq: ["CHARTER", "SCHOOL"], cat: "school", label: "Charter School" },
  { seq: ["CHARTER", "ACADEMY"], cat: "school", label: "Charter Academy" },
  { seq: ["SCHOOL", "DISTRICT"], cat: "school", label: "School District" },
  { seq: ["COLLEGE"], cat: "school", label: "College" },
  { seq: ["UNIVERSITY"], cat: "school", label: "University" },
  { seq: ["CHURCH"], cat: "religious", label: "Church" },
  { seq: ["MINISTRY"], cat: "religious", label: "Ministry" },
  { seq: ["TEMPLE"], cat: "religious", label: "Temple" },
  { seq: ["SYNAGOGUE"], cat: "religious", label: "Synagogue" },
  { seq: ["DIOCESE"], cat: "religious", label: "Diocese" },
  { seq: ["CITY", "OF"], cat: "government", label: "City of" },
  { seq: ["TOWN", "OF"], cat: "government", label: "Town of" },
  // "State of" the government — never "State-Of-The-Art".
  { seq: ["STATE", "OF"], cat: "government", label: "State of", notAfter: ["THE"] },
  { seq: ["DEPARTMENT", "OF"], cat: "government", label: "Department of" },
  { seq: ["HOUSING", "AUTHORITY"], cat: "government", label: "Housing Authority" },
  { seq: ["VA", "MEDICAL"], cat: "government", label: "VA Medical" },
  { seq: ["VA", "HOSPITAL"], cat: "government", label: "VA Hospital" },
  { seq: ["VA", "CLINIC"], cat: "government", label: "VA Clinic" },
  { seq: ["VETERANS", "AFFAIRS"], cat: "government", label: "Veterans Affairs" },
  { seq: ["COMMISSARY"], cat: "government", label: "Commissary" },
  { seq: ["MILITARY", "BASE"], cat: "government", label: "Military Base" },
  { seq: ["AIR", "FORCE", "BASE"], cat: "government", label: "Air Force Base" },
  { seq: ["CORRECTIONAL"], cat: "correctional facility", label: "Correctional" },
  { seq: ["DETENTION"], cat: "correctional facility", label: "Detention" },
  { seq: ["LIBRARY"], cat: "government", label: "Library" },
  { seq: ["MUSEUM"], cat: "nonprofit", label: "Museum" },
  { seq: ["COMMUNITY", "CENTER"], cat: "community institution", label: "Community Center" },
  { seq: ["HOSPITAL", "CAFETERIA"], cat: "healthcare facility dining", label: "Hospital cafeteria" },
  { seq: ["MEDICAL", "CENTER", "CAFETERIA"], cat: "healthcare facility dining", label: "Medical Center cafeteria" },
];

/** Weak name signals: [token sequence, ambiguity note]. Alone they
 * tag "Possible institution"; two or more corroborate into a flag. */
const INST_WEAK_NAME_TERMS: { seq: string[]; cat: string; label: string; note: string }[] = [
  { seq: ["CLUB"], cat: "member club", label: "Club", note: "member-owned clubs are institutional; commercial clubs exist" },
  { seq: ["HOA"], cat: "government", label: "HOA", note: "may be the association itself or its (commercial) manager" },
  { seq: ["BASE"], cat: "government", label: "Base", note: "\"Base\" alone does not prove a military installation" },
  // Bare District / County / Charter / Campus were HARD in the first
  // run and produced clear false positives (District Power LLC, East
  // County Wood & Tile, Charter Construction Group, a senior-living
  // "Campus") — they are ambiguous alone, so they corroborate or tag
  // for review instead. Paired forms stay hard: School District,
  // Charter School, Housing Authority.
  { seq: ["DISTRICT"], cat: "school", label: "District", note: "\"District\" alone is often a commercial district brand, not a school district" },
  { seq: ["COUNTY"], cat: "government", label: "County", note: "\"County\" may be county government or just a geographic descriptor in a contractor's name" },
  { seq: ["CHARTER"], cat: "school", label: "Charter", note: "\"Charter\" alone may be a charter school or an unrelated brand" },
  { seq: ["CAMPUS"], cat: "school", label: "Campus", note: "\"Campus\" may be a school campus or a care/office campus brand" },
];

/** Strong facility-class keywords (permit / facility types): a permit
 * class that IS an institution. Used for the facility arm and by the
 * hospitality sync to classify permitted locations. */
const INST_FACILITY_KEYWORDS = [
  "SCHOOL", "HOSPITAL", "NURSING HOME", "DETENTION", "CORRECTIONAL",
  "JAIL", "CHURCH", "MEDICAL CENTER", "HOSPICE FACILITY",
];

/** True when a permit/facility type or facility name text names an
 * institutional facility class. Exported for the hospitality sync's
 * per-location classification. */
export function isInstitutionalFacilityText(text: string): boolean {
  const t = ` ${String(text ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ")} `;
  return INST_FACILITY_KEYWORDS.some((k) => t.includes(` ${k} `) || t.includes(` ${k}`));
}

/** True when a NAME carries a hard institutional signal (name terms
 * incl. the commercial-exception handling, sector-aware Foundation).
 * Exported for the hospitality sync's per-permit classification. */
export function hasInstitutionalNameSignal(name: string, sector = ""): boolean {
  return detectInstitutional({ name, sector }).isInstitutional;
}

export function detectInstitutional(
  rec: { name: string; sector?: string; details?: string }
): InstitutionalVerdict {
  let d: Record<string, unknown> = {};
  try {
    d = rec.details ? (JSON.parse(rec.details) as Record<string, unknown>) : {};
  } catch {
    d = {};
  }
  const sector = rec.sector ?? "";
  const nameUpper = ` ${(rec.name ?? "").toUpperCase().replace(/['’]/g, "").replace(/[^A-Z0-9]+/g, " ")} `;
  const tokens = chainTokens(rec.name ?? "");
  // Stemmed tokens so plural forms match ("Mesa Public Schools").
  const stemTokens = tokens.map(stemToken);
  const hard = (cat: string, evidence: string): InstitutionalVerdict => ({
    isInstitutional: true,
    reason: `Institutional: ${cat} — ${evidence}`,
    suspect: false,
    suspectReason: "",
  });

  // (ownership) — the hospitality ownership detector's verdict is the
  // strongest institutional evidence the portal holds.
  if (String(d.ownership ?? "").toLowerCase() === "institutional") {
    const basis = typeof d.ownershipBasis === "string" && d.ownershipBasis ? ` — ${d.ownershipBasis}` : "";
    return hard("institutional operator", `ownership detector stamped "institutional"${basis}`);
  }

  // (entity) — stored entity-type fields. SAM.gov registrations carry
  // entityStructureDesc as details.structure; tax-exempt / government
  // / nonprofit / educational / cooperative structures are decisive.
  const structure = String(d.structure ?? "").trim();
  // TRAP (fixed Oct 17, 2026): SAM's most common corporate value is
  // "Corporate Entity (Not Tax Exempt)" — matching plain "tax exempt"
  // flagged every ordinary corporation as a nonprofit in the first
  // batch run (760 false positives). The explicit "not tax exempt"
  // value is for-profit evidence: it skips the entity arm (the
  // name/facility arms below still apply).
  if (structure && !/not tax exempt/i.test(structure)) {
    if (/tax exempt/i.test(structure)) return hard("nonprofit", `entity type "${structure}" (SAM.gov registration)`);
    if (/non[-\s]?profit/i.test(structure)) return hard("nonprofit", `entity type "${structure}" (SAM.gov registration)`);
    if (/government/i.test(structure)) return hard("government", `entity type "${structure}" (SAM.gov registration)`);
    if (/educational/i.test(structure)) return hard("school", `entity type "${structure}" (SAM.gov registration)`);
    if (/cooperative/i.test(structure)) return hard("cooperative", `entity type "${structure}" (SAM.gov registration)`);
  }

  // (facility) — permitted locations are institutional facilities:
  // the hospitality sync stamps commercial/institutional location
  // counts; zero commercial locations with institutional ones present
  // means the "business" is dining inside institutions.
  const commLocs = typeof d.commercialLocationCount === "number" ? d.commercialLocationCount : null;
  const instLocs = typeof d.institutionalLocationCount === "number" ? d.institutionalLocationCount : null;
  if (commLocs === 0 && instLocs !== null && instLocs > 0) {
    return hard("institutional facility", `all ${instLocs} permitted location${instLocs === 1 ? " is an institutional facility" : "s are institutional facilities"} (school / hospital / care-facility kitchens) — no commercial locations`);
  }
  // (facility) — stored permit/facility types that are institutional
  // classes outright (school cafeteria, hospital kitchen, jail, ...).
  const facTypes = Array.isArray(d.facilityTypes) ? d.facilityTypes.map((x) => String(x)) : [];
  for (const t of facTypes) {
    if (isInstitutionalFacilityText(t)) {
      return hard("institutional facility", `permit/facility type "${t}" is an institutional class`);
    }
  }

  // (name) — hard terms on word boundaries (raw + stemmed tokens).
  let churchFirst = false;
  for (const term of INST_HARD_NAME_TERMS) {
    let hit = false;
    for (const hay of [tokens, stemTokens]) {
      const needle = hay === stemTokens ? term.seq.map(stemToken) : term.seq;
      const idx = seqIndex(hay, needle);
      if (idx < 0) continue;
      if (term.notAfter && term.notAfter.includes(hay[idx + needle.length] ?? "")) continue;
      hit = true;
      break;
    }
    if (!hit) continue;
    // "Church" LEADING a name is as often a surname as a congregation
    // (Church Concrete LLC is a family-named contractor) — demote to
    // a weak signal; a church named "... Church" still flags hard.
    if (term.label === "Church" && tokens[0] === "CHURCH") {
      churchFirst = true;
      continue;
    }
    return hard(term.cat, `name contains "${term.label}"`);
  }
  // (name) — Foundation: a nonprofit tell everywhere EXCEPT the
  // trades, where a foundation is something you pour and repair.
  if (stemTokens.includes("FOUNDATION")) {
    if (sector === "Specialty Trades & Construction") {
      // falls through to the weak-signal tally below
    } else {
      return hard("nonprofit", "name contains \"Foundation\"");
    }
  }
  // (name) — dining inside a care facility: in the Hospitality spine
  // a "Senior Living" / "Care Center" permit name is the facility's
  // kitchen, not an operator. (In Healthcare the same words name the
  // target operators themselves, so the arm is hospitality-only.)
  if (sector === "Hospitality") {
    if (tokensContainSeq(tokens, ["SENIOR", "LIVING"])) {
      return hard("healthcare facility dining", "name contains \"Senior Living\" — dining at a care facility, not a commercial restaurant");
    }
    if (tokensContainSeq(tokens, ["CARE", "CENTER"])) {
      return hard("healthcare facility dining", "name contains \"Care Center\" — dining at a care facility, not a commercial restaurant");
    }
  }

  // (name) — School / Academy with Ethan's commercial exception: an
  // exception phrase suppresses the name signal (the record is then
  // judged on entity type / ownership, which ran above).
  const hasSchoolToken = stemTokens.includes("SCHOOL") || stemTokens.includes("ACADEMY");
  if (hasSchoolToken) {
    const exception = INSTITUTIONAL_COMMERCIAL_EXCEPTIONS.find((x) => nameUpper.includes(` ${x} `) || nameUpper.includes(` ${x}`));
    if (!exception) {
      return hard("school", `name contains "${stemTokens.includes("SCHOOL") ? "School" : "Academy"}"`);
    }
  }

  // ---- weak signals only from here: "Possible institution". ----
  const weak: { cat: string; text: string }[] = [];
  for (const term of INST_WEAK_NAME_TERMS) {
    if (tokensContainSeq(tokens, term.seq) || tokensContainSeq(stemTokens, term.seq.map(stemToken))) {
      weak.push({ cat: term.cat, text: `"${term.label}" in name — ${term.note}` });
    }
  }
  if (stemTokens.includes("FOUNDATION") && sector === "Specialty Trades & Construction") {
    weak.push({ cat: "nonprofit", text: "\"Foundation\" in a trades name usually means structural foundation work, not a nonprofit" });
  }
  if (churchFirst) {
    weak.push({ cat: "religious", text: "\"Church\" leading the name — a house of worship, or a surname on a family-named business" });
  }
  if (tokens.includes("VA") && !tokensContainSeq(tokens, ["VA", "MEDICAL"]) && !tokensContainSeq(tokens, ["VA", "HOSPITAL"]) && !tokensContainSeq(tokens, ["VA", "CLINIC"])) {
    weak.push({ cat: "government", text: "\"VA\" in name — may be a veterans' facility or an unrelated name" });
  }
  if (sector !== "Hospitality" && sector !== "Healthcare") {
    if (tokensContainSeq(tokens, ["SENIOR", "LIVING"])) {
      weak.push({ cat: "healthcare facility dining", text: "\"Senior Living\" in name outside the care sectors" });
    }
  }
  // Address-is-institution evidence is NOT implemented: no spine
  // holds a defensible school/hospital/government address register,
  // and inventing one would flag on guesses. The permit facility
  // classification above is the in-data proxy (see checkpoint).
  if (weak.length >= 2) {
    return hard(weak[0].cat, `corroborated weak signals: ${weak.map((w) => w.text).join("; ")}`);
  }
  if (weak.length === 1) {
    return {
      isInstitutional: false,
      reason: "",
      suspect: true,
      suspectReason: `Possible institution — ${weak[0].text}`,
    };
  }
  return { isInstitutional: false, reason: "", suspect: false, suspectReason: "" };
}
