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
}

export interface WorkspaceRow {
  id: string;
  dealId: string;
  companyId: string | null;
  status: string;
  notes: string;
  createdBy: string;
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

/** Props every workspace tab receives from the shell. */
export interface TabProps {
  workspaceId: string;
  bundle: WorkspaceBundle;
  reload: () => Promise<void>;
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

export const CHECKLIST_STATUSES: Array<{ key: string; label: string }> = [
  { key: "not_started", label: "Not started" },
  { key: "in_progress", label: "In progress" },
  { key: "received", label: "Received" },
  { key: "reviewed", label: "Reviewed" },
  { key: "approved", label: "Approved" },
  { key: "waived", label: "Waived" },
  { key: "na", label: "N/A" },
];

export const TERM_TYPES: Array<{ key: string; label: string }> = [
  { key: "working_capital_peg", label: "Working capital peg" },
  { key: "holdback", label: "Holdback" },
  { key: "earnout", label: "Earnout" },
  { key: "price_adjustment", label: "Price adjustment" },
  { key: "escrow", label: "Escrow" },
  { key: "representation", label: "Representation / warranty" },
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
