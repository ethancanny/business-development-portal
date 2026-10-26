"use client";

/**
 * Investors & Capital home (Step 1 redesign, Oct 25, 2026) — shared
 * local types + small building blocks for the raise-centred page.
 *
 * The extended deal shape mirrors the LANE DATA contract for
 * GET /api/platform/capital/deals; components/capital/types.ts is
 * owned by another lane, so the new fields are declared here and the
 * base CapitalDeal / RaiseSummary are extended, never edited.
 * Optional identity / milestone fields are read defensively: when
 * the payload does not carry them the UI falls back to the monogram
 * mark and an honest "—" instead of fabricating values.
 */

import type { CapitalDeal, RaiseSummary } from "@/components/capital/types";
import { fmtMoneyCompact } from "@/components/capital/types";

export interface ExtRaiseSummary extends RaiseSummary {
  indicatedTotal?: number;
  /** Optional next-milestone fields (read when the payload carries them). */
  nextMilestoneLabel?: string | null;
  nextMilestoneDate?: string | null;
  nextMilestone?: { label?: string | null; date?: string | null } | null;
  entityName?: string | null;
  spvName?: string | null;
  ebitda?: number | null;
}

export interface InvestmentTypeRef {
  key: string;
  label: string;
  enabled: boolean;
}

export interface ExtCapitalDeal extends Omit<CapitalDeal, "summary"> {
  investmentType?: InvestmentTypeRef | null;
  isTestData?: boolean;
  parentDeal?: { id: string; name: string } | null;
  metrics?: Record<string, number | string | null>;
  leadInvestorName?: string | null;
  investorAvatars?: Array<{ personId: string; name: string }>;
  hasRaise?: boolean;
  raiseId?: string | null;
  /* Identity-system fields, when the payload carries them. */
  codename?: string | null;
  logoVersion?: number | null;
  accentColor?: string | null;
  nextMilestoneLabel?: string | null;
  nextMilestoneDate?: string | null;
  nextMilestone?: { label?: string | null; date?: string | null } | null;
  entityName?: string | null;
  summary: ExtRaiseSummary | null;
}

export interface CapitalSummaryData {
  target: number;
  indicated: number;
  soft: number;
  hard: number;
  funded: number;
  remaining: number;
  closingsNext30: Array<{
    dealId: string;
    dealName: string;
    label: string;
    date: string;
  }>;
  byType: Array<{
    typeKey: string;
    label: string;
    enabled: boolean;
    raiseCount: number;
    target: number;
    soft: number;
    hard: number;
    funded: number;
  }>;
  types: Array<{ key: string; label: string; enabled: boolean }>;
}

export function hasOpenRaise(deal: ExtCapitalDeal): boolean {
  if (typeof deal.hasRaise === "boolean") return deal.hasRaise;
  return deal.summary != null || !!deal.raiseId;
}

export function isPassed(deal: ExtCapitalDeal): boolean {
  return (deal.stage ?? "").trim().toLowerCase() === "passed";
}

/* ------------------------------ metrics ------------------------------ */

export function metricNum(
  metrics: Record<string, number | string | null> | undefined,
  ...keys: string[]
): number | null {
  if (!metrics) return null;
  for (const k of keys) {
    const v = metrics[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/[$,\s%]/g, ""));
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

export function metricStr(
  metrics: Record<string, number | string | null> | undefined,
  ...keys: string[]
): string | null {
  if (!metrics) return null;
  for (const k of keys) {
    const v = metrics[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

export function fmtMetricMoney(
  metrics: Record<string, number | string | null> | undefined,
  ...keys: string[]
): string | null {
  const n = metricNum(metrics, ...keys);
  if (n !== null) return fmtMoneyCompact(n);
  return metricStr(metrics, ...keys);
}

/** Percent metric: fractions (0.2) and whole percents (20) both render sanely. */
export function fmtMetricPct(
  metrics: Record<string, number | string | null> | undefined,
  ...keys: string[]
): string | null {
  const n = metricNum(metrics, ...keys);
  if (n === null) return metricStr(metrics, ...keys);
  const pct = Math.abs(n) <= 1 ? n * 100 : n;
  return `${Math.round(pct * 10) / 10}%`;
}

/* ------------------------------ milestone ------------------------------ */

export interface Milestone {
  label: string;
  date: string | null;
}

export function getMilestone(deal: ExtCapitalDeal): Milestone | null {
  const s = deal.summary;
  const label =
    deal.nextMilestone?.label ??
    deal.nextMilestoneLabel ??
    s?.nextMilestone?.label ??
    s?.nextMilestoneLabel ??
    null;
  const date =
    deal.nextMilestone?.date ??
    deal.nextMilestoneDate ??
    s?.nextMilestone?.date ??
    s?.nextMilestoneDate ??
    null;
  if (!label && !date) return null;
  return { label: label || "Milestone", date };
}

/* ------------------------------ dates ------------------------------ */

/** "in 3d" / "2d ago" / "today" for an ISO date; "" when unparseable. */
export function relDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const startOf = (x: Date) =>
    new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(d) - startOf(now)) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days}d`;
  if (days === -1) return "yesterday";
  return `${Math.abs(days)}d ago`;
}

/* ------------------------------ segmented bar ------------------------------ */

/**
 * Funded (navy) / hard (gold) / soft (light) as disjoint segments of
 * the target. Widths are each bucket's share of target, capped so the
 * bar never overflows when buckets sum past the target.
 */
export function SegmentedBar({
  target,
  soft,
  hard,
  funded,
  heightCls = "h-2.5",
}: {
  target: number;
  soft: number;
  hard: number;
  funded: number;
  heightCls?: string;
}) {
  if (!target || target <= 0) {
    return (
      <div
        className={`${heightCls} w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10`}
        aria-hidden
      />
    );
  }
  const pct = (v: number) => Math.max(0, (v / target) * 100);
  let fundedW = pct(funded);
  let hardW = pct(hard);
  let softW = pct(soft);
  const total = fundedW + hardW + softW;
  if (total > 100) {
    const scale = 100 / total;
    fundedW *= scale;
    hardW *= scale;
    softW *= scale;
  }
  return (
    <div
      className={`flex ${heightCls} w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10`}
      role="img"
      aria-label={`Funded ${fmtMoneyCompact(funded)}, hard-committed ${fmtMoneyCompact(hard)}, soft-circled ${fmtMoneyCompact(soft)} of ${fmtMoneyCompact(target)} target`}
    >
      {fundedW > 0 && (
        <div className="h-full bg-[#0d1f3c] dark:bg-[#3b5b84]" style={{ width: `${fundedW}%` }} />
      )}
      {hardW > 0 && <div className="h-full bg-[#b8975a]" style={{ width: `${hardW}%` }} />}
      {softW > 0 && (
        <div className="h-full bg-[#d9c08a] dark:bg-[#b8975a]/40" style={{ width: `${softW}%` }} />
      )}
    </div>
  );
}

export function SegmentLegend({
  soft,
  hard,
  funded,
}: {
  soft: number;
  hard: number;
  funded: number;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 dark:text-white/50">
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-[#0d1f3c] dark:bg-[#3b5b84]" /> Funded{" "}
        {fmtMoneyCompact(funded)}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-[#b8975a]" /> Hard {fmtMoneyCompact(hard)}
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2 w-2 rounded-full bg-[#d9c08a]" /> Soft {fmtMoneyCompact(soft)}
      </span>
    </div>
  );
}

export function scrollToId(id: string) {
  if (typeof document === "undefined") return;
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
