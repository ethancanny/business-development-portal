"use client";

/**
 * Raises section (Step 1 redesign) — Cards / Table / Timeline views
 * over the deals that carry an open raise, plus the collapsed
 * "Deals without a raise" group. Card identity follows the deal
 * identity system: CompanyMark (logo when the payload carries a
 * logoVersion, monogram otherwise) on an accent strip, real name
 * with the codename as a chip beside it — this is an internal
 * surface, so codename rules show both. Type-specific fields come
 * from the deal's whitelisted metrics (Part B §2); only fields with
 * values render.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CompanyMark from "@/components/identity/CompanyMark";
import PersonAvatar from "@/components/PersonAvatar";
import { TypeBadge } from "@/components/InvestmentTypeBits";
import { EmptyState } from "@/components/ui";
import {
  cardCls,
  fmtDateShort,
  fmtMoneyCompact,
  fmtMoneyN,
  tdCls,
  thCls,
} from "@/components/capital/types";
import { resolveDisplayIdentity } from "@/lib/identity/shared";
import {
  fmtMetricMoney,
  fmtMetricPct,
  getMilestone,
  metricNum,
  metricStr,
  relDate,
  SegmentedBar,
  SegmentLegend,
  type ExtCapitalDeal,
} from "./shared";

type ViewKey = "cards" | "table" | "timeline";
const VIEW_STORAGE_KEY = "ccp-capital-raise-view";

function typeKeyOf(deal: ExtCapitalDeal): string {
  return deal.investmentType?.key ?? "";
}

function workspaceHref(deal: ExtCapitalDeal): string {
  return `/investors-capital/${encodeURIComponent(deal.dealId)}`;
}

/* --------------------------- type-specific fields --------------------------- */

interface FieldRow {
  label: string;
  value: string;
}

function typeFields(deal: ExtCapitalDeal): FieldRow[] {
  const m = deal.metrics;
  const s = deal.summary;
  const key = typeKeyOf(deal);
  const rows: FieldRow[] = [];
  const push = (label: string, value: string | null | undefined) => {
    if (value != null && String(value).trim() !== "") rows.push({ label, value: String(value) });
  };

  if (key === "add_on") {
    push("Parent platform", deal.parentDeal?.name);
    push("Funding source", metricStr(m, "funding_source"));
    push("Amount", s ? fmtMoneyCompact(s.targetRaise) : null);
  } else if (key === "early_stage") {
    push("Round size", fmtMetricMoney(m, "round_size"));
    push("Instrument", metricStr(m, "instrument"));
    push(
      "Valuation",
      fmtMetricMoney(m, "pre_money") ?? fmtMetricMoney(m, "valuation_cap")
    );
    push("Our check", fmtMetricMoney(m, "check_size"));
    push("Lead investor", metricStr(m, "lead_investor") ?? deal.leadInvestorName);
  } else if (key === "minority_growth") {
    push("Check size", fmtMetricMoney(m, "mg_check_size"));
    push("Instrument", metricStr(m, "mg_instrument"));
    push("Pre-money", fmtMetricMoney(m, "mg_pre_money"));
    push("Ownership", fmtMetricPct(m, "mg_ownership_pct"));
  } else {
    // Platform LBO (and untyped deals): equity needed + entity.
    const equity = metricNum(m, "equity_check");
    push(
      "Equity needed",
      equity !== null ? fmtMoneyCompact(equity) : s ? fmtMoneyCompact(s.targetRaise) : null
    );
    push("Entity / SPV", s?.spvName ?? s?.entityName ?? deal.entityName ?? metricStr(m, "entity_name", "spv_name"));
  }
  return rows;
}

/** LBO mini capital stack: debt (leverage × EBITDA when both are in
 * the payload), seller note / rollover when present, equity = target. */
