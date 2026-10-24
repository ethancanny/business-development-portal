"use client";

import type { Deal, Executive, MiMultiple } from "@/lib/types";
import { fmtDate, fmtMoney, uniqueStrings } from "@/lib/format";
import {
  dealFocusSector,
  estimateMultiple,
  resolveDealValue,
  type MarketRates,
} from "@/lib/valuation";
import { agingColor, sectorColor } from "@/lib/sector-colors";
import CompanyLogo from "@/components/CompanyLogo";
import PersonAvatar from "@/components/PersonAvatar";
import SectorChip, { StageChip } from "@/components/SectorChip";
import { dealWebsite } from "@/components/DealTable";
import {
  TypeBadge,
  type BdBootstrap,
} from "@/components/InvestmentTypeBits";
import { StageMoveMenu } from "@/components/StageMove";
import type { Pairing } from "@/components/PairingTable";

/**
 * Pipeline card views (Premium redesign Wave 3): the third view next
 * to Table | Kanban on the Pipeline page. Presentation only — values
 * come from the same resolveDealValue / estimateMultiple calls the
 * table makes, days-in-stage is the table's updatedAt age semantics,
 * and a card click opens the same modal as a table row.
 */

function daysInStage(iso: string): number {
  const t = new Date(iso).getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function multLabel(d: Deal, multiples: MiMultiple[], rates: MarketRates): string | null {
  const est = estimateMultiple(d, multiples, rates);
  if (!est) return null;
  return est.headlineLow.toFixed(1) === est.headlineHigh.toFixed(1)
    ? `${est.headlineLow.toFixed(1)}×`
    : `${est.headlineLow.toFixed(1)}–${est.headlineHigh.toFixed(1)}×`;
}

const GRID_CLS = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

// ---------------- Deals ----------------

export function DealCardGrid({
  deals,
  multiples = [],
  rates = {},
  onSelect,
  allDeals = [],
  bd = null,
  onStageMoved,
}: {
  deals: Deal[];
  multiples?: MiMultiple[];
  rates?: MarketRates;
  onSelect: (d: Deal) => void;
  /** Investment Types (Step 1): full pipeline for add-on parent labels. */
  allDeals?: Deal[];
  /** bd bootstrap for per-type stage lists in the move menu. */
  bd?: BdBootstrap | null;
  /** Fired after a stage move through a card's Move-to-stage menu. */
  onStageMoved?: () => void;
}) {
  if (deals.length === 0) {
    return (
      <p className="card-surface px-3 py-8 text-center text-sm text-slate-400 dark:text-white/40">
        No deals match.
      </p>
    );
  }
  return (
    <div className={GRID_CLS}>
      {deals.map((d) => {
        const sector = dealFocusSector(d.industry) ?? d.industry;
        const rv = resolveDealValue(d, multiples, rates);
        const mult = multLabel(d, multiples, rates);
        const days = daysInStage(d.updatedAt);
        return (
          <div
            key={d.id}
            onClick={() => onSelect(d)}
            className="card-surface card-hover cursor-pointer overflow-hidden"
          >
            <div
              className="img-grade h-20"
              style={{
                background: `linear-gradient(120deg, ${sectorColor(sector || "")} 0%, #0d1f3c 80%)`,
              }}
            >
              <div className="relative z-10 flex h-full items-end p-3">
                <CompanyLogo name={d.companyName} website={dealWebsite(d)} sector={sector} size={34} />
              </div>
            </div>
            <div className="p-4">
              <h3 className="truncate text-xl font-semibold leading-snug text-[#0d1f3c] dark:text-white">
                {d.companyName}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {d.industry ? (
                  <>
                    <SectorChip sector={sector} />
                  </>
                ) : (
                  <span className="text-xs text-slate-400 dark:text-white/40">Industry —</span>
                )}
                <StageMoveMenu deal={d} bd={bd} onMoved={onStageMoved} />
                <TypeBadge type={d.investmentType} />
              </div>
              {d.investmentType === "add_on" && d.parentDealId && (
                <p className="mt-1.5 text-xs text-slate-500 dark:text-white/50">
                  Add-on to{" "}
                  <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">
                    {(allDeals.length ? allDeals : deals).find(
                      (x) => x.id === d.parentDealId
                    )?.companyName ?? "platform"}
                  </span>
                </p>
              )}
              <div className="mt-3 flex items-baseline justify-between gap-2">
                <span className="tnum text-lg font-semibold text-slate-800 dark:text-[#e8dfc8]">
                  {rv.value === null ? "—" : fmtMoney(rv.value)}
                  {rv.value !== null && rv.estimated && (
                    <span className="ml-1 text-[11px] font-normal text-slate-400 dark:text-white/40">
                      est.
                    </span>
                  )}
                </span>
                {mult && (
                  <span className="tnum text-xs text-slate-500 dark:text-white/50">
                    Est. multiple <span className="font-semibold text-slate-700 dark:text-[#e8dfc8]">{mult}</span>
                  </span>
                )}
              </div>
              <p className="tnum mt-2 text-xs" style={{ color: agingColor(days) }}>
                {days} {days === 1 ? "day" : "days"} in stage · updated {fmtDate(d.updatedAt)}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------- Executives ----------------

export function ExecCardGrid({
  execs,
  onSelect,
}: {
  execs: Executive[];
  onSelect: (e: Executive) => void;
}) {
  if (execs.length === 0) {
    return (
      <p className="card-surface px-3 py-8 text-center text-sm text-slate-400 dark:text-white/40">
        No candidates match.
      </p>
    );
  }
  return (
    <div className={GRID_CLS}>
      {execs.map((e) => (
        <div
          key={e.id}
          onClick={() => onSelect(e)}
          className="card-surface card-hover cursor-pointer p-4"
        >
          <div className="flex items-start gap-3">
            <PersonAvatar name={e.name} photoUrl={e.photoUrl} size={44} />
            <div className="min-w-0">
              <h3 className="truncate text-xl font-semibold leading-snug text-[#0d1f3c] dark:text-white">
                {e.name}
              </h3>
              {e.currentTitle && (
                <p className="truncate text-sm text-slate-500 dark:text-white/55">{e.currentTitle}</p>
              )}
              {e.targetRole && (
                <p className="truncate text-xs text-slate-500 dark:text-white/50">
                  <span className="text-slate-400 dark:text-white/40">Target:</span> {e.targetRole}
                </p>
              )}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <StageChip stage={e.stage} />
            {uniqueStrings(e.industries ?? []).slice(0, 3).map((ind) => (
              <SectorChip key={ind} sector={dealFocusSector(ind) ?? ind} />
            ))}
          </div>
          <div className="mt-3">
            {e.owner ? (
              <span className="inline-block rounded-full bg-[#0d1f3c] px-2.5 py-0.5 text-[11px] font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                Claimed by {e.owner}
              </span>
            ) : (
              <span className="inline-block rounded-full border border-dashed border-slate-300 px-2.5 py-0.5 text-[11px] font-medium text-slate-400 dark:border-white/25 dark:text-white/50">
                Unclaimed
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Pairings ----------------

export function PairingCardGrid({
  pairings,
  multiples = [],
  rates = {},
  onSelectDeal,
  bd = null,
  onStageMoved,
}: {
  pairings: Pairing[];
  multiples?: MiMultiple[];
  rates?: MarketRates;
  onSelectDeal: (d: Deal) => void;
  bd?: BdBootstrap | null;
  onStageMoved?: () => void;
}) {
  if (pairings.length === 0) {
    return (
      <p className="card-surface px-3 py-8 text-center text-sm text-slate-400 dark:text-white/40">
        No pairings match.
      </p>
    );
  }
  return (
    <div className={GRID_CLS}>
      {pairings.map(({ deal: d, operator: op, isMatch }) => {
        const sector = dealFocusSector(d.industry) ?? d.industry;
        const rv = resolveDealValue(d, multiples, rates);
        return (
          <div
            key={`${d.id}-${op.id}`}
            onClick={() => onSelectDeal(d)}
            className="card-surface card-hover cursor-pointer overflow-hidden"
          >
            <div
              className="img-grade h-16"
              style={{
                background: `linear-gradient(120deg, ${sectorColor(sector || "")} 0%, #0d1f3c 80%)`,
              }}
            >
              <div className="relative z-10 flex h-full items-end p-3">
                <CompanyLogo name={d.companyName} website={dealWebsite(d)} sector={sector} size={30} />
              </div>
            </div>
            <div className="p-4">
              <h3 className="truncate text-xl font-semibold leading-snug text-[#0d1f3c] dark:text-white">
                {d.companyName}
              </h3>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {d.industry && <SectorChip sector={sector} />}
                <StageMoveMenu deal={d} bd={bd} onMoved={onStageMoved} />
              </div>
              <p className="tnum mt-2.5 text-base font-semibold text-slate-800 dark:text-[#e8dfc8]">
                {rv.value === null ? "—" : fmtMoney(rv.value)}
                {rv.value !== null && rv.estimated && (
                  <span className="ml-1 text-[11px] font-normal text-slate-400 dark:text-white/40">
                    est.
                  </span>
                )}
              </p>
              <div className="mt-3 flex items-center gap-2.5 rounded-lg bg-violet-50 px-2.5 py-2 dark:bg-violet-500/10">
                <PersonAvatar name={op.name} photoUrl={op.photoUrl} size={30} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-violet-800 dark:text-violet-200">
                    ◈ {op.name}
                  </p>
                  {op.currentTitle && (
                    <p className="truncate text-[11px] text-violet-600 dark:text-violet-300/80">
                      {op.currentTitle}
                    </p>
                  )}
                  {isMatch && (
                    <span className="mt-0.5 inline-block rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                      ✓ industry match
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
