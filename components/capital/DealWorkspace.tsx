"use client";

/**
 * Investors & Capital deal workspace shell (Phase 7) — one deal's
 * capital stack: Raise, Economics, Deal Screen, IC and Reporting
 * tabs over the deal's raise summary header. The shell owns only
 * the header (deal + stored raise summary from GET /deals); each
 * tab fetches its own slice on open — no polling anywhere.
 *
 * Tab selection persists per deal in sessionStorage (same pattern
 * as the Value Creation workspace).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import {
  API,
  api,
  fmtMoneyCompact,
  fmtMoneyN,
  listFrom,
  type CapitalDeal,
} from "@/components/capital/types";
import RaiseTab from "@/components/capital/RaiseTab";
import EconomicsTab from "@/components/capital/EconomicsTab";
import ScreenTab from "@/components/capital/ScreenTab";
import IcTab from "@/components/capital/IcTab";
import ReportingTab from "@/components/capital/ReportingTab";

const TABS = [
  { key: "raise", label: "Raise" },
  { key: "economics", label: "Economics" },
  { key: "screen", label: "Deal Screen" },
  { key: "ic", label: "IC" },
  { key: "reporting", label: "Reporting" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default function DealWorkspace({ dealId }: { dealId: string }) {
  const [deal, setDeal] = useState<CapitalDeal | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [tab, setTab] = useState<TabKey>("raise");

  const loadHeader = useCallback(async () => {
    const data = await api<Record<string, unknown>>(`${API}/deals`);
    const deals = listFrom<CapitalDeal>(data, "deals");
    const match = deals.find((d) => d.dealId === dealId) ?? null;
    setDeal(match);
    return match;
  }, [dealId]);

  const resolve = useCallback(async () => {
    setPhase("loading");
    try {
      const match = await loadHeader();
      setPhase(match ? "ready" : "none");
    } catch {
      setPhase("error");
    }
  }, [loadHeader]);

  useEffect(() => {
    void resolve();
  }, [resolve]);

  useEffect(() => {
    try {
      const saved = window.sessionStorage.getItem(`ccp-capital-tab:${dealId}`) ?? "";
      if (TABS.some((t) => t.key === saved)) setTab(saved as TabKey);
    } catch {
      /* storage unavailable — default tab stands */
    }
  }, [dealId]);

  const selectTab = (t: TabKey) => {
    setTab(t);
    try {
      window.sessionStorage.setItem(`ccp-capital-tab:${dealId}`, t);
    } catch {
      /* storage unavailable — tab still switches */
    }
  };

  const refreshSummary = useCallback(() => {
    void loadHeader().catch(() => undefined);
  }, [loadHeader]);

  if (phase === "loading") return <SkeletonRows rows={6} />;
  if (phase === "error") return <ErrorState onRetry={() => void resolve()} />;

  if (phase === "none" || !deal) {
    return (
      <div className="card-surface px-6 py-10 text-center">
        <p className="font-display text-2xl font-semibold text-navy-900 dark:text-white">
          Deal not found
        </p>
        <p className="caption mx-auto mt-2 max-w-md">
          This deal isn&apos;t in the capital workspace list. It may have
          been removed, or the link is stale.
        </p>
        <div className="mt-5">
          <Link href="/investors-capital" className="btn btn-primary btn-sm min-h-[44px]">
            ← Investors &amp; Capital
          </Link>
        </div>
      </div>
    );
  }

  const s = deal.summary;
  const tabProps = { dealId, refreshSummary };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href="/investors-capital"
            className="text-xs font-semibold uppercase tracking-wider text-gold-700 hover:underline dark:text-gold-400"
          >
            ← Investors &amp; Capital
          </Link>
          <h2 className="mt-1 truncate font-display text-3xl font-semibold text-[#0d1f3c] dark:text-white">
            {deal.dealName || deal.companyName || "Deal"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            {deal.companyName && deal.dealName ? `${deal.companyName} · ` : ""}
            Stage {deal.stage || "—"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/due-diligence/${encodeURIComponent(dealId)}`}
            className="btn btn-secondary btn-sm min-h-[44px]"
          >
            Due Diligence
          </Link>
          {deal.companyId && (
            <Link
              href={`/companies/${encodeURIComponent(deal.companyId)}`}
              className="btn btn-secondary btn-sm min-h-[44px]"
            >
              Company profile
            </Link>
          )}
        </div>
      </div>

      {/* Raise summary tiles */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card-surface p-4">
          <StatTile
            label="Target raise"
            display={s ? fmtMoneyN(s.targetRaise) : "—"}
            caption={s ? "Open raise target" : "No raise open yet"}
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Hard commitments"
            display={s ? fmtMoneyCompact(s.hardTotal) : "—"}
            title={s ? fmtMoneyN(s.hardTotal) : undefined}
            caption={s ? `Soft ${fmtMoneyCompact(s.softTotal)} indicated` : "See the Raise tab"}
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Funded"
            display={s ? fmtMoneyCompact(s.fundedTotal) : "—"}
            title={s ? fmtMoneyN(s.fundedTotal) : undefined}
            caption={s ? `${s.investorCount} investor${s.investorCount === 1 ? "" : "s"} in the book` : "See the Raise tab"}
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Called / Distributed / NAV"
            display={
              s
                ? `${fmtMoneyCompact(s.calledTotal)} / ${fmtMoneyCompact(s.distributedTotal)} / ${fmtMoneyCompact(s.navTotal)}`
                : "—"
            }
            caption="Reporting totals to date"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Capital sections">
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
        {tab === "raise" && <RaiseTab {...tabProps} />}
        {tab === "economics" && <EconomicsTab {...tabProps} />}
        {tab === "screen" && <ScreenTab {...tabProps} />}
        {tab === "ic" && <IcTab {...tabProps} />}
        {tab === "reporting" && <ReportingTab {...tabProps} />}
      </div>
    </div>
  );
}