function CapitalStackMini({ deal }: { deal: ExtCapitalDeal }) {
  const m = deal.metrics;
  const s = deal.summary;
  if (!s || typeKeyOf(deal) === "add_on" || typeKeyOf(deal) === "early_stage" || typeKeyOf(deal) === "minority_growth")
    return null;
  const leverage = metricNum(m, "leverage_x");
  const ebitda = metricNum(m, "ebitda") ?? s.ebitda ?? null;
  const seller = metricNum(m, "seller_note", "seller_financing") ?? 0;
  const rollover = metricNum(m, "rollover", "rollover_equity") ?? 0;
  const debt = leverage !== null && ebitda !== null ? leverage * ebitda : null;
  const equity = metricNum(m, "equity_check") ?? s.targetRaise;
  if (debt === null && seller <= 0 && rollover <= 0) return null;
  const total = (debt ?? 0) + seller + rollover + equity;
  if (total <= 0) return null;
  const w = (v: number) => `${Math.max(0, (v / total) * 100)}%`;
  return (
    <div>
      <div
        className="flex h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
        role="img"
        aria-label="Capital stack"
      >
        {debt !== null && debt > 0 && <div className="h-full bg-[#3b5b84]" style={{ width: w(debt) }} />}
        {seller > 0 && <div className="h-full bg-[#d9c08a]" style={{ width: w(seller) }} />}
        {rollover > 0 && <div className="h-full bg-[#8a6f3c]" style={{ width: w(rollover) }} />}
        {equity > 0 && <div className="h-full bg-[#0d1f3c] dark:bg-white/40" style={{ width: w(equity) }} />}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-slate-500 dark:text-white/50">
        {debt !== null && debt > 0 && <span>Debt {fmtMoneyCompact(debt)}</span>}
        {seller > 0 && <span>Seller note {fmtMoneyCompact(seller)}</span>}
        {rollover > 0 && <span>Rollover {fmtMoneyCompact(rollover)}</span>}
        {equity > 0 && <span>Equity {fmtMoneyCompact(equity)}</span>}
      </div>
    </div>
  );
}

/* --------------------------------- card --------------------------------- */

function OverflowMenu({ deal }: { deal: ExtCapitalDeal }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open ]);
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="btn btn-ghost btn-sm min-h-[44px] min-w-[44px] px-2 text-lg leading-none"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-48 rounded-xl border border-slate-200 bg-white p-1 shadow-lg dark:border-white/10 dark:bg-[#101b30]"
        >
          <Link
            role="menuitem"
            href={workspaceHref(deal)}
            className="block rounded-lg px-2.5 py-2 text-sm text-[#0d1f3c] hover:bg-slate-50 dark:text-white dark:hover:bg-white/5"
          >
            Edit raise
          </Link>
          <Link
            role="menuitem"
            href={`/deals/${encodeURIComponent(deal.dealId)}`}
            className="block rounded-lg px-2.5 py-2 text-sm text-[#0d1f3c] hover:bg-slate-50 dark:text-white dark:hover:bg-white/5"
          >
            View deal
          </Link>
          <Link
            role="menuitem"
            href={`/companies/${encodeURIComponent(deal.companyId)}`}
            className="block rounded-lg px-2.5 py-2 text-sm text-[#0d1f3c] hover:bg-slate-50 dark:text-white dark:hover:bg-white/5"
          >
            View company
          </Link>
        </div>
      )}
    </div>
  );
}

