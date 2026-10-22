/**
 * Phase 7 Investors & Capital — shared client types + fetch helpers.
 *
 * Types mirror the capital service row shapes returned by
 * /api/platform/capital/* (see the Phase 7 API contract). They are
 * re-declared here so client components never import server modules.
 * Money formatting delegates to @/lib/format so figures render
 * exactly as elsewhere in the portal.
 *
 * Conventions (from lib/capital/schema.ts):
 * - Investor identity lives in the Directory (core.people); this
 *   module stores only the capital profile extension keyed by
 *   personId. The legacy "Investment Database" sheet fields arrive
 *   separately as `legacyInvestor` and are NEVER merged into the
 *   capital profile in the UI.
 * - Percents are fractions (0.20 = 20%) everywhere except the deal
 *   screen grid's stored assumption echoes, which are rendered as
 *   returned.
 */

import { fmtDate, fmtMoney, fmtMoneyCompact } from "@/lib/format";

export { fmtDate, fmtMoney, fmtMoneyCompact };

export const API = "/api/platform/capital";

/* ------------------------------ investors ------------------------------ */

/** Mirrors INVESTOR_TYPES in lib/capital/schema.ts. */
export const INVESTOR_TYPES: Array<{ key: string; label: string }> = [
  { key: "lp", label: "LP" },
  { key: "family_office", label: "Family office" },
  { key: "co_invest", label: "Co-invest" },
  { key: "hnw_advisor", label: "HNW / advisor" },
  { key: "other", label: "Other" },
];

/** Mirrors INVESTOR_STATUSES in lib/capital/schema.ts. */
export const INVESTOR_STATUSES: Array<{ key: string; label: string }> = [
  { key: "exploring", label: "Exploring" },
  { key: "active", label: "Active" },
  { key: "committed", label: "Committed" },
  { key: "passed", label: "Passed" },
];

export function investorStatusBadge(status: string): string {
  switch (status) {
    case "committed":
      return "badge-fit";
    case "active":
      return "badge-warn";
    case "passed":
      return "badge-danger";
    default:
      return "badge-neutral";
  }
}

/** The capital profile extension for one Directory person. */
export interface InvestorProfile {
  exists: boolean;
  investorType: string;
  status: string;
  introSource: string;
  lastTouchAt: string | null;
  thesisSectors: string[];
  dealSizeMin: number | null;
  dealSizeMax: number | null;
  checkSizeMin: number | null;
  checkSizeMax: number | null;
  structurePrefs: string;
  notes: string;
  updatedAt?: string | null;
}

/** One row of GET /investors. */
export interface InvestorListItem {
  personId: string;
  name: string;
  firm: string;
  title: string;
  email: string;
  phone: string;
  types: string[];
  profile: InvestorProfile;
}

/** Fields imported from Ethan's "Investment Database" sheet — the
 * imported record, shown as-is and never merged with the profile. */
export interface LegacyInvestor {
  investmentType: string;
  industry: string;
  ebitdaSize: string;
  checkSize: string;
  status: string;
  website: string;
}

export interface InvestorCommitment {
  id: string;
  dealId: string;
  dealName: string;
  amount: number;
  kind: string;
  stage: string;
}

export interface InvestorActivity {
  kind: string;
  message: string;
  actor: string;
  createdAt: string;
}

export interface InvestorLinkedDeal {
  dealId: string;
  dealName?: string;
  companyName?: string;
  stage?: string;
  role?: string;
  [key: string]: unknown;
}

/** GET /investors/[personId] */
export interface InvestorDetailData {
  record: Record<string, unknown> & {
    name?: string;
    firm?: string;
    title?: string;
    email?: string;
    phone?: string;
  };
  types: string[];
  linkedDeals: InvestorLinkedDeal[];
  legacyInvestor: LegacyInvestor | null;
  profile: InvestorProfile;
  commitments: InvestorCommitment[];
  reportTotals: { called: number; distributed: number; nav: number };
  activity: InvestorActivity[];
}

