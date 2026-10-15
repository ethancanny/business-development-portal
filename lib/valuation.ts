import type { Deal, DealDrivers, DealStructureInput, MiMultiple } from "./types";

/** Rough multiple-range estimate for a pipeline business (Oct 10, 2026).
 *
 * Three layers, recomputed whenever the underlying data changes:
 *  1. BASE — the industry's overall multiple from Market Intel
 *     (ExitValue private deals, the deal's EV size band). EBITDA first;
 *     when no EBITDA median is published for the band (common below
 *     $25M EV), derive it from the band's EV/Revenue median and this
 *     deal's own EBITDA margin; last resort, the all-industry median.
 *  2. DRIVERS — qualitative factors recorded on the deal (customer
 *     concentration, recurring revenue, owner dependence, growth,
 *     margins, management depth, financial records) nudge the
 *     headline multiple up or down. Noting "concentration came down"
 *     (setting the driver to Low/diversified) raises the estimate.
 *  3. STRUCTURE — the HEADLINE is the fixed stated price of a deal:
 *     the sum of its pieces (or the asking price). Adding $100K of
 *     earnout or seller financing raises the headline by $100K. The
 *     EFFECTIVE multiple then discounts that headline back down,
 *     piece by piece, for expected payout and time value: cash counts
 *     at 100¢, a seller note ~95¢, rollover ~90¢, an earnout ~60¢ on
 *     the dollar. When no structure/price is on record, the headline
 *     is derived from the cash-equivalent estimate at the
 *     industry-typical mix (the Market Intel deal-structure data).
 *
 * It is deliberately rough — a yardstick that sharpens as more data
 * is recorded on the deal, not an appraisal. */

export const DRIVER_DEFS: {
  key: keyof DealDrivers;
  label: string;
  negLabel: string;
  neuLabel: string;
  posLabel: string;
  weight: number;
}[] = [
  { key: "concentration", label: "Customer concentration", negLabel: "High — a top customer is >25% of revenue", neuLabel: "Moderate", posLabel: "Low / diversified", weight: 0.75 },
  { key: "recurring", label: "Recurring / contracted revenue", negLabel: "Mostly one-off / project work", neuLabel: "Mixed", posLabel: "Mostly recurring / contracted", weight: 0.75 },
  { key: "ownerDependence", label: "Owner dependence", negLabel: "Business runs through the owner", neuLabel: "Some key-person risk", posLabel: "Runs without the owner", weight: 0.75 },
  { key: "margins", label: "Margins vs industry", negLabel: "Below typical", neuLabel: "In line", posLabel: "Above typical", weight: 0.5 },
  { key: "management", label: "Management depth", negLabel: "Thin — owner plus crew", neuLabel: "Some bench", posLabel: "Strong second layer", weight: 0.25 },
  { key: "financials", label: "Financial records", negLabel: "Messy / tax returns only", neuLabel: "Partial / reviewed", posLabel: "Clean — audited or QoE-ready", weight: 0.25 },
];

const GROUPS = [
  "Aerospace & Defense",
  "Healthcare",
  "Advanced Manufacturing",
  "Specialty Trades & Construction",
  "Business Services",
  "Consumer & Retail",
  "Technology & Media",
  "Energy & Utilities",
  "Financial Services",
  "Transportation & Logistics",
];

export function matchGroup(industry: string): string | null {
  const s = (industry || "").toLowerCase();
  if (!s) return null;
  for (const g of GROUPS) if (g.toLowerCase() === s) return g;
  if (/aero|defen|defense|aviation|space/.test(s)) return "Aerospace & Defense";
  if (/health|medical|dental|clinic|hospice|pharma|vet/.test(s)) return "Healthcare";
  if (/manufact|fabricat|machin|industrial|plastic|electronics|metal/.test(s)) return "Advanced Manufacturing";
  if (/construct|contractor|trades|hvac|plumb|electric|roofing|concrete/.test(s)) return "Specialty Trades & Construction";
  if (/saas|software|tech|media|digital|it services|information/.test(s)) return "Technology & Media";
  if (/energy|utilit|oil|gas|solar/.test(s)) return "Energy & Utilities";
  if (/financ|insurance|bank|wealth/.test(s)) return "Financial Services";
  if (/transport|logistic|truck|freight|distribution|wholesale/.test(s)) return "Transportation & Logistics";
  if (/restaurant|retail|consumer|food|gaming|hospitality|hotel/.test(s)) return "Consumer & Retail";
  if (/service|consult|agency|staffing|business/.test(s)) return "Business Services";
  return null;
}

/** Ethan's five focus sectors, as deal-industry groups. Hospitality
 * deals land in Consumer & Retail in the multiples taxonomy, so they
 * are detected by name here. Everything else is "Non-focus". */
export const FOCUS_GROUPS = [
  "Aerospace & Defense",
  "Healthcare",
  "Advanced Manufacturing",
  "Specialty Trades & Construction",
] as const;

export function dealFocusSector(industry: string): string | null {
  const s = (industry || "").toLowerCase();
  if (/hospitality|hotel|lodging|resort|casino|restaurant/.test(s))
    return "Hospitality & Leisure";
  const g = matchGroup(industry);
  if (g && (FOCUS_GROUPS as readonly string[]).includes(g)) return g;
  return null;
}

