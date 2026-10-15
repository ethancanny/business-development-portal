"use client";

import type { Deal, MiMultiple } from "@/lib/types";
import { fmtMoney } from "@/lib/format";
import { dealFocusSector, resolveDealValue, type MarketRates } from "@/lib/valuation";
import { sectorColor } from "@/lib/sector-colors";
import CompanyLogo from "@/components/CompanyLogo";
import { StageChip } from "@/components/SectorChip";
import { dealWebsite } from "@/components/DealTable";

/**
 * Record header band (Premium redesign Wave 3): the graded sector
 * visual strip that tops a deal's detail views (dossier page and the
 * deal modal's read view). A sector-color → navy sweep under the one
 * standard .img-grade navy grade, CompanyLogo, the company name in
 * the serif display face, and a key-facts row: stage, resolved value,
 * industry, location. Presentation only — the value is the same
 * resolveDealValue figure every other surface shows.
 */
export default function DealRecordHeader({
  deal,
  multiples = [],
  rates = {},
}: {
  deal: Deal;
  multiples?: MiMultiple[];
  rates?: MarketRates;
}) {
  const sector = dealFocusSector(deal.industry) ?? deal.industry;
  const color = sectorColor(sector || "");
  const rv = resolveDealValue(deal, multiples, rates);
  return (
    <div
      className="img-grade overflow-hidden rounded-2xl"
      style={{
        background: `linear-gradient(120deg, ${color} 0%, #0d1f3c 78%)`,
      }}
    >
      <div
        className="relative z-10 flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4"
        style={{ minHeight: 96 }}
      >
        <CompanyLogo
          name={deal.companyName}
          website={dealWebsite(deal)}
          sector={sector}
          size={44}
        />
        <div className="min-w-0">
          <h3 className="font-display truncate text-[26px] font-semibold leading-tight text-white">
            {deal.companyName}
          </h3>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-white/85">
            <StageChip stage={deal.stage} />
            <span className="tnum text-sm font-semibold text-white">
              {rv.value === null
                ? "—"
                : `${fmtMoney(rv.value)}${rv.estimated ? " est." : ""}`}
            </span>
            {deal.industry && <span>{deal.industry}</span>}
            {deal.city && <span>{deal.city}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
