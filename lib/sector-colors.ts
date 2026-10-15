/**
 * Sector + status color system (Ethan, Oct 14, 2026 visual refresh).
 * One muted color per focus sector, used consistently on chips, charts,
 * Directory tags, map/density markers, and tabs. Aging colors (green /
 * amber / red) are RESERVED for stage aging and relationship decay —
 * nothing else in the UI may use them.
 */

export const SECTOR_COLORS: Record<string, string> = {
  "Aerospace & Defense": "#3B5B84",
  Healthcare: "#2F7F79",
  "Advanced Manufacturing": "#B5703A",
  "Specialty Trades & Construction": "#8A7A2E",
  Hospitality: "#7A4E7E",
  // The news classifier's name for the same sector:
  "Hospitality & Leisure": "#7A4E7E",
};

export const SECTOR_ICONS: Record<string, string> = {
  "Aerospace & Defense": "✈",
  Healthcare: "✚",
  "Advanced Manufacturing": "⚙",
  "Specialty Trades & Construction": "🛠",
  Hospitality: "🍽",
  "Hospitality & Leisure": "🍽",
};

export const FOCUS_SECTOR_NAMES = [
  "Aerospace & Defense",
  "Healthcare",
  "Advanced Manufacturing",
  "Specialty Trades & Construction",
  "Hospitality",
] as const;

export function sectorColor(sector: string): string {
  return SECTOR_COLORS[sector] ?? "#64748B";
}

export function sectorIcon(sector: string): string {
  return SECTOR_ICONS[sector] ?? "◆";
}

/** Stage chips: one muted slate-blue progression, deepening as a deal or
 * operator advances. "Passed" sits outside the progression (an exit, not
 * a stage). These hues are deliberately distinct from the aging trio. */
export const STAGE_COLORS: Record<string, string> = {
  Sourcing: "#7D90B0",
  "Initial Contact": "#5B7BA6",
  Screening: "#5B7BA6",
  Diligence: "#3B5B84",
  Interview: "#3B5B84",
  Negotiation: "#2C4A73",
  "Reference Check": "#2C4A73",
  Closing: "#1E3A5F",
  Offer: "#1E3A5F",
  "Closed Won": "#122A47",
  Placed: "#122A47",
  Passed: "#8A7A86",
};

export function stageColor(stage: string): string {
  return STAGE_COLORS[stage] ?? "#64748B";
}

/** AGING / DECAY ONLY (Ethan's rule — never reuse these hues elsewhere):
 * green = on track, amber = stalled 30d or 60d without a touch,
 * red = 90d or overdue. */
export const AGING_COLORS = {
  ok: "#3E7C4F",
  warn: "#B07C24",
  bad: "#B03A2E",
} as const;

export function agingColor(days: number, warnAt = 30, badAt = 90): string {
  if (days >= badAt) return AGING_COLORS.bad;
  if (days >= warnAt) return AGING_COLORS.warn;
  return AGING_COLORS.ok;
}

/** Banner imagery (Ethan, Oct 14, 2026): the desert photo stays for
 * light mode; the uploaded night-sky photo (already the login page's
 * backdrop, hosted on the main site under the same filename) is the
 * dark-mode banner on every page and the digest/empty-state header. */
export const BANNER_LIGHT = "https://cannycapitalpartners.com/arizona-desert-hero.jpg";
export const BANNER_DARK = "https://cannycapitalpartners.com/arizona-desert-landscape.jpg";
