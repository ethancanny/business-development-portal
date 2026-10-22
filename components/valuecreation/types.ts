/**
 * Phase 6 Value Creation — shared client types + fetch helpers.
 *
 * Types mirror the value-creation service row shapes returned by
 * /api/platform/value-creation/* (see the Phase 6 API contract).
 * They are re-declared here so client components never import
 * server modules. Money formatting delegates to @/lib/format so
 * figures render exactly as in FinancialAnalysis.
 */

import { fmtDate, fmtMoney, fmtMoneyCompact } from "@/lib/format";

export { fmtDate, fmtMoney, fmtMoneyCompact };

/* ------------------------------ plans ------------------------------ */

export interface PlanSummary {
  openInitiatives: number;
  impactWeighted: number;
  impactUnweighted: number;
  /** Exit readiness overall, 0–100 (null when unscored). */
  exitOverall: number | null;
}

export interface VcPlan {
  id: string;
  companyId: string;
  companyName?: string;
  name: string;
  planStartDate: string | null;
  status: string;
  thesis: string;
  incentiveNotes?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** One row of GET /plans. */
export interface PlanListItem {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  planStartDate: string | null;
  status: string;
  updatedAt?: string;
  summary: PlanSummary | null;
}

/** GET /plans/[planId] */
export interface PlanDetail {
  plan: VcPlan;
  summary: PlanSummary;
  initiatives: Initiative[];
}

/* ------------------------------ initiatives ------------------------------ */

export interface Initiative {
  id: string;
  planId: string;
  title: string;
  description?: string;
  category?: string;
  status: string; // planned | in_progress | on_track | at_risk | done | deferred
  ownerName: string;
  startDate: string | null;
  endDate: string | null;
  oneTimeCost: number | null;
  recurringCost: number | null;
  ebitdaImpact: number | null;
  /** 0–1 */
  confidence: number | null;
  /** 1–5 */
  effort: number | null;
  dependsOn: string[];
  sourceKind: string; // manual | playbook | remediation
  sourceRef: Record<string, unknown> | string | null;
  createdAt?: string;
  updatedAt?: string;
}

/** Mirrors INITIATIVE_STATUSES in lib/valuecreation/schema.ts. */
export const INITIATIVE_STATUSES: Array<{ key: string; label: string }> = [
  { key: "planned", label: "Planned" },
  { key: "in_progress", label: "In progress" },
  { key: "on_track", label: "On track" },
  { key: "at_risk", label: "At risk" },
  { key: "done", label: "Done" },
  { key: "deferred", label: "Deferred" },
];

export function initiativeStatusBadge(status: string): string {
  switch (status) {
    case "done":
    case "on_track":
      return "badge-fit";
    case "in_progress":
      return "badge-warn";
    case "at_risk":
    case "deferred":
      return "badge-danger";
    default:
      return "badge-neutral";
  }
}

/* ------------------------------ remediation ------------------------------ */

/** One low-scorecard-area candidate from GET /plans/[id]/remediation. */
export interface RemediationCandidate {
  workspaceId: string;
  dealId?: string;
  areaKey: string;
  areaLabel?: string;
  label?: string;
  score: number | null;
  notes?: string;
  alreadyConverted?: boolean;
  companyName?: string;
}

/* ------------------------------ playbooks ------------------------------ */

export interface PlaybookStep {
  title: string;
  description?: string;
  /** Backend field name for the step's typical EBITDA impact. */
  typicalImpact?: number | null;
  ebitdaImpact?: number | null;
  effort?: number | null;
  /** 0–1 */
  confidence?: number | null;
  durationDays?: number | null;
  offsetDays?: number | null;
}

export interface Playbook {
  id: string;
  name: string;
  category: string;
  description: string;
  steps: PlaybookStep[];
  isSystem?: boolean;
  isBuiltin?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

/** The six playbook categories (lib/valuecreation/schema.ts). */
export const PLAYBOOK_CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "pricing", label: "Pricing" },
  { key: "procurement", label: "Procurement" },
  { key: "sales_comp", label: "Sales compensation" },
  { key: "working_capital", label: "Working capital" },
  { key: "org_design", label: "Org design" },
  { key: "systems", label: "Systems" },
];

