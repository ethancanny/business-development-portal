/**
 * New investment form — section registry + pure math (Oct 24, 2026).
 *
 * The type-first DealForm renders its sections from this registry:
 * metric sections pull their fields from bd.metric_definitions by
 * config.section (Settings-editable), record sections bind Deal
 * fields directly. This module is pure (no imports) so the round
 * math and blended-multiple helpers can be unit-checked outside the
 * app and shared by the form, the summary rail, and verification.
 */

export type FormSectionDef = {
  /** Stable key; metric sections use the same key as config.section. */
  key: string;
  title: string;
  /** "record" = Deal fields, "metrics" = bd definitions by section,
   * "special" = bespoke blocks (valuation panel, parent picker…). */
  kind: "record" | "metrics" | "special";
  /** Render even when it has no metric fields (record/special). */
  always?: boolean;
};

const BASICS: FormSectionDef = { key: "basics", title: "Basics", kind: "record", always: true };
const VALUATION: FormSectionDef = { key: "valuation", title: "Valuation estimate", kind: "special", always: true };
const DRIVERS: FormSectionDef = { key: "drivers", title: "Qualitative drivers", kind: "record", always: true };
const DRIVERS_SHORT: FormSectionDef = { key: "drivers", title: "Qualitative drivers", kind: "record", always: true };
const MEASURED: FormSectionDef = { key: "measured", title: "Measured metrics", kind: "record", always: true };
const STRUCTURE: FormSectionDef = { key: "structure", title: "Deal structure", kind: "record", always: true };
const SOURCE: FormSectionDef = { key: "source", title: "Source and contacts", kind: "record", always: true };
const SECTOR_PACK: FormSectionDef = { key: "sector_pack", title: "Aerospace & Defense pack", kind: "metrics" };

/** Ordered sections for a type, BEFORE the sector pack (appended
 * when its pack applies) and the common Source section (always last). */
export function sectionsForType(typeKey: string): FormSectionDef[] {
  switch (typeKey) {
    case "add_on":
      return [
        { key: "parent", title: "Parent platform", kind: "special", always: true },
        BASICS,
        VALUATION,
        DRIVERS_SHORT,
        STRUCTURE,
        { key: "addon_metrics", title: "Add-on metrics", kind: "metrics" },
      ];
    case "early_stage":
      return [
        BASICS,
        { key: "round", title: "Round", kind: "metrics" },
        { key: "traction", title: "Traction", kind: "metrics" },
        { key: "team_market", title: "Team and market notes", kind: "metrics" },
        { key: "investors_es", title: "Lead and co-investors", kind: "metrics" },
        { key: "sourced_from", title: "Sourced from", kind: "special", always: true },
      ];
    case "platform_lbo":
    default:
      return [
        BASICS,
        VALUATION,
        DRIVERS,
        MEASURED,
        STRUCTURE,
        { key: "lbo_metrics", title: "LBO metrics", kind: "metrics" },
      ];
  }
}

/** The full ordered list the form renders: type sections, then the
 * sector pack (when it has fields for this deal), then Source. */
export function formSections(
  typeKey: string,
  sectorPackApplies: boolean
): FormSectionDef[] {
  const base = sectionsForType(typeKey);
  return sectorPackApplies ? [...base, SECTOR_PACK, SOURCE] : [...base, SOURCE];
}

/** One-line descriptions for the type selector cards. */
export const TYPE_CARD_BLURBS: Record<string, string> = {
  platform_lbo: "Control buyout of an established business",
  add_on: "Acquisition into an existing platform company",
  early_stage: "Minority check into an early company or round",
  minority_growth: "Minority growth investment in a proven business",
};

/* ------------------------------------------------------------------ */
/* Round math (Early Stage) — display-derived, labeled estimates.      */
/* ------------------------------------------------------------------ */

export type RoundMath = {
  /** Post-money valuation implied by the round terms, when derivable. */
  postMoney: number | null;
  /** Our ownership % at close (check / post-money), when derivable. */
  ownershipPct: number | null;
  /** Post-money / revenue (ARR preferred) — the implied revenue
   * multiple shown instead of the LBO market multiple panel. */
  impliedRevenueMultiple: number | null;
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Priced round: post-money = pre-money + round size.
 * SAFE / convertible: the conversion basis is the valuation cap,
 * reduced by the discount when one is set (cap × (1 − discount));
 * post-money = basis + round size (post-money SAFE convention).
 * Ownership = our check / post-money. All values are estimates from
 * the entered terms — the form labels them as such.
 */
export function computeRoundMath(values: {
  instrument?: string;
  preMoney?: unknown;
  valuationCap?: unknown;
  discountPct?: unknown;
  roundSize?: unknown;
  checkSize?: unknown;
  arr?: unknown;
  revenue?: unknown;
}): RoundMath {
  const instrument = String(values.instrument ?? "");
  const roundSize = num(values.roundSize);
  const check = num(values.checkSize);
  let postMoney: number | null = null;
  if (instrument === "Priced equity") {
    const pre = num(values.preMoney);
    if (pre && roundSize) postMoney = pre + roundSize;
    else if (pre) postMoney = pre;
  } else {
    const cap = num(values.valuationCap);
    if (cap) {
      const discount = num(values.discountPct);
      const basis = discount ? cap * (1 - discount / 100) : cap;
      postMoney = roundSize ? basis + roundSize : basis;
    }
  }
  const ownershipPct =
    postMoney && check ? (check / postMoney) * 100 : null;
  const rev = num(values.arr) ?? num(values.revenue);
  const impliedRevenueMultiple =
    postMoney && rev ? postMoney / rev : null;
  return { postMoney, ownershipPct, impliedRevenueMultiple };
}

/** Blended pro forma multiple for an add-on: combined price over
 * combined EBITDA (display-derived, never stored — Step 1 rule). */
export function blendedMultiple(
  parentPrice: number | null | undefined,
  parentEbitda: number | null | undefined,
  addonPrice: number | null | undefined,
  addonEbitda: number | null | undefined
): number | null {
  const pp = num(parentPrice);
  const pe = num(parentEbitda);
  const ap = num(addonPrice);
  const ae = num(addonEbitda);
  if (!pp || !pe || !ap || !ae) return null;
  return (pp + ap) / (pe + ae);
}

/** Headline multiple for a deal record (price over EBITDA). */
export function headlineMultiple(
  price: number | null | undefined,
  ebitda: number | null | undefined
): number | null {
  const p = num(price);
  const e = num(ebitda);
  return p && e ? p / e : null;
}
