// Word-boundary keyword matching (Ethan, Oct 2026 — a resort deal was tagged
// "Healthcare" because the old substring match found "hospital" inside
// "hospitality"). Words ending in * are prefix stems (fabricat* →
// fabrication); all others must match as whole words. Order matters: the
// first matching category wins, and Hospitality sits above Healthcare so
// hotels/resorts can never fall into the hospital bucket.
export const INDUSTRY_KEYWORDS: { industry: string; words: string[] }[] = [
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

/** Word-boundary token sourced from a regex literal via .source — NEVER
 * from a string literal. In the production (minified) build, a
 * string-carried "\b" degrades to a backspace character and silently
 * kills the boundary (proven root cause of the Phase 5 Item 0 parser
 * bug, fixed in 9abefcf9); regex literals pass through the build
 * verbatim, so .source always yields the true two-character sequence. */
const WB = /\b/.source;

/** Whole-word / prefix-stem keyword test: "hospital" must NOT match inside
 * "hospitality"; words ending in * match word prefixes (fabricat*). */
export function kwMatch(text: string, word: string): boolean {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return word.endsWith("*")
    ? new RegExp(`${WB}${esc.slice(0, -2)}`, "i").test(text)
    : new RegExp(`${WB}${esc}${WB}`, "i").test(text);
}

export function classifyIndustry(text: string): string {
  for (const { industry, words } of INDUSTRY_KEYWORDS) {
    if (words.some((w) => kwMatch(text, w))) return industry;
  }
  return "";
}
