/**
 * Hospitality §5 helpers (Oct 17, 2026).
 *
 * Two jobs:
 *  1. Distinctive-name matching for tracked hospitality groups. Group
 *     names are operator names resolved from permit records — many are
 *     generic ("Canteen", "Valley Coffee", "BOSA DONUTS"). A story or a
 *     listing may only be tied to a group through a name that carries at
 *     least one DISTINCTIVE token; a false tag is worse than a missed
 *     one, so generic names are simply unmatchable.
 *  2. The hospitality listing screen for Activity (deal-flow): a
 *     hospitality business_for_sale item posts as "new" only if it
 *     passes the same screen as hospitality targets — Arizona location,
 *     multi-unit (≥3 locations) or a hotel/lodging property, and the
 *     standing viability bar (stated earnings ≥ $500K, else ask ≥ $1M).
 *     The screen fails CLOSED on proven failures (stated non-AZ
 *     location, stated location count < 3, a tracked group known to
 *     have < 3 locations, stated figures under the bar) and stays OPEN
 *     on the unverifiable — the same doctrine as the AZ rule, where a
 *     blank location is unverified, not out-of-state.
 */
import { neon } from "@neondatabase/serverless";
import { ensureSchema } from "./db-postgres";
import { isAzLocation } from "./az-location";
import { classifyIndustry } from "./industry-classify";

function sql() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (hospitality screen requires Postgres)");
  return neon(url);
}

const str = (v: unknown): string => String(v ?? "");

/* ---------------- distinctive group names ---------------- */

/** Tokens that can never make a hospitality name distinctive on their
 * own: food/service vocabulary, hospitality vocabulary, Arizona place
 * and desert words, and common adjectives/nouns that flood headlines. */
