"use client";

/**
 * Portfolio Monitoring company workspace shell (Phase 8) — one
 * portfolio company's monitoring record: header (company + status
 * chips from GET /companies/[companyId]), Board pack / Investor
 * update export buttons, and the eight tabs (Overview, Reporting,
 * KPIs, Variance, VC Plan, Cash & Debt, Covenants, Alerts). Each tab
 * fetches its own slice on open — no polling anywhere. Tab selection
 * persists per company in sessionStorage (capital workspace pattern).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import {
  companyBase,
  api,
  fmtDateShort,
  fmtFractionPct,
  fmtMoneyC,
  fmtMoneyN,
  num,
  pick,
  statusBadge,
  str,
  dateOnly,
  type MonitoringTabProps,
  type Rec,
} from "@/components/monitoring/types";
import OverviewTab from "@/components/monitoring/OverviewTab";
import ReportingTab from "@/components/monitoring/ReportingTab";
import KpisTab from "@/components/monitoring/KpisTab";
import VarianceTab from "@/components/monitoring/VarianceTab";
import VcTab from "@/components/monitoring/VcTab";
import CashDebtTab from "@/components/monitoring/CashDebtTab";
import CovenantsTab from "@/components/monitoring/CovenantsTab";
import AlertsTab from "@/components/monitoring/AlertsTab";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "reporting", label: "Reporting" },
  { key: "kpis", label: "KPIs" },
  { key: "variance", label: "Variance" },
  { key: "vc", label: "VC Plan" },
  { key: "cash", label: "Cash & Debt" },
  { key: "covenants", label: "Covenants" },
  { key: "alerts", label: "Alerts" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function MonitoringWorkspace({ companyId }: { companyId: string }) {
  const [detail, setDetail] = useState<Rec | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [tab, setTab] = useState<TabKey>("overview");

  const loadHeader = useCallback(async () => {
    const data = await api<Rec>(companyBase(companyId));
    const rec = (pick(data, "company", "portfolioCompany") ?? data) as Rec;
    // Keep any sibling summary the detail response carries.
    const merged: Rec = { ...data, ...rec };
    setDetail(merged);
    return merged;
  }, [companyId]);

  const resolve = useCallback(async () => {
    setPhase("loading");
    try {
      const match = await loadHeader();
      setPhase(match && Object.keys(match).length ? "ready" : "none");
    } catch (err) {
      setPhase(
        err && typeof err === "object" && (err as { status?: number }).status === 404
          ? "none"
          : "error"
      );
    }
  }, [loadHeader]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  useEffect(() => {
    try {
      const saved =
        window.sessionStorage.getItem(`ccp-monitoring-tab:${companyId}`) ?? "";
      if (TABS.some((t) => t.key === saved)) setTab(saved as TabKey);
    } catch {
      /* storage unavailable — default tab stands */
    }
  }, [companyId]);

  const selectTab = (t: TabKey) => {
    setTab(t);
    try {
      window.sessionStorage.setItem(`ccp-monitoring-tab:${companyId}`, t);
    } catch {
      /* storage unavailable — tab still switches */
    }
  };

  const refreshHeader = useCallback(() => {
    void loadHeader().catch(() => undefined);
  }, [loadHeader]);

  if (phase === "loading") return <SkeletonRows rows={6} />;
  if (phase === "error") return <ErrorState onRetry={() => void resolve()} />;

  if (phase === "none" || !detail) {
    return (
      <div className="card-surface px-6 py-10 text-center">
        <p className="font-display text-2xl font-semibold text-navy-900 dark:text-white">
          Portfolio company not found
        </p>
        <p className="caption mx-auto mt-2 max-w-md">
          This company isn&apos;t a live portfolio company in monitoring. It
          enters monitoring through the deal_closed handoff when its deal
          closes.
        </p>
        <div className="mt-5">
          <Link href="/portfolio-monitoring" className="btn btn-primary btn-sm min-h-[44px]">
            ← Portfolio Monitoring
          </Link>
        </div>
      </div>
    );
  }

  const company = detail;
  const summary = (pick(company, "summary", "monitoringSummary") ?? company) as Rec;
  const kpis = (pick(summary, "kpis") ?? pick(company, "kpis") ?? {}) as Rec;
  // The detail record carries no name — it lives on the copied
  // company snapshot (baselineCompany).
  const baselineCompany = (pick(company, "baselineCompany") ?? {}) as Rec;
  const name =
    str(pick(baselineCompany, "name", "companyName")) ||
    str(pick(company, "companyName", "name")) ||
    "Portfolio company";
  const status = str(pick(company, "status", "monitoringStatus"));
  const dealId = str(pick(company, "dealId"));
  const reporting = str(pick(summary, "reportingStatus")) || str(pick(company, "reportingStatus"));
  const covenant = str(pick(summary, "covenantStatus")) || str(pick(company, "covenantStatus"));
  const openAlerts = num(pick(summary, "openAlerts")) ?? num(pick(company, "openAlerts")) ?? 0;
  const latestPeriod = dateOnly(pick(summary, "latestPeriodEnd")) || dateOnly(pick(company, "latestPeriodEnd"));
  const revenue = num(pick(kpis, "revenue"));
  const ebitda = num(pick(kpis, "ebitda"));
  const margin = num(pick(kpis, "grossMarginPct", "grossMargin"));
  const cash = num(pick(kpis, "cash"));

  const tabProps: MonitoringTabProps = {
    companyId,
    company,
    summary,
    refreshHeader,
  };
  const exportBase = `${companyBase(companyId)}/export`;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/portfolio-monitoring"
            className="text-xs font-semibold uppercase tracking-wider text-gold-700 hover:underline dark:text-gold-400"
          >
            ← Portfolio Monitoring
          </Link>
          <h2 className="mt-1 truncate font-display text-3xl font-semibold text-[#0d1f3c] dark:text-white">
            {name}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            {status ? `${status} · ` : ""}
            {latestPeriod
              ? `Latest period ${fmtDateShort(latestPeriod)}`
              : "No period reported yet"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
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
        </div>
        <div className="flex flex-wrap gap-2">
          {dealId && (
            <Link
              href={`/companies/${encodeURIComponent(companyId)}`}
              className="btn btn-secondary btn-sm min-h-[44px]"
            >
              Company profile
            </Link>
          )}
          <a
            href={`${exportBase}/board-pack?format=pdf`}
            className="btn btn-primary btn-sm min-h-[44px]"
          >
            Board pack PDF
          </a>
          <a
            href={`${exportBase}/board-pack?format=xlsx`}
            className="btn btn-secondary btn-sm min-h-[44px]"
          >
            Board pack XLSX
          </a>
          <a
            href={`${exportBase}/investor-update?format=pdf`}
            className="btn btn-secondary btn-sm min-h-[44px]"
          >
            Investor update PDF
          </a>
          <a
            href={`${exportBase}/investor-update?format=xlsx`}
            className="btn btn-secondary btn-sm min-h-[44px]"
          >
            Investor update XLSX
          </a>
        </div>
      </div>

      {/* Latest KPI tiles */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card-surface p-4">
          <StatTile label="Revenue" display={fmtMoneyC(revenue)} title={fmtMoneyN(revenue)} caption="Latest period" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="EBITDA" display={fmtMoneyC(ebitda)} title={fmtMoneyN(ebitda)} caption="Latest period" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Gross margin" display={fmtFractionPct(margin)} caption="Latest period" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Cash" display={fmtMoneyC(cash)} title={fmtMoneyN(cash)} caption="Latest snapshot" />
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Monitoring sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => selectTab(t.key)}
            className={`chip min-h-[44px] shrink-0 ${tab === t.key ? "chip-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-5">
        {tab === "overview" && <OverviewTab {...tabProps} />}
        {tab === "reporting" && <ReportingTab {...tabProps} />}
        {tab === "kpis" && <KpisTab {...tabProps} />}
        {tab === "variance" && <VarianceTab {...tabProps} />}
        {tab === "vc" && <VcTab {...tabProps} />}
        {tab === "cash" && <CashDebtTab {...tabProps} />}
        {tab === "covenants" && <CovenantsTab {...tabProps} />}
        {tab === "alerts" && <AlertsTab {...tabProps} />}
      </div>
    </div>
  );
}
