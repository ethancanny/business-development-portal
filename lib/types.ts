export const DEAL_STAGES = [
  "Sourcing",
  "Initial Contact",
  "Diligence",
  "Negotiation",
  "Closing",
  "Closed Won",
  "Passed",
] as const;

export type DealStage = (typeof DEAL_STAGES)[number];

export interface DealLink {
  label: string;
  url: string;
}

/** Qualitative valuation drivers recorded on a deal (Oct 10, 2026).
 * Each moves the estimated multiple: "pos" raises it, "neg" lowers it.
 * Set them as diligence learns more — the estimate updates with them. */
export type DriverLevel = "neg" | "neu" | "pos";
export interface DealDrivers {
  concentration?: DriverLevel | "";
  recurring?: DriverLevel | "";
  ownerDependence?: DriverLevel | "";
  growth?: DriverLevel | "";
  margins?: DriverLevel | "";
  management?: DriverLevel | "";
  financials?: DriverLevel | "";
}

/** Deal structure (Oct 10, 2026). Preferred form: the stated dollar
 * amounts of a proposed/asking structure — the headline price is
 * their sum, and the effective multiple discounts each piece for
 * expected payout and time value. Percent fields are the legacy /
 * fallback form; all blank = assume the industry-typical mix. */
export interface DealStructureInput {
  cashAmt?: number | null;
  sellerAmt?: number | null;
  earnoutAmt?: number | null;
  rolloverAmt?: number | null;
  /** Seller note terms, when known — the note is then priced off its
   * actual rate/term against the market prime rate instead of the
   * flat 95¢ default. */
  sellerRatePct?: number | null;
  sellerTermYrs?: number | null;
  /** Earnout (contingent consideration) terms, accounting-style:
   * the key metric it pays on, its measurement/vesting period, and
   * the probability-weighted expected payout %. The earnout is
   * valued at expected payout discounted at prime over the period.
   * Defaults when blank: 70% expected payout over 2 years. */
  earnoutMetric?: string;
  earnoutPeriodYrs?: number | null;
  earnoutProbPct?: number | null;
  /** Rollover terms: vesting period and the probability it fully
   * vests / is retained. Adjusts the flat 90¢ illiquidity value. */
  rolloverVestYrs?: number | null;
  rolloverProbPct?: number | null;
  cashPct?: number | null;
  sellerPct?: number | null;
  earnoutPct?: number | null;
  rolloverPct?: number | null;
}

export interface Deal {
  id: string;
  companyName: string;
  industry: string;
  stage: DealStage;
  dealValue: number;
  drivers?: DealDrivers;
  structure?: DealStructureInput;
  /** Annual revenue, if known. */
  revenue: number | null;
  /** Annual EBITDA, if known. */
  ebitda: number | null;
  /** Asking price, if known. */
  askingPrice: number | null;
  /** Projected annual growth % — its own valuation layer
   * (~0.05× per point, clamped ±1.25×). */
  growthPct?: number | null;
  /** Broker / intermediary name, if any. */
  broker: string;
  /** How this target was sourced. */
  source: string;
  contactName: string;
  contactEmail: string;
  notes: string;
  owner: string;
  city: string;
  lat: number | null;
  lng: number | null;
  links: DealLink[];
  /** IDs of executives (operators) paired with this deal. */
  operatorIds: string[];
  createdAt: string;
  updatedAt: string;
}

export const EXEC_STAGES = [
  "Sourcing",
  "Screening",
  "Interview",
  "Reference Check",
  "Offer",
  "Placed",
  "Passed",
] as const;

export type ExecStage = (typeof EXEC_STAGES)[number];

