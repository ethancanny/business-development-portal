"use client";

/**
 * Matching section (Step 1 redesign) — the cross-raise matrix from
 * GET /api/platform/capital/matrix: rows are Directory investors,
 * columns are the open raises (already filtered by the page's type
 * chip server-side). A cell shows the pipeline stage, or the hard /
 * funded amount once money is in. Above the matrix, the top
 * suggested matches per raise. On phones the matrix scrolls
 * horizontally with the investor column stuck to the left.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import {
  API,
  api,
  fmtMoneyCompact,
  selectCls,
  tdCls,
  thCls,
} from "@/components/capital/types";
import type { InvestmentTypeRef } from "./shared";

interface MatrixCell {
  pipelineStage?: string | null;
  stage?: string | null;
  hard?: number | null;
  funded?: number | null;
}

interface MatrixInvestor {
  personId: string;
  name: string;
  firm: string;
  types: string[];
  exposure: number | null;
  capacity: number | null;
  cells: Record<string, MatrixCell | undefined>;
}

interface MatrixRaise {
  raiseId: string;
  dealId: string;
  dealName: string;
  typeKey: string;
  typeLabel: string;
  target: number;
}

interface MatrixData {
  raises: MatrixRaise[];
  investors: MatrixInvestor[];
  suggestions: Record<string, Array<{ personId: string; name: string; score: number }>>;
}

const PAGE = 50;

function moneyOrDash(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? fmtMoneyCompact(v) : "—";
}

function cellText(cell: MatrixCell | undefined): string {
  if (!cell) return "—";
  if (typeof cell.funded === "number" && cell.funded > 0)
    return `${fmtMoneyCompact(cell.funded)} funded`;
  if (typeof cell.hard === "number" && cell.hard > 0)
    return `${fmtMoneyCompact(cell.hard)} hard`;
  return cell.pipelineStage || cell.stage || "—";
}

export default function MatchingSection({
  typeKey,
  typeOptions,
}: {
  typeKey: string;
  typeOptions: InvestmentTypeRef[];
}) {
  const [data, setData] = useState<MatrixData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [visible, setVisible] = useState(PAGE);
  const [investorType, setInvestorType] = useState("all");

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const d = await api<MatrixData>(`${API}/matrix?type=${encodeURIComponent(typeKey)}`);
      setData(d);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setVisible(PAGE);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey]);

  const labelForType = useMemo(() => {
    const map = new Map(typeOptions.map((t) => [t.key, t.label]));
    return (key: string) => map.get(key) ?? key;
  }, [typeOptions]);

  const rows = useMemo(() => {
    const all = data?.investors ?? [];
    if (investorType === "all") return all;
    return all.filter((i) => (i.types ?? []).includes(investorType));
  }, [data, investorType]);

  if (loading && !data) return <CardSkeleton lines={5} />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (!data || (data.raises.length === 0 && data.investors.length === 0)) {
    return (
      <EmptyState
        title="No matching data yet"
        message="The cross-raise matrix appears once raises are open and investors are in the Directory."
      />
    );
  }

  const suggestionRaises = data.raises.filter(
    (r) => (data.suggestions[r.dealId] ?? []).length > 0
  );

  return (
    <div>
      {suggestionRaises.length > 0 && (
        <div className="mb-5">
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Top suggested matches
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suggestionRaises.map((r) => (
              <div
                key={r.raiseId}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-[#132847]/60"
              >
                <p className="truncate font-medium text-[#0d1f3c] dark:text-white">
                  <Link
                    href={`/investors-capital/${encodeURIComponent(r.dealId)}`}
                    className="hover:underline"
                  >
                    {r.dealName}
                  </Link>
                  <span className="ml-2 text-xs text-slate-400 dark:text-white/40">
                    {r.typeLabel} · {fmtMoneyCompact(r.target)}
                  </span>
                </p>
                <ol className="mt-2 space-y-1">
                  {(data.suggestions[r.dealId] ?? []).slice(0, 3).map((sug) => (
                    <li key={sug.personId}>
                      <Link
                        href={`/investors-capital/${encodeURIComponent(r.dealId)}`}
                        className="flex min-h-[32px] items-center justify-between gap-2 rounded-lg px-2 py-1 text-sm text-slate-600 hover:bg-slate-50 dark:text-white/70 dark:hover:bg-white/5"
                      >
                        <span className="truncate">{sug.name}</span>
                        <span className="badge badge-fit shrink-0">{Math.round(sug.score)}</span>
                      </Link>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-500 dark:text-white/50">
          {rows.length} investor{rows.length === 1 ? "" : "s"} · {data.raises.length} open raise
          {data.raises.length === 1 ? "" : "s"}
        </p>
        <label className="ml-auto flex items-center gap-2 text-sm text-slate-500 dark:text-white/60">
          Invests in
          <select
            value={investorType}
            onChange={(e) => {
              setInvestorType(e.target.value);
              setVisible(PAGE);
            }}
            className={`${selectCls} min-h-[44px] w-auto`}
          >
            <option value="all">All types</option>
            {typeOptions.map((t) => (
              <option key={t.key} value={t.key}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.raises.length === 0 ? (
        <EmptyState
          title="No open raises in this view"
          message="Open a raise to see investors matched against it here."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No investors match this filter"
          message="Try a different investment type, or add investors in the Directory."
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-[#132847]/60">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th
                    className={`${thCls} sticky left-0 z-10 min-w-[180px] bg-white dark:bg-[#132847]`}
                  >
                    Investor
                  </th>
                  <th className={thCls}>Types</th>
                  <th className={thCls}>Exposure</th>
                  <th className={thCls}>Capacity</th>
                  {data.raises.map((r) => (
                    <th key={r.raiseId} className={thCls}>
                      <Link
                        href={`/investors-capital/${encodeURIComponent(r.dealId)}`}
                        className="hover:underline"
                      >
                        {r.dealName}
                      </Link>
                      <span className="block normal-case tracking-normal text-slate-400 dark:text-white/30">
                        {r.typeLabel} · {fmtMoneyCompact(r.target)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, visible).map((inv) => (
                  <tr
                    key={inv.personId}
                    className="border-b border-slate-50 hover:bg-slate-50/60 dark:border-white/5 dark:hover:bg-white/5"
                  >
                    <td
                      className={`${tdCls} sticky left-0 z-10 min-w-[180px] bg-white dark:bg-[#132847]`}
                    >
                      <span className="block font-medium">{inv.name}</span>
                      {inv.firm && (
                        <span className="block text-xs text-slate-400 dark:text-white/40">
                          {inv.firm}
                        </span>
                      )}
                    </td>
                    <td className={tdCls}>
                      <span className="flex flex-wrap gap-1">
                        {(inv.types ?? []).length === 0
                          ? "—"
                          : inv.types.map((t) => (
                              <span key={t} className="badge badge-neutral">
                                {labelForType(t)}
                              </span>
                            ))}
                      </span>
                    </td>
                    <td className={tdCls}>{moneyOrDash(inv.exposure)}</td>
                    <td className={tdCls}>{moneyOrDash(inv.capacity)}</td>
                    {data.raises.map((r) => {
                      const cell = inv.cells?.[r.raiseId];
                      const committed =
                        (typeof cell?.funded === "number" && cell.funded > 0) ||
                        (typeof cell?.hard === "number" && cell.hard > 0);
                      return (
                        <td key={r.raiseId} className={tdCls}>
                          {cell ? (
                            <span className={`badge ${committed ? "badge-fit" : "badge-neutral"}`}>
                              {cellText(cell)}
                            </span>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > visible && (
            <div className="mt-3 text-center">
              <button
                type="button"
                onClick={() => setVisible((v) => v + PAGE)}
                className="btn btn-secondary btn-sm min-h-[44px]"
              >
                Show more ({rows.length - visible} remaining)
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
