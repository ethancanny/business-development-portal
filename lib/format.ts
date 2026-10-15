export function fmtMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Exact-duplicate removal for display/write lists, preserving
 * first-seen order (Ethan, Oct 14, 2026 — repeated tokens and chips
 * kept reaching the screen wherever values were aggregated without
 * dedupe: "USASpending · USASpending", the same industry chip twice).
 */
export function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (v === null || v === undefined) continue;
    const s = String(v);
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

/**
 * Dedupe the tokens inside ONE composite source string
 * ("SAM.gov + USASpending + USASpending" → "SAM.gov + USASpending").
 * Tokens are split on "+" / "·" boundaries; the joiner follows the
 * string's own separator. Single-token strings pass through untouched.
 */
export function dedupeSourceTokens(source: string): string {
  const s = (source ?? "").trim();
  if (!s) return s;
  const tokens = s
    .split(/\s*[+·]\s*/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (tokens.length < 2) return s;
  return uniqueStrings(tokens).join(s.includes("+") ? " + " : " · ");
}