export function isFocusDeal(industry: string): boolean {
  return dealFocusSector(industry) !== null;
}

/** Industry-typical structure mixes (% of value), midpoints of the
 * Market Intel per-industry deal-structure ranges. */
const TYPICAL_STRUCTURE: Record<string, { cash: number; seller: number; earnout: number; rollover: number }> = {
  "Aerospace & Defense": { cash: 87, seller: 8, earnout: 5, rollover: 0 },
  Healthcare: { cash: 80, seller: 10, earnout: 4, rollover: 6 },
  "Advanced Manufacturing": { cash: 86, seller: 8, earnout: 6, rollover: 0 },
  "Specialty Trades & Construction": { cash: 80, seller: 12, earnout: 8, rollover: 0 },
  "Business Services": { cash: 84, seller: 8, earnout: 8, rollover: 0 },
  "Consumer & Retail": { cash: 82, seller: 10, earnout: 8, rollover: 0 },
  "Technology & Media": { cash: 85, seller: 6, earnout: 9, rollover: 0 },
  "Energy & Utilities": { cash: 85, seller: 8, earnout: 7, rollover: 0 },
  "Financial Services": { cash: 84, seller: 8, earnout: 8, rollover: 0 },
  "Transportation & Logistics": { cash: 82, seller: 10, earnout: 8, rollover: 0 },
};
const DEFAULT_STRUCTURE = { cash: 85, seller: 8, earnout: 7, rollover: 0 };

/** Present value of $1 of each structure piece at the DEFAULT
 * assumptions (Ethan approved these, Oct 10, 2026): cash is cash; a
 * seller note is near par; rollover equity is real but illiquid; an
 * earnout is contingent and deferred. Where the deal records actual
 * note terms, or market rates are available, pieceValues() refines
 * the note and earnout figures off the prime rate. */
const PIECE_VALUE = { cash: 1.0, seller: 0.95, rollover: 0.9, earnout: 0.6 };

/** Market rates used to price structure pieces (percent, e.g. 7.75). */
export interface MarketRates {
  prime?: number | null;
  /** SBA 7(a) max rate for loans > $350K (prime + 3.00%). */
  sba?: number | null;
}

function pieceValues(
  deal: Deal,
  rates?: MarketRates
): {
  cash: number;
  seller: number;
  rollover: number;
  earnout: number;
  primePct: number | null;
  sbaPct: number | null;
  notes: string[];
} {
  const primePct = rates?.prime && rates.prime > 0 ? rates.prime : null;
  // Discount basis: the SBA 7(a) rate — prime + 3.00%, the SBA
  // maximum spread for loans over $350K and roughly what LMM
  // buyers actually pay for senior debt. Prime alone is a
  // wholesale benchmark nobody in this market borrows at, and
  // deal paper is junior to that SBA loan, so the SBA rate is
  // the right floor for pricing it. (Ethan, Oct 11, 2026.)
  const sbaPct =
    rates?.sba && rates.sba > 0 ? rates.sba : primePct !== null ? primePct + 3 : null;
  const prime = sbaPct !== null ? sbaPct / 100 : null;
  const st = deal.structure ?? {};
  const notes: string[] = [];
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

  // Seller note with known terms: present value of its payments
  // discounted at prime. A note priced at prime is worth par; a
  // below-prime note is worth less, mechanically.
  let seller = PIECE_VALUE.seller;
  if (prime !== null && st.sellerRatePct != null && st.sellerTermYrs != null && st.sellerTermYrs > 0) {
    const r = Math.max(0, st.sellerRatePct) / 100;
    const n = st.sellerTermYrs;
    const pmt = r > 0 ? r / (1 - Math.pow(1 + r, -n)) : 1 / n;
    const pv = (pmt * (1 - Math.pow(1 + prime, -n))) / prime;
    seller = clamp(pv, 0.7, 1);
    notes.push(
      `Seller note at ${(seller * 100).toFixed(0)}¢ — ${st.sellerRatePct}% over ${st.sellerTermYrs} yrs, discounted at the SBA rate ${sbaPct!.toFixed(2)}% (prime + 3.00%)`
    );
  }

  // Earnout (contingent consideration, ASC 805 style): the
  // probability-weighted expected payout, discounted at prime over
  // the earnout's period. Defaults: 70% expected payout, 2 years —
  // at prime 7% that is ≈ 61¢, matching the flat default.
  const eProb = st.earnoutProbPct != null ? clamp(st.earnoutProbPct / 100, 0, 1) : 0.7;
  const eYrs = st.earnoutPeriodYrs != null && st.earnoutPeriodYrs > 0 ? st.earnoutPeriodYrs : 2;
  let earnout: number;
  if (prime !== null) earnout = clamp(eProb / Math.pow(1 + prime, eYrs), 0.05, 1);
  else earnout = st.earnoutProbPct != null ? clamp(eProb * 0.87, 0.05, 1) : PIECE_VALUE.earnout;
  if (st.earnoutProbPct != null || st.earnoutPeriodYrs != null || st.earnoutMetric) {
    notes.push(
      `Earnout at ${(earnout * 100).toFixed(0)}¢ — ${(eProb * 100).toFixed(0)}% expected payout${
        st.earnoutMetric ? ` on ${st.earnoutMetric}` : ""
      } over ${eYrs} yrs${prime !== null ? `, discounted at the SBA rate ${sbaPct!.toFixed(2)}%` : ""}`
    );
  }

  // Rollover: 90¢ illiquidity base. With vesting terms recorded,
  // adjust for the retention probability and the average time to
  // liquidity (half the vest, discounted at prime).
  let rollover = PIECE_VALUE.rollover;
  if (st.rolloverVestYrs != null || st.rolloverProbPct != null) {
    const rp = st.rolloverProbPct != null ? clamp(st.rolloverProbPct / 100, 0, 1) : 1;
    const rv = st.rolloverVestYrs != null && st.rolloverVestYrs > 0 ? st.rolloverVestYrs : 0;
    const df = prime !== null && rv > 0 ? 1 / Math.pow(1 + prime, rv / 2) : 1;
    rollover = clamp(0.9 * rp * df, 0.4, 1);
    notes.push(
      `Rollover at ${(rollover * 100).toFixed(0)}¢ — ${rv ? `${rv}-yr vesting, ` : ""}${(rp * 100).toFixed(0)}% retention, 90¢ illiquidity base`
    );
  }

  return { cash: PIECE_VALUE.cash, seller, rollover, earnout, primePct, sbaPct, notes };
}