/* ------------------------------ deals & raises ------------------------------ */

export interface RaiseSummary {
  targetRaise: number;
  softTotal: number;
  hardTotal: number;
  fundedTotal: number;
  investorCount: number;
  calledTotal: number;
  distributedTotal: number;
  navTotal: number;
}

/** One row of GET /deals. */
export interface CapitalDeal {
  dealId: string;
  dealName: string;
  companyName: string;
  companyId: string;
  stage: string;
  summary: RaiseSummary | null;
}

export interface Raise {
  id: string;
  targetRaise: number;
  status: string;
  notes: string;
}

export interface Commitment {
  id: string;
  investorPersonId: string;
  investorName: string;
  investorFirm: string;
  amount: number;
  kind: string; // soft | hard
  stage: string; // indicated | committed | funded | passed
  notes: string;
  updatedAt?: string;
}

/** Mirrors COMMITMENT_KINDS / COMMITMENT_STAGES in lib/capital/schema.ts. */
export const COMMITMENT_KINDS: Array<{ key: string; label: string }> = [
  { key: "soft", label: "Soft" },
  { key: "hard", label: "Hard" },
];

export const COMMITMENT_STAGES: Array<{ key: string; label: string }> = [
  { key: "indicated", label: "Indicated" },
  { key: "committed", label: "Committed" },
  { key: "funded", label: "Funded" },
  { key: "passed", label: "Passed" },
];

export function commitmentStageBadge(stage: string): string {
  switch (stage) {
    case "funded":
      return "badge-fit";
    case "committed":
      return "badge-warn";
    case "passed":
      return "badge-danger";
    default:
      return "badge-neutral";
  }
}

/* ------------------------------ economics ------------------------------ */

/** Per-deal economics inputs — null/absent = inherit global params. */
export interface EconomicsInputs {
  ebitdaOverride: number | null;
  entryMultiple: number | null;
  leverageMultiple: number | null;
  exitMultiple: number | null;
  growthPct: number | null;
  holdYears: number | null;
  advisoryFeePct: number | null;
  financingFeePct: number | null;
  mgmtFeePct: number | null;
  prefPct: number | null;
  carryPct: number | null;
  rolloverEquity: number | null;
  debtPaydownPct: number | null;
  [key: string]: unknown;
}

/** Global valuation parameters (GET/PUT /valuation-params). */
export interface ValuationParams {
  entryMultipleLow: number;
  entryMultipleHigh: number;
  targetIrr: number;
  leverageLow: number;
  leverageHigh: number;
  entryMultiple: number;
  leverageMultiple: number;
  exitMultiple: number;
  growthPct: number;
  holdYears: number;
  advisoryFeePct: number;
  financingFeePct: number;
  mgmtFeePct: number;
  prefPct: number;
  carryPct: number;
  debtPaydownPct: number;
  [key: string]: unknown;
}

export interface FeeStackRow {
  label: string;
  amount: number;
  basis: string;
}

export interface EconomicsResult {
  available: boolean;
  reason?: string;
  ebitda: number | null;
  ebitdaSource: string;
  sourcesUses: {
    sources: { debt: number; rolloverEquity: number; equity: number };
    uses: {
      purchasePrice: number;
      advisoryFee: number;
      financingFee: number;
      totalFees: number;
      totalUses: number;
    };
  } | null;
  feeStack: FeeStackRow[];
  returns: {
    exitEbitda: number;
    exitValue: number;
    equityOutGross: number;
    investorOutNet: number;
    profit: number;
    prefAmount: number;
    carry: number;
    mgmtFees: number;
    grossMoic: number | null;
    grossIrr: number | null;
    netMoic: number | null;
    netIrr: number | null;
  } | null;
  sensitivity: {
    entryMultiples: number[];
    exitMultiples: number[];
    leverages: number[];
    /** netIrr[leverage][entry][exit] — fractions, null when n/a. */
    netIrr: Array<Array<Array<number | null>>>;
  } | null;
  computedAt: string;
}

