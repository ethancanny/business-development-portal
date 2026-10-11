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
 *  3. STRUCTURE — the base range is a CASH-EQUIVALENT value. Pushing
 *     value into deferred/contingent pieces RAISES the headline
 *     multiple: a seller who takes an earnout (or a seller note, or
 *     rollover) demands — and a buyer can concede — a bigger stated
 *     price, because part of it is at risk and arrives late. Each
 *     stated dollar is worth ~100¢ in cash, ~95¢ as a seller note,
 *     ~90¢ as rollover, ~60¢ as an earnout; the headline multiple is
 *     the cash-equivalent range grossed up by the mix's value factor.
 *     Blank structure fields assume the industry-typical mix from
 *     the Market Intel deal-structure data.
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

/** Present value of $1 of each structure piece, roughly: cash is cash;
 * a market-rate seller note is near par; rollover equity is real but
 * illiquid; an earnout is contingent and deferred. */
const PIECE_VALUE = { cash: 1.0, seller: 0.95, rollover: 0.9, earnout: 0.6 };

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
  /** Cash-equivalent multiple range (base + drivers), before structure. */
  cashEqLow: number;
  cashEqHigh: number;
  /** Headline (stated) multiple range at the structure mix — higher
   * than cash-equivalent when value sits in earnouts/notes/rollover. */
  headlineLow: number;
  headlineHigh: number;
  /** Structure mix used, % of value. */
  structure: { cash: number; seller: number; earnout: number; rollover: number };
  structureAssumed: boolean;
  /** Present-value factor of the structure mix (≤ 1). */
  structureFactor: number;
  /** How much the structure inflates the headline over cash-equivalent. */
  structureUplift: number;
  /** Implied enterprise value range at the cash-equivalent multiple. */
  evLow: number | null;
  evHigh: number | null;
  /** Implied stated price range at the headline multiple. */
  statedEvLow: number | null;
  statedEvHigh: number | null;
}

export function resolveStructure(
  deal: Deal,
  group: string | null
): { mix: { cash: number; seller: number; earnout: number; rollover: number }; assumed: boolean } {
  const st: DealStructureInput = deal.structure ?? {};
  const has =
    st.cashPct != null || st.sellerPct != null || st.earnoutPct != null || st.rolloverPct != null;
  if (!has) {
    return { mix: { ...(group ? TYPICAL_STRUCTURE[group] : undefined) ?? DEFAULT_STRUCTURE }, assumed: true };
  }
  const raw = {
    cash: st.cashPct ?? 0,
    seller: st.sellerPct ?? 0,
    earnout: st.earnoutPct ?? 0,
    rollover: st.rolloverPct ?? 0,
  };
  const total = raw.cash + raw.seller + raw.earnout + raw.rollover;
  if (total <= 0) return { mix: { cash: 100, seller: 0, earnout: 0, rollover: 0 }, assumed: false };
  const f = 100 / total;
  return {
    mix: {
      cash: Math.round(raw.cash * f),
      seller: Math.round(raw.seller * f),
      earnout: Math.round(raw.earnout * f),
      rollover: Math.round(raw.rollover * f),
    },
    assumed: false,
  };
}

export function estimateMultiple(deal: Deal, multiples: MiMultiple[]): MultipleEstimate | null {
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

  // Structure: the cash-equivalent range grossed up by the mix's
  // value factor gives the headline (stated) multiple — more earnout
  // or deferral in the mix, higher the headline multiple.
  const { mix, assumed } = resolveStructure(deal, group);
  const structureFactor =
    (mix.cash * PIECE_VALUE.cash +
      mix.seller * PIECE_VALUE.seller +
      mix.rollover * PIECE_VALUE.rollover +
      mix.earnout * PIECE_VALUE.earnout) /
    100;

  const headlineLow = cashEqLow / structureFactor;
  const headlineHigh = cashEqHigh / structureFactor;
  const evLow = deal.ebitda ? cashEqLow * deal.ebitda : null;
  const evHigh = deal.ebitda ? cashEqHigh * deal.ebitda : null;
  const statedEvLow = deal.ebitda ? headlineLow * deal.ebitda : null;
  const statedEvHigh = deal.ebitda ? headlineHigh * deal.ebitda : null;

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
    structure: mix,
    structureAssumed: assumed,
    structureFactor,
    structureUplift: structureFactor > 0 ? 1 / structureFactor - 1 : 0,
    evLow,
    evHigh,
    statedEvLow,
    statedEvHigh,
  };
}

export { BANDS as VALUATION_BANDS };
