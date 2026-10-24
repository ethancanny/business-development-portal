"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Deal, Executive, MiMultiple } from "@/lib/types";
import { fmtMoney, uniqueStrings } from "@/lib/format";
import { dealFocusSector, estimateMultiple, resolveDealValue, type MarketRates } from "@/lib/valuation";
import CompanyLogo from "@/components/CompanyLogo";
import SectorChip, { SectorLegend } from "@/components/SectorChip";
import { StageMoveMenu } from "@/components/StageMove";
import {
  TypeBadge,
  fmtMetricValue,
  type BdBootstrap,
  type BdMetricDefinition,
} from "@/components/InvestmentTypeBits";
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

/**
 * Investment Types (Step 1): the table's columns are a per-type model.
 * "All" shows the common set (company, industry, type, stage, value,
 * EBITDA, est. multiple, the type's KEY metric, owner, updated).
 * Platform LBO leads with the long-hold operating metrics; IRR/MOIC
 * appear only in the optional hold-period view. Add-on and Early
 * Stage get their spec column sets. Metric values read from
 * bd.deal_metrics via the bootstrap payload — display only.
 */
interface Col {
  id: string;
  label: string;
  sortKey?: SortKey;
  cell: (d: Deal) => ReactNode;
}

export default function DealTable({
  deals,
  execs,
  onSelect,
  multiples = [],
  rates = {},
  typeFilter = "all",
  bd = null,
  holdView = false,
  allDeals = [],
  onStageMoved,
}: {
  deals: Deal[];
  execs: Executive[];
  onSelect: (d: Deal) => void;
  multiples?: MiMultiple[];
  rates?: MarketRates;
  typeFilter?: string;
  bd?: BdBootstrap | null;
  holdView?: boolean;
  allDeals?: Deal[];
  /** Fired after a stage move through the row's Move-to-stage menu. */
  onStageMoved?: () => void;
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

  // ---- bd metric helpers -------------------------------------------------
  const defOf = (key: string): BdMetricDefinition | undefined =>
    bd?.config.definitions.find((x) => x.key === key);
  const metricCell = (key: string) => (d: Deal) => {
    const def = defOf(key);
    const v = bd?.metricsByDeal[d.id]?.[key];
    if (!def) return v?.num != null ? String(v.num) : (v?.text ?? "—");
    return fmtMetricValue(def, v);
  };
  const metricNum = (d: Deal, key: string): number | null =>
    bd?.metricsByDeal[d.id]?.[key]?.num ?? null;

  const parentOf = (d: Deal): Deal | undefined =>
    d.parentDealId ? allDeals.find((x) => x.id === d.parentDealId) : undefined;
  const headlineMid = (d: Deal): number | null => {
    const e = estOf(d);
    return e ? (e.headlineLow + e.headlineHigh) / 2 : null;
  };
  /** Pro forma blended multiple: value-weighted headline multiples of
   * platform + add-on (display-derived, never stored). */
  const blendedMultiple = (d: Deal): string => {
    const parent = parentOf(d);
    if (!parent) return "—";
    const pm = headlineMid(parent);
    const am = headlineMid(d);
    const pv = resolveDealValue(parent, multiples, rates).value;
    const av = resolveDealValue(d, multiples, rates).value;
    if (pm === null || am === null || !pv || !av) return "—";
    return `${((pv * pm + av * am) / (pv + av)).toFixed(1)}×`;
  };
  const sourcedFromLabel = (d: Deal): string => {
    if (!d.sourcedFromId || !bd) return "—";
    const hit =
      bd.sourcedFromOptions.portfolioCompanies.find(
        (o) => o.id === d.sourcedFromId
      ) ??
      bd.sourcedFromOptions.marketInsights.find(
        (o) => o.id === d.sourcedFromId
      );
    return hit?.label ?? "—";
  };

  // ---- shared cells ------------------------------------------------------
  const companyCol: Col = {
    id: "company",
    label: "Company",
    sortKey: "companyName",
    cell: (d) => (
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
          {d.city && <span className="caption block">{d.city}</span>}
        </span>
      </span>
    ),
  };
  const industryCol: Col = {
    id: "industry",
    label: "Industry",
    sortKey: "industry",
    cell: (d) =>
      d.industry ? (
        <span className="inline-flex items-center gap-1.5">
          <SectorChip sector={dealFocusSector(d.industry) ?? d.industry} />
        </span>
      ) : (
        "—"
      ),
  };
  const typeCol: Col = {
    id: "type",
    label: "Type",
    cell: (d) => <TypeBadge type={d.investmentType} />,
  };
  const stageCol: Col = {
    id: "stage",
    label: "Stage",
    sortKey: "stage",
    // The chip IS the move control (Oct 24, 2026): click opens the
    // deal's own type stage list; gates + override ride the deals PUT.
    cell: (d) => (
      <StageMoveMenu deal={d} bd={bd} onMoved={onStageMoved} />
    ),
  };
  const valueCol: Col = {
    id: "value",
    label: "Value",
    sortKey: "dealValue",
    cell: (d) => {
      const rv = resolveDealValue(d, multiples, rates);
      if (rv.value === null) return "—";
      return (
        <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">
          {fmtMoney(rv.value)}
          {rv.estimated && (
            <span className="ml-1 text-[11px] font-normal text-slate-400 dark:text-white/40">
              est.
            </span>
          )}
        </span>
      );
    },
  };
  const ebitdaCol: Col = {
    id: "ebitda",
    label: "EBITDA",
    sortKey: "ebitda",
    cell: (d) => (d.ebitda != null ? fmtMoney(d.ebitda) : "—"),
  };
  const ebitdaSdeCol: Col = {
    id: "ebitdaSde",
    label: "EBITDA / SDE",
    cell: (d) => (
      <span>
        {d.ebitda != null ? fmtMoney(d.ebitda) : "—"}
        <span className="block text-[11px] text-slate-400 dark:text-white/40">
          SDE {metricCell("sde")(d)}
        </span>
      </span>
    ),
  };
  const estCol: Col = {
    id: "estMultiple",
    label: "Est. multiple",
    sortKey: "estMultiple",
    cell: (d) => {
      const est = estOf(d);
      if (!est) return <span className="text-slate-400">—</span>;
      return (
        <span title={`${est.baseBasis}. Effective ${est.effLow.toFixed(1)}–${est.effHigh.toFixed(1)}× after discounting the headline (${est.headlineSource}) for expected payout + time value. Market multiple ${est.marketMid.toFixed(1)}× after drivers/growth; market effective estimate ${est.estimateEffMid.toFixed(1)}× at the usual structure. Actual effective ${est.effMid.toFixed(1)}× — ${est.gapEffectiveX >= 0 ? "+" : "−"}${Math.abs(est.gapEffectiveX).toFixed(2)}× vs the market estimate.`}>
          <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">
            {est.headlineLow.toFixed(1) === est.headlineHigh.toFixed(1)
              ? `${est.headlineLow.toFixed(1)}×`
              : `${est.headlineLow.toFixed(1)}–${est.headlineHigh.toFixed(1)}×`}
          </span>
        </span>
      );
    },
  };
  const ownerCol: Col = {
    id: "owner",
    label: "Owner",
    sortKey: "owner",
    cell: (d) => d.owner || <span className="text-slate-400">Unclaimed</span>,
  };
  const updatedCol: Col = {
    id: "updated",
    label: "Updated",
    sortKey: "updatedAt",
    cell: (d) => (
      <span
        style={{
          color: agingColor(
            Math.floor((Date.now() - new Date(d.updatedAt).getTime()) / 86400000)
          ),
        }}
        title="Deal staleness — amber at 30 days untouched, red at 90"
      >
        {fmtDateShort(d.updatedAt)}
      </span>
    ),
  };
  const keyMetricCol: Col = {
    id: "keyMetric",
    label: "Key metric",
    cell: (d) => {
      const t = d.investmentType ?? "platform_lbo";
      if (t === "early_stage") {
        const arr = metricNum(d, "arr") ?? d.revenue;
        return arr != null ? `ARR ${fmtMoney(arr)}` : "—";
      }
      if (t === "add_on") return `Blended ${blendedMultiple(d)}`;
      const fcf = metricNum(d, "fcf_yield_pct");
      return fcf !== null ? `FCF yield ${fcf}%` : "—";
    },
  };

  const columns: Col[] = useMemo(() => {
    if (typeFilter === "platform_lbo" && holdView) {
      return [
        companyCol, industryCol, stageCol, valueCol, ebitdaCol,
        { id: "irr", label: "Target IRR", cell: metricCell("target_irr_pct") },
        { id: "moic", label: "Target MOIC", cell: metricCell("target_moic") },
        { id: "hold", label: "Hold (yrs)", cell: metricCell("hold_years") },
        ownerCol, updatedCol,
      ];
    }
    if (typeFilter === "platform_lbo") {
      return [
        companyCol, industryCol, stageCol, valueCol, ebitdaSdeCol, estCol,
        { id: "leverage", label: "Leverage", cell: metricCell("leverage_x") },
        { id: "equity", label: "Equity check", cell: metricCell("equity_check") },
        { id: "fcf", label: "FCF yield", cell: metricCell("fcf_yield_pct") },
        { id: "roic", label: "ROIC", cell: metricCell("roic_pct") },
        { id: "dscr", label: "DSCR", cell: metricCell("dscr") },
        ownerCol, updatedCol,
      ];
    }
    if (typeFilter === "add_on") {
      return [
        companyCol, industryCol, stageCol,
        {
          id: "parent",
          label: "Parent platform",
          cell: (d) => parentOf(d)?.companyName ?? "—",
        },
        valueCol,
        {
          id: "purchaseMult",
          label: "Purchase mult.",
          cell: (d) => {
            const m = headlineMid(d);
            return m === null ? "—" : `${m.toFixed(1)}×`;
          },
        },
        {
          id: "platformMult",
          label: "Platform mult.",
          cell: (d) => {
            const p = parentOf(d);
            const m = p ? headlineMid(p) : null;
            return m === null || m === undefined ? "—" : `${m.toFixed(1)}×`;
          },
        },
        { id: "blended", label: "Pro forma blended", cell: (d) => blendedMultiple(d) },
        { id: "synergies", label: "Synergies", cell: metricCell("synergies") },
        { id: "integration", label: "Integration cost", cell: metricCell("integration_cost") },
        { id: "fit", label: "Fit score", cell: metricCell("fit_score") },
        ownerCol, updatedCol,
      ];
    }
    if (typeFilter === "early_stage") {
      return [
        companyCol, industryCol, stageCol,
        {
          id: "arr",
          label: "ARR / contract rev.",
          cell: (d) => {
            const arr = metricNum(d, "arr") ?? d.revenue;
            return arr != null ? fmtMoney(arr) : metricCell("arr")(d);
          },
        },
        {
          id: "growth",
          label: "Growth",
          cell: (d) =>
            d.growthPct != null ? `${d.growthPct}%` : metricCell("growth_pct")(d),
        },
        { id: "gm", label: "Gross margin", cell: metricCell("gross_margin_pct") },
        { id: "burn", label: "Burn / mo", cell: metricCell("monthly_burn") },
        {
          id: "runway",
          label: "Runway",
          cell: (d) => {
            const n = metricNum(d, "runway_months");
            return n !== null ? `${n} mo` : "—";
          },
        },
        { id: "round", label: "Round size", cell: metricCell("round_size") },
        { id: "instrument", label: "Instrument", cell: metricCell("instrument") },
        { id: "cap", label: "Valuation cap", cell: metricCell("valuation_cap") },
        { id: "ownership", label: "Ownership", cell: metricCell("ownership_pct") },
        { id: "sourced", label: "Sourced from", cell: (d) => sourcedFromLabel(d) },
        ownerCol, updatedCol,
      ];
    }
    // "all" (and any other type): the common column set.
    return [
      companyCol, industryCol, typeCol, stageCol, valueCol, ebitdaCol,
      estCol, keyMetricCol, ownerCol, updatedCol,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, holdView, bd, allDeals, multiples, rates, onStageMoved]);

  const thCls =
    "select-none whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-label text-slate-500 dark:text-white/50";
  const thSortCls = `${thCls} cursor-pointer hover:text-slate-800 dark:hover:text-white`;

  return (
    <div>
      {legendSectors.length > 1 && (
        <div className="mb-2 px-1">
          <SectorLegend sectors={legendSectors} />
        </div>
      )}
    <div className="hidden overflow-x-auto rounded-card border border-slate-200 bg-white shadow-card dark:border-white/10 dark:bg-[#132847] md:block">
      <table className="tbl-grad w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 dark:border-white/10">
            {columns.map((c) => (
              <th
                key={c.id}
                className={c.sortKey ? thSortCls : thCls}
                onClick={c.sortKey ? () => toggleSort(c.sortKey!) : undefined}
              >
                {c.label}
                {c.sortKey && sortKey === c.sortKey && (
                  <span className="ml-1 text-[#b8975a]">
                    {sortDir === 1 ? "▲" : "▼"}
                  </span>
                )}
              </th>
            ))}
            <th className="whitespace-nowrap px-3 py-3 text-left text-xs font-semibold uppercase tracking-label text-slate-500 dark:text-white/50">
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
              {columns.map((c) => (
                <td key={c.id} className="whitespace-nowrap px-3 py-3 text-slate-600 dark:text-[#c8bfa8]">
                  {c.cell(d)}
                </td>
              ))}
              <td className="px-3 py-3">
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
                colSpan={columns.length + 1}
                className="px-3 py-10 text-center text-sm text-caption"
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
        const parent = parentOf(d);
        return (
          <div
            key={d.id}
            onClick={() => onSelect(d)}
            className="card-surface card-hover cursor-pointer p-3.5"
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
                    <span className="caption block">
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
              <StageMoveMenu deal={d} bd={bd} onMoved={onStageMoved} />
              <TypeBadge type={d.investmentType} />
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
              {parent && (
                <span>
                  Add-on to{" "}
                  <span className="font-medium text-slate-700 dark:text-[#e8dfc8]">
                    {parent.companyName}
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
        <p className="card-surface px-3 py-10 text-center text-sm text-caption">
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
