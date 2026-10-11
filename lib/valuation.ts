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
  { key: "recurring", label: "Recurring / contracted revenue", negLabel: "Mostly one-off / project work", neuLabel: "Mixed", posLabel: "Mostly recurring / contracted", weight: 0.5 },
  { key: "ownerDependence", label: "Owner dependence", negLabel: "Business runs through the owner", neuLabel: "Some key-person risk", posLabel: "Runs without the owner", weight: 0.5 },
  { key: "growth", label: "Growth trend", negLabel: "Declining", neuLabel: "Flat", posLabel: "Growing", weight: 0.5 },
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
}

function pieceValues(
  deal: Deal,
  rates?: MarketRates
): { cash: number; seller: number; rollover: number; earnout: number; primePct: number | null } {
  const primePct = rates?.prime && rates.prime > 0 ? rates.prime : null;
  const prime = primePct !== null ? primePct / 100 : null;
  let seller = PIECE_VALUE.seller;
  const st = deal.structure ?? {};
  // Seller note with known terms: present value of its payments
  // discounted at prime. A note priced at prime is worth par; a
  // below-prime note is worth less, mechanically.
  if (prime !== null && st.sellerRatePct != null && st.sellerTermYrs != null && st.sellerTermYrs > 0) {
    const r = Math.max(0, st.sellerRatePct) / 100;
    const n = st.sellerTermYrs;
    const pmt = r > 0 ? r / (1 - Math.pow(1 + r, -n)) : 1 / n;
    const pv = (pmt * (1 - Math.pow(1 + prime, -n))) / prime;
    seller = Math.max(0.7, Math.min(1, pv));
  }
  // Earnout: ~70% expected payout, discounted two years at prime.
  // At prime 7.75% that is ≈ 60¢, matching the flat default.
  let earnout = PIECE_VALUE.earnout;
  if (prime !== null) {
    earnout = Math.max(0.4, Math.min(0.75, 0.7 / Math.pow(1 + prime, 2)));
  }
  return { cash: PIECE_VALUE.cash, seller, rollover: PIECE_VALUE.rollover, earnout, primePct };
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
  /** Net multiple points from recorded drivers (can be negative). */
  driverAdj: number;
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

export function estimateMultiple(deal: Deal, multiples: MiMultiple[], rates?: MarketRates): MultipleEstimate | null {
  const evRows = multiples.filter((m) => m.sourceReport.includes("ExitValue"));
  if (!evRows.length) return null;
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

  let base: number | null = null;
  let baseBasis = "";
  base = overallFor(group, "evEbitdaMedian");
  if (base !== null) {
    baseBasis = `${group ?? "All-industry"} overall EV/EBITDA, ${band} private deals (ExitValue)`;
  } else {
    const rev = overallFor(group, "evRevenueMedian");
    const margin =
      deal.revenue && deal.ebitda && deal.revenue > 0 ? deal.ebitda / deal.revenue : null;
    if (rev !== null && margin !== null && margin > 0) {
      base = rev / margin;
      baseBasis = `Derived: ${group ?? "all-industry"} EV/Revenue ${rev.toFixed(2)}× ÷ this deal's ${(margin * 100).toFixed(0)}% EBITDA margin`;
    } else if (group !== null) {
      base = overallFor(null, "evEbitdaMedian");
      if (base !== null) baseBasis = `All-industry overall EV/EBITDA, ${band} (no ${group} EBITDA median published)`;
    }
  }
  if (base === null || !isFinite(base) || base <= 0) return null;

  // Drivers
  let driverAdj = 0;
  const driverNotes: string[] = [];
  const drivers: DealDrivers = deal.drivers ?? {};
  for (const def of DRIVER_DEFS) {
    const lvl = drivers[def.key];
    if (lvl === "pos") {
      driverAdj += def.weight;
      driverNotes.push(`+${def.weight.toFixed(2)}× ${def.label.toLowerCase()}: ${def.posLabel.toLowerCase()}`);
    } else if (lvl === "neg") {
      driverAdj -= def.weight;
      driverNotes.push(`−${def.weight.toFixed(2)}× ${def.label.toLowerCase()}: ${def.negLabel.toLowerCase()}`);
    }
  }
  driverAdj = Math.max(-1.5, Math.min(1.5, driverAdj));

  const mid = base + driverAdj;
  const cashEqLow = Math.max(1, mid - 0.5);
  const cashEqHigh = mid + 0.5;

  // Structure: the headline is the fixed stated price — the sum of
  // the recorded structure amounts, else the asking price, else
  // derived from the cash-equivalent estimate at the structure mix.
  // The effective multiple discounts the headline back down, piece
  // by piece, for expected payout and time value.
  const { mix, assumed, amountsTotal } = resolveStructure(deal, group);
  const pv = pieceValues(deal, rates);
  const pieces = { cash: pv.cash, seller: pv.seller, rollover: pv.rollover, earnout: pv.earnout };
  const structureFactor =
    (mix.cash * pieces.cash +
      mix.seller * pieces.seller +
      mix.rollover * pieces.rollover +
      mix.earnout * pieces.earnout) /
    100;

  const evLow = deal.ebitda ? cashEqLow * deal.ebitda : null;
  const evHigh = deal.ebitda ? cashEqHigh * deal.ebitda : null;

  let statedEvLow: number | null = null;
  let statedEvHigh: number | null = null;
  let headlineSource = "derived from the estimate at the structure mix";
  if (amountsTotal !== null && amountsTotal > 0) {
    statedEvLow = amountsTotal;
    statedEvHigh = amountsTotal;
    headlineSource = "sum of the structure amounts";
  } else if (deal.askingPrice && deal.askingPrice > 0) {
    statedEvLow = deal.askingPrice;
    statedEvHigh = deal.askingPrice;
    headlineSource = "asking price";
  } else if (evLow !== null && evHigh !== null && structureFactor > 0) {
    statedEvLow = evLow / structureFactor;
    statedEvHigh = evHigh / structureFactor;
  }

  const headlineLow =
    statedEvLow !== null && deal.ebitda ? statedEvLow / deal.ebitda : cashEqLow / structureFactor;
  const headlineHigh =
    statedEvHigh !== null && deal.ebitda ? statedEvHigh / deal.ebitda : cashEqHigh / structureFactor;
  const effLow = headlineLow * structureFactor;
  const effHigh = headlineHigh * structureFactor;
  const effEvLow = deal.ebitda ? effLow * deal.ebitda : null;
  const effEvHigh = deal.ebitda ? effHigh * deal.ebitda : null;

  return {
    base,
    baseBasis,
    band,
    group,
    driverAdj,
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
