/**
 * Phase 8 Portfolio Monitoring — shared client types + fetch helpers.
 *
 * Mirrors components/capital/types.ts conventions. The monitoring API
 * shapes are owned by the service workstreams; rows are typed loosely
 * (index signatures) and read through pick()/num() so a field-name
 * variant renders instead of crashing — but a missing figure always
 * renders "—", never an invented $0.
 */

import { fmtDate, fmtMoney, fmtMoneyCompact } from "@/lib/format";

export { fmtDate, fmtMoney, fmtMoneyCompact };

export const API = "/api/platform/monitoring";

export type Rec = Record<string, unknown>;

/** First present (non-null, non-empty) field among `keys`. */
export function pick(rec: Rec | null | undefined, ...keys: string[]): unknown {
  if (!rec) return undefined;
  for (const k of keys) {
    const v = rec[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

export function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

export function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[$,%\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function dateOnly(v: unknown): string {
  const s = str(v);
  return s ? s.slice(0, 10) : "";
}

/* ------------------------------ formatting ------------------------------ */

export function fmtMoneyN(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return fmtMoney(value);
}

export function fmtMoneyC(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return fmtMoneyCompact(value);
}

/** Percent-points margins (rollup weightedGrossMarginPct, KPI period
 * groups, VC targets): 30.5 → "30.5%". */
export function fmtPctPoints(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return `${value.toFixed(digits)}%`;
}

/** Fraction margins (stored kpi_values rows + the monitoring summary
 * + the company list, which pass the stored row through):
 * 0.305 → "30.5%". */
export function fmtFractionPct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

export function fmtMultiple(value: number | null | undefined): string {
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

/* ------------------------------ badges ------------------------------ */

export function statusBadge(status: string): string {
  switch (status.toLowerCase()) {
    case "current":
    case "received":
    case "on_track":
    case "pass":
    case "passed":
    case "compliant":
    case "active":
      return "badge-fit";
    case "due":
    case "pending":
    case "acknowledged":
    case "acked":
    case "watch":
      return "badge-warn";
    case "overdue":
    case "late":
    case "fail":
    case "failed":
    case "breach":
    case "breached":
    case "open":
      return "badge-danger";
    default:
      return "badge-neutral";
  }
}

export function severityBadge(severity: string): string {
  switch (severity.toLowerCase()) {
    case "critical":
    case "high":
      return "badge-danger";
    case "medium":
    case "warning":
      return "badge-warn";
    default:
      return "badge-neutral";
  }
}

/* ------------------------------ fetching ------------------------------ */

export class ApiError extends Error {
  status: number;
  body: Rec;
  constructor(status: number, body: Rec) {
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
  const data = (await res.json().catch(() => ({}))) as Rec;
  if (!res.ok) throw new ApiError(res.status, data);
  return data as T;
}

/** Pull a list of records out of a response under any of the keys. */
export function listFrom(data: unknown, ...keys: string[]): Rec[] {
  if (Array.isArray(data)) return data as Rec[];
  const rec = (data ?? {}) as Rec;
  for (const k of keys) {
    const v = rec[k];
    if (Array.isArray(v)) return v as Rec[];
  }
  return [];
}

/** Company base path for the per-company monitoring API. */
export function companyBase(companyId: string): string {
  return `${API}/companies/${encodeURIComponent(companyId)}`;
}

/** Props every company-workspace tab receives from the shell. */
export interface MonitoringTabProps {
  companyId: string;
  /** The company detail record from GET /companies/[companyId]. */
  company?: Rec | null;
  /** The monitoring summary embedded in (or alongside) the detail. */
  summary?: Rec | null;
  /** Re-pull the workspace header. */
  refreshHeader?: () => void;
}
