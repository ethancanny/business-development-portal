"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Deal, Executive } from "@/lib/types";
import { fmtMoney } from "@/lib/format";

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

function sortVal(p: Pairing, key: SortKey): string | number {
  switch (key) {
    case "dealName":
      return p.deal.companyName;
    case "stage":
      return p.deal.stage;
    case "dealValue":
      return p.deal.dealValue || 0;
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
}: {
  pairings: Pairing[];
  onSelectDeal: (d: Deal) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("dealName");
  const [sortDir, setSortDir] = useState<1 | -1>(1);

  const sorted = useMemo(() => {
    const arr = [...pairings];
    arr.sort((a, b) => {
      const va = sortVal(a, sortKey);
      const vb = sortVal(b, sortKey);
      let cmp: number;
      if (typeof va === "number" || typeof vb === "number") {
        cmp = Number(va) - Number(vb);
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      return cmp * sortDir;
    });
    return arr;
  }, [pairings, sortKey, sortDir]);

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
      <table className="w-full min-w-[960px] border-collapse text-sm">
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
                <Link
                  href={`/deals/${d.id}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-slate-900 hover:underline dark:text-white"
                >
                  {d.companyName}
                </Link>
              </td>
              <td className="px-3 py-2.5">
                <span className="rounded-full bg-[#0d1f3c] px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                  {d.stage}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-700 dark:text-[#e8dfc8]">
                {fmtMoney(d.dealValue)}
              </td>
              <td className="px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                {d.industry || "—"}
              </td>
              <td className="px-3 py-2.5">
                <span className="font-semibold text-slate-900 dark:text-white">
                  {op.name}
                </span>
                {op.currentTitle && (
                  <span className="block text-xs text-slate-500 dark:text-white/50">
                    {op.currentTitle}
                  </span>
                )}
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