export function playbookStepImpact(s: PlaybookStep): number {
  if (typeof s.typicalImpact === "number") return s.typicalImpact;
  if (typeof s.ebitdaImpact === "number") return s.ebitdaImpact;
  return 0;
}

export function playbookTypicalImpact(p: Playbook): number {
  return (p.steps ?? []).reduce((sum, s) => sum + playbookStepImpact(s), 0);
}

/* ------------------------------ add-ons ------------------------------ */

export interface Addon {
  id: string;
  planId: string;
  /** Backend row field for the target's name. */
  name: string;
  targetName?: string;
  /** Linked platform company, when the target is a known company. */
  targetCompanyId?: string | null;
  targetDealId?: string | null;
  companyId?: string | null;
  linkedCompanyId?: string | null;
  status: string; // identified | contacted | diligence | closed | passed
  synergyEstimate: number | null;
  revenueEstimate: number | null;
  ebitdaEstimate: number | null;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function addonName(a: Addon): string {
  return a.name || a.targetName || "Untitled target";
}

export function addonCompanyId(a: Addon): string | null {
  return a.targetCompanyId ?? a.companyId ?? a.linkedCompanyId ?? null;
}

export const ADDON_STATUSES: Array<{ key: string; label: string }> = [
  { key: "identified", label: "Identified" },
  { key: "contacted", label: "Contacted" },
  { key: "diligence", label: "Diligence" },
  { key: "closed", label: "Closed" },
  { key: "passed", label: "Passed" },
];

/* ------------------------------ org & hiring ------------------------------ */

export interface OrgNode {
  id: string;
  planId: string;
  name: string;
  title: string;
  /** Backend row field for the parent node id. */
  reportsToId: string | null;
  reportsTo?: string | null;
  isKeyPerson: boolean;
  keyPerson?: boolean;
  riskLevel: string; // low | medium | high
  /** Backend row field for the node's risk notes. */
  riskNotes?: string;
  notes?: string;
  incentiveNotes?: string;
  vacancy: boolean;
  isVacant?: boolean;
  vacant?: boolean;
  targetDate?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export function orgReportsTo(n: OrgNode): string | null {
  return n.reportsToId ?? n.reportsTo ?? null;
}

export function orgNotes(n: OrgNode): string {
  return n.riskNotes ?? n.notes ?? "";
}

export function orgIsKeyPerson(n: OrgNode): boolean {
  return Boolean(n.isKeyPerson ?? n.keyPerson);
}

export function orgIsVacant(n: OrgNode): boolean {
  return Boolean(n.vacancy ?? n.isVacant ?? n.vacant) || !n.name?.trim();
}

export const RISK_LEVELS: Array<{ key: string; label: string }> = [
  { key: "low", label: "Low risk" },
  { key: "medium", label: "Medium risk" },
  { key: "high", label: "High risk" },
];

export function riskBadge(level: string): string {
  if (level === "high") return "badge-danger";
  if (level === "medium") return "badge-warn";
  return "badge-neutral";
}

export interface HiringRole {
  id: string;
  planId: string;
  role: string;
  title?: string;
  department: string;
  priority: string; // high | medium | low
  targetDate: string | null;
  status: string; // planned | searching | interviewing | offered | hired | on_hold
  /** Backend stores the comp range as one free-text string. */
  compRange: string;
  compMin?: number | null;
  compMax?: number | null;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function hiringRoleName(r: HiringRole): string {
  return r.role || r.title || "Untitled role";
}

export const HIRING_STATUSES: Array<{ key: string; label: string }> = [
  { key: "planned", label: "Planned" },
  { key: "searching", label: "Searching" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offered", label: "Offered" },
  { key: "hired", label: "Hired" },
  { key: "on_hold", label: "On hold" },
];

export const PRIORITIES: Array<{ key: string; label: string }> = [
  { key: "high", label: "High" },
  { key: "medium", label: "Medium" },
  { key: "low", label: "Low" },
];

/* ------------------------------ targets ------------------------------ */

export interface VcTarget {
  id: string;
  planId: string;
  /** Backend row fields. */
  periodLabel: string;
  periodEnd: string;
  metric: string;
  targetValue: number;
  period?: string;
  value?: number | null;
  unit?: string;
  source?: string; // manual | derived
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
}

export function targetPeriod(t: VcTarget): string {
  return t.periodLabel || t.period || "—";
}

export function targetValueOf(t: VcTarget): number | null {
  if (typeof t.targetValue === "number") return t.targetValue;
  return t.value ?? null;
}

/** Mirrors TARGET_METRICS in lib/valuecreation/schema.ts. */
export const TARGET_METRICS: Array<{ key: string; label: string; margin?: boolean }> = [
  { key: "revenue", label: "Revenue" },
  { key: "ebitda", label: "EBITDA" },
  { key: "gross_margin_pct", label: "Gross margin", margin: true },
  { key: "ebitda_margin_pct", label: "EBITDA margin", margin: true },
];

export function isMarginMetric(metric: string): boolean {
  return /margin/i.test(metric);
}

/**
 * Margin targets are stored as percentage POINTS by the backend
 * (the derive path writes e.g. 22.5 for 22.5%); a value ≤ 1 is
 * treated defensively as a fraction.
 */
export function fmtTargetValue(t: VcTarget): string {
  const v = targetValueOf(t);
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  if (isMarginMetric(t.metric) || t.unit === "%" || t.unit === "pct") {
    const pct = Math.abs(v) <= 1 ? v * 100 : v;
    return `${pct.toFixed(1)}%`;
  }
  return fmtMoney(v);
}

/* ------------------------------ driver trees ------------------------------ */

export interface VcTree {
  id: string;
  planId: string;
  name: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TreeNode {
  id: string;
  treeId: string;
  parentId: string | null;
  label: string;
  /** Backend row field: metric | driver | line. */
  nodeKind: string;
  kind?: string;
  lineKey: string | null;
  targetValue: number | null;
  unit?: string;
  notes?: string;
  sort?: number;
  createdAt?: string;
  updatedAt?: string;
}

export function treeNodeKind(n: TreeNode): string {
  return n.nodeKind ?? n.kind ?? "driver";
}

/** Node kinds from lib/valuecreation/trees.ts (DriverNodeKind). */
export const TREE_NODE_KINDS: Array<{ key: string; label: string }> = [
  { key: "metric", label: "Metric" },
  { key: "driver", label: "Driver" },
  { key: "line", label: "Line item" },
];

/* ------------------------------ scenarios ------------------------------ */

export interface ScenarioBridgeRow {
  initiativeId: string;
  title: string;
  impact: number;
  weightedImpact: number;
  confidence: number;
}

export interface ScenarioBridge {
  baseRevenue: number;
  baseEbitda: number;
  basePeriodEnd?: string | null;
  rows: ScenarioBridgeRow[];
  totalImpact: number;
  totalWeightedImpact: number;
  adjustedEbitda: number;
  adjustedWeightedEbitda: number;
  /** Revenue-growth scenario line computed by the backend. */
  revenueScenario?: {
    growthPct: number;
    revenueAtGrowth: number;
    ebitdaAtGrowth: number;
  };
  realizationSensitivity: Array<{ pct: number; ebitda: number }>;
  computedAt: string;
}

export interface ScenarioAssumptions {
  horizonMonths: number;
  /** Percent points (5 = +5%). */
  revenueGrowthPct: number;
  realizationPct: number;
}

export interface ScenarioTotals {
  totalImpact: number;
  totalWeightedImpact: number;
  adjustedEbitda: number;
  adjustedWeightedEbitda: number;
}

export interface Scenario {
  id: string;
  planId: string;
  name: string;
  isDefault?: boolean;
  baseRevenue?: number | null;
  baseEbitda?: number | null;
  basePeriodEnd?: string | null;
  assumptions: ScenarioAssumptions;
  /** List rows carry `totals` instead of the bridge; detail carries the bridge. */
  totals?: ScenarioTotals | null;
  bridge: ScenarioBridge | null;
  computedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
}

/* ------------------------------ exit readiness ------------------------------ */

/** Labels mirror the backend EXIT_AREAS keys. */
export const EXIT_AREAS: Array<{ key: string; label: string; hint: string }> = [
  {
    key: "financial_readiness",
    label: "Financial readiness",
    hint: "Audited / quality financials, clean close, forecast credibility",
  },
  {
    key: "management_depth",
    label: "Management depth",
    hint: "Second layer that can run the business without the owner",
  },
  {
    key: "customer_concentration",
    label: "Customer concentration",
    hint: "No single customer a buyer would price as a cliff risk",
  },
  {
    key: "systems",
    label: "Systems & reporting",
    hint: "Documented processes, systems, and data a buyer can diligence",
  },
  {
    key: "legal_compliance",
    label: "Legal / compliance cleanliness",
    hint: "Contracts, licenses, litigation and regulatory posture in order",
  },
];

export interface ExitAreaScore {
  score: number | null;
  notes: string;
}

/** GET/PATCH /plans/[id]/exit-readiness → { readiness }. */
export interface ExitReadiness {
  id?: string;
  planId?: string;
  /** Scores keyed by EXIT_AREAS area key. */
  scores: Record<string, ExitAreaScore>;
  areas?: Record<string, ExitAreaScore>;
  /** 0–100 */
  overall: number | null;
  notes?: string;
  updatedAt?: string;
  hints?: ExitHints;
}

/** Advisory hints (never written into the scores). */
export interface ExitHints {
  financial_readiness?: {
    postedPeriods: number;
    flags: string[];
    suggestion: string;
  };
  postedPeriods?: number;
  flags?: string[];
  [key: string]: unknown;
}

/* ------------------------------ process maps (BPMN) ------------------------------ */

export interface VcDiagramMeta {
  id: string;
  name: string;
  processKey?: string;
  /** Linked diligence as-is diagram, when this to-be map derives from one. */
  asIsDiagramId?: string | null;
  /** Backend label for the linked as-is map ("" when unlinked). */
  asIsLabel?: string;
  linkedAsIsId?: string | null;
  asIsName?: string | null;
  linkedAsIsName?: string | null;
  currentVersion: number;
  versionCount: number;
  updatedAt: string;
}

export function diagramAsIsLabel(d: VcDiagramMeta): string | null {
  return d.asIsLabel || d.asIsName || d.linkedAsIsName || null;
}

export interface VcDiagramDetail {
  id: string;
  name: string;
  processKey?: string;
  asIsDiagramId?: string | null;
  asIsLabel?: string;
  currentVersion: number;
  xml: string;
  saved: boolean;
}

export interface VcVersionMeta {
  version: number;
  savedBy: string;
  createdAt: string;
  xmlBytes: number;
}

export interface AsIsCandidate {
  /** Backend row field for the candidate's diagram id. */
  diagramId: string;
  id?: string;
  name: string;
  processKey?: string;
  workspaceId?: string;
  dealId?: string;
  dealName?: string;
  companyName?: string;
  currentVersion?: number;
}

export function asIsCandidateId(c: AsIsCandidate): string {
  return c.diagramId ?? c.id ?? "";
}

/* ------------------------------ companies picker ------------------------------ */

export interface CompanyOption {
  id: string;
  name: string;
  vertical?: string;
  city?: string;
  state?: string;
  stage?: string;
}

/* ------------------------------ tab props ------------------------------ */

/** Props every workspace tab receives from the shell. */
export interface VcTabProps {
  planId: string;
  plan: VcPlan;
  summary: PlanSummary | null;
  initiatives: Initiative[];
  reload: () => Promise<void>;
}

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

export function fmtMoneyN(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return fmtMoney(value);
}

export function fmtSignedMoneyN(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  const s = fmtMoney(Math.abs(value));
  return value < 0 ? `−${s}` : `+${s}`;
}

/** Confidence is stored 0–1; render as a whole percent. */
export function fmtConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return `${Math.round(value * 100)}%`;
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

/** YYYY-MM-DD (local) for date inputs / defaults. */
export function todayIso(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Whole days from `fromIso` to `toIso` (negative when before). */
export function dayOffset(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T12:00:00`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T12:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
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

export const API = "/api/platform/value-creation";
