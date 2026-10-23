/**
 * In-house e-signature — shared client types + fetch helpers for the
 * portal-side signing components (Send dialog, status chip, detail
 * dialog, Settings card). Types mirror the pinned signing API
 * shapes; they are re-declared here so client components never
 * import server modules (fetch only). Field reads tolerate the
 * camelCase / snake_case spellings the API may use.
 */

export type Rec = Record<string, unknown>;

export function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
export function pick(r: Rec | null | undefined, ...keys: string[]): unknown {
  if (!r) return undefined;
  for (const k of keys) {
    if (r[k] !== undefined && r[k] !== null) return r[k];
  }
  return undefined;
}
export function listFrom<T>(
  data: Record<string, unknown> | unknown,
  ...keys: string[]
): T[] {
  if (Array.isArray(data)) return data as T[];
  const r = (data ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = r[k];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

export const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white dark:placeholder:text-white/30";
export const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

export interface EnvelopeListItem {
  id: string;
  documentId: string | null;
  reportId: string | null;
  status: string;
  signers: Array<{ name: string; email: string; status: string }>;
  createdAt: string;
  completedAt: string | null;
}

export function envelopeStatusLabel(status: string): string {
  const s = (status || "").replace(/_/g, " ");
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "Unknown";
}

export function envelopeBadgeClass(status: string): string {
  switch ((status || "").toLowerCase()) {
    case "completed":
    case "complete":
    case "executed":
      return "badge-fit";
    case "declined":
    case "voided":
    case "expired":
      return "badge-danger";
    case "draft":
      return "badge-neutral";
    default:
      return "badge-warn";
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
