"use client";

/**
 * Active deals row (Overview redesign §4, Oct 25, 2026).
 *
 * Cards for the active pipeline, highest resolved value first. Each
 * card carries ONLY real data: identity mark + accent from the deal
 * identity system, type badge, stage, resolved value, the key metric
 * that exists (EBITDA → Revenue → ARR → our check size), the next
 * open follow-up as the next step, and a diligence readiness bar
 * ONLY when the summary has checklist data for the deal (absent =
 * no bar, never an invented percentage). Mobile: horizontal
 * scroll-snap; desktop: the row wraps into the main column grid.
 */

import { useState } from "react";
import Link from "next/link";
import CompanyMark from "@/components/identity/CompanyMark";
import {
  OutOfFocusChip,
  ShowOutOfFocusToggle,
  useFocus,
} from "@/components/focus/FocusProvider";
import { fmtMoney, fmtMoneyCompact } from "@/lib/format";
import { INVESTMENT_TYPE_LABELS, type Deal, type Task } from "@/lib/types";
import { resolveDealValue, type MarketRates } from "@/lib/valuation";
import type { MiMultiple } from "@/lib/types";

const TERMINAL = ["Closed", "Passed", "Closed Won"];

export interface DealMetricsLite {
  [key: string]: { num?: number | null; text?: string | null } | undefined;
}

function keyMetric(
  deal: Deal,
  metrics: DealMetricsLite | undefined
): { label: string; value: string } | null {
  if (deal.ebitda != null) return { label: "EBITDA", value: fmtMoney(deal.ebitda) };
  if (deal.revenue != null) return { label: "Revenue", value: fmtMoney(deal.revenue) };
  const arr = metrics?.arr?.num;
  if (typeof arr === "number" && arr > 0) return { label: "ARR", value: fmtMoney(arr) };
  const check = metrics?.check_size?.num;
  if (typeof check === "number" && check > 0)
    return { label: "Our check", value: fmtMoney(check) };
  const round = metrics?.round_size?.num;
  if (typeof round === "number" && round > 0)
    return { label: "Round size", value: fmtMoney(round) };
  return null;
}

