"use client";

import { useMemo, useState } from "react";
import type { Deal, Executive } from "@/lib/types";
import PersonAvatar from "@/components/PersonAvatar";
import SectorChip, { StageChip } from "@/components/SectorChip";
import { agingColor } from "@/lib/sector-colors";
import { dealFocusSector } from "@/lib/valuation";

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
    <div>
    <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#132847] md:block">
      <table className="tbl-grad w-full min-w-[900px] border-collapse text-sm">
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
                  <span className="flex items-center gap-2">
                    <PersonAvatar name={e.name} photoUrl={e.photoUrl} />
                    {e.name}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                  {e.currentTitle || "—"}
                </td>
                <td className="px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                  {e.targetRole || "—"}
                </td>
                <td className="px-3 py-2.5">
                  <StageChip stage={e.stage} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                  {e.owner || <span className="text-slate-400">Unclaimed</span>}
                </td>
                <td
                  className="whitespace-nowrap px-3 py-2.5"
                  style={{
                    color: agingColor(
                      Math.floor((Date.now() - new Date(e.updatedAt).getTime()) / 86400000),
                      60,
                      90
                    ),
                  }}
                  title="No-touch decay — amber at 60 days, red at 90"
                >
                  {fmtDateShort(e.updatedAt)}
                </td>
                <td className="px-3 py-2.5">
                  {e.industries && e.industries.length > 0 ? (
                    <span className="flex flex-wrap gap-1">
                      {e.industries.map((ind) => (
                        <SectorChip key={ind} sector={dealFocusSector(ind) ?? ind} />
                      ))}
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
    {/* Mobile: stacked cards (same sorted data; tap opens the profile). */}
    <div className="space-y-2.5 md:hidden">
      {sorted.map((e) => {
        const paired = pairedDeals(e.id);
        return (
          <div
            key={e.id}
            onClick={() => onSelect(e)}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition active:bg-slate-50 dark:border-white/10 dark:bg-[#132847] dark:active:bg-white/5"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <PersonAvatar name={e.name} photoUrl={e.photoUrl} size={32} />
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-slate-900 dark:text-white">
                    {e.name}
                  </span>
                  {(e.currentTitle || e.targetRole) && (
                    <span className="block truncate text-xs text-slate-500 dark:text-white/50">
                      {e.currentTitle}
                      {e.currentTitle && e.targetRole ? " → " : ""}
                      {e.targetRole}
                    </span>
                  )}
                </span>
              </span>
              <StageChip stage={e.stage} />
            </div>
            {e.industries && e.industries.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {e.industries.map((ind) => (
                  <SectorChip key={ind} sector={dealFocusSector(ind) ?? ind} />
                ))}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-white/50">
              <span>{e.owner || "Unclaimed"}</span>
              <span
                style={{
                  color: agingColor(
                    Math.floor((Date.now() - new Date(e.updatedAt).getTime()) / 86400000),
                    60,
                    90
                  ),
                }}
              >
                Updated {fmtDateShort(e.updatedAt)}
              </span>
            </div>
            {paired.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {paired.map((d) => (
                  <span
                    key={d.id}
                    className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
                  >
                    ◈ {d.companyName}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {sorted.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-400 dark:border-white/10 dark:bg-[#132847] dark:text-white/40">
          No candidates match.
        </p>
      )}
    </div>
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
