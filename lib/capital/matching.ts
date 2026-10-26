/**
 * Investor ↔ raise matching (Investors & Capital Redesign Step 1).
 *
 * PURE scoring — no DB, no imports from other modules — so a test
 * harness can exercise it directly. The service layer
 * (lib/capital/service.ts listMatchingForRaise) gathers the inputs
 * (capital profile, deal context, participation) and calls
 * scoreInvestorForRaise with the stored weights
 * (capital.matching_weights, editable in Settings).
 *
 * Score = Σ criterion points (weights are points, defaulting to
 * 30/20/20/10/10/10 = 100). A hard type mismatch (the investor records
 * type preferences and this raise's type is not among them) caps the
 * total at 49 so a mismatch can never rank as a strong match.
 */

export interface MatchingWeights {
  type: number;
  checkSize: number;
  sector: number;
  structure: number;
  geography: number;
  activity: number;
}

export const DEFAULT_MATCHING_WEIGHTS: MatchingWeights = {
  type: 30,
  checkSize: 20,
  sector: 20,
  structure: 10,
  geography: 10,
  activity: 10,
};

export type MatchCriterionKey =
  | "type"
  | "checkSize"
  | "sector"
  | "structure"
  | "geography"
  | "activity";

export interface MatchReason {
  criterion: MatchCriterionKey;
  matched: boolean;
  partial: boolean;
  text: string;
}

/** The slice of the (extended) capital profile matching reads. */
export interface MatchingProfile {
  exists?: boolean;
  thesisSectors?: string[];
  structurePrefs?: string;
  geography?: string;
  checkSizeMin?: number | null;
  checkSizeMax?: number | null;
  investsInTypes?: string[];
  checkByType?: Record<
    string,
    { min: number | null; max: number | null }
  >;
}

export interface ScoreInvestorInput {
  profile: MatchingProfile | null;
  dealTypeKey: string | null;
  dealTypeLabel: string;
  industry: string;
  target: number;
  remaining: number;
  hasPriorCommitment: boolean;
  lastTouchAt: string | null;
}

export interface MatchScore {
  score: number;
  reasons: MatchReason[];
}

const TYPE_LABELS: Record<string, string> = {
  platform_lbo: "Platform LBO",
  add_on: "Add-on",
  early_stage: "Early Stage",
  minority_growth: "Minority Growth",
};

export function typeLabel(key: string): string {
  return TYPE_LABELS[key] ?? key;
}

function money(v: number): string {
  if (!Number.isFinite(v)) return "—";
  if (Math.abs(v) >= 1_000_000) {
    const m = v / 1_000_000;
    return `$${Number.isInteger(m) ? m : Math.round(m * 10) / 10}M`;
  }
  if (Math.abs(v) >= 1_000) return `$${Math.round(v / 1_000)}K`;
  return `$${Math.round(v)}`;
}

function rangeText(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  const hasMin = min !== null && min !== undefined;
  const hasMax = max !== null && max !== undefined;
  if (hasMin && hasMax) return `${money(min)}–${money(max)}`;
  if (hasMin) return `${money(min)}+`;
  if (hasMax) return `up to ${money(max)}`;
  return "no range recorded";
}

/** A&D synonym folding: aerospace / defense / a&d are one sector. */
function sectorTokens(raw: string): string[] {
  const s = (raw ?? "").toLowerCase().trim();
  if (!s) return [];
  const tokens = [s];
  if (
    s.includes("aerospace") ||
    s.includes("defense") ||
    s.includes("defence") ||
    s.includes("a&d") ||
    s.includes("a & d")
  ) {
    tokens.push("a&d");
  }
  return tokens;
}

function sectorMatch(thesis: string[], industry: string): boolean {
  const ind = (industry ?? "").toLowerCase().trim();
  if (!ind) return false;
  const indTokens = sectorTokens(ind);
  for (const t of thesis) {
    const tt = (t ?? "").toLowerCase().trim();
    if (!tt) continue;
    if (tt.includes(ind) || ind.includes(tt)) return true;
    const tTokens = sectorTokens(tt);
    if (tTokens.some((x) => indTokens.includes(x))) return true;
  }
  return false;
}

const STRUCTURE_TOKENS = [
  "common",
  "preferred",
  "deal-by-deal",
  "spv",
  "convertible",
  "safe",
] as const;