function dueChip(dueDate: string, todayStr: string): { label: string; cls: string } | null {
  if (!dueDate) return null;
  const label = new Date(`${dueDate}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  if (dueDate < todayStr)
    return { label: `Overdue · ${label}`, cls: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300" };
  if (dueDate === todayStr)
    return { label: `Due today`, cls: "bg-[#b8975a]/15 text-[#8a6f3c] dark:text-[#d4b37a]" };
  return { label: `Due ${label}`, cls: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/70" };
}

export default function ActiveDealsRow({
  deals,
  multiples,
  rates,
  tasks,
  metricsByDeal,
  readinessByDeal,
}: {
  deals: Deal[];
  multiples: MiMultiple[];
  rates: MarketRates;
  tasks: Task[];
  metricsByDeal: Record<string, DealMetricsLite>;
  readinessByDeal: Record<string, number>;
}) {
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  // Focus & Theme §2 (Oct 26, 2026): in Focus mode, deals whose
  // industry is set and not A&D are out of focus — hidden by default
  // behind this list's local "Show out-of-focus" toggle, flagged with
  // the chip when shown. In "all" mode isOutOfFocus is always false,
  // so the row renders exactly as before.
  const { isOutOfFocus } = useFocus();
  const [showOutOfFocus, setShowOutOfFocus] = useState(false);

  const activeAll = deals
    .filter((d) => !TERMINAL.includes(d.stage))
    .map((d) => ({ deal: d, value: resolveDealValue(d, multiples, rates) }))
    .sort((a, b) => (b.value.value ?? -1) - (a.value.value ?? -1));
  const hiddenCount = activeAll.filter(({ deal }) =>
    isOutOfFocus(deal.industry)
  ).length;
  const active = (
    showOutOfFocus
      ? activeAll
      : activeAll.filter(({ deal }) => !isOutOfFocus(deal.industry))
  ).slice(0, 10);

  const nextTaskFor = (dealId: string): Task | undefined =>
    tasks
      .filter((t) => !t.done && t.relatedKind === "deal" && t.relatedId === dealId)
      .sort((a, b) => (a.dueDate || "9999") .localeCompare(b.dueDate || "9999"))[0];

  return (
    <div className="card-surface p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
          Active deals
        </h3>
        <span className="flex items-baseline gap-3">
          <ShowOutOfFocusToggle
            show={showOutOfFocus}
            onChange={setShowOutOfFocus}
            hiddenCount={hiddenCount}
          />
          <Link
            href="/pipeline"
            className="text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
          >
            Open pipeline →
          </Link>
        </span>
      </div>
      {active.length === 0 ? (
        hiddenCount > 0 ? (
          <p className="text-sm text-caption">
            No in-focus active deals — {hiddenCount} out-of-focus{" "}
            {hiddenCount === 1 ? "deal is" : "deals are"} hidden. Turn on
            “Show out-of-focus” above to see {hiddenCount === 1 ? "it" : "them"}.
          </p>
        ) : (
          <p className="text-sm text-caption">
            No active deals yet.{" "}
            <Link href="/pipeline?new=deal" className="font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]">
              Add a deal →
            </Link>
          </p>
        )
      ) : (
        <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible">
          {active.map(({ deal, value }) => {
            const km = keyMetric(deal, metricsByDeal[deal.id]);
            const next = nextTaskFor(deal.id);
            const chip = next ? dueChip(next.dueDate, todayStr) : null;
            const readiness = readinessByDeal[deal.id];
            return (
              <Link
                key={deal.id}
                href={`/deals/${deal.id}`}
                className="group relative w-[240px] shrink-0 snap-start overflow-hidden rounded-xl border border-slate-200/80 bg-white p-3.5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[var(--shadow-lift)] dark:border-white/10 dark:bg-white/[0.03] sm:w-[260px] lg:w-[calc(50%-6px)] xl:w-[calc(33.333%-8px)]"
              >
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-1"
                  style={{ backgroundColor: deal.accentColor || "#b8975a" }}
                />
                <span className="flex items-center gap-2.5">
                  <CompanyMark
                    companyId={deal.companyId ?? ""}
                    name={deal.companyName}
                    logoVersion={deal.logoVersion ?? 0}
                    size={32}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[#0d1f3c] group-hover:underline dark:text-white">
                      {deal.companyName}
                    </span>
                    <span className="block truncate text-[11px] text-caption">
                      {deal.codename ? `${deal.codename} · ` : ""}
                      {deal.city ? `${deal.city}, AZ` : deal.industry || ""}
                    </span>
                  </span>
                </span>
                <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
                  <span className="badge badge-neutral">
                    {INVESTMENT_TYPE_LABELS[deal.investmentType ?? "platform_lbo"]}
                  </span>
                  <span className="badge badge-fit">{deal.stage}</span>
                  {isOutOfFocus(deal.industry) && <OutOfFocusChip />}
                </span>
                <span className="mt-2.5 flex items-baseline justify-between gap-2">
                  <span
                    className="tnum font-display text-[22px] font-semibold leading-none text-[#0d1f3c] dark:text-white"
                    title={value.value !== null ? fmtMoney(value.value) : undefined}
                  >
                    {value.value === null ? "—" : fmtMoneyCompact(value.value)}
                  </span>
                  {km && (
                    <span className="text-right text-[11px] text-caption">
                      {km.label}{" "}
                      <span className="tnum block text-xs font-semibold text-slate-700 dark:text-[#e8dfc8]">
                        {km.value}
                      </span>
                    </span>
                  )}
                </span>
                {value.estimated && value.value !== null && (
                  <span className="mt-0.5 block text-[10px] text-caption">Estimated value</span>
                )}
                <span className="mt-2.5 block border-t border-slate-100 pt-2 dark:border-white/10">
                  {next ? (
                    <>
                      <span className="block truncate text-xs text-slate-600 dark:text-white/70">
                        Next: {next.title}
                      </span>
                      {chip && (
                        <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${chip.cls}`}>
                          {chip.label}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="block text-xs text-caption">No next step scheduled</span>
                  )}
                </span>
                {typeof readiness === "number" && (
                  <span className="mt-2.5 block">
                    <span className="mb-1 flex items-baseline justify-between text-[10px] font-semibold uppercase tracking-wide text-caption">
                      <span>Diligence readiness</span>
                      <span className="tnum">{readiness}%</span>
                    </span>
                    <span className="block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <span
                        className="block h-full rounded-full bg-gradient-to-r from-[#0d1f3c] to-[#b8975a] dark:from-[#b8975a] dark:to-[#dec084]"
                        style={{ width: `${Math.max(2, Math.min(100, readiness))}%` }}
                      />
                    </span>
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