/* ------------------------------ deal screen ------------------------------ */

export interface ScreenAnalysisRef {
  id: string;
  status: string;
  generatedAt: string;
}

export interface WorkingCapitalData {
  points?: Array<{
    setId: string;
    periodEnd: string | null;
    wc: number;
    revenue: number | null;
    wcPctRevenue: number | null;
  }>;
  normalizedWcPct?: number | null;
  peg?: {
    low: number | null;
    mid: number | null;
    high: number | null;
    basis: string;
  };
  seasonality?: Array<{ month: number; index: number | null }>;
  missingInputs?: string[];
  [key: string]: unknown;
}

export interface DealScreenGridRow {
  entryMultiple: number;
  enterpriseValue: number | null;
  debt: number | null;
  fees: number | null;
  equityCheck: number | null;
  exitEbitda: number | null;
  exitValue: number | null;
  equityOut: number | null;
  moic: number | null;
  irr: number | null;
}

export interface DealScreenData {
  grid?: DealScreenGridRow[];
  sensitivity?: Array<{
    entryMultiple: number;
    exitMultiple: number;
    irr: number | null;
    moic: number | null;
  }>;
  assumptionsUsed?: Record<string, unknown>;
  ebitdaBasis?: string;
  basis?: string;
  notes?: string[];
  [key: string]: unknown;
}

/** GET /deals/[dealId]/screen */
export interface ScreenData {
  deal: Record<string, unknown> & {
    dealId?: string;
    dealName?: string;
    companyName?: string;
    stage?: string;
  };
  analysis: ScreenAnalysisRef | null;
  adjustedEbitda: number | null;
  reportedEbitda: number | null;
  workingCapital: {
    available: boolean;
    data?: WorkingCapitalData;
    reason?: string;
  };
  dealScreen: DealScreenData | null;
  valuationParams: ValuationParams | null;
}

/* ------------------------------ IC ------------------------------ */

/** Mirrors IC_AREAS in lib/capital/schema.ts. */
export const IC_AREAS: Array<{ key: string; label: string }> = [
  { key: "market", label: "Market" },
  { key: "business_quality", label: "Business quality" },
  { key: "management", label: "Management" },
  { key: "deal_terms", label: "Deal terms" },
  { key: "risks", label: "Risks" },
];

/** Mirrors IC_DECISIONS in lib/capital/schema.ts. */
export const IC_DECISIONS: Array<{ key: string; label: string }> = [
  { key: "approved", label: "Approved" },
  { key: "approved_with_conditions", label: "Approved with conditions" },
  { key: "declined", label: "Declined" },
];

export function decisionBadge(decision: string): string {
  switch (decision) {
    case "approved":
      return "badge-fit";
    case "approved_with_conditions":
      return "badge-warn";
    case "declined":
      return "badge-danger";
    default:
      return "badge-neutral";
  }
}

export interface IcScorecard {
  scores: Record<string, number | null>;
  notes: Record<string, string>;
  updatedBy?: string;
  updatedAt?: string | null;
}

export interface MemoCitation {
  kind: string;
  id: string;
  label: string;
}

export interface MemoSection {
  key: string;
  title: string;
  body: string;
  citations: MemoCitation[];
}

export interface IcMemo {
  id: string;
  version: number;
  status: string;
  payload: { sections: MemoSection[] };
  generatedAt: string;
}

export interface IcDecision {
  id: string;
  decision: string;
  conditions: string;
  votes: Array<{ voter: string; vote: string }>;
  decidedBy: string;
  decidedAt: string;
}

/** GET /deals/[dealId]/ic */
export interface IcData {
  scorecard: IcScorecard;
  memo: { memo: IcMemo | null; stale: boolean };
  decisions: IcDecision[];
}