const BANDS = ["EV < $5M", "EV $5–25M", "EV $25–100M", "EV $100–500M", "EV > $500M"];

function bandFor(deal: Deal): string {
  const ev =
    deal.askingPrice ??
    (deal.dealValue && deal.dealValue > 0 ? deal.dealValue : null) ??
    (deal.ebitda ? deal.ebitda * 6 : null) ??
    (deal.revenue ? deal.revenue * 0.8 : null);
  if (ev === null || ev === undefined) return "EV $5–25M";
  if (ev < 5e6) return "EV < $5M";
  if (ev < 25e6) return "EV $5–25M";
  if (ev < 100e6) return "EV $25–100M";
  if (ev < 500e6) return "EV $100–500M";
  return "EV > $500M";
}

function median(vals: number[]): number | null {
  if (!vals.length) return null;
  const s = vals.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function splitIndustry(ind: string): [string, string] {
  const i = ind.indexOf(" — ");
  if (i < 0) return [ind.trim(), ""];
  return [ind.slice(0, i).trim(), ind.slice(i + 3).trim()];
}

export interface MultipleEstimate {
  /** Base industry multiple before drivers/structure. */
  base: number;
  baseBasis: string;
  band: string;
  group: string | null;
  /** Valuation lens (Oct 14, 2026): EBITDA multiples for the focus
   * sectors; revenue multiples for software deals with revenue on
   * record. */
  lens: "EBITDA" | "Revenue";
  /** Human-readable source of the base multiple, e.g.
   * "ExitValue — Technology & Media overall, EV $5–25M". */
  baseSource: string;
  /** True when the base fell back to the all-industry blend. */
  baseIsBlend: boolean;
  /** Published/logged comps behind the base: ExitValue rows in the
   * group+band plus Canny Comp Log entries for the group+band. */
  compSupport: number;
  /** Confidence from compSupport: 0–2 Low, 3–6 Med, 7+ High. */
  confidence: "Low" | "Med" | "High";
  /** Canny Comp Log entries for this group+band (lens metric). */
  compLogCount: number;
  /** True when ≥5 comp-log entries fed the base (50/50 blend with
   * ExitValue, or the base outright when no ExitValue base exists). */
  compBlended: boolean;
  /** Per-driver adjustments by name, for the summary line. */
  driverImpacts: { label: string; adj: number }[];
  /** The single largest driver adjustment by absolute size. */
  largestDriver: { label: string; adj: number } | null;
  /** Sources actually used by the engine for this deal, with
   * periods — rendered in the synthesis Details view. */
  sourcesUsed: string[];
  /** Net multiple points from recorded drivers (can be negative). */
  driverAdj: number;
  /** Growth-outlook adjustment (its own layer, from growthPct). */
  growthAdj: number;
  growthNote: string | null;
  /** The market multiple for THIS business (Ethan's model,
   * Oct 11, 2026): the Market Intel base adjusted for quality
   * (drivers) and growth — the headline multiple the market
   * would price this business at. */
  marketMid: number;
  /** The market estimate: marketMid run through the USUAL deal
   * structure at today's piece values — the effective multiple
   * the market is actually pricing. */
  estimateEffMid: number;
  estimateEffLow: number;
  estimateEffHigh: number;
  /** Structure factor of the industry-typical mix at default
   * piece values (the estimate's discount). */
  typicalFactor: number;
  /** Effective multiple midpoint of the ACTUAL deal. */
  effMid: number;
  /** Actual headline midpoint minus the market multiple. */
  gapHeadlineX: number;
  /** Actual effective minus the market estimate — the
   * like-for-like PV gap against market pricing, in turns and
   * (gapEffectiveDollars) in EV dollars. */
  gapEffectiveX: number;
  gapEffectiveDollars: number | null;
  /** True when the headline is a stated price (structure
   * amounts or asking price); false when no price is recorded
   * and the headline is shown at the market multiple. */
  headlineLocked: boolean;
  driverNotes: string[];
  /** Estimated cash-equivalent multiple range (base + drivers) —
   * what we'd estimate the business is worth, before any stated price. */
  cashEqLow: number;
  cashEqHigh: number;
  /** Headline (stated) multiple: the fixed stated price ÷ EBITDA.
   * A point value when the price comes from structure amounts or
   * the asking price; a range when derived from the estimate. */
  headlineLow: number;
  headlineHigh: number;
  /** Where the headline price came from. */
  headlineSource: string;
  /** Effective multiple: the headline discounted piece by piece for
   * expected payout and time value. */
  effLow: number;
  effHigh: number;
  /** Structure mix used, % of value. */
  structure: { cash: number; seller: number; earnout: number; rollover: number };
  structureAssumed: boolean;
  /** Present-value factor of the structure mix (≤ 1). */
  structureFactor: number;
  /** Per-piece values used (cents on the dollar), after any
   * rate-based refinement. */
  pieces: { cash: number; seller: number; rollover: number; earnout: number };
  /** Prime rate used for the refinement, when available. */
  primePct: number | null;
  /** SBA discount rate actually applied (prime + 3.00%). */
  sbaPct: number | null;
  /** Per-piece explanations when actual terms are on record
   * (e.g. "Earnout at 49¢ — 60% expected payout on EBITDA…"). */
  pieceNotes: string[];
  /** How much the structure inflates the headline over cash-equivalent. */
  structureUplift: number;
  /** Estimated cash-equivalent value range (base + drivers). */
  evLow: number | null;
  evHigh: number | null;
  /** Stated (headline) price. */
  statedEvLow: number | null;
  statedEvHigh: number | null;
  /** Effective value: the stated price after the structure discount. */
  effEvLow: number | null;
  effEvHigh: number | null;
}

export function resolveStructure(
  deal: Deal,
  group: string | null
): {
  mix: { cash: number; seller: number; earnout: number; rollover: number };
  assumed: boolean;
  /** Total stated price when dollar amounts are on record. */
  amountsTotal: number | null;
} {
  const st: DealStructureInput = deal.structure ?? {};
  const hasAmt =
    st.cashAmt != null || st.sellerAmt != null || st.earnoutAmt != null || st.rolloverAmt != null;
  if (hasAmt) {
    const raw = {
      cash: st.cashAmt ?? 0,
      seller: st.sellerAmt ?? 0,
      earnout: st.earnoutAmt ?? 0,
      rollover: st.rolloverAmt ?? 0,
    };
    const total = raw.cash + raw.seller + raw.earnout + raw.rollover;
    if (total > 0) {
      const f = 100 / total;
      return {
        mix: {
          cash: Math.round(raw.cash * f),
          seller: Math.round(raw.seller * f),
          earnout: Math.round(raw.earnout * f),
          rollover: Math.round(raw.rollover * f),
        },
        assumed: false,
        amountsTotal: total,
      };
    }
  }
  const has =
    st.cashPct != null || st.sellerPct != null || st.earnoutPct != null || st.rolloverPct != null;
  if (!has) {
    return {
      mix: { ...(group ? TYPICAL_STRUCTURE[group] : undefined) ?? DEFAULT_STRUCTURE },
      assumed: true,
      amountsTotal: null,
    };
  }
  const raw = {
    cash: st.cashPct ?? 0,
    seller: st.sellerPct ?? 0,
    earnout: st.earnoutPct ?? 0,
    rollover: st.rolloverPct ?? 0,
  };
  const total = raw.cash + raw.seller + raw.earnout + raw.rollover;
  if (total <= 0)
    return { mix: { cash: 100, seller: 0, earnout: 0, rollover: 0 }, assumed: false, amountsTotal: null };
  const f = 100 / total;
  return {
    mix: {
      cash: Math.round(raw.cash * f),
      seller: Math.round(raw.seller * f),
      earnout: Math.round(raw.earnout * f),
      rollover: Math.round(raw.rollover * f),
    },
    assumed: false,
    amountsTotal: null,
  };
}

/** Piecewise-linear curve through [x, adjustment] points, clamped
 * at the ends — the continuous form of a driver adjustment. */
function curve(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

/** How hard a given risk bites at this deal's size: the same
 * concentration or key-person exposure costs more turns on a small
 * deal than a large one (thinner buyer pool, less bench to absorb
 * it). Applied to NEGATIVE concentration / owner-dependence
 * adjustments only. */
function sizeRiskFactor(band: string): number {
  if (band.includes("< $5M")) return 1.15;
  if (band.includes("$5–25M")) return 1.0;
  if (band.includes("$25–100M")) return 0.85;
  if (band.includes("$100–500M")) return 0.75;
  return 0.65;
}

function fmtAdj(a: number): string {
  return `${a >= 0 ? "+" : "−"}${Math.abs(a).toFixed(2)}×`;
}

export function estimateMultiple(deal: Deal, multiples: MiMultiple[], rates?: MarketRates): MultipleEstimate | null {
  const evRows = multiples.filter((m) => m.sourceReport.includes("ExitValue"));
  const compRows = multiples.filter((m) => m.sourceReport.includes("Canny Comp Log"));
  const group = matchGroup(deal.industry);
  const band = bandFor(deal);

  const overallFor = (g: string | null, metric: "evEbitdaMedian" | "evRevenueMedian"): number | null => {
    const vals: number[] = [];
    for (const m of evRows) {
      if (m.sizeBand !== band) continue;
      const [mg] = splitIndustry(m.industry);
      if (g !== null && mg !== g) continue;
      const v = m[metric];
      if (v !== null && v !== undefined) vals.push(v);
    }
    return median(vals);
  };

  /** How many published ExitValue rows stand behind a base, and the
   * most common period among them (for the source citation). */
  const supportFor = (g: string | null, metric: "evEbitdaMedian" | "evRevenueMedian"): { count: number; period: string } => {
    let count = 0;
    const periods: Record<string, number> = {};
    for (const m of evRows) {
      if (m.sizeBand !== band) continue;
      const [mg] = splitIndustry(m.industry);
      if (g !== null && mg !== g) continue;
      const v = m[metric];
      if (v !== null && v !== undefined) {
        count++;
        if (m.period) periods[m.period] = (periods[m.period] ?? 0) + 1;
      }
    }
    let period = "";
    let best = 0;
    for (const p of Object.keys(periods)) {
      if (periods[p] > best) {
        best = periods[p];
        period = p;
      }
    }
    return { count, period };
  };

  /** Canny Comp Log entries for this deal's group + band. */
  const compFor = (metric: "evEbitdaMedian" | "evRevenueMedian"): { med: number | null; count: number; period: string } => {
    if (!group) return { med: null, count: 0, period: "" };
    const vals: number[] = [];
    const periods: Record<string, number> = {};
    for (const m of compRows) {
      if (m.sizeBand !== band) continue;
      const [mg] = splitIndustry(m.industry);
      if (mg !== group) continue;
      const v = m[metric];
      if (v !== null && v !== undefined) {
        vals.push(v);
        if (m.period) periods[m.period] = (periods[m.period] ?? 0) + 1;
      }
    }
    let period = "";
    let best = 0;
    for (const p of Object.keys(periods)) {
      if (periods[p] > best) {
        best = periods[p];
        period = p;
      }
    }
    return { med: median(vals), count: vals.length, period };
  };

  let base: number | null = null;
  let baseBasis = "";
  let baseSource = "";
  let baseIsBlend = false;
  let support = 0;
  let supportPeriod = "";
  let compCount = 0;
  let compPeriod = "";
  let compBlended = false;

  // Lens (Oct 14, 2026): software deals with revenue on record are
  // valued on a revenue multiple; everything else on EBITDA. A
  // software deal with no revenue recorded stays on the EBITDA lens
  // until revenue lands — a revenue multiple needs a revenue.
  const isSoftware = /saas|software|tech/.test((deal.industry || "").toLowerCase());
  let lens: "EBITDA" | "Revenue" = "EBITDA";

  if (isSoftware && deal.revenue && deal.revenue > 0) {
    let revBase = overallFor(group, "evRevenueMedian");
    if (revBase !== null) {
      lens = "Revenue";
      base = revBase;
      const s = supportFor(group, "evRevenueMedian");
      support = s.count;
      supportPeriod = s.period;
      baseSource = `ExitValue — ${group ?? "All industries"} overall, ${band}`;
      baseBasis = `${group ?? "All-industry"} overall EV/Revenue, ${band} private deals (ExitValue)`;
    } else if (group !== null) {
      revBase = overallFor(null, "evRevenueMedian");
      if (revBase !== null) {
        lens = "Revenue";
        base = revBase;
        baseIsBlend = true;
        const s = supportFor(null, "evRevenueMedian");
        support = s.count;
        supportPeriod = s.period;
        baseSource = `ExitValue — all-industry blend, ${band}`;
        baseBasis = `All-industry overall EV/Revenue, ${band} (no ${group} revenue median published)`;
      }
    }
    if (lens === "Revenue") {
      const c = compFor("evRevenueMedian");
      compCount = c.count;
      compPeriod = c.period;
      if (c.count >= 5 && c.med !== null) {
        compBlended = true;
        base = base !== null ? (base + c.med) / 2 : c.med;
        baseSource = baseSource
          ? `${baseSource} + Canny Comp Log (n=${c.count})`
          : `Canny Comp Log (n=${c.count})`;
        if (!baseBasis)
          baseBasis = `Canny comp log EV/Revenue median, ${group}, ${band} (n=${c.count})`;
      }
    }
  }

  if (lens !== "Revenue") {
    base = overallFor(group, "evEbitdaMedian");
    if (base !== null) {
      const s = supportFor(group, "evEbitdaMedian");
      support = s.count;
      supportPeriod = s.period;
      baseSource = `ExitValue — ${group ?? "All industries"} overall, ${band}`;
      baseBasis = `${group ?? "All-industry"} overall EV/EBITDA, ${band} private deals (ExitValue)`;
    } else {
      const rev = overallFor(group, "evRevenueMedian");
      const margin =
        deal.revenue && deal.ebitda && deal.revenue > 0 ? deal.ebitda / deal.revenue : null;
      if (rev !== null && margin !== null && margin > 0) {
        base = rev / margin;
        const s = supportFor(group, "evRevenueMedian");
        support = s.count;
        supportPeriod = s.period;
        baseSource = `ExitValue — derived from EV/Revenue, ${band}`;
        baseBasis = `Derived: ${group ?? "all-industry"} EV/Revenue ${rev.toFixed(2)}× ÷ this deal's ${(margin * 100).toFixed(0)}% EBITDA margin`;
      } else if (group !== null) {
        base = overallFor(null, "evEbitdaMedian");
        if (base !== null) {
          baseIsBlend = true;
          const s = supportFor(null, "evEbitdaMedian");
          support = s.count;
          supportPeriod = s.period;
          baseSource = `ExitValue — all-industry blend, ${band}`;
          baseBasis = `All-industry overall EV/EBITDA, ${band} (no ${group} EBITDA median published)`;
        }
      }
    }
    // Comp log (Oct 14, 2026): with ≥5 logged comps for the group +
    // band, their median blends 50/50 into the base — or is the base
    // when ExitValue publishes nothing for the band.
    const c = compFor("evEbitdaMedian");
    compCount = c.count;
    compPeriod = c.period;
    if (c.count >= 5 && c.med !== null) {
      compBlended = true;
      base = base !== null ? (base + c.med) / 2 : c.med;
      baseSource = baseSource
        ? `${baseSource} + Canny Comp Log (n=${c.count})`
        : `Canny Comp Log (n=${c.count})`;
      if (!baseBasis)
        baseBasis = `Canny comp log EV/EBITDA median, ${group}, ${band} (n=${c.count})`;
    }
  }
  if (base === null || !isFinite(base) || base <= 0) return null;

  const compSupport = support + compCount;
  const confidence: "Low" | "Med" | "High" =
    compSupport <= 2 ? "Low" : compSupport <= 6 ? "Med" : "High";
  const sourcesUsed: string[] = [];
  if (support > 0)
    sourcesUsed.push(
      `ExitValue private-deal multiples — ${group ?? "All industries"}, ${band}${supportPeriod ? ` (${supportPeriod})` : ""}`
    );
  if (compBlended)
    sourcesUsed.push(
      `Canny Comp Log — ${group}, ${band} (n=${compCount}${compPeriod ? `, ${compPeriod}` : ""})`
    );

  // The metric the dollar figures hang off: EBITDA normally,
  // revenue on the revenue lens.
  const metricVal = lens === "Revenue" ? deal.revenue ?? null : deal.ebitda ?? null;

  // Drivers. Measured metrics (Oct 11, 2026) supersede the matching
  // qualitative bucket: the adjustment scales continuously with the
  // actual number, risk penalties scale with deal size, contracted
  // recurring revenue mitigates concentration, and concentration
  // compounding with owner dependence costs extra (the owner likely
  // holds the key relationships). Buckets still apply wherever no
  // metric is recorded.
  let driverAdj = 0;
  const driverNotes: string[] = [];
  const drivers: DealDrivers = deal.drivers ?? {};
  const metrics = deal.metrics ?? {};
  const sizeF = sizeRiskFactor(band);
  const adjByKey: Partial<Record<keyof DealDrivers, number>> = {};

  // Customer concentration — from measured customer shares.
  if (metrics.topCustomerPct != null || metrics.top3Pct != null) {
    const concCurve: [number, number][] = [[5, 0.5], [10, 0.35], [15, 0.15], [20, 0], [25, -0.2], [30, -0.38], [40, -0.62], [50, -0.85], [65, -1.05], [100, -1.25]];
    const top3Curve: [number, number][] = [[15, 0.4], [30, 0.15], [45, -0.15], [60, -0.45], [75, -0.7], [90, -0.9]];
    const parts: string[] = [];
    let a: number;
    if (metrics.topCustomerPct != null) {
      a = curve(concCurve, metrics.topCustomerPct);
      parts.push(`top customer ${metrics.topCustomerPct}% of revenue`);
      if (metrics.top3Pct != null) {
        a = 0.7 * a + 0.3 * curve(top3Curve, metrics.top3Pct);
        parts.push(`top 3 at ${metrics.top3Pct}%`);
      }
    } else {
      a = curve(top3Curve, metrics.top3Pct as number);
      parts.push(`top 3 at ${metrics.top3Pct}% of revenue`);
    }
    let mitigated = false;
    if (a < 0) {
      a *= sizeF;
      if (metrics.recurringPct != null && metrics.recurringPct >= 60) {
        a *= 0.8;
        mitigated = true;
      }
    }
    adjByKey.concentration = a;
    driverNotes.push(
      `${fmtAdj(a)} customer concentration: ${parts.join(", ")}${a < 0 && sizeF !== 1 ? ` (size factor ${sizeF}×)` : ""}${mitigated ? " — contracted recurring revenue mitigates" : ""} [measured]`
    );
  }

  // Recurring / contracted revenue — from the measured share.
  if (metrics.recurringPct != null) {
    const a = curve(
      [[0, -0.55], [10, -0.4], [25, -0.15], [40, 0.05], [55, 0.3], [70, 0.5], [85, 0.68], [100, 0.75]],
      metrics.recurringPct
    );
    adjByKey.recurring = a;
    driverNotes.push(`${fmtAdj(a)} recurring revenue: ${metrics.recurringPct}% recurring / contracted [measured]`);
  }

  // Owner dependence — from the owner's hours in the business.
  if (metrics.ownerHoursPerWeek != null) {
    let a = curve(
      [[0, 0.55], [5, 0.5], [10, 0.4], [20, 0.2], [30, 0], [35, -0.2], [40, -0.4], [45, -0.58], [50, -0.7], [60, -0.85], [80, -0.9]],
      metrics.ownerHoursPerWeek
    );
    if (a < 0) a *= sizeF;
    adjByKey.ownerDependence = a;
    driverNotes.push(
      `${fmtAdj(a)} owner dependence: owner works ~${metrics.ownerHoursPerWeek} hrs/week in the business${a < 0 && sizeF !== 1 ? ` (size factor ${sizeF}×)` : ""} [measured]`
    );
  }

  // Bucket drivers — for every driver without a measured metric.
  for (const def of DRIVER_DEFS) {
    if (adjByKey[def.key] !== undefined) continue;
    const lvl = drivers[def.key];
    if (lvl === "pos") {
      adjByKey[def.key] = def.weight;
      driverNotes.push(`+${def.weight.toFixed(2)}× ${def.label.toLowerCase()}: ${def.posLabel.toLowerCase()}`);
    } else if (lvl === "neg") {
      adjByKey[def.key] = -def.weight;
      driverNotes.push(`−${def.weight.toFixed(2)}× ${def.label.toLowerCase()}: ${def.negLabel.toLowerCase()}`);
    }
  }

  // Interaction: concentrated customers whose relationships run
  // through a hands-on owner compound — the two risks are the same
  // risk counted twice, plus a key-person premium on top.
  let interactionAdj = 0;
  if ((adjByKey.concentration ?? 0) <= -0.45 && (adjByKey.ownerDependence ?? 0) <= -0.3) {
    interactionAdj = -0.25;
    driverNotes.push("−0.25× interaction: concentrated customers + owner dependence — the owner likely holds the key relationships");
  }

  driverAdj = Object.values(adjByKey).reduce((sum, v) => sum + (v ?? 0), 0) + interactionAdj;
  driverAdj = Math.max(-2, Math.min(2, driverAdj));

  // Named per-driver impacts for the panel's summary line.
  const driverImpacts: { label: string; adj: number }[] = [];
  for (const def of DRIVER_DEFS) {
    const a = adjByKey[def.key];
    if (a !== undefined && a !== 0) driverImpacts.push({ label: def.label, adj: a });
  }
  if (interactionAdj !== 0)
    driverImpacts.push({ label: "Concentration × owner dependence", adj: interactionAdj });
  const largestDriver = driverImpacts.length
    ? driverImpacts.reduce((m, d) => (Math.abs(d.adj) > Math.abs(m.adj) ? d : m))
    : null;

  // Growth outlook — its own quantitative layer, separate from the
  // qualitative drivers: ~0.05× per point of projected annual
  // growth (10%/yr ≈ +0.5×), clamped to ±1.25×.
  const growthPct = deal.growthPct != null && isFinite(deal.growthPct) ? deal.growthPct : null;
  const growthAdj = growthPct !== null ? Math.max(-1.25, Math.min(1.25, 0.05 * growthPct)) : 0;
  const growthNote =
    growthPct !== null
      ? `Growth outlook: ${growthPct > 0 ? "+" : ""}${growthPct}%/yr projected (${growthAdj >= 0 ? "+" : "−"}${Math.abs(growthAdj).toFixed(2)}×)`
      : null;

  const mid = base + driverAdj + growthAdj;
  const cashEqLow = Math.max(1, mid - 0.5);
  const cashEqHigh = mid + 0.5;

  // Structure: the headline is the fixed stated price — the sum
  // of the recorded structure amounts, else the asking price.
  // The effective multiple discounts the headline back down,
  // piece by piece, for expected payout and time value. The
  // market multiple (base + drivers + growth) is the benchmark:
  // the market estimate discounts IT by the usual structure, and
  // an unpriced deal's headline is shown at the market multiple.
  const { mix, assumed, amountsTotal } = resolveStructure(deal, group);
  const pv = pieceValues(deal, rates);
  const pieces = { cash: pv.cash, seller: pv.seller, rollover: pv.rollover, earnout: pv.earnout };
  const structureFactor =
    (mix.cash * pieces.cash +
      mix.seller * pieces.seller +
      mix.rollover * pieces.rollover +
      mix.earnout * pieces.earnout) /
    100;

  const evLow = metricVal ? cashEqLow * metricVal : null;
  const evHigh = metricVal ? cashEqHigh * metricVal : null;

  // The market estimate (effective): the market multiple run
  // through the USUAL deal structure at today's piece values,
  // using default terms — not this deal's — so it stays a pure
  // market benchmark.
  const typicalMix = (group ? TYPICAL_STRUCTURE[group] : undefined) ?? DEFAULT_STRUCTURE;
  const pvDefault = pieceValues({ ...deal, structure: {} }, rates);
  const typicalFactor =
    (typicalMix.cash * pvDefault.cash +
      typicalMix.seller * pvDefault.seller +
      typicalMix.rollover * pvDefault.rollover +
      typicalMix.earnout * pvDefault.earnout) /
    100;
  const estimateEffMid = mid * typicalFactor;
  const estimateEffLow = cashEqLow * typicalFactor;
  const estimateEffHigh = cashEqHigh * typicalFactor;

  // The actual deal: the headline is the stated price when one
  // is recorded; with no price, the headline is shown at the
  // market multiple and the effective follows from the deal's
  // (or the typical) structure.
  let statedEvLow: number | null = null;
  let statedEvHigh: number | null = null;
  let headlineSource = "no price recorded — shown at the market multiple";
  let headlineLow = mid;
  let headlineHigh = mid;
  if (amountsTotal !== null && amountsTotal > 0) {
    statedEvLow = amountsTotal;
    statedEvHigh = amountsTotal;
    headlineSource = "sum of the structure amounts";
    if (metricVal) {
      headlineLow = amountsTotal / metricVal;
      headlineHigh = headlineLow;
    }
  } else if (deal.askingPrice && deal.askingPrice > 0) {
    statedEvLow = deal.askingPrice;
    statedEvHigh = deal.askingPrice;
    headlineSource = "asking price";
    if (metricVal) {
      headlineLow = deal.askingPrice / metricVal;
      headlineHigh = headlineLow;
    }
  }
  const headlineLocked =
    (amountsTotal !== null && amountsTotal > 0) || (deal.askingPrice ?? 0) > 0;

  const effLow = headlineLow * structureFactor;
  const effHigh = headlineHigh * structureFactor;
  const effMid = ((headlineLow + headlineHigh) / 2) * structureFactor;
  const gapHeadlineX = (headlineLow + headlineHigh) / 2 - mid;
  const gapEffectiveX = effMid - estimateEffMid;
  const gapEffectiveDollars = metricVal ? gapEffectiveX * metricVal : null;
  const effEvLow = metricVal ? effLow * metricVal : null;
  const effEvHigh = metricVal ? effHigh * metricVal : null;

  return {
    base,
    baseBasis,
    band,
    group,
    lens,
    baseSource,
    baseIsBlend,
    compSupport,
    confidence,
    compLogCount: compCount,
    compBlended,
    driverImpacts,
    largestDriver,
    sourcesUsed,
    driverAdj,
    growthAdj,
    growthNote,
    marketMid: mid,
    estimateEffMid,
    estimateEffLow,
    estimateEffHigh,
    typicalFactor,
    effMid,
    gapHeadlineX,
    gapEffectiveX,
    gapEffectiveDollars,
    headlineLocked,
    driverNotes,
    cashEqLow,
    cashEqHigh,
    headlineLow,
    headlineHigh,
    headlineSource,
    effLow,
    effHigh,
    structure: mix,
    structureAssumed: assumed,
    structureFactor,
    pieces,
    primePct: pv.primePct,
    sbaPct: pv.sbaPct,
    pieceNotes: pv.notes,
    structureUplift: structureFactor > 0 ? 1 / structureFactor - 1 : 0,
    evLow,
    evHigh,
    statedEvLow,
    statedEvHigh,
    effEvLow,
    effEvHigh,
  };
}

export { BANDS as VALUATION_BANDS };
export { GROUPS as VALUATION_GROUPS };

export function bandForDeal(deal: Deal): string {
  return bandFor(deal);
}

/** The deal's stated price (Oct 14, 2026): the structure-amounts sum
 * first — the same order the valuation engine's headline uses — then
 * the asking price, then the manually recorded deal value. Null when
 * no price is stated anywhere; never 0-as-a-price. */
export function resolveStatedPrice(deal: Deal): number | null {
  const { amountsTotal } = resolveStructure(deal, matchGroup(deal.industry));
  if (amountsTotal !== null && amountsTotal > 0) return amountsTotal;
  if (deal.askingPrice && deal.askingPrice > 0) return deal.askingPrice;
  if (deal.dealValue && deal.dealValue > 0) return deal.dealValue;
  return null;
}

export interface ResolvedDealValue {
  value: number | null;
  /** True when the value is the market-multiple estimate (EBITDA or
   * revenue × market multiple), not a stated price. */
  estimated: boolean;
}

/** The one Value every surface shows (Pipeline table, Overview stat
 * cards, stage chart): stated price when present, else the estimated
 * EV from the market multiple, else null → render "—", never $0. */
export function resolveDealValue(
  deal: Deal,
  multiples: MiMultiple[],
  rates?: MarketRates
): ResolvedDealValue {
  const stated = resolveStatedPrice(deal);
  if (stated !== null) return { value: stated, estimated: false };
  const est = estimateMultiple(deal, multiples, rates);
  if (est && est.evLow !== null && est.evHigh !== null) {
    return { value: (est.evLow + est.evHigh) / 2, estimated: true };
  }
  return { value: null, estimated: false };
}
