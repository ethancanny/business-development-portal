export function fmtMoney(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

/**
 * Compact money for stat tiles and big-number displays (visual
 * polish, Oct 17, 2026): $9.5M instead of $9,499,994, $950K under a
 * million, full dollars under $10K. One decimal, trailing ".0"
 * dropped. The exact figure stays one tap away — callers pair this
 * with fmtMoney in the title attribute / detail view.
 */
export function fmtMoneyCompact(value: number): string {
  const v = value || 0;
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const trim = (n: number) =>
    n.toFixed(1).replace(/\.0$/, "");
  if (abs >= 1_000_000_000) return `${sign}$${trim(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}$${trim(abs / 1_000_000)}M`;
  if (abs >= 10_000) return `${sign}$${trim(abs / 1_000)}K`;
  return fmtMoney(v);
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
/** Compact relative time for feed timestamps ("just now", "2h ago"). */
export function fmtRelTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const secs = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "1d ago" : `${days}d ago`;
}

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
