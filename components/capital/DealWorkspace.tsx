"use client";

/**
 * Investors & Capital deal workspace shell (Phase 7, redesigned
 * Step 1, Oct 25, 2026) — one deal's raise workspace under the
 * deal identity banner (DealBanner: logo, accent strip, codename
 * rules, type badge), grouped tabs:
 *   Overview | Investors | Matching | Book | Documents |
 *   Reports | Economics | Closing | IC | Screen
 * The old Raise tab is retired as a shell tab — its settings form
 * lives in WorkspaceOverview and its commitment CRUD patterns in
 * BookTab (RaiseTab.tsx stays on disk, unimported).
 *
 * The shell owns only the header (deal + stored raise summary from
 * GET /deals — its summary now includes the indicated total); each
 * tab fetches its own slice on
 * open — no polling anywhere. Tab selection persists per deal in
 * sessionStorage; legacy saved keys map forward (raise → overview,
 * reporting → reports).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import DealBanner from "@/components/identity/DealBanner";
import {
  API,
  api,
  fmtMoneyCompact,
  fmtMoneyN,
  listFrom,
  type CapitalDeal,
  type RaiseSummary,
} from "@/components/capital/types";
import EconomicsTab from "@/components/capital/EconomicsTab";
import ScreenTab from "@/components/capital/ScreenTab";
import IcTab from "@/components/capital/IcTab";
import ReportingTab from "@/components/capital/ReportingTab";
import WorkspaceOverview from "@/components/capital/workspace/WorkspaceOverview";
import InvestorsTab from "@/components/capital/workspace/InvestorsTab";
import MatchingTab from "@/components/capital/workspace/MatchingTab";
import BookTab from "@/components/capital/workspace/BookTab";
import DocumentsTab from "@/components/capital/workspace/DocumentsTab";
import ClosingTab from "@/components/capital/workspace/ClosingTab";

type ExtSummary = RaiseSummary & { indicatedTotal?: number };
type ExtDeal = Omit<CapitalDeal, "summary"> & { summary: ExtSummary | null };

const TAB_GROUPS: Array<Array<{ key: string; label: string }>> = [
  [
    { key: "overview", label: "Overview" },
    { key: "investors", label: "Investors" },
    { key: "matching", label: "Matching" },
    { key: "book", label: "Book" },
    { key: "documents", label: "Documents" },
  ],
  [
    { key: "reports", label: "Reports" },
    { key: "economics", label: "Economics" },
    { key: "closing", label: "Closing" },
  ],
  [
    { key: "ic", label: "IC" },
    { key: "screen", label: "Screen" },
  ],
];

const ALL_TABS = TAB_GROUPS.flat();
const LEGACY_TAB_MAP: Record<string, string> = {
  raise: "overview",
  reporting: "reports",
};

export default function DealWorkspace({ dealId }: { dealId: string }) {
  const [deal, setDeal] = useState<ExtDeal | null>(null);
  const [phase, setPhase] = useState<"loading" | "ready" | "none" | "error">("loading");
  const [tab, setTab] = useState<string>("overview");

  const loadHeader = useCallback(async () => {
    const data = await api<Record<string, unknown>>(`${API}/deals`);
    const deals = listFrom<ExtDeal>(data, "items", "deals");
    const match = deals.find((d) => d.dealId === dealId) ?? null;
    // The deals-list summary now carries indicatedTotal directly
    // (Step 1 extension in types.ts) — no second fetch needed here.
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
      const mapped = LEGACY_TAB_MAP[saved] ?? saved;
      if (ALL_TABS.some((t) => t.key === mapped)) setTab(mapped);
    } catch {
      /* storage unavailable — default tab stands */
    }
  }, [dealId]);

  const selectTab = (t: string) => {
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
      {/* Deal identity banner — logo, accent, codename rules */}
      <DealBanner dealId={dealId} />

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

      {/* Raise summary chips — now including indicated */}
      <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <div className="card-surface p-4">
          <StatTile
            label="Target raise"
            display={s ? fmtMoneyN(s.targetRaise) : "—"}
            caption={s ? "Open raise target" : "No raise open yet"}
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Indicated"
            display={s?.indicatedTotal != null ? fmtMoneyCompact(s.indicatedTotal) : "—"}
            title={s?.indicatedTotal != null ? fmtMoneyN(s.indicatedTotal) : undefined}
            caption={s?.indicatedTotal != null ? "Indicated in the book" : "See the Overview / Book"}
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Hard commitments"
            display={s ? fmtMoneyCompact(s.hardTotal) : "—"}
            title={s ? fmtMoneyN(s.hardTotal) : undefined}
            caption={s ? `Soft ${fmtMoneyCompact(s.softTotal)} indicated` : "See the Overview"}
          />
        </div>
        <div className="card-surface p-4">
          <StatTile
            label="Funded"
            display={s ? fmtMoneyCompact(s.fundedTotal) : "—"}
            title={s ? fmtMoneyN(s.fundedTotal) : undefined}
            caption={s ? `${s.investorCount} investor${s.investorCount === 1 ? "" : "s"} in the book` : "See the Overview"}
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

      {/* Grouped tabs */}
      <div className="mt-6 flex flex-wrap items-center gap-1.5 pb-1" role="tablist" aria-label="Capital sections">
        {TAB_GROUPS.map((group, gi) => (
          <span key={gi} className="flex items-center gap-1.5">
            {gi > 0 && <span aria-hidden className="mx-1 hidden h-6 w-px bg-slate-200 dark:bg-white/10 sm:block" />}
            {group.map((t) => (
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
          </span>
        ))}
      </div>

      <div className="mt-5">
        {tab === "overview" && <WorkspaceOverview {...tabProps} />}
        {tab === "investors" && <InvestorsTab {...tabProps} />}
        {tab === "matching" && <MatchingTab {...tabProps} />}
        {tab === "book" && <BookTab {...tabProps} />}
        {tab === "documents" && <DocumentsTab {...tabProps} />}
        {tab === "reports" && <ReportingTab {...tabProps} />}
        {tab === "economics" && (
          <EconomicsTab {...tabProps} onOpenTab={selectTab} />
        )}
        {tab === "closing" && <ClosingTab {...tabProps} />}
        {tab === "ic" && <IcTab {...tabProps} />}
        {tab === "screen" && <ScreenTab {...tabProps} />}
      </div>
    </div>
  );
}
