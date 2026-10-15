"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Deal, Executive, MiMultiple } from "@/lib/types";
import { fmtMoney, uniqueStrings } from "@/lib/format";
import { dealFocusSector, estimateMultiple, isFocusDeal, resolveDealValue, type MarketRates } from "@/lib/valuation";
import CompanyLogo from "@/components/CompanyLogo";
import SectorChip, { SectorLegend, StageChip } from "@/components/SectorChip";
import { agingColor } from "@/lib/sector-colors";

/** A deal's website, when one of its links is plainly the company site. */
export function dealWebsite(d: Deal): string | undefined {
  const links = d.links ?? [];
  const named = links.find((l) => /website|web site|site|homepage/i.test(l.label || ""));
  if (named?.url) return named.url;
  if (links.length === 1 && /^https?:\/\//i.test(links[0].url)) return links[0].url;
  return undefined;
}

type SortKey = "companyName" | "industry" | "stage" | "dealValue" | "ebitda" | "estMultiple" | "owner" | "updatedAt";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "companyName", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "stage", label: "Stage" },
  { key: "dealValue", label: "Value" },
  { key: "ebitda", label: "EBITDA" },
  { key: "estMultiple", label: "Est. multiple" },
  { key: "owner", label: "Owner" },
  { key: "updatedAt", label: "Updated" },
];

