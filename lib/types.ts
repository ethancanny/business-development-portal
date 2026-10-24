/* ---------------- Investment types (Step 1, Oct 23, 2026) ------------
 * Every deal carries an investment type. Stage lists are per type and
 * configurable in Settings (bd.type_config is the live source); the
 * constants below are the seeded defaults and the offline fallback.
 * Ethan's correction (Oct 23, 23:47): NDA is NOT a stage.
 * The pre-Oct-23 stage names (Sourcing / Initial Contact / Negotiation /
 * Closing / Closed Won) were migrated to the Platform LBO list with the
 * approved mapping — see bd.migration_reports. */

export type InvestmentTypeKey =
  | "platform_lbo"
  | "add_on"
  | "early_stage"
  | "minority_growth";

export const INVESTMENT_TYPE_LABELS: Record<InvestmentTypeKey, string> = {
  platform_lbo: "Platform LBO",
  add_on: "Add-on",
  early_stage: "Early Stage",
  minority_growth: "Minority Growth",
};

export const PLATFORM_LBO_STAGES = [
  "Sourced",
  "IOI",
  "Diligence",
  "LOI",
  "Financing",
  "Closed",
  "Passed",
] as const;

export const ADD_ON_STAGES = PLATFORM_LBO_STAGES;

export const EARLY_STAGE_STAGES = [
  "Sourced",
  "Intro",
  "Partner Meeting",
  "Term Sheet",
  "Diligence",
  "Closed",
  "Passed",
] as const;

/** Default stage list per investment type (Settings can override). */
export const DEFAULT_STAGES_BY_TYPE: Record<InvestmentTypeKey, readonly string[]> = {
  platform_lbo: PLATFORM_LBO_STAGES,
  add_on: ADD_ON_STAGES,
  early_stage: EARLY_STAGE_STAGES,
  minority_growth: PLATFORM_LBO_STAGES,
};

/** Every stage name valid for at least one type — the deals API
 * accepts these; per-type membership is enforced against bd config. */
export const ALL_DEAL_STAGES: readonly string[] = Array.from(
  new Set([
    ...PLATFORM_LBO_STAGES,
    ...EARLY_STAGE_STAGES,
    // Legacy names stay *acceptable* on read for any pre-migration row
    // that surfaces before the migration runs; writes never produce them.
    "Sourcing",
    "Initial Contact",
    "Negotiation",
    "Closing",
    "Closed Won",
  ])
);

/** Back-compat default (Platform LBO list) for surfaces that have not
 * loaded the per-type config yet. */
export const DEAL_STAGES = PLATFORM_LBO_STAGES;

export type DealStage = string;

/** Crosswalk used when a deal's type changes and its current stage is
 * not in the new type's list: exact-name match wins; these are the
 * judgment mappings for the non-shared stages. */
export const STAGE_CROSSWALK: Record<string, string> = {
  IOI: "Intro",
  LOI: "Term Sheet",
  Financing: "Diligence",
  Intro: "Sourced",
  "Partner Meeting": "Sourced",
  "Term Sheet": "IOI",
};

export function stageForTypeChange(
  stage: string,
  targetStages: readonly string[]
): string {
  if (targetStages.includes(stage)) return stage;
  const mapped = STAGE_CROSSWALK[stage];
  if (mapped && targetStages.includes(mapped)) return mapped;
  return targetStages[0] ?? "Sourced";
}

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

/** Measured business metrics (Oct 11, 2026) — the raw inputs the
 * valuation's continuous driver curves read. Recorded by hand in the
 * deal modal or extracted from a CIM by the email intake. When a
 * metric is present it supersedes the matching qualitative driver
 * bucket: the adjustment scales with the actual number (and, for
 * risk penalties, with deal size) instead of a flat step. */
export interface DealMetrics {
  /** Largest customer as % of revenue. */
  topCustomerPct?: number | null;
  /** Top 3 customers combined, % of revenue. */
  top3Pct?: number | null;
  /** Recurring / contracted revenue, % of revenue. */
  recurringPct?: number | null;
  /** Owner's working hours per week in the business. */
  ownerHoursPerWeek?: number | null;
}

/** Stored synthesis (Oct 11, 2026): the agent's written valuation
 * read on the deal — market context across the multiples sources,
 * what the measured metrics imply, the verdict, and what's still
 * missing. Refreshed when the deal's inputs change; inputsHash
 * fingerprints the inputs it was written from so staleness shows. */
export interface DealSynthesis {
  text: string;
  updatedAt: string;
  inputsHash: string;
  author?: string;
}