function RaiseCard({ deal }: { deal: ExtCapitalDeal }) {
  const s = deal.summary;
  const display = resolveDisplayIdentity(
    { name: deal.dealName || deal.companyName || "Deal", codename: deal.codename },
    "internal"
  );
  const target = s?.targetRaise ?? 0;
  const covered = s ? s.softTotal + s.hardTotal + s.fundedTotal : 0;
  const pct = target > 0 ? Math.round((covered / target) * 100) : null;
  const milestone = getMilestone(deal);
  const fields = typeFields(deal);
  const avatars = deal.investorAvatars ?? [];
  const investorCount = s?.investorCount ?? avatars.length;
  const accent = deal.accentColor || "#b8975a";

  return (
    <div className={`${cardCls} relative overflow-hidden`}>
      <div className="absolute inset-x-0 top-0 h-1" style={{ backgroundColor: accent }} aria-hidden />
      <div className="flex items-start gap-3">
        <CompanyMark
          companyId={deal.companyId}
          name={display.displayName}
          logoVersion={deal.logoVersion ?? 0}
          size={40}
          rounded="rounded-lg"
        />
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
            <Link href={workspaceHref(deal)} className="hover:text-gold-700 hover:underline dark:hover:text-gold-400">
              {display.displayName}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {display.secondaryName && (
              <span className="rounded bg-gold-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-800 dark:bg-gold-500/15 dark:text-gold-300">
                {display.secondaryName}
              </span>
            )}
            {deal.investmentType ? (
              <TypeBadge type={deal.investmentType.key} />
            ) : null}
            {deal.stage && <span className="badge badge-neutral">{deal.stage}</span>}
            {deal.isTestData && <span className="badge badge-warn">Test data</span>}
          </div>
        </div>
        <OverflowMenu deal={deal} />
      </div>

      {s ? (
        <div className="mt-4 space-y-3">
          <SegmentedBar target={target} soft={s.softTotal} hard={s.hardTotal} funded={s.fundedTotal} />
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <SegmentLegend soft={s.softTotal} hard={s.hardTotal} funded={s.fundedTotal} />
            <p className="text-xs font-medium text-[#0d1f3c] dark:text-white/80">
              {pct !== null ? `${pct}% of ${fmtMoneyCompact(target)}` : fmtMoneyN(target)}
            </p>
          </div>
          <CapitalStackMini deal={deal} />
        </div>
      ) : (
        <p className="mt-4 text-sm text-slate-500 dark:text-white/50">Raise open — no summary yet.</p>
      )}

      {fields.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-slate-100 pt-3 dark:border-white/5">
          {fields.map((f) => (
            <div key={f.label}>
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                {f.label}
              </dt>
              <dd className="truncate text-sm font-medium text-[#0d1f3c] dark:text-white/90" title={f.value}>
                {f.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-4 space-y-1.5 text-sm text-slate-500 dark:text-white/50">
        <div className="flex items-center gap-2">
          <span className="flex -space-x-1.5">
            {avatars.slice(0, 5).map((a) => (
              <PersonAvatar key={a.personId} name={a.name} size={22} />
            ))}
          </span>
          <span>
            {investorCount} investor{investorCount === 1 ? "" : "s"}
            {deal.leadInvestorName ? ` · Lead: ${deal.leadInvestorName}` : ""}
          </span>
        </div>
        <p>
          Next milestone:{" "}
          {milestone ? (
            <span className="font-medium text-[#0d1f3c] dark:text-white/80">
              {milestone.label}
              {milestone.date ? ` · ${fmtDateShort(milestone.date)} (${relDate(milestone.date)})` : ""}
            </span>
          ) : (
            "—"
          )}
        </p>
      </div>

      <div className="mt-4">
        <Link href={workspaceHref(deal)} className="btn btn-primary btn-sm min-h-[44px]">
          Open raise
        </Link>
      </div>
    </div>
  );
}

/* --------------------------------- views --------------------------------- */

function RaiseTable({ deals }: { deals: ExtCapitalDeal[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#132847]/60">
      <table className="w-full min-w-[820px] border-collapse">
        <thead>
          <tr className="border-b border-slate-100 dark:border-white/5">
            <th className={thCls}>Raise</th>
            <th className={thCls}>Type</th>
            <th className={thCls}>Stage</th>
            <th className={thCls}>Target</th>
            <th className={thCls}>Soft</th>
            <th className={thCls}>Hard</th>
            <th className={thCls}>Funded</th>
            <th className={thCls}>%</th>
            <th className={thCls}>Investors</th>
            <th className={thCls}>Lead</th>
            <th className={thCls}>Next milestone</th>
            <th className={thCls} aria-label="Open" />
          </tr>
        </thead>
        <tbody>
          {deals.map((deal) => {
            const s = deal.summary;
            const target = s?.targetRaise ?? 0;
            const covered = s ? s.softTotal + s.hardTotal + s.fundedTotal : 0;
            const milestone = getMilestone(deal);
            return (
              <tr key={deal.dealId} className="border-b border-slate-50 hover:bg-slate-50/60 dark:border-white/5 dark:hover:bg-white/5">
                <td className={tdCls}>
                  <span className="flex items-center gap-2">
                    <CompanyMark companyId={deal.companyId} name={deal.dealName || deal.companyName} logoVersion={deal.logoVersion ?? 0} size={24} />
                    <Link href={workspaceHref(deal)} className="font-medium hover:underline">
                      {deal.dealName || deal.companyName || "Deal"}
                    </Link>
                    {deal.codename && (
                      <span className="rounded bg-gold-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-800 dark:bg-gold-500/15 dark:text-gold-300">
                        {deal.codename}
                      </span>
                    )}
                  </span>
                </td>
                <td className={tdCls}>{deal.investmentType ? <TypeBadge type={deal.investmentType.key} /> : "—"}</td>
                <td className={tdCls}>{deal.stage || "—"}</td>
                <td className={tdCls}>{s ? fmtMoneyCompact(target) : "—"}</td>
                <td className={tdCls}>{s ? fmtMoneyCompact(s.softTotal) : "—"}</td>
                <td className={tdCls}>{s ? fmtMoneyCompact(s.hardTotal) : "—"}</td>
                <td className={tdCls}>{s ? fmtMoneyCompact(s.fundedTotal) : "—"}</td>
                <td className={tdCls}>{s && target > 0 ? `${Math.round((covered / target) * 100)}%` : "—"}</td>
                <td className={tdCls}>{s ? s.investorCount : deal.investorAvatars?.length ?? "—"}</td>
                <td className={tdCls}>{deal.leadInvestorName ?? "—"}</td>
                <td className={tdCls}>
                  {milestone ? `${milestone.label}${milestone.date ? ` · ${fmtDateShort(milestone.date)}` : ""}` : "—"}
                </td>
                <td className={tdCls}>
                  <Link href={workspaceHref(deal)} className="btn btn-primary btn-sm min-h-[44px]">
                    Open raise
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RaiseTimeline({ deals }: { deals: ExtCapitalDeal[] }) {
  const sorted = [...deals].sort((a, b) => {
    const da = getMilestone(a)?.date;
    const db = getMilestone(b)?.date;
    if (da && db) return da.localeCompare(db);
    if (da) return -1;
    if (db) return 1;
    return (a.dealName || "").localeCompare(b.dealName || "");
  });
  return (
    <ol className="space-y-3">
      {sorted.map((deal) => {
        const milestone = getMilestone(deal);
        const s = deal.summary;
        return (
          <li key={deal.dealId} className={`${cardCls} flex flex-wrap items-center gap-3`}>
            <div className="w-24 shrink-0 text-center">
              {milestone?.date ? (
                <>
                  <p className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                    {fmtDateShort(milestone.date)}
                  </p>
                  <p className="text-[11px] text-slate-400 dark:text-white/40">{relDate(milestone.date)}</p>
                </>
              ) : (
                <p className="font-display text-lg font-semibold text-slate-300 dark:text-white/30">—</p>
              )}
            </div>
            <CompanyMark companyId={deal.companyId} name={deal.dealName || deal.companyName} logoVersion={deal.logoVersion ?? 0} size={32} rounded="rounded-lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-[#0d1f3c] dark:text-white">
                {deal.dealName || deal.companyName || "Deal"}
                {deal.investmentType && <span className="ml-2 align-middle"><TypeBadge type={deal.investmentType.key} /></span>}
              </p>
              <p className="truncate text-sm text-slate-500 dark:text-white/50">
                {milestone ? milestone.label : "No milestone dated"}
                {s ? ` · ${fmtMoneyCompact(s.fundedTotal + s.hardTotal + s.softTotal)} of ${fmtMoneyCompact(s.targetRaise)}` : ""}
              </p>
            </div>
            <Link href={workspaceHref(deal)} className="btn btn-primary btn-sm min-h-[44px]">
              Open raise
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/* --------------------------------- section --------------------------------- */

export default function RaiseViews({
  raises,
  dealsWithoutRaise,
  showTestData,
  onShowTestDataChange,
  onStartRaise,
  startingDealId,
}: {
  raises: ExtCapitalDeal[];
  dealsWithoutRaise: ExtCapitalDeal[];
  showTestData: boolean;
  onShowTestDataChange: (v: boolean) => void;
  onStartRaise: (deal: ExtCapitalDeal) => void;
  startingDealId: string | null;
}) {
  const [view, setView] = useState<ViewKey>("table");
  const [noRaiseOpen, setNoRaiseOpen] = useState(false);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(VIEW_STORAGE_KEY);
      if (saved === "cards" || saved === "table" || saved === "timeline") setView(saved);
    } catch {
      /* storage unavailable — default stands */
    }
  }, []);

  const pick = (v: ViewKey) => {
    setView(v);
    try {
      window.sessionStorage.setItem(VIEW_STORAGE_KEY, v);
    } catch {
      /* storage unavailable — view still switches */
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5" role="tablist" aria-label="Raise views">
          {(["cards", "table", "timeline"] as ViewKey[]).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => pick(v)}
              className={`chip min-h-[44px] capitalize ${view === v ? "chip-active" : ""}`}
            >
              {v}
            </button>
          ))}
        </div>
        <label className="ml-auto inline-flex min-h-[44px] cursor-pointer items-center gap-2 text-sm text-slate-500 dark:text-white/60">
          <input
            type="checkbox"
            checked={showTestData}
            onChange={(e) => onShowTestDataChange(e.target.checked)}
            className="h-4 w-4 accent-[#0d1f3c] dark:accent-[#b8975a]"
          />
          Show test data
        </label>
      </div>

      <div className="mt-4">
        {raises.length === 0 ? (
          <EmptyState
            title="No open raises"
            message="Deals with an open raise appear here. Start one from “Deals without a raise” below or with “+ New raise”."
          />
        ) : view === "cards" ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {raises.map((deal) => (
              <RaiseCard key={deal.dealId} deal={deal} />
            ))}
          </div>
        ) : view === "table" ? (
          <RaiseTable deals={raises} />
        ) : (
          <RaiseTimeline deals={raises} />
        )}
      </div>

      {dealsWithoutRaise.length > 0 && (
        <div className="mt-6 rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#132847]/60">
          <button
            type="button"
            aria-expanded={noRaiseOpen}
            onClick={() => setNoRaiseOpen((v) => !v)}
            className="flex min-h-[44px] w-full items-center justify-between px-5 py-3 text-left"
          >
            <span className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Deals without a raise ({dealsWithoutRaise.length})
            </span>
            <span aria-hidden className="text-slate-400 dark:text-white/40">{noRaiseOpen ? "▾" : "▸"}</span>
          </button>
          {noRaiseOpen && (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 dark:divide-white/5 dark:border-white/5">
              {dealsWithoutRaise.map((deal) => (
                <li key={deal.dealId} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <CompanyMark companyId={deal.companyId} name={deal.dealName || deal.companyName} logoVersion={deal.logoVersion ?? 0} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-[#0d1f3c] dark:text-white">
                      {deal.dealName || deal.companyName || "Deal"}
                    </span>
                    <span className="block text-xs text-slate-400 dark:text-white/40">
                      {deal.stage || "—"}
                      {deal.investmentType ? ` · ${deal.investmentType.label}` : ""}
                    </span>
                  </span>
                  <button
                    type="button"
                    disabled={startingDealId === deal.dealId}
                    onClick={() => onStartRaise(deal)}
                    className="btn btn-secondary btn-sm min-h-[44px]"
                  >
                    {startingDealId === deal.dealId ? "Starting…" : "Start raise"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