export default function DealTable({
  deals,
  execs,
  onSelect,
  multiples = [],
  rates = {},
}: {
  deals: Deal[];
  execs: Executive[];
  onSelect: (d: Deal) => void;
  multiples?: MiMultiple[];
  rates?: MarketRates;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("updatedAt");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);

  const estOf = (d: Deal) => estimateMultiple(d, multiples, rates);

  const sorted = useMemo(() => {
    const arr = [...deals];
    arr.sort((a, b) => {
      if (sortKey === "estMultiple") {
        const ea = estOf(a);
        const eb = estOf(b);
        const ma = ea ? (ea.headlineLow + ea.headlineHigh) / 2 : -1;
        const mb = eb ? (eb.headlineLow + eb.headlineHigh) / 2 : -1;
        return (ma - mb) * sortDir;
      }
      if (sortKey === "dealValue") {
        // Sort by the resolved Value (stated price, else estimate).
        const va = resolveDealValue(a, multiples, rates).value ?? -1;
        const vb = resolveDealValue(b, multiples, rates).value ?? -1;
        return (va - vb) * sortDir;
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, sortKey, sortDir, multiples, rates]);

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir((d) => (d === 1 ? -1 : 1));
    else {
      setSortKey(key);
      setSortDir(key === "companyName" || key === "industry" ? 1 : -1);
    }
  };

  const opName = (id: string) => execs.find((e) => e.id === id)?.name ?? "—";

  const legendSectors = useMemo(() => {
    const seen: string[] = [];
    for (const d of deals) {
      const s = dealFocusSector(d.industry);
      if (s && !seen.includes(s)) seen.push(s);
    }
    return seen;
  }, [deals]);

  const thCls =
    "cursor-pointer select-none whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 hover:text-slate-800 dark:text-white/50 dark:hover:text-white";

  return (
    <div>
      {legendSectors.length > 1 && (
        <div className="mb-2 px-1">
          <SectorLegend sectors={legendSectors} />
        </div>
      )}
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
                <span className="flex items-center gap-2">
                  <CompanyLogo
                    name={d.companyName}
                    website={dealWebsite(d)}
                    sector={dealFocusSector(d.industry) ?? d.industry}
                  />
                  <span>
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
                  </span>
                </span>
              </td>
              <td className="px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                {d.industry ? (
                  <span className="inline-flex items-center gap-1.5">
                    <SectorChip sector={dealFocusSector(d.industry) ?? d.industry} />
                    {!isFocusDeal(d.industry) && (
                      <span className="inline-block rounded-full bg-slate-100 px-1.5 py-px align-middle text-[10px] font-semibold text-slate-500 dark:bg-white/10 dark:text-white/50">
                        Non-focus
                      </span>
                    )}
                  </span>
                ) : (
                  "—"
                )}
              </td>
              <td className="px-3 py-2.5">
                <StageChip stage={d.stage} />
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 font-medium text-slate-700 dark:text-[#e8dfc8]">
                {(() => {
                  const rv = resolveDealValue(d, multiples, rates);
                  if (rv.value === null) return "—";
                  return (
                    <>
                      {fmtMoney(rv.value)}
                      {rv.estimated && (
                        <span className="ml-1 text-[11px] font-normal text-slate-400 dark:text-white/40">
                          est.
                        </span>
                      )}
                    </>
                  );
                })()}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                {d.ebitda != null ? fmtMoney(d.ebitda) : "—"}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5">
                {(() => {
                  const est = estOf(d);
                  if (!est) return <span className="text-slate-400">—</span>;
                  return (
                    <span title={`${est.baseBasis}. Effective ${est.effLow.toFixed(1)}–${est.effHigh.toFixed(1)}× after discounting the headline (${est.headlineSource}) for expected payout + time value. Market multiple ${est.marketMid.toFixed(1)}× after drivers/growth; market effective estimate ${est.estimateEffMid.toFixed(1)}× at the usual structure. Actual effective ${est.effMid.toFixed(1)}× — ${est.gapEffectiveX >= 0 ? "+" : "−"}${Math.abs(est.gapEffectiveX).toFixed(2)}× vs the market estimate.`}>
                      <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">
                        {est.headlineLow.toFixed(1) === est.headlineHigh.toFixed(1)
                          ? `${est.headlineLow.toFixed(1)}×`
                          : `${est.headlineLow.toFixed(1)}–${est.headlineHigh.toFixed(1)}×`}
                      </span>
                      <span className="block text-[11px] text-slate-400 dark:text-white/40">
                        headline · eff. {est.effLow.toFixed(1) === est.effHigh.toFixed(1)
                          ? `${est.effLow.toFixed(1)}×`
                          : `${est.effLow.toFixed(1)}–${est.effHigh.toFixed(1)}×`}{est.structureAssumed ? " · typ. structure" : ""} · {est.gapEffectiveX >= 0 ? "+" : "−"}{Math.abs(est.gapEffectiveX).toFixed(1)} vs mkt est
                      </span>
                    </span>
                  );
                })()}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-slate-600 dark:text-[#c8bfa8]">
                {d.owner || <span className="text-slate-400">Unclaimed</span>}
              </td>
              <td
                className="whitespace-nowrap px-3 py-2.5"
                style={{
                  color: agingColor(
                    Math.floor((Date.now() - new Date(d.updatedAt).getTime()) / 86400000)
                  ),
                }}
                title="Deal staleness — amber at 30 days untouched, red at 90"
              >
                {fmtDateShort(d.updatedAt)}
              </td>
              <td className="px-3 py-2.5">
                {d.operatorIds && d.operatorIds.length > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {uniqueStrings(d.operatorIds).map((oid) => (
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
    {/* Mobile: stacked cards (same sorted data; tap opens the deal). */}
    <div className="space-y-2.5 md:hidden">
      {sorted.map((d) => {
        const rv = resolveDealValue(d, multiples, rates);
        const est = estOf(d);
        return (
          <div
            key={d.id}
            onClick={() => onSelect(d)}
            className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition active:bg-slate-50 dark:border-white/10 dark:bg-[#132847] dark:active:bg-white/5"
          >
            <div className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2">
                <CompanyLogo
                  name={d.companyName}
                  website={dealWebsite(d)}
                  sector={dealFocusSector(d.industry) ?? d.industry}
                />
                <span className="min-w-0">
                  <Link
                    href={`/deals/${d.id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="block truncate font-semibold text-slate-900 hover:underline dark:text-white"
                  >
                    {d.companyName}
                  </Link>
                  {d.city && (
                    <span className="block text-xs text-slate-400 dark:text-white/40">
                      {d.city}
                    </span>
                  )}
                </span>
              </span>
              <span className="whitespace-nowrap text-right font-semibold text-slate-800 dark:text-[#e8dfc8]">
                {rv.value === null ? (
                  "—"
                ) : (
                  <>
                    {fmtMoney(rv.value)}
                    {rv.estimated && (
                      <span className="block text-[11px] font-normal text-slate-400 dark:text-white/40">
                        est.
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {d.industry && (
                <SectorChip sector={dealFocusSector(d.industry) ?? d.industry} />
              )}
              {!isFocusDeal(d.industry) && d.industry && (
                <span className="inline-block rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-semibold text-slate-500 dark:bg-white/10 dark:text-white/50">
                  Non-focus
                </span>
              )}
              <StageChip stage={d.stage} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-white/50">
              <span>
                EBITDA{" "}
                <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">
                  {d.ebitda != null ? fmtMoney(d.ebitda) : "—"}
                </span>
              </span>
              {est && (
                <span>
                  Mult{" "}
                  <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">
                    {est.headlineLow.toFixed(1) === est.headlineHigh.toFixed(1)
                      ? `${est.headlineLow.toFixed(1)}×`
                      : `${est.headlineLow.toFixed(1)}–${est.headlineHigh.toFixed(1)}×`}
                  </span>
                </span>
              )}
              <span>{d.owner || "Unclaimed"}</span>
              <span
                style={{
                  color: agingColor(
                    Math.floor((Date.now() - new Date(d.updatedAt).getTime()) / 86400000)
                  ),
                }}
              >
                {fmtDateShort(d.updatedAt)}
              </span>
            </div>
            {d.operatorIds && d.operatorIds.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {uniqueStrings(d.operatorIds).map((oid) => (
                  <span
                    key={oid}
                    className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:bg-violet-500/20 dark:text-violet-200"
                  >
                    ◈ {opName(oid)}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2">
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                  No operator
                </span>
              </div>
            )}
          </div>
        );
      })}
      {sorted.length === 0 && (
        <p className="rounded-xl border border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-400 dark:border-white/10 dark:bg-[#132847] dark:text-white/40">
          No deals match.
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