const GENERIC_TOKENS = new Set([
  // food & service vocabulary
  "restaurant", "restaurants", "cafe", "cafes", "coffee", "grill", "grille", "grills",
  "bar", "bars", "kitchen", "kitchens", "food", "foods", "dining", "eatery", "eateries",
  "pizza", "pizzeria", "sushi", "taco", "tacos", "burrito", "burritos", "burger", "burgers",
  "chicken", "mexican", "chinese", "japanese", "thai", "italian", "indian", "vietnamese",
  "korean", "mediterranean", "seafood", "steakhouse", "steak", "steaks", "bakery", "bakeries",
  "donuts", "donut", "doughnuts", "bagel", "bagels", "deli", "delis", "sandwich", "sandwiches",
  "market", "markets", "grocery", "vending", "shop", "shops", "store", "stores", "pharmacy",
  "drug", "theatre", "theater", "cinema", "fitness", "gym", "gyms", "salon", "salons", "spa",
  "spas", "auto", "car", "cars", "wash", "gas", "fuel", "mart", "canteen", "goodwill",
  "target", "subway", "express", "super", "center", "centre", "company", "companies",
  "circle", "dollar",
  "group", "groups", "holdings", "enterprise", "enterprises",
  // hospitality vocabulary
  "hotel", "hotels", "inn", "inns", "suites", "suite", "resort", "resorts", "lodging",
  "motel", "motels", "hospitality", "leisure", "diner", "diners", "tavern", "saloon",
  "lounge", "lounges", "club", "clubs", "pub", "pubs", "brewery", "brewpub", "winery",
  "wine", "wines", "beer", "beers", "ale", "ales", "brew", "brews", "brewing",
  // place / desert / generic scenery words
  "desert", "valley", "sun", "sunny", "canyon", "cactus", "mountain", "mountains",
  "river", "rivers", "palm", "palms", "saguaro", "sky", "stone", "stones", "copper",
  "sonoran", "southwest", "southwestern", "pacific", "atlantic", "arizona", "phoenix",
  "scottsdale", "tempe", "mesa", "tucson", "chandler", "gilbert", "glendale", "peoria",
  "flagstaff", "yuma", "prescott",
  // common adjectives / nouns that flood headlines
  "the", "and", "of", "at", "a", "an", "by", "for", "with", "house", "houses", "room",
  "rooms", "table", "tables", "fork", "spoon", "salt", "pepper", "fire", "flame", "flames",
  "smoke", "oak", "pine", "elm", "garden", "gardens", "park", "parks", "lake", "lakes",
  "creek", "ridge", "peak", "summit", "vista", "bella", "casa", "la", "el", "los", "las",
  "mi", "de", "del", "san", "santa", "real", "fiesta", "cantina", "taqueria", "cocina",
  "sabor", "olive", "basil", "ginger", "lemon", "mango", "peach", "apple", "orange",
  "cherry", "berry", "sweet", "sugar", "honey", "butter", "bread", "milk", "egg", "eggs",
  "daily", "morning", "evening", "night", "nights", "day", "days", "original", "famous",
  "world", "global", "united", "alliance", "partners", "partner", "brothers", "bros",
  "sons", "son", "daughters", "mom", "moms", "dad", "dads", "uncle", "aunt", "chef",
  "chefs", "cook", "cooks", "eats", "bites", "bowls", "bowl", "plates", "plate", "cups",
  "cup", "mugs", "hall", "halls", "ranch", "farm", "farms", "orchard", "grove", "fields",
  "field", "harvest", "seed", "root", "roots", "leaf", "leaves", "branch", "branches",
  "tree", "trees", "wood", "woods", "iron", "steel", "brick", "bricks", "marble",
  "granite", "adobe", "mission", "hacienda", "patio", "terrace", "rooftop", "downtown",
  "uptown", "midtown", "heights", "hills", "hill", "springs", "spring", "falls", "fall",
  "bay", "beach", "coast", "shore", "island", "islands", "harbor", "harbour", "port",
  "dock", "pier", "marina", "anchor", "sail", "wave", "waves", "tide", "current",
  "drift", "ember", "embers", "ash", "coal", "forge", "anvil", "hammer", "gold",
  "golden", "silver", "red", "blue", "green", "white", "black", "brown", "grand",
  "royal", "classic", "fresh", "modern", "american", "national", "first", "premier",
  "quality", "total", "family", "hometown", "village", "town", "city", "country",
  "western", "southern", "northern", "eastern", "old", "new", "happy", "lucky",
  "best", "top", "main", "central", "plaza", "pointe", "point", "points", "commons",
  "crossing", "crossings", "station", "stations", "great", "little", "big", "lone",
  "star", "stars", "eagle", "eagles", "hawk", "hawks", "wolf", "bear", "bears",
  "lion", "lions", "tiger", "tigers", "wild", "free", "true", "pure", "prime",
  "choice", "select", "llc", "inc", "corp", "corporation", "co", "ltd", "llp",
]);

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/’/g, "'")
    .split(/[^a-z0-9']+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

function isDistinctiveToken(t: string): boolean {
  if (t.length < 3 || /^\d+$/.test(t)) return false;
  const bare = t.replace(/'s$/, "");
  return !GENERIC_TOKENS.has(t) && !GENERIC_TOKENS.has(bare);
}

/**
 * The name a tracked hospitality group may be matched by, or null when
 * the name is too generic to match safely. Strips permit store numbers
 * ("McDonald's #20697" → "McDonald's", "Jimmy John's - #1635" →
 * "Jimmy John's") and corporate suffixes. Requires at least one
 * distinctive token; a single-token name must be ≥5 chars and itself
 * distinctive.
 */
export function hospitalityMatchName(raw: string): string | null {
  const name = (raw ?? "")
    .replace(/\s*[-–—]?\s*#\s*\d+\s*$/, "")
    .replace(/\s+(llc|inc|corp|co|ltd|llp)\.?$/i, "")
    .replace(/[,\s]+$/, "")
    .trim();
  if (name.length < 4) return null;
  const tokens = nameTokens(name);
  if (!tokens.length) return null;
  if (!tokens.some(isDistinctiveToken)) return null;
  if (tokens.length === 1 && (tokens[0].length < 5 || !isDistinctiveToken(tokens[0]))) return null;
  return name;
}

/** Loose key for containment comparisons: lowercase alphanumerics +
 * single spaces, apostrophes dropped ("filiberto s mexican food"). */
export function nameKey(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* ---------------- the listing screen ---------------- */

const HOTEL_RE =
  /\b(hotel|hotels|lodging|resort|resorts|motel|motels|inn|inns|suites|extended stay|bed and breakfast)\b/i;

export function isHospitalityListing(industry: string, title = ""): boolean {
  const ind = (industry ?? "").trim();
  if (ind) {
    if (classifyIndustry(ind) === "Hospitality & Leisure") return true;
    return /\b(hospitality|restaurant|food|beverage|dining|eatery|catering|brewpub|tavern)\b/i.test(ind);
  }
  return classifyIndustry(title) === "Hospitality & Leisure";
}

/** A location count stated in free text: "5 locations", "3 stores". */
export function parseStatedLocations(text: string): number | null {
  const m = (text ?? "").match(/(\d{1,3})\s*(?:locations|stores|units|restaurants|properties)\b/i);
  return m ? Number(m[1]) : null;
}

export interface TrackedGroupHit {
  name: string;
  locationCount: number;
}

let groupCache: { at: number; groups: { matchName: string; key: string; name: string; locationCount: number }[] } | null = null;
const GROUP_CACHE_MS = 10 * 60e3;

/** Find a tracked hospitality group named in a listing title. Uses the
 * same distinctive match names as the news screen; containment is on
 * the normalized key, longest match name wins. */
export async function findTrackedGroup(title: string): Promise<TrackedGroupHit | null> {
  if (!groupCache || Date.now() - groupCache.at > GROUP_CACHE_MS) {
    await ensureSchema();
    const rows = (await sql()`
      SELECT name, location_count FROM mi_hospitality_groups`) as unknown as Record<string, unknown>[];
    const groups: { matchName: string; key: string; name: string; locationCount: number }[] = [];
    for (const r of rows) {
      const matchName = hospitalityMatchName(str(r.name));
      if (!matchName) continue;
      groups.push({
        matchName,
        key: nameKey(matchName),
        name: str(r.name),
        locationCount: Number(r.location_count ?? 0),
      });
    }
    groups.sort((a, b) => b.key.length - a.key.length);
    groupCache = { at: Date.now(), groups };
  }
  const titleKey = ` ${nameKey(title)} `;
  for (const g of groupCache.groups) {
    if (g.key.length >= 4 && titleKey.includes(` ${g.key} `)) {
      return { name: g.name, locationCount: g.locationCount };
    }
  }
  return null;
}

export interface HospitalityScreenInput {
  title: string;
  industry: string;
  location: string;
  why?: string;
  price?: number | null;
  cashFlow?: number | null;
  locations?: number | null;
}

export interface HospitalityScreenVerdict {
  pass: boolean;
  reason: string;
}

/**
 * The §5 screen. Fail-closed only on proven failures; unverifiable
 * dimensions stay open (mirrors the AZ blank-location doctrine).
 */
export async function screenHospitalityListing(
  input: HospitalityScreenInput
): Promise<HospitalityScreenVerdict> {
  // Arizona — a stated non-AZ location fails (blank stays open).
  if ((input.location ?? "").trim() && !isAzLocation(input.location)) {
    return { pass: false, reason: `non-Arizona location "${input.location}"` };
  }
  // Viability — judged only on figures actually stated.
  if (input.cashFlow !== null && input.cashFlow !== undefined) {
    if (input.cashFlow < 500000) {
      return { pass: false, reason: `stated earnings $${Math.round(input.cashFlow)} under the $500K bar` };
    }
  } else if (input.price !== null && input.price !== undefined) {
    if (input.price < 1000000) {
      return { pass: false, reason: `earnings undisclosed and ask $${Math.round(input.price)} under the $1M bar` };
    }
  }
  // Multi-unit or hotel.
  const stated =
    input.locations !== null && input.locations !== undefined
      ? input.locations
      : parseStatedLocations(`${input.title} ${input.why ?? ""}`);
  if (stated !== null) {
    return stated >= 3
      ? { pass: true, reason: `${stated} locations stated` }
      : { pass: false, reason: `only ${stated} location(s) stated — hospitality screen requires 3+ or a hotel` };
  }
  if (HOTEL_RE.test(`${input.title} ${input.industry}`)) {
    return { pass: true, reason: "hotel/lodging property" };
  }
  try {
    const hit = await findTrackedGroup(input.title);
    if (hit) {
      return hit.locationCount >= 3
        ? { pass: true, reason: `tracked group ${hit.name} (${hit.locationCount} locations)` }
        : { pass: false, reason: `tracked group ${hit.name} has ${hit.locationCount} location(s) — under the 3+ screen` };
    }
  } catch {
    // Group table unavailable — unverifiable, stays open.
  }
  return { pass: true, reason: "multi-unit status unverifiable — admitted, screen applies on stated facts only" };
}
