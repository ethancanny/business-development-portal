/**
 * Phase 5 Due Diligence — shared client types + fetch helpers.
 *
 * Types mirror the diligence service row shapes returned by
 * /api/platform/diligence/* (see lib/diligence/service.ts). They are
 * re-declared here so client components never import server modules.
 */

export interface DealContext {
  dealId: string;
  companyId: string | null;
  dealName: string;
  companyName: string;
  stage: string;
  /** Claimed-by partner (added server-side for the DD hub cards). */
  owner?: string;
  /** Redesign header facts (from the deals table, server-side). */
  investmentType?: string;
  industry?: string;
  askingPrice?: number | null;
  dealValue?: number | null;
  ebitda?: number | null;
  revenue?: number | null;
}

export interface WorkspaceRow {
  id: string;
  dealId: string;
  companyId: string | null;
  status: string;
  notes: string;
  createdBy: string;
  /** Key dates (redesign): LOI signed, exclusivity expiry, target close. */
  loiDate?: string | null;
  exclusivityExpiry?: string | null;
  targetCloseDate?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistItem {
  id: string;
  workspaceId: string;
  workstream: string;
  title: string;
  owner: string;
  status: string;
  dueDate: string | null;
  notes: string;
  /** Redesign additions. */
  priority: string; // low | normal | high
  description: string;
  dataroomChecklistItemId: string | null;
  dataroomDocumentId: string | null;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface RequestItem {
  id: string;
  workspaceId: string;
  checklistItemId: string | null;
  dataroomChecklistItemId: string | null;
  label: string;
  status: string; // requested | received | waived
  lastRequestedAt: string | null;
  respondedAt: string | null;
  responseNotes: string;
  createdAt: string;
  updatedAt: string;
}

export interface RequestSend {
  id: string;
  workspaceId: string;
  recipient: string;
  subject: string;
  body: string;
  channel: string;
  itemIds: string[];
  sentBy: string;
  createdAt: string;
}

export interface Finding {
  id: string;
  workspaceId: string;
  title: string;
  detail: string;
  category: string;
  severity: string;
  proposedTermType: string;
  proposedTermDetail: string;
  status: string; // proposed | accepted | rejected
  redFlagId: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
  /** Redesign additions: dollar impact, owner, checklist link. */
  impactAmount: number | null;
  owner: string;
  checklistItemId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Contract {
  id: string;
  workspaceId: string;
  counterparty: string;
  contractType: string;
  title: string;
  effectiveDate: string | null;
  expiryDate: string | null;
  renewalDate: string | null;
  autoRenew: boolean;
  changeOfControl: string;
  terminationTerms: string;
  keyTerms: string;
  annualValue: number | null;
  documentId: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface License {
  id: string;
  workspaceId: string;
  licenseType: string;
  issuingBody: string;
  licenseNumber: string;
  issuedDate: string | null;
  expiryDate: string | null;
  transferability: string;
  status: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
}

export interface SiteVisit {
  id: string;
  workspaceId: string;
  visitDate: string | null;
  attendees: string[];
  observations: string;
  photoDocumentIds: string[];
  facilityConditionScore: number | null;
  capacityNotes: string;
  utilizationEstimate: string;
  createdAt: string;
  updatedAt: string;
}

export interface RedFlag {
  id: string;
  workspaceId: string;
  title: string;
  detail: string;
  severity: string;
  owner: string;
  mitigation: string;
  status: string; // candidate | open | mitigating | resolved | dismissed
  source: string; // manual | analysis
  analysisId: string | null;
  anomalyRule: string | null;
  sourceSetId: string | null;
  periodEnd: string | null;
  confirmedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClosingItem {
  id: string;
  workspaceId: string;
  category: string;
  title: string;
  status: string; // open | done | waived
  dueDate: string | null;
  completedAt: string | null;
  notes: string;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceCounts {
  checklistTotal: number;
  checklistDone: number;
  requestsOutstanding: number;
  findingsProposed: number;
  findingsOpenBySeverity: { high: number; medium: number; low: number };
  findingsImpactTotal: number;
  redFlagsOpen: number;
  redFlagsCandidate: number;
  closingOpen: number;
}

export interface WorkspaceBundle {
  workspace: WorkspaceRow;
  deal: DealContext | null;
  room: { id: string; name: string } | null;
  checklist: ChecklistItem[];
  requestItems: RequestItem[];
  requestSends: RequestSend[];
  findings: Finding[];
  contracts: Contract[];
  licenses: License[];
  siteVisits: SiteVisit[];
  redFlags: RedFlag[];
  closingItems: ClosingItem[];
  counts: WorkspaceCounts;
}

export interface DealIndexItem {
  deal: DealContext;
  workspace: WorkspaceRow | null;
  checklistTotal: number;
  checklistDone: number;
  openRedFlags: number;
  candidateRedFlags: number;
  roomId: string | null;
}

/**
 * Slim bundle handed to tabs by the redesigned shell: identity +
 * counts only. Section data is fetched per tab (load only what's
 * viewed); the full server bundle remains available at
 * GET /api/platform/diligence/workspaces/[id] for other consumers.
 */
export interface WorkspaceSlim {
  workspace: WorkspaceRow;
  deal: DealContext | null;
  room: { id: string; name: string } | null;
  counts: WorkspaceCounts;
}

/** GET /api/platform/diligence/workspaces/[id]/summary */
export interface WorkspaceSummary {
  workspace: WorkspaceRow;
  deal: DealContext | null;
  room: { id: string; name: string } | null;
  counts: WorkspaceCounts & {
    checklistPct: number;
    findingsOpen: number;
  };
  workstreams: Array<{
    workstream: string;
    total: number;
    done: number;
    pct: number;
  }>;
  needsAttention: {
    overdueItems: Array<{
      id: string;
      title: string;
      workstream: string;
      owner: string;
      dueDate: string | null;
      daysOverdue: number;
    }>;
    agingRequests: Array<{
      id: string;
      label: string;
      lastRequestedAt: string | null;
      createdAt: string;
      daysOutstanding: number;
    }>;
    highFindings: Array<{
      id: string;
      title: string;
      severity: string;
      status: string;
      impactAmount: number | null;
    }>;
  };
  keyDates: {
    loiDate: string | null;
    exclusivityExpiry: string | null;
    targetCloseDate: string | null;
    startedOn: string;
    daysInDiligence: number;
  };
  dataroom: {
    roomId: string;
    roomName: string;
    total: number;
    satisfied: number;
    pct: number;
  } | null;
  bridge: {
    reportedEbitda: number | null;
    adjustedEbitda: number | null;
    items: Array<{ label: string; amount: number }>;
  } | null;
  activity: Array<{
    id: string;
    actor: string;
    kind: string;
    message: string;
    source: string;
    createdAt: string;
  }>;
  team: string[];
}

/** Props every workspace tab receives from the shell. */
export interface TabProps {
  workspaceId: string;
  bundle: WorkspaceSlim;
  reload: () => Promise<void>;
  /** Cross-tab navigation with an optional filter intent (tile clicks). */
  navigate?: (section: SectionKey, intent?: NavIntent) => void;
  /** One-shot filter intent handed over by a summary-tile click. */
  intent?: NavIntent | null;
}

/** Section keys across the grouped navigation (Batch C). */
export type SectionKey =
  | "overview"
  | "checklist"
  | "requests"
  | "qa"
  | "qoe"
  | "analysis"
  | "tax"
  | "contracts"
  | "generate"
  | "licenses"
  | "site-visits"
  | "bpmn"
  | "scorecard"
  | "findings"
  | "red-flags"
  | "risk"
  | "docint"
  | "records"
  | "closing"
  | "memo";

export interface NavIntent {
  /** Checklist: "attention" = overdue/issue toggle. */
  checklist?: "attention";
  /** Findings: severity filter. */
  findingsSeverity?: "high" | "medium" | "low";
  /** Red flags: status filter. */
  redFlagsStatus?: "candidate" | "open";
}

/** Statuses that count a checklist item as done (redesign set). */
export const CHECKLIST_DONE = ["complete", "na"];

export function isChecklistDone(status: string): boolean {
  return CHECKLIST_DONE.includes(status);
}

/* ------------------------------ constants ------------------------------ */

export const WORKSTREAMS: Array<{ key: string; label: string }> = [
  { key: "financial", label: "Financial" },
  { key: "tax", label: "Tax" },
  { key: "legal", label: "Legal" },
  { key: "operations", label: "Operations" },
  { key: "commercial", label: "Commercial" },
  { key: "hr", label: "HR / People" },
  { key: "insurance", label: "Insurance" },
  { key: "environmental", label: "Environmental" },
  { key: "it", label: "IT / Systems" },
];

/**
 * Redesigned 7-value status set (Oct 2026). Legacy values were
 * remapped server-side by the marker-guarded migration
 * `dd-checklist-status-v2`: in_progress → in_review,
 * reviewed → in_review, approved → complete, waived → na.
 */
export const CHECKLIST_STATUSES: Array<{ key: string; label: string }> = [
  { key: "not_started", label: "Not started" },
  { key: "requested", label: "Requested" },
  { key: "received", label: "Received" },
  { key: "in_review", label: "In review" },
  { key: "issue", label: "Issue noted" },
  { key: "complete", label: "Complete" },
  { key: "na", label: "N/A" },
];

export const CHECKLIST_PRIORITIES: Array<{ key: string; label: string }> = [
  { key: "low", label: "Low" },
  { key: "normal", label: "Normal" },
  { key: "high", label: "High" },
];

export const TERM_TYPES: Array<{ key: string; label: string }> = [
  { key: "working_capital_peg", label: "Working capital peg" },
  { key: "holdback", label: "Holdback" },
  { key: "earnout", label: "Earnout" },
  { key: "price_adjustment", label: "Price adjustment" },
  { key: "escrow", label: "Escrow" },
  { key: "representation", label: "Representation / warranty" },
  { key: "indemnity", label: "Indemnity" },
  { key: "closing_condition", label: "Closing condition" },
  { key: "walk_away", label: "Walk-away" },
  { key: "other", label: "Other" },
];

export const SEVERITIES = ["high", "medium", "low"] as const;

export const CLOSING_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "funds_flow", label: "Funds flow" },
  { key: "signature_pages", label: "Signature pages" },
  { key: "third_party_consents", label: "Third-party consents" },
  { key: "payoff_letters", label: "Payoff letters" },
  { key: "escrow_instructions", label: "Escrow instructions" },
  { key: "post_closing", label: "Post-closing" },
  { key: "other", label: "Other" },
];

export const ADJUSTMENT_KINDS: Array<{ key: string; label: string }> = [
  { key: "owner_comp", label: "Owner compensation" },
  { key: "related_party_rent", label: "Related-party rent" },
  { key: "one_time_fees", label: "One-time fees" },
  { key: "nonrecurring", label: "Non-recurring items" },
  { key: "anomaly_addback", label: "Anomaly add-back" },
  { key: "other", label: "Other" },
];

export const TRANSFERABILITY: Array<{ key: string; label: string }> = [
  { key: "transferable", label: "Transferable" },
  { key: "consent_required", label: "Consent required" },
  { key: "non_transferable", label: "Non-transferable" },
  { key: "unknown", label: "Unknown" },
];

export function labelOf(
  list: Array<{ key: string; label: string }>,
  key: string
): string {
  return list.find((x) => x.key === key)?.label ?? key;
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

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return usd0.format(value);
}

export function fmtSignedMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const s = usd0.format(Math.abs(value));
  return value < 0 ? `−${s}` : `+${s}`;
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

/** True when a YYYY-MM-DD date falls within the next `days` days (or past). */
export function withinDays(date: string | null, days: number): boolean {
  if (!date) return false;
  const target = new Date(`${date}T12:00:00`);
  if (Number.isNaN(target.getTime())) return false;
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return diff <= days * 24 * 60 * 60 * 1000;
}

/* ------------------------------ fetching ------------------------------ */

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(
      typeof body.error === "string" ? body.error : `HTTP ${status}`
    );
    this.status = status;
    this.body = body;
  }
}

export async function api<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(path, {
    cache: "no-store",
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

export function splitList(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/* --------------------- Part 5B: Doc Intel / Records / Memo / Risk --------------------- */

/** One provider leg of the document-intelligence status payload. */
export interface DocintProviderStatus {
  configured: boolean;
  detail: string;
}

/** GET /api/platform/diligence/docint/status */
export interface DocintStatus {
  activeProvider: string;
  policy?: string;
  azureUsageThisMonth?: { runs: number; pages: number };
  azure: DocintProviderStatus;
  local: DocintProviderStatus;
}

/** One extraction run row (POST extract response / runs list). */
export interface DocintRun {
  id: string;
  dealId?: string;
  documentId?: string | null;
  provider: string;
  status: string;
  pages?: number | null;
  pageCount?: number | null;
  fieldsExtracted?: number | null;
  fieldCount?: number | null;
  error?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

/** One extracted field awaiting (or past) human review. */
export interface DocintField {
  id: string;
  runId: string;
  documentId: string;
  fieldKey: string;
  label: string;
  valueText: string | null;
  confidence: number | null;
  page: number | null;
  passage: string | null;
  status: string; // provisional | confirmed | corrected | rejected
  correctedValue: string | null;
  appliedContractId: string | null;
}

/** One point-in-time snapshot of an external record check. */
export interface RecordSnapshot {
  id: string;
  checkType: string;
  sourceName: string;
  sourceUrl: string | null;
  route: string; // automated | manual
  resultStatus: string; // clear | finding | unknown
  summary: string;
  checkedAt: string | null;
  enteredBy: string | null;
  changed: boolean;
  changeSummary: string | null;
}

/** One check type in the records register, with its latest snapshot. */
export interface RecordCheckType {
  key: string;
  label: string;
  defaultSource: string;
  automation: string; // automated | manual
  automationNote: string;
  latest: RecordSnapshot | null;
  refreshDue: boolean;
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

/** The IC memo row (GET /api/platform/diligence/memo → memo). */
export interface MemoData {
  id: string;
  version: number;
  status: string; // draft | approved
  payload: { sections: MemoSection[] };
  generatedBy: string | null;
  generatedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
}

/** A risk-score source: plain label or a linkable reference. */
export type RiskSource =
  | string
  | { label?: string; name?: string; href?: string; url?: string }
  | null;

export interface RiskComponent {
  key: string;
  label: string;
  weight: number;
  subscore: number;
  value: string | number | null;
  detail: string;
  source: RiskSource;
}

export interface RiskDriver {
  key?: string;
  label?: string;
  title?: string;
  subscore?: number | null;
  value?: string | number | null;
  detail?: string;
  source?: RiskSource;
  /** Backend drivers carry a direct link to the source record. */
  href?: string;
}

/** The current risk score (GET /api/platform/diligence/risk → current). */
export interface RiskCurrent {
  id: string;
  score: number;
  band: string; // Low | Moderate | Elevated | High
  components: RiskComponent[];
  drivers: Array<RiskDriver | string>;
  changes: Record<string, unknown> | null;
  triggerSource?: string | null;
  createdAt: string;
}

export interface RiskHistoryItem {
  id: string;
  score: number;
  band: string;
  triggerSource: string | null;
  createdAt: string;
  changes: Record<string, unknown> | null;
}