export interface Executive {
  id: string;
  name: string;
  currentTitle: string;
  targetRole: string;
  stage: ExecStage;
  background: string;
  notes: string;
  owner: string;
  /** Industry / sector expertise, e.g. ["Industrial Services", "Healthcare"]. */
  industries: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Partner {
  id: string;
  name: string;
  email: string;
}

export const PARTNER_NAMES = [
  "Ethan Canny",
  "Ronan Canny",
  "Ian Canny",
] as const;

// --- Tasks & follow-ups ---

export type TaskRelatedKind = "deal" | "executive";

export interface Task {
  id: string;
  title: string;
  dueDate: string; // yyyy-mm-dd or ""
  done: boolean;
  owner: string; // partner name or ""
  relatedKind: TaskRelatedKind | null;
  relatedId: string | null;
  relatedName: string; // denormalized for display
  createdAt: string;
  updatedAt: string;
}

// --- Activity feed ---

export interface Contact {
  id: string;
  name: string;
  role: string;
  email: string;
  phone: string;
  linkedin: string;
  notes: string;
  dealId: string | null;
  execId: string | null;
  owner: string;
  createdAt: string;
  updatedAt: string;
}

export type InteractionKind = "call" | "email" | "meeting" | "note";

export interface Interaction {
  id: string;
  dealId: string | null;
  execId: string | null;
  kind: InteractionKind;
  occurredAt: string;
  summary: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  dealId: string;
  filename: string;
  mimeType: string;
  size: number;
  /** base64-encoded file bytes */
  data: string;
  createdAt: string;
}

export type DealFlowKind =
  | "business_for_sale"
  | "operator_available"
  | "market_note";

export type DealFlowStatus = "new" | "reviewed" | "added" | "dismissed";

export interface DealFlowItem {
  id: string;
  kind: DealFlowKind;
  title: string;
  source: string;
  sourceDetail: string;
  spottedAt: string;
  why: string;
  industry: string;
  location: string;
  status: DealFlowStatus;
  relatedDealId: string | null;
  relatedExecId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ActivityType =
  | "deal.created"
  | "deal.updated"
  | "deal.stage"
  | "deal.claim"
  | "deal.operators"
  | "deal.deleted"
  | "deal.contact"
  | "deal.interaction"
  | "deal.attachment"
  | "flow.created"
  | "flow.converted"
  | "exec.created"
  | "exec.updated"
  | "exec.stage"
  | "exec.claim"
  | "exec.deleted"
  | "task.created"
  | "task.completed"
  | "task.reopened"
  | "task.deleted";

export interface ActivityEvent {
  id: string;
  type: ActivityType;
  actor: string;
  message: string;
  dealId: string | null;
  execId: string | null;
  dealName: string | null;
  execName: string | null;
  createdAt: string;
}

/* ---------------- Market Intel ---------------- */

export type MiIndicatorSource = "fred" | "bls" | "census" | "usaspending" | "ebrc" | "yahoo" | "damodaran";

export interface MiIndicatorObs {
  id: string;
  source: MiIndicatorSource;
  seriesId: string;
  title: string;
  units: string;
  frequency: string;
  obsDate: string; // YYYY-MM-DD
  value: number | null;
}

export interface MiListing {
  id: string;
  title: string;
  price: number | null;
  revenue: number | null;
  cashFlow: number | null;
  industry: string;
  location: string;
  broker: string;
  url: string;
  source: string;
  description: string;
  status: "new" | "keep" | "dismissed" | "added";
  firstSeen: string;
  lastSeen: string;
  createdAt: string;
  updatedAt: string;
}

/** A named company profile built from a public registry spine (SAM.gov,
 * AZ ROC, NPPES, EPA FRS, USASpending recipients). signalValue is the
 * headline size signal in dollars where the source carries one (e.g.
 * federal award totals); signalLabel says what it means. */
export interface MiCompany {
  id: string;
  dedupKey: string;
  name: string;
  sector: string;
  subsector: string;
  naics: string;
  city: string;
  state: string;
  address: string;
  zip: string;
  contactName: string;
  contactTitle: string;
  phone: string;
  website: string;
  formedDate: string;
  employees: number | null;
  signalValue: number | null;
  signalLabel: string;
  source: string;
  sourceUrl: string;
  details: string;
  status: "new" | "keep" | "dismissed" | "added";
  firstSeen: string;
  lastSeen: string;
}

export interface MiMultiple {
  id: string;
  sourceReport: string;
  period: string;
  industry: string;
  sizeBand: string;
  evEbitdaLow: number | null;
  evEbitdaHigh: number | null;
  evEbitdaMedian: number | null;
  evRevenueMedian: number | null;
  notes: string;
  createdAt: string;
}

export interface MiAcquisition {
  id: string;
  acquirer: string;
  target: string;
  targetLocation: string;
  industry: string;
  dealValue: number | null;
  announcedDate: string;
  sourceUrl: string;
  publisher: string;
  eventType: "acquisition" | "bankruptcy" | "expansion" | "contract" | "relocation" | "ipo" | "policy" | "investment";
  headline: string;
  summary: string;
  status: "new" | "keep" | "dismissed";
  createdAt: string;
}

export type MiFilingCategory = "acquisition" | "form_d" | "expansion" | "bankruptcy";

export interface MiFiling {
  id: string;
  form: string;
  company: string;
  cik: string;
  filingDate: string;
  accession: string;
  category: MiFilingCategory;
  summary: string;
  url: string;
  azCompany: boolean;
  majorEvent: boolean;
  status: "new" | "keep" | "dismissed";
  createdAt: string;
}

export interface MiWarnNotice {
  id: string;
  employer: string;
  location: string;
  headcount: number | null;
  noticeDate: string;
  effectiveDate: string;
  industry: string;
  source: string;
  status: string;
  createdAt: string;
}

export interface MiEntity {
  id: string;
  name: string;
  entityType: string;
  formationDate: string;
  agent: string;
  address: string;
  source: string;
  status: "new" | "keep" | "dismissed";
  createdAt: string;
}

export interface MiSyncLog {
  id: string;
  job: string;
  ranAt: string;
  status: "ok" | "error" | "skipped";
  added: number;
  message: string;
}