export interface Deal {
  id: string;
  companyName: string;
  industry: string;
  stage: DealStage;
  /** Investment type (Step 1, Oct 23, 2026). Absent on pre-migration
   * rows — readers default to "platform_lbo". */
  investmentType?: InvestmentTypeKey;
  /** Add-on → its platform deal (required for add_on deals). */
  parentDealId?: string | null;
  /** Deal Identity (Oct 24, 2026): optional codename. Internal
   *  surfaces show it beside the real name; external surfaces show
   *  the codename ONLY (logo hidden) when codenameExternal is on. */
  codename?: string;
  /** Per-deal override: FALSE = real name shows externally too.
   *  Absent/TRUE = codename applies externally when set. */
  codenameExternal?: boolean;
  /** Deal Identity enrichment (API-side, from the identity service):
   *  the core company this deal belongs to + its stored-logo version
   *  and accent, so list surfaces render the mark without extra reads. */
  companyId?: string;
  logoVersion?: number;
  accentColor?: string;
  /** Early-stage flywheel link: where this deal was sourced from. */
  sourcedFromType?: "portfolio_company" | "market_insight" | null;
  sourcedFromId?: string | null;
  dealValue: number;
  drivers?: DealDrivers;
  structure?: DealStructureInput;
  metrics?: DealMetrics;
  synthesis?: DealSynthesis | null;
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
  /** Structured pass reason (set when stage = Passed). */
  passReason?: string;
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
  /** Optional photo URL (initials avatar otherwise). */
  photoUrl?: string;
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

export type TaskType = "Call" | "Email" | "Meeting" | "Send docs" | "Other";
export type TaskPriority = "normal" | "high";

export interface Task {
  id: string;
  title: string;
  dueDate: string; // yyyy-mm-dd (America/Phoenix calendar date) or ""
  dueTime: string | null; // "HH:MM" 24h Phoenix wall-clock; null = all-day
  type: TaskType;
  priority: TaskPriority;
  notes: string;
  done: boolean;
  completedAt: string | null; // ISO timestamp when marked done
  owner: string; // partner name or ""
  relatedKind: TaskRelatedKind | null;
  relatedId: string | null;
  relatedName: string; // denormalized for display
  calendarEventId: string | null; // Outlook/Graph event mirrored from this follow-up
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
  /** ISO timestamp when the item was seen in the Activity list;
   * null = unread (counts toward the app-icon badge). */
  readAt: string | null;
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
  | "deal.intake"
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
  | "task.deleted"
  | "candidate.created"
  | "candidate.updated"
  | "candidate.status"
  | "candidate.merged"
  | "candidate.deleted";

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
  /** Pipeline stage (Ethan, Oct 16, 2026): "fit" is the active-fit
   * stage feeding the Fit Targets section; "dismissed" is sticky —
   * no ingest or sync may flip it back (see lib/market-db.ts). */
  status: "new" | "keep" | "dismissed" | "added" | "fit";
  firstSeen: string;
  lastSeen: string;
  /** Set once when the record is created; never overwritten by syncs. */
  dateAdded: string;
  dismissedAt: string | null;
  dismissedReason: string;
  /** Chain/franchise filter (Ethan, Oct 16, 2026): isChain rows never
   * appear in the Fits section and never count toward its cap; they
   * list in the Filtered Out view with chainReason. chainSuspect is
   * the weak-signal "Possible franchise" tag — the row stays in Fits.
   * chainExempt is the permanent "Not a chain" override. */
  isChain: boolean;
  chainReason: string;
  chainSuspect: boolean;
  chainExempt: boolean;
  /** Institutional filter (Ethan, Oct 17, 2026): isInstitutional rows
   * (schools, nonprofits, government, religious, correctional,
   * facility dining) never appear in the Fits section and never count
   * toward its totals; institutionalSuspect is the ambiguous-signal
   * "Possible institution" tag — likewise held out of Fits until
   * reviewed. Both list in the Filtered Out view with
   * institutionalReason. institutionalExempt is the permanent
   * "Not institutional" override. */
  isInstitutional: boolean;
  institutionalReason: string;
  institutionalSuspect: boolean;
  institutionalExempt: boolean;
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
  /** Focus sector the filer maps to ("" = none / unmapped). */
  sector: string;
  /** Triage tag: "Competing capital" | "Operating company raise" | "Other"
   * | "Possible exit buyer" | "Competing platform" | "Distress / asset sale" | "". */
  tag: string;
  /** "Why this matters" one-liner shown under the summary. */
  why: string;
  /** JSON payload: Form D fields / 8-K items / bankruptcy chapter+court /
   * keep-link target. "" when empty. */
  details: string;
  sic: string;
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

/** News & Intelligence (redesign Wave 2, Oct 14, 2026): an entity the
 * relevance screen matched a story to. `kind` on the item is the primary
 * lane (entity | watchlist | event | sector) that decided its score. */
export interface MiNewsMatch {
  type: "company" | "deal" | "operator" | "investor" | "watchlist" | "hospitality";
  id: string;
  name: string;
}

export interface MiNewsItem {
  id: string;
  dedupeKey: string;
  headline: string;
  url: string;
  sourceName: string;
  publishedAt: string;
  fetchedAt: string;
  sector: string | null;
  /** Classifier confidence (0–1) for `sector` and any secondary sector
   * tags (News overhaul, Oct 17, 2026 — lib/news-classify.ts). Rows
   * predating the classifier carry 0 / [] until the reclassify pass. */
  sectorConfidence: number;
  sectorTags: string[];
  /** Why this story matters, generated by the relevance model at
   * classify time ("Acquisition / M&A · Tracked name · Arizona"). */
  relevanceReason: string | null;
  /** True when the story carries an acquisition/investment signal —
   * the pool the ⭐ Top Market Event pick draws from. */
  dealSignal: boolean;
  /** Written by an agent in our own words (≤2 sentences) — never copied
   * from the publisher. Null until the summary pass fills it. */
  summary: string | null;
  summaryAt: string | null;
  relevanceScore: number;
  kind: "entity" | "watchlist" | "event" | "sector";
  matched: MiNewsMatch[];
  imageUrl: string | null;
  imageCredit: string | null;
  alsoCoveredBy: string[];
  saved: boolean;
  dismissed: boolean;
  linkedCompanyId: string | null;
}
