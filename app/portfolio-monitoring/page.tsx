"use client";

/**
 * Portfolio Monitoring index (Phase 8) — portfolio rollup tiles from
 * GET /api/platform/monitoring/rollups (stored read model server-side;
 * this page never recomputes) and one card per live portfolio company
 * from GET /api/platform/monitoring/companies, each linking into the
 * company monitoring workspace. Honest empty state when no deal has
 * closed into monitoring yet.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PageHero from "@/components/PageHero";
import { CardSkeleton, EmptyState, ErrorState, StatTile } from "@/components/ui";
import {
  API,
  api,
  dateOnly,
  fmtDateShort,
  fmtFractionPct,
  fmtMoneyC,
  fmtMoneyN,
  fmtMultiple,
  fmtPctPoints,
  listFrom,
  num,
  pick,
  statusBadge,
  str,
  type Rec,
} from "@/components/monitoring/types";

export default function PortfolioMonitoringPage() {
  const [rollups, setRollups] = useState<Rec | null>(null);
  const [companies, setCompanies] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [rollupData, companyData] = await Promise.all([
        api<Rec>(`${API}/rollups`).catch(() => ({}) as Rec),
        api<Rec>(`${API}/companies`),
      ]);
      // GET /rollups returns { rollups: { payload, updatedAt } | null }.
      const rollupWrap = (rollupData.rollups ?? null) as Rec | null;
      const r = ((rollupWrap?.payload ?? rollupWrap ?? rollupData) || {}) as Rec;
      setRollups(r);
      setCompanies(listFrom(companyData, "items", "companies"));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalRevenue = num(pick(rollups ?? {}, "totalRevenue", "revenue"));
  const totalEbitda = num(pick(rollups ?? {}, "totalEbitda", "ebitda"));
  // weightedGrossMarginPct is PERCENT POINTS in the rollup payload
  // (Σgross_profit/Σrevenue × 100) — rendered with fmtPctPoints, NOT
  // multiplied again.
  const weightedMargin = num(
    pick(rollups ?? {}, "weightedGrossMarginPct", "grossMarginPct", "weightedGrossMargin")
  );
  const leverage = num(pick(rollups ?? {}, "aggregateLeverage", "leverage"));
  const totalCash = num(pick(rollups ?? {}, "totalCash", "cash"));
  const companyCount =
    num(pick(rollups ?? {}, "companyCount", "count")) ?? companies.length;

  return (
    <div>
      <PageHero
        eyebrow="Platform"
        title="Portfolio Monitoring"
        subtitle="Reporting, KPIs, variance, covenants, cash and alerts across closed portfolio companies"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <CardSkeleton key={i} lines={3} />
            ))}
          </div>
        ) : error ? (
          <ErrorState onRetry={() => void load()} />
        ) : companies.length === 0 ? (
          <EmptyState
            title="No portfolio companies yet"
            message="Companies enter Portfolio Monitoring through the deal_closed handoff — when a deal closes, its baseline, underwriting and participants are copied here and monthly reporting begins. Nothing is monitored until then."
          />
        ) : (
          <>
            {/* Rollups */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <div className="card-surface p-4">
                <StatTile
                  label="Total revenue"
                  display={fmtMoneyC(totalRevenue)}
                  title={fmtMoneyN(totalRevenue)}
                  caption={`${companyCount} portfolio compan${companyCount === 1 ? "y" : "ies"}, latest periods`}
                />
              </div>
              <div className="card-surface p-4">
                <StatTile
                  label="Total EBITDA"
                  display={fmtMoneyC(totalEbitda)}
                  title={fmtMoneyN(totalEbitda)}
                  caption="Latest reported periods"
                />
              </div>
              <div className="card-surface p-4">
                <StatTile
                  label="Weighted gross margin"
                  display={fmtPctPoints(weightedMargin)}
                  caption="Revenue-weighted across the portfolio"
                />
              </div>
              <div className="card-surface p-4">
                <StatTile
                  label="Aggregate leverage"
                  display={fmtMultiple(leverage)}
                  caption="Total debt / total EBITDA"
                />
              </div>
              <div className="card-surface p-4">
                <StatTile
                  label="Total cash"
                  display={fmtMoneyC(totalCash)}
                  title={fmtMoneyN(totalCash)}
                  caption="Latest cash snapshots"
                />
              </div>
            </div>

            {/* Companies */}
            <h2 className="mt-8 font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
              Portfolio companies
            </h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {companies.map((c, i) => {
                const companyId = str(pick(c, "companyId", "id"));
                const name = str(pick(c, "companyName", "name")) || "Portfolio company";
                // List items are flat (PortfolioCompanyListItem): the
                // KPI fields sit on the row itself; grossMarginPct is
                // the stored FRACTION there.
                const kpis = (pick(c, "kpis") ?? {}) as Rec;
                const revenue = num(pick(c, "revenue")) ?? num(pick(kpis, "revenue"));
                const ebitda = num(pick(c, "ebitda")) ?? num(pick(kpis, "ebitda"));
                const margin =
                  num(pick(c, "grossMarginPct")) ??
                  num(pick(kpis, "grossMarginPct", "grossMargin"));
                const reporting = str(pick(c, "reportingStatus"));
                const covenant = str(pick(c, "covenantStatus"));
                const openAlerts = num(pick(c, "openAlerts", "openAlertCount")) ?? 0;
                const latestPeriod = dateOnly(pick(c, "latestPeriodEnd", "periodEnd"));
                return (
                  <div
                    key={companyId || i}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-[#132847]/60 sm:p-6"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
                          <Link
                            href={`/portfolio-monitoring/${encodeURIComponent(companyId)}`}
                            className="hover:text-gold-700 hover:underline dark:hover:text-gold-400"
                          >
                            {name}
                          </Link>
                        </h3>
                        <p className="truncate text-sm text-slate-500 dark:text-white/50">
                          {latestPeriod
                            ? `Latest period ${fmtDateShort(latestPeriod)}`
                            : "No period reported yet"}
                          {str(pick(c, "status")) ? ` · ${str(pick(c, "status"))}` : ""}
                        </p>
                      </div>
                      {str(pick(c, "status")) && (
                        <span className="badge badge-neutral shrink-0">
                          {str(pick(c, "status"))}
                        </span>
                      )}
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div className="rounded-xl bg-slate-50 px-2 py-2 dark:bg-white/5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                          Revenue
                        </p>
                        <p className="tnum font-display text-lg font-semibold text-[#0d1f3c] dark:text-white" title={fmtMoneyN(revenue)}>
                          {fmtMoneyC(revenue)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-2 py-2 dark:bg-white/5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                          EBITDA
                        </p>
                        <p className="tnum font-display text-lg font-semibold text-[#0d1f3c] dark:text-white" title={fmtMoneyN(ebitda)}>
                          {fmtMoneyC(ebitda)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-2 py-2 dark:bg-white/5">
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                          Gross margin
                        </p>
                        <p className="tnum font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                          {fmtFractionPct(margin)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {reporting && (
                        <span className={`badge ${statusBadge(reporting)}`}>
                          Reporting: {reporting}
                        </span>
                      )}
                      {covenant && (
                        <span className={`badge ${statusBadge(covenant)}`}>
                          Covenants: {covenant}
                        </span>
                      )}
                      <span className={`badge ${openAlerts > 0 ? "badge-danger" : "badge-neutral"}`}>
                        {openAlerts} open alert{openAlerts === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="mt-4">
                      <Link
                        href={`/portfolio-monitoring/${encodeURIComponent(companyId)}`}
                        className="btn btn-primary btn-sm min-h-[44px]"
                      >
                        Open monitoring
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
