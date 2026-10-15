"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Deal, Executive, MiMultiple } from "@/lib/types";
import { fmtMoney } from "@/lib/format";
import { dealFocusSector, resolveDealValue, type MarketRates } from "@/lib/valuation";
import CompanyLogo from "@/components/CompanyLogo";
import PersonAvatar from "@/components/PersonAvatar";
import SectorChip, { StageChip } from "@/components/SectorChip";
import { dealWebsite } from "@/components/DealTable";

export interface Pairing {
  deal: Deal;
  operator: Executive;
  isMatch: boolean;
}

type SortKey =
  | "dealName"
  | "stage"
  | "dealValue"
  | "industry"
  | "operatorName"
  | "owner";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "dealName", label: "Deal" },
  { key: "stage", label: "Deal stage" },
  { key: "dealValue", label: "Value" },
  { key: "industry", label: "Industry" },
  { key: "operatorName", label: "Operator" },
  { key: "owner", label: "Deal owner" },
];

function sortVal(p: Pairing, key: SortKey, multiples: MiMultiple[] = [], rates: MarketRates = {}): string | number {
  switch (key) {
    case "dealName":
      return p.deal.companyName;
    case "stage":
      return p.deal.stage;
    case "dealValue":
      return resolveDealValue(p.deal, multiples, rates).value ?? 0;
    case "industry":
      return p.deal.industry;
    case "operatorName":
      return p.operator.name;
    case "owner":
      return p.deal.owner;
  }
}

export default function PairingTable({
  pairings,
  onSelectDeal,
  multiples = [],
  rates = {},
}: {
  pairings: Pairing[];
  onSelectDeal: (d: Deal) => void;
  multiples?: MiMultiple[];
  rates?: MarketRates;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("dealName");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const sorted = useMemo(() => {
    const arr = [...pairings];
    arr.sort((a, b) => {
      const va = sortVal(a, sortKey, multiples, rates);
      const vb = sortVal(b, sortKey, multiples, rates);
      let cmp: number;
      if (typeof va === "number" || typeof vb === "number") {
        cmp = Number(va) - Number(vb);
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return cmp * sortDir;
    });
    return arr;
  }, [pairings, sortKey, sortDir, multiples, rates]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "dealValue" ? -1 : 1);
    }
  };

  const thCls =
    "cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white";

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#132847]">
      <table className="tbl-grad w-full min-w-[960px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-white/10">
            {COLUMNS.map((c) => (
              <th key={c.key} className={thCls} onClick={() => toggleSort(c.key)}>
                {c.label}
                {sortKey === c.key && (
                  <span className="ml-1 text-[#b8975a]">
                    {sortDir === 1 ? "▲" : "▼"}
                  </span>
                )}
              </th>
            ))}
            <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/50">
              Fit
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ deal: d, operator: op, isMatch }) => (
            <tr
              key={`${d.id}-${op.id}`}
              onClick={() => onSelectDeal(d)}
              className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50 last:border-0 dark:border-white/5 dark:hover:bg-white/5"
            >
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <CompanyLogo
                    name={d.companyName}
                    website={dealWebsite(d)}
                    sector={dealFocusSector(d.industry) ?? d.industry}
                  />
                  <Link
                    href={`/deals/${d.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="font-semibold text-slate-900 hover:underline dark:text-white"
                  >
                    {d.companyName}
                  </Link>
                </span>
              </td>
              <td className="px-3 py-2.5">
                <StageChip stage={d.stage} />
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-700 dark:text-[#e8dfc8]">
                {(() => {
                  const rv = resolveDealValue(d, multiples, rates);
                  return rv.value === null
                    ? "—"
                    : `${fmtMoney(rv.value)}${rv.estimated ? " est." : ""}`;
                })()}
              </td>
              <td className="px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                {d.industry ? (
                  <SectorChip sector={dealFocusSector(d.industry) ?? d.industry} />
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2.5">
                <span className="flex items-center gap-2">
                  <PersonAvatar name={op.name} />
                  <span>
                    <span className="font-semibold text-slate-900 dark:text-white">
                      {op.name}
                    </span>
                    {op.currentTitle && (
                      <span className="block text-xs text-slate-500 dark:text-white/50">
                        {op.currentTitle}
                      </span>
                    )}
                  </span>
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                {d.owner || <span className="text-slate-400">Unclaimed</span>}
              </td>
              <td className="px-3 py-2.5">
                {isMatch ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                    ✓ industry match
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={COLUMNS.length + 1}
                className="px-3 py-8 text-center text-sm text-slate-400 dark:text-white/40"
              >
                No pairings yet — pair operators from a deal.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