/** Structure tokens that are plausible for each deal type. */
function plausibleStructures(dealTypeKey: string | null): string[] {
  switch (dealTypeKey) {
    case "early_stage":
      return ["convertible", "safe", "preferred", "common", "spv", "deal-by-deal"];
    case "minority_growth":
      return ["preferred", "common", "deal-by-deal", "spv"];
    case "platform_lbo":
    case "add_on":
      return ["common", "preferred", "deal-by-deal", "spv"];
    default:
      return [...STRUCTURE_TOKENS];
  }
}

function geographyMatches(geography: string): boolean {
  const g = (geography ?? "").toLowerCase();
  if (!g.trim()) return false;
  if (
    g.includes("arizona") ||
    g.includes("national") ||
    g.includes("anywhere") ||
    g.includes("southwest") ||
    g.includes("united states")
  ) {
    return true;
  }
  // Bare "AZ" as its own token.
  return /(^|[^a-z])az([^a-z]|$)/.test(g);
}

export function scoreInvestorForRaise(
  input: ScoreInvestorInput,
  weights: MatchingWeights
): MatchScore {
  const profile = input.profile;
  const reasons: MatchReason[] = [];
  let total = 0;
  let typeMismatchCap = false;

  /* ------------------------------- type ------------------------------ */
  {
    const w = weights.type;
    const invests = (profile?.investsInTypes ?? []).filter(Boolean);
    const dealType = input.dealTypeKey ?? "";
    if (!dealType) {
      reasons.push({
        criterion: "type",
        matched: false,
        partial: true,
        text: "Deal has no investment type recorded",
      });
      total += w * 0.4;
    } else if (!invests.length) {
      reasons.push({
        criterion: "type",
        matched: false,
        partial: true,
        text: "No type preference recorded for this investor",
      });
      total += w * 0.4;
    } else if (invests.includes(dealType)) {
      reasons.push({
        criterion: "type",
        matched: true,
        partial: false,
        text: `Invests in ${input.dealTypeLabel || typeLabel(dealType)} — matches this raise`,
      });
      total += w;
    } else {
      typeMismatchCap = true;
      reasons.push({
        criterion: "type",
        matched: false,
        partial: false,
        text: `Type mismatch: invests in ${invests.map(typeLabel).join(", ")}, this raise is ${input.dealTypeLabel || typeLabel(dealType)}`,
      });
    }
  }

  /* ---------------------------- check size --------------------------- */
  {
    const w = weights.checkSize;
    const target = input.target || 0;
    if (!(target > 0)) {
      reasons.push({
        criterion: "checkSize",
        matched: false,
        partial: false,
        text: "Raise target not set",
      });
    } else {
      const typical = (input.remaining > 0 ? input.remaining : target) / 3;
      const byType = input.dealTypeKey
        ? profile?.checkByType?.[input.dealTypeKey]
        : undefined;
      const range =
        byType && (byType.min !== null || byType.max !== null)
          ? byType
          : {
              min: profile?.checkSizeMin ?? null,
              max: profile?.checkSizeMax ?? null,
            };
      if (range.min === null && range.max === null) {
        reasons.push({
          criterion: "checkSize",
          matched: false,
          partial: true,
          text: `No check size recorded for this investor; a typical check here is about ${money(typical)}`,
        });
        total += w * 0.5;
      } else {
        const min = range.min ?? 0;
        const max = range.max ?? Number.POSITIVE_INFINITY;
        const rt = rangeText(range.min, range.max);
        if (typical >= min && typical <= max) {
          reasons.push({
            criterion: "checkSize",
            matched: true,
            partial: false,
            text: `Check size ${rt} covers a typical check of about ${money(typical)}`,
          });
          total += w;
        } else if (max >= typical / 2) {
          reasons.push({
            criterion: "checkSize",
            matched: false,
            partial: true,
            text: `Check size ${rt} is a stretch for a typical check of about ${money(typical)}`,
          });
          total += w * 0.5;
        } else {
          reasons.push({
            criterion: "checkSize",
            matched: false,
            partial: false,
            text: `Check size ${rt} is below a typical check of about ${money(typical)}`,
          });
        }
      }
    }
  }

  /* ------------------------------ sector ----------------------------- */
  {
    const w = weights.sector;
    const thesis = (profile?.thesisSectors ?? []).filter(Boolean);
    if (!thesis.length) {
      reasons.push({
        criterion: "sector",
        matched: false,
        partial: true,
        text: "No sector focus recorded",
      });
      total += w * 0.5;
    } else if (sectorMatch(thesis, input.industry)) {
      reasons.push({
        criterion: "sector",
        matched: true,
        partial: false,
        text: `Sector focus (${thesis.join(", ")}) matches ${input.industry || "this deal"}`,
      });
      total += w;
    } else {
      reasons.push({
        criterion: "sector",
        matched: false,
        partial: false,
        text: `Sector focus (${thesis.join(", ")}) does not cover ${input.industry || "this deal's sector"}`,
      });
    }
  }

  /* ---------------------------- structure ---------------------------- */
  {
    const w = weights.structure;
    const prefs = (profile?.structurePrefs ?? "").toLowerCase();
    const tokens = STRUCTURE_TOKENS.filter((t) => prefs.includes(t));
    // "deal by deal" spelled with spaces counts as deal-by-deal.
    if (!tokens.includes("deal-by-deal") && prefs.includes("deal by deal")) {
      tokens.push("deal-by-deal");
    }
    if (!prefs.trim()) {
      reasons.push({
        criterion: "structure",
        matched: false,
        partial: true,
        text: "No structure preference recorded",
      });
      total += w * 0.5;
    } else if (
      tokens.some((t) => plausibleStructures(input.dealTypeKey).includes(t))
    ) {
      reasons.push({
        criterion: "structure",
        matched: true,
        partial: false,
        text: `Structure preference (${profile?.structurePrefs}) works for this raise`,
      });
      total += w;
    } else {
      reasons.push({
        criterion: "structure",
        matched: false,
        partial: true,
        text: `Structure preference (${profile?.structurePrefs}) is unusual for this type of raise`,
      });
      total += w * 0.25;
    }
  }

  /* ---------------------------- geography ---------------------------- */
  {
    const w = weights.geography;
    const geo = profile?.geography ?? "";
    if (!geo.trim()) {
      reasons.push({
        criterion: "geography",
        matched: false,
        partial: true,
        text: "No geography preference recorded",
      });
      total += w * 0.5;
    } else if (geographyMatches(geo)) {
      reasons.push({
        criterion: "geography",
        matched: true,
        partial: false,
        text: `Geography (${geo}) includes Arizona / national scope`,
      });
      total += w;
    } else {
      reasons.push({
        criterion: "geography",
        matched: false,
        partial: false,
        text: `Geography (${geo}) does not include Arizona`,
      });
    }
  }

  /* ----------------------------- activity ---------------------------- */
  {
    const w = weights.activity;
    const hasProfile = Boolean(profile) && profile?.exists !== false;
    if (input.hasPriorCommitment) {
      reasons.push({
        criterion: "activity",
        matched: true,
        partial: false,
        text: "Has committed with Canny before",
      });
      total += w;
    } else if (input.lastTouchAt) {
      const t = new Date(input.lastTouchAt).getTime();
      const within180 =
        Number.isFinite(t) && Date.now() - t <= 180 * 24 * 3600 * 1000;
      if (within180) {
        reasons.push({
          criterion: "activity",
          matched: false,
          partial: true,
          text: "In touch within the last 180 days",
        });
        total += w * 0.6;
      } else if (hasProfile) {
        reasons.push({
          criterion: "activity",
          matched: false,
          partial: true,
          text: "Capital profile on file, but no recent touch",
        });
        total += w * 0.3;
      } else {
        reasons.push({
          criterion: "activity",
          matched: false,
          partial: false,
          text: "No capital profile yet",
        });
      }
    } else if (hasProfile) {
      reasons.push({
        criterion: "activity",
        matched: false,
        partial: true,
        text: "Capital profile on file, but never touched",
      });
      total += w * 0.3;
    } else {
      reasons.push({
        criterion: "activity",
        matched: false,
        partial: false,
        text: "No capital profile yet",
      });
    }
  }

  let score = Math.round(total);
  if (typeMismatchCap) score = Math.min(score, 49);
  score = Math.max(0, Math.min(100, score));
  return { score, reasons };
}
