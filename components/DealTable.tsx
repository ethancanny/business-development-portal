"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Deal, Executive } from "@/lib/types";
import { fmtMoney } from "@/lib/format";

type SortKey = "companyName" | "industry" | "stage" | "dealValue" | "ebitda" | "owner" | "updatedAt";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "companyName", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "stage", label: "Stage" },
  { key: "dealValue", label: "Value" },
  { key: "ebitda", label: "EBITDA" },
  { key: "owner", label: "Owner" },
  { key: "updatedAt", label: "Updated" },
];

export default function DealTable({
  deals,
  execs,
  onSelect,
}: {
  deals: Deal[];
  execs: Executive[];
  onSelect: (d: Deal) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const sorted = useMemo(() => {
    const arr = [...deals];
    arr.sort((a, b) => {
      const va = a[sortKey];
      const vb = b[sortKey];
      let cmp: number;
      if (typeof va === "number" || typeof vb === "number") {
        cmp = (Number(va) || 0) - (Number(vb) || 0);
      } else {
        cmp = String(va ?? "").localeCompare(String(vb ?? ""));
      }
      return cmp * sortDir;
    });
    return arr;
  }, [deals, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "companyName" || key === "industry" ? 1 : -1);
    }
  };

  const opName = (id: string) => execs.find((e) => e.id === id)?.name ?? "—";

  const thCls =
    "cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white";

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#132847]">
      <table className="w-full min-w-[900px] border-collapse text-sm">
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
              Operators
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((d) => (
            <tr
              key={d.id}
              onClick={() => onSelect(d)}
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
                {d.city && (
                  <span className="block text-xs text-slate-400 dark:text-white/40">
                    {d.city}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                {d.industry || "—"}
              </td>
              <td className="px-3 py-2.5">
                <span className="rounded-full bg-[#0d1f3c] px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                  {d.stage}
                </span>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-700 dark:text-[#e8dfc8]">
                {fmtMoney(d.dealValue)}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                {d.ebitda != null ? fmtMoney(d.ebitda) : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                {d.owner || <span className="text-slate-400">Unclaimed</span>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-500 dark:text-white/40">
                {fmtDateShort(d.updatedAt)}
              </td>
              <td className="px-3 py-2.5">
                {d.operatorIds && d.operatorIds.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {d.operatorIds.map((oid) => (
                      <span
                        key={oid}
                        className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
                      >
                        ◈ {opName(oid)}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                    No operator
                  </span>
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
                No deals match.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function fmtDateShort(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
