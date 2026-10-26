/**
 * Part 12 Communications & Reports — shared client types + fetch
 * helpers. Types mirror the lib/comms service row shapes and the
 * contract's shared render types; they are re-declared here so client
 * components never import server modules (fetch only).
 */

import { fmtDate, fmtMoney } from "@/lib/format";

export { fmtDate, fmtMoney };

export const COMMS_API = "/api/platform/comms";

/* ------------------------------ fetching ------------------------------ */

export class CommsApiError extends Error {
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
  if (!res.ok) throw new CommsApiError(res.status, data);
  return data as T;
}

/** Pull a list out of a response under any of the given keys. */
export function listFrom<T>(
  data: Record<string, unknown> | unknown,
  ...keys: string[]
): T[] {
  if (Array.isArray(data)) return data as T[];
  const rec = (data ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = rec[k];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

export type Rec = Record<string, unknown>;

export function str(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}
export function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
export function bool(v: unknown): boolean {
  return v === true;
}
/** Read a field under its camelCase or snake_case spelling. */
export function pick(r: Rec | null | undefined, ...keys: string[]): unknown {
  if (!r) return undefined;
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  return undefined;
}

/* ------------------------------ styling ------------------------------- */

export const cardCls =
  "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6";
export const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30";
export const selectCls = inputCls;
export const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";
export const thCls =
  "px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide";
export const tdCls = "px-3 py-2.5 text-sm text-[#0d1f3c] dark:text-white";

/* ----------------------------- constants ------------------------------ */

export const AUDIENCES: Array<{ key: string; label: string }> = [
  { key: "investor", label: "Investor" },
  { key: "lender", label: "Lender" },
  { key: "seller", label: "Seller" },
  { key: "portfolio_manager", label: "Portfolio manager" },
  { key: "board", label: "Board" },
  { key: "internal", label: "Internal" },
];

export const PURPOSES: Array<{ key: string; label: string }> = [
  { key: "investor_update", label: "Investor update" },
  { key: "investment_memo", label: "Investment memo" },
  { key: "ic_memo", label: "IC memo" },
  { key: "lender_package", label: "Lender package" },
  { key: "seller_feedback", label: "Seller feedback" },
  { key: "board_packet", label: "Board packet" },
  { key: "portfolio_monthly", label: "Portfolio monthly" },
  { key: "diligence_summary", label: "Diligence summary" },
];

export const BLOCK_TYPES: Array<{ key: string; label: string }> = [
  { key: "financial_summary", label: "Financial summary" },
  { key: "kpi_table", label: "KPI table" },
  { key: "variance_table", label: "Variance table" },
  { key: "covenant_status", label: "Covenant status" },
  { key: "plan_status", label: "Plan status" },
  { key: "capital_status", label: "Capital status" },
  { key: "findings", label: "Findings" },
  { key: "memo", label: "Memo" },
  { key: "narrative", label: "Narrative (AI / manual)" },
  { key: "text", label: "Text" },
  { key: "internal_notes", label: "Internal notes" },
];

export const SUBJECT_KINDS: Array<{ key: string; label: string }> = [
  { key: "company", label: "Company" },
  { key: "deal", label: "Deal" },
  { key: "investor", label: "Investor" },
  { key: "portfolio_company", label: "Portfolio company" },
];

export function labelOf(
  list: Array<{ key: string; label: string }>,
  key: string
): string {
  return list.find((x) => x.key === key)?.label ?? key;
}

/* ------------------------------- types -------------------------------- */

export interface TemplateBlock {
  key: string;
  type: string;
  heading: string;
  visibility: "all" | "internal_only" | string;
  config?: { text?: string; note?: string };
}

export interface CommsTemplate extends Rec {
  id: string;
  name: string;
  purpose: string;
  audience: string;
  subjectKinds?: string[];
  subject_kinds?: string[];
  blocks?: TemplateBlock[];
  tone?: string;
  disclaimers?: string[];
  routine?: boolean;
  isSystem?: boolean;
  is_system?: boolean;
}

export function templateSubjectKinds(t: CommsTemplate): string[] {
  const v = pick(t, "subjectKinds", "subject_kinds");
  return Array.isArray(v) ? v.map((x) => String(x)) : [];
}
export function templateBlocks(t: CommsTemplate): TemplateBlock[] {
  return Array.isArray(t.blocks) ? (t.blocks as TemplateBlock[]) : [];
}

/** Mirror of the contract's routineAllowed — the editor disables the
 *  routine toggle client-side on exactly the same rule the service
 *  enforces: memo purposes and narrative blocks can never be routine. */
export function routineAllowed(t: {
  purpose?: string;
  blocks?: TemplateBlock[];
}): boolean {
  if (t.purpose === "investment_memo" || t.purpose === "ic_memo") return false;
  const blocks = t.blocks ?? [];
  return !blocks.some((b) => b.type === "narrative");
}
export function routineBlockReason(t: {
  purpose?: string;
  blocks?: TemplateBlock[];
}): string {
  if (t.purpose === "investment_memo" || t.purpose === "ic_memo") {
    return "Memo templates (investment memo / IC memo) always require human review — they can never run as routine.";
  }
  if ((t.blocks ?? []).some((b) => b.type === "narrative")) {
    return "Templates with a narrative block can never be routine — narrative content must be reviewed before anything is sent.";
  }
  return "";
}

export interface CommsReport extends Rec {
  id: string;
  templateId?: string;
  templateName?: string;
  purpose?: string;
  audience?: string;
  subjectKind?: string;
  companyId?: string | null;
  dealId?: string | null;
  personId?: string | null;
  title?: string;
  status: string;
  isSample?: boolean;
  currentVersion?: number;
  hasUnreviewed?: boolean;
  stale?: boolean;
  staleReason?: string | null;
  narrativeStatus?: string;
  scheduleId?: string | null;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function reportField(r: CommsReport, ...keys: string[]): unknown {
  return pick(r as Rec, ...keys);
}

export function reportStatusBadge(status: string): string {
  switch (status) {
    case "approved":
    case "sent":
      return "badge-fit";
    case "in_review":
    case "generating":
      return "badge-warn";
    case "failed":
      return "badge-danger";
    default:
      return "badge-neutral";
  }
}

export interface AppendixFigure {
  key: string;
  label: string;
  value: number | string | null;
  format: "money" | "pct" | "multiple" | "number" | "text" | string;
  sourceModule: string;
  sourceId?: string;
  sourceLabel: string;
  href: string;
  verification: "reviewed" | "unreviewed" | string;
  confidence: number | null;
}

export interface RenderBlock {
  key: string;
  type: string;
  heading: string;
  visibility: string;
  dataStatus: "ok" | "missing" | "not_applicable" | string;
  figures: AppendixFigure[];
  table?: { columns: string[]; rows: Array<Array<string | number | null>> };
  chart?: {
    kind: "line" | "bar";
    series: Array<{ name: string; points: Array<{ x: string; y: number }> }>;
  };
  text?: string;
  narrative?: {
    status: string;
    statements: Array<{ text: string; figureKeys: string[] }>;
  };
}

export interface ReportRender {
  title: string;
  subjectLabel: string;
  asOf: string;
  sample: boolean;
  firm: string;
  disclaimers: string[];
  blocks: RenderBlock[];
  warnings: string[];
}

export function formatFigureValue(f: AppendixFigure): string {
  const v = f.value;
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "string") return v;
  switch (f.format) {
    case "money":
      return fmtMoney(v);
    case "pct":
      return `${(v * 100).toFixed(1)}%`;
    case "multiple":
      return `${v.toFixed(2)}×`;
    default:
      return new Intl.NumberFormat("en-US").format(v);
  }
}

export interface CheckIssue {
  code: string;
  message: string;
  blockKey?: string;
}

/* ------------- report redesign: presentation + meta --------------- */

/** Type-only re-exports — the presentation model and the guest meta
 * contract live in lib (pure modules); components consume the types
 * from here per the module's mirror convention. */
export type {
  ReportGuestMeta,
  ReportSubjectMark,
} from "@/lib/comms/types";
export type {
  PresentModel,
  PresentSection,
  PresentTile,
  PresentTakeaway,
  HiddenSection,
} from "@/lib/comms/present";

/** Sender contact settings (report-settings route). */
export interface ReportContactSettings {
  senderName: string;
  senderEmail: string;
  senderPhone: string;
  schedulingUrl: string;
}
export interface CheckResult {
  blocked: CheckIssue[];
  flagged: CheckIssue[];
  excluded: CheckIssue[];
}

export interface CommsSchedule extends Rec {
  id: string;
  templateId?: string;
  templateName?: string;
  subjectKind?: string;
  companyId?: string | null;
  dealId?: string | null;
  personId?: string | null;
  cadence?: string;
  dayOfMonth?: number;
  recipients?: Array<{ personId?: string; name: string; email: string }>;
  routineApproved?: boolean;
  approvedBy?: string;
  approvedAt?: string | null;
  status: string;
  pauseReason?: string | null;
  nextRunAt?: string | null;
  lastRunAt?: string | null;
  lastReportId?: string | null;
}

export interface CommsDelivery extends Rec {
  id: string;
  reportId?: string;
  version?: number;
  recipientPersonId?: string | null;
  recipientName?: string;
  recipientEmail?: string;
  audience?: string;
  allowPdf?: boolean;
  status: string;
  emailStatus?: string;
  emailDetail?: string | null;
  deliveredBy?: string;
  deliveredAt?: string | null;
  /** Open-pixel stamp (delivery email image fetched) — distinct from
   * openedAt/viewedAt (portal-link access). */
  emailOpenedAt?: string | null;
  openedAt?: string | null;
  viewedAt?: string | null;
  downloadedAt?: string | null;
  revokedAt?: string | null;
  expiresAt?: string | null;
}

export interface AiStatus {
  configured: boolean;
  provider: string | null;
  detail: string;
  setupSteps: string[];
}
export interface EmailTransportStatus {
  provider: string;
  connected: boolean;
  mailSend: "unknown" | "available" | "setup_required" | string;
  detail: string;
  setupSteps: string[];
}
export interface CommsStatus {
  ai: AiStatus;
  email: EmailTransportStatus;
  counts?: Record<string, number>;
}
