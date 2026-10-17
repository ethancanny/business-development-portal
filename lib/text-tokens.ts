/** Shared name tokenization for the chain/franchise and institutional
 * matchers (moved out of lib/market-db.ts Oct 17, 2026 — the file
 * outgrew the GitHub push payload cap; both filters must tokenize
 * identically, so the helpers live here, import-free). */

/** Brand/name tokenizer: uppercase, apostrophes dropped (so DENNY'S
 * and Denny's agree), punctuation becomes spaces, corporate suffixes
 * dropped. Token-sequence matching gives word boundaries for free —
 * "ALDI" matches the Aldi group but never "ESMERALDITA". */
export function chainTokens(s: string): string[] {
  return (s || "")
    .toUpperCase()
    .replace(/['’]/g, "")
    .replace(/&/g, " AND ")
    .replace(/[^A-Z0-9]+/g, " ")
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t && !["INC", "LLC", "LTD", "CORP", "CORPORATION", "CO", "COMPANY", "LP", "LLP", "PLC", "THE"].includes(t));
}

export const stemToken = (t: string): string => (t.length > 3 && t.endsWith("S") ? t.slice(0, -1) : t);

export function tokensContainSeq(hay: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) {
    let ok = true;
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}