/* ------------------------------ reporting ------------------------------ */

/** Mirrors REPORT_ENTRY_TYPES in lib/capital/schema.ts. */
export const REPORT_ENTRY_TYPES: Array<{ key: string; label: string }> = [
  { key: "capital_call", label: "Capital call" },
  { key: "distribution", label: "Distribution" },
  { key: "nav", label: "NAV update" },
];

export interface ReportEntry {
  id: string;
  investorPersonId: string | null;
  investorName: string;
  entryType: string; // capital_call | distribution | nav
  amount: number;
  asOf: string;
  notes: string;
}

export interface ReportTotals {
  called: number;
  distributed: number;
  navLatest: number;
  byInvestor: unknown;
}

export interface ReportTemplate {
  id: string;
  name: string;
  kind: string;
  body: string;
  isSystem?: boolean;
}

/* ------------------------------ tab props ------------------------------ */

/** Props every deal-workspace tab receives from the shell. */
export interface CapitalTabProps {
  dealId: string;
  /** Re-pull the workspace header (deal + raise summary). */
  refreshSummary?: () => void;
}

/* ------------------------------ styling ------------------------------ */

export const cardCls =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6";
export const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30";
export const selectCls = inputCls;
export const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";
export const thCls =
  "px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";
export const tdCls = "px-3 py-2 text-sm text-[#0d1f3c] dark:text-white/90";

/* ------------------------------ formatting ------------------------------ */

export function fmtMoneyN(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return fmtMoney(value);
}

/** Fractions render as percents: 0.20 → "20%", 0.075 → "7.5%". */
export function fmtPct(
  value: number | null | undefined,
  digits = 1
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const pct = value * 100;
  const s = pct.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, "$1");
  return `${s}%`;
}

export function fmtMultiple(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return `${value.toFixed(1)}×`;
}

export function fmtMoic(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return `${value.toFixed(2)}×`;
}

export function fmtDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtUpdated(iso: string | null | undefined): string {
  if (!iso) return "—";
  return fmtDate(iso);
}

/** Parse a user-entered number; null when blank / not a number. */
export function parseNum(text: string): number | null {
  const t = text.replace(/[$,\s%]/g, "");
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a percent the user typed ("8" or "8%") into a fraction.
 * Null when blank / not a number.
 */
export function parsePct(text: string): number | null {
  const n = parseNum(text);
  return n === null ? null : n / 100;
}

/** Fraction → editable percent text (0.08 → "8"). */
export function pctText(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "";
  return String(Math.round(value * 10000) / 100);
}

/** YYYY-MM-DD (local) for date inputs / defaults. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function labelOf(
  list: Array<{ key: string; label: string }>,
  key: string
): string {
  return list.find((x) => x.key === key)?.label ?? key;
}

/** Range label like "$250K – $1M" / "$500K+" / "—". */
export function fmtRange(
  min: number | null | undefined,
  max: number | null | undefined
): string {
  const hasMin = min !== null && min !== undefined && Number.isFinite(min);
  const hasMax = max !== null && max !== undefined && Number.isFinite(max);
  if (!hasMin && !hasMax) return "—";
  if (hasMin && hasMax) return `${fmtMoneyCompact(min as number)} – ${fmtMoneyCompact(max as number)}`;
  if (hasMin) return `${fmtMoneyCompact(min as number)}+`;
  return `up to ${fmtMoneyCompact(max as number)}`;
}

/* ------------------------------ fetching ------------------------------ */

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Pull a list out of a response under any of the given keys. */
export function listFrom<T>(
  data: Record<string, unknown>,
  ...keys: string[]
): T[] {
  for (const k of keys) {
    const v = data[k];
    if (Array.isArray(v)) return v as T[];
  }
  if (Array.isArray(data)) return data as unknown as T[];
  return [];
}
