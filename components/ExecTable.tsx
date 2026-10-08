"use client";

import { useMemo, useState } from "react";
import type { Deal, Executive } from "@/lib/types";

type SortKey =
  | "name"
  | "currentTitle"
  | "targetRole"
  | "stage"
  | "owner"
  | "updatedAt";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "currentTitle", label: "Current title" },
  { key: "targetRole", label: "Target role" },
  { key: "stage", label: "Stage" },
  { key: "owner", label: "Owner" },
  { key: "updatedAt", label: "Updated" },
];

export default function ExecTable({
  execs,
  deals,
  onSelect,
}: {
  execs: Executive[];
  deals: Deal[];
  onSelect: (e: Executive) => void;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const sorted = useMemo(() => {
    const arr = [...execs];
    arr.sort((a, b) => {
      const va = a[sortKey] ?? "";
      const vb = b[sortKey] ?? "";
      const cmp = String(va).localeCompare(String(vb));
      return cmp * sortDir;
    });
    return arr;
  }, [execs, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "name" ? 1 : -1);
    }
  };

  const pairedDeals = (execId: string) =>
    deals.filter((d) => (d.operatorIds ?? []).includes(execId));

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
              Industries
            </th>
            <th className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/50">
              Paired with
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((e) => {
            const paired = pairedDeals(e.id);
            return (
              <tr
                key={e.id}
                onClick={() => onSelect(e)}
                className="cursor-pointer border-b border-slate-100 transition hover:bg-slate-50 last:border-0 dark:border-white/5 dark:hover:bg-white/5"
              >
                <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                  {e.name}
                </td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                  {e.currentTitle || "—"}
                </td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                  {e.targetRole || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <span className="rounded-full bg-[#0d1f3c] px-2 py-0.5 text-[11px] font-semibold text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]">
                    {e.stage}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                  {e.owner || <span className="text-slate-400">Unclaimed</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-500 dark:text-white/40">
                  {fmtDateShort(e.updatedAt)}
                </td>
                <td className="px-3 py-2.5">
                  {e.industries && e.industries.length > 0 ? (
                    <span className="text-xs text-slate-500 dark:text-white/50">
                      {e.industries.join(", ")}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  {paired.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {paired.map((d) => (
                        <span
                          key={d.id}
                          className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
                        >
                          ◈ {d.companyName}
                        </span>
                      ))}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-400">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td
                colSpan={COLUMNS.length + 2}
                className="px-3 py-8 text-center text-sm text-slate-400 dark:text-white/40"
              >
                No candidates match.
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
