// Arizona-location test for the Arizona-only Businesses for Sale rule
// (Ethan, Oct 14, 2026): a listing with a stated location that shows no
// Arizona signal is auto-dismissed. A blank location is NOT dismissed —
// it is unverified, not out-of-state.
const AZ_PLACES = [
  "arizona", "phoenix", "scottsdale", "tempe", "mesa", "tucson", "chandler",
  "gilbert", "glendale", "peoria", "surprise", "flagstaff", "yuma", "prescott",
  "avondale", "goodyear", "buckeye", "queen creek", "maricopa", "pinal",
  "sedona", "lake havasu", "casa grande", "sierra vista", "bullhead",
  "kingman", "payson", "oro valley", "marana", "apache junction",
  "fountain hills", "paradise valley", "cave creek", "wickenburg", "nogales",
  "safford", "globe", "cottonwood", "chino valley", "prescott valley",
  "florence", "sahuarita", "green valley", "san luis", "parker", "yavapai",
  "mohave", "coconino", "pima", "cochise", "navajo", "gila", "graham",
  "greenlee", "la paz", "santa cruz", "apache county",
];

export function isAzLocation(location: string): boolean {
  const loc = (location || "").trim().toLowerCase();
  if (!loc) return true; // unknown — keep, do not auto-dismiss
  if (/,\s*az\b/.test(loc) || loc.endsWith(" az")) return true;
  return AZ_PLACES.some((p) => loc.includes(p));
}

export function shouldAutoDismiss(kind: string, location: string): boolean {
  return kind === "business_for_sale" && !isAzLocation(location);
}
