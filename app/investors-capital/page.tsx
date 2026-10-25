"use client";

/**
 * Investors & Capital index (Phase 7) — the deal grid first (every
 * deal with its raise summary chips: target / hard / funded /
 * investors, linking into the per-deal capital workspace), then the
 * investor panel (Directory people + capital profiles). Section
 * order flipped Oct 24, 2026 at Ethan's direction: Deals & raises
 * above Investors.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import InvestorsPanel from "@/components/capital/InvestorsPanel";
import {
  API,
  api,
  cardCls,
  fmtMoneyCompact,
  fmtMoneyN,
  listFrom,
  type CapitalDeal,
} from "@/components/capital/types";

export default function InvestorsCapitalPage() {
  const [deals, setDeals] = useState<CapitalDeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api<Record<string, unknown>>(`${API}/deals`);
      setDeals(listFrom<CapitalDeal>(data, "items", "deals"));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHero
        eyebrow="Platform"
        title="Investors & Capital"
        subtitle="Investor profiles, capital raises, deal economics, investment committee and investor reporting"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
          Deals &amp; raises
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          Open a deal for its raise book, economics model, deal screen, IC
          record and reporting ledger.
        </p>

        <div className="mt-4">
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
              {Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} lines={3} />
              ))}
            </div>
          ) : error ? (
            <ErrorState onRetry={() => void load()} />
          ) : deals.length === 0 ? (
            <EmptyState
              title="No deals yet"
              message="Deals appear here as they enter the pipeline. Each deal gets a capital workspace — raise, economics, screen, IC and reporting — as soon as it exists."
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {deals.map((deal) => {
                const s = deal.summary;
                const fundedPct =
                  s && s.targetRaise > 0 ? s.fundedTotal / s.targetRaise : null;
                return (
                  <div key={deal.dealId} className={cardCls}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
                          <Link
                            href={`/investors-capital/${encodeURIComponent(deal.dealId)}`}
                            className="hover:text-gold-700 hover:underline dark:hover:text-gold-400"
                          >
                            {deal.dealName || deal.companyName || "Deal"}
                          </Link>
                        </h3>
                        {deal.companyName && deal.dealName && (
                          <p className="truncate text-sm text-slate-500 dark:text-white/50">
                            {deal.companyName}
                          </p>
                        )}
                      </div>
                      {deal.stage && (
                        <span className="badge badge-neutral shrink-0">{deal.stage}</span>
                      )}
                    </div>

                    {s ? (
                      <>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <span className="badge badge-neutral" title={fmtMoneyN(s.targetRaise)}>
                            Target {fmtMoneyCompact(s.targetRaise)}
                          </span>
                          <span className="badge badge-warn" title={fmtMoneyN(s.hardTotal)}>
                            Hard {fmtMoneyCompact(s.hardTotal)}
                          </span>
                          <span className="badge badge-fit" title={fmtMoneyN(s.fundedTotal)}>
                            Funded {fmtMoneyCompact(s.fundedTotal)}
                          </span>
                          <span className="badge badge-neutral">
                            {s.investorCount} investor{s.investorCount === 1 ? "" : "s"}
                          </span>
                        </div>
                        {fundedPct !== null && (
                          <div className="mt-3" aria-label="Funded progress">
                            <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#b8975a] to-[#d4b37a]"
                                style={{ width: `${Math.min(100, Math.max(0, fundedPct * 100))}%` }}
                              />
                            </div>
                            <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                              {Math.round(fundedPct * 100)}% funded · called{" "}
                              {fmtMoneyCompact(s.calledTotal)} · NAV{" "}
                              {fmtMoneyCompact(s.navTotal)}
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
                        No raise open yet — open one in the workspace.
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={`/investors-capital/${encodeURIComponent(deal.dealId)}`}
                        className="btn btn-primary btn-sm min-h-[44px]"
                      >
                        Open workspace
                      </Link>
                      <Link
                        href={`/due-diligence/${encodeURIComponent(deal.dealId)}`}
                        className="btn btn-secondary btn-sm min-h-[44px]"
                      >
                        Due Diligence
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-8">
          <InvestorsPanel />
        </div>
      </div>
    </div>
  );
}
