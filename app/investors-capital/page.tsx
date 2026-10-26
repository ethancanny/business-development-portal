"use client";

/**
 * Investors & Capital index (Step 1 redesign, Oct 25, 2026) — the
 * page is built around capital raises: a clickable summary strip,
 * type chips that filter everything below, then Raises (Cards /
 * Table / Timeline), the cross-raise Matching matrix, and the
 * Action Center. The Investors list and Investor Pipeline that used
 * to live here are REMOVED — investors live only in the Directory
 * (the header keeps an "Add investor" shortcut into it). All figures
 * come from the pre-aggregated /api/platform/capital endpoints;
 * nothing is recomputed on load.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PageHero from "@/components/PageHero";
import { loadDataset } from "@/lib/client/datasets";
import { CardSkeleton, ErrorState } from "@/components/ui";
import { GenerateDocumentButton } from "@/components/docgen/GenerateDocument";
import SummaryStrip from "@/components/capital/home/SummaryStrip";
import RaiseViews from "@/components/capital/home/RaiseViews";
import MatchingSection from "@/components/capital/home/MatchingSection";
import ActionCenter from "@/components/capital/home/ActionCenter";
import NewRaiseDialog from "@/components/capital/home/NewRaiseDialog";
import {
  API,
  api,
  fmtMoneyCompact,
  listFrom,
} from "@/components/capital/types";
import {
  hasOpenRaise,
  isPassed,
  type CapitalSummaryData,
  type ExtCapitalDeal,
} from "@/components/capital/home/shared";

export default function InvestorsCapitalPage() {
  const router = useRouter();
  const [deals, setDeals] = useState<ExtCapitalDeal[]>([]);
  const [dealsLoading, setDealsLoading] = useState(true);
  const [dealsError, setDealsError] = useState(false);
  const [summary, setSummary] = useState<CapitalSummaryData | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [type, setType] = useState("all");
  const [showTestData, setShowTestData] = useState(false);
  const [newRaiseOpen, setNewRaiseOpen] = useState(false);
  const [startingDealId, setStartingDealId] = useState<string | null>(null);
  const [startError, setStartError] = useState("");

  const loadDeals = useCallback(async () => {
    setDealsLoading(true);
    setDealsError(false);
    try {
      // Version-gated (Performance Fix Pass): an unchanged capital
      // dataset returns the cached payload object, so listFrom hands
      // back the same array reference and React bails on the setState.
      const r = await loadDataset<Record<string, unknown>>(
        "capital",
        `${API}/deals`
      );
      if (r.data) {
        setDeals(listFrom<ExtCapitalDeal>(r.data, "items", "deals"));
      } else {
        setDealsError(true);
      }
    } catch {
      setDealsError(true);
    } finally {
      setDealsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadDeals();
  }, [loadDeals]);

  useEffect(() => {
    let cancelled = false;
    setSummaryLoading(true);
    (async () => {
      try {
        // Version-gated under the shared "capital" dataset: switching
        // type re-keys by URL, and an unchanged type returns the same
        // payload object (setState bails on the identical reference).
        const r = await loadDataset<CapitalSummaryData>(
          "capital",
          `${API}/summary?type=${encodeURIComponent(type)}`
        );
        if (!cancelled) setSummary(r.data ?? null);
      } catch {
        if (!cancelled) setSummary(null);
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [type]);

  /* Type chips come from the configured types on the summary
   * payload (labels from config — never hardcoded). Disabled types
   * show only when they actually have raises. */
  const typeChips = useMemo(() => {
    const byType = new Map((summary?.byType ?? []).map((t) => [t.typeKey, t]));
    const chips: Array<{
      key: string;
      label: string;
      raiseCount: number;
      target: number;
    }> = [];
    for (const t of summary?.types ?? []) {
      const agg = byType.get(t.key);
      const raiseCount = agg?.raiseCount ?? 0;
      if (!t.enabled && raiseCount === 0) continue;
      chips.push({
        key: t.key,
        label: t.label,
        raiseCount,
        target: agg?.target ?? 0,
      });
    }
    return chips;
  }, [summary]);

  const allRaiseCount = useMemo(
    () => (summary?.byType ?? []).reduce((n, t) => n + t.raiseCount, 0),
    [summary]
  );
  const allTarget = useMemo(() => {
    if (type === "all" && summary) return summary.target;
    return (summary?.byType ?? []).reduce((n, t) => n + t.target, 0);
  }, [summary, type]);

  const typeFiltered = useMemo(
    () =>
      type === "all"
        ? deals
        : deals.filter((d) => d.investmentType?.key === type),
    [deals, type]
  );

  const visible = useMemo(
    () =>
      showTestData
        ? typeFiltered
        : typeFiltered.filter((d) => !d.isTestData && !isPassed(d)),
    [typeFiltered, showTestData]
  );

  const raises = useMemo(() => visible.filter(hasOpenRaise), [visible]);
  const dealsWithoutRaise = useMemo(
    () => visible.filter((d) => !hasOpenRaise(d)),
    [visible]
  );
  /* The New raise picker offers every deal without an open raise,
   * regardless of the Passed/test-data visibility toggle. */
  const newRaiseCandidates = useMemo(
    () => typeFiltered.filter((d) => !hasOpenRaise(d)),
    [typeFiltered]
  );

  const startRaise = useCallback(
    async (deal: ExtCapitalDeal) => {
      if (startingDealId) return;
      setStartingDealId(deal.dealId);
      setStartError("");
      try {
        await api(`${API}/deals/${encodeURIComponent(deal.dealId)}/raise`, {
          method: "POST",
          body: JSON.stringify({ targetRaise: 0 }),
        });
        router.push(`/investors-capital/${encodeURIComponent(deal.dealId)}`);
      } catch {
        setStartError(
          `Could not start a raise for ${deal.dealName || deal.companyName || "that deal"}. It may already have an open raise.`
        );
        setStartingDealId(null);
      }
    },
    [router, startingDealId]
  );

  return (
    <div>
      <PageHero
        eyebrow="Platform"
        title="Investors & Capital"
        subtitle="Capital raises, cross-raise matching and what needs action — investors live in the Directory"
      />
      <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setNewRaiseOpen(true)}
            className="btn btn-primary btn-sm min-h-[44px]"
          >
            + New raise
          </button>
          <GenerateDocumentButton
            scope="investor"
            label="Generate contract"
            className="btn btn-secondary btn-sm min-h-[44px]"
          />
          <Link
            href="/directory?action=add-investor&view=investors"
            className="btn btn-secondary btn-sm min-h-[44px]"
          >
            Add investor
          </Link>
        </div>

        <div className="mt-5">
          <SummaryStrip summary={summary} loading={summaryLoading} />
        </div>

        {/* Type chips */}
        <div className="mt-5 flex flex-wrap gap-1.5" role="group" aria-label="Filter by investment type">
          <button
            type="button"
            aria-pressed={type === "all"}
            onClick={() => setType("all")}
            className={`chip min-h-[44px] ${type === "all" ? "chip-active" : ""}`}
          >
            All
            <span className="opacity-70">
              {allRaiseCount} · {fmtMoneyCompact(allTarget)}
            </span>
          </button>
          {typeChips.map((c) => (
            <button
              key={c.key}
              type="button"
              aria-pressed={type === c.key}
              onClick={() => setType(c.key)}
              className={`chip min-h-[44px] ${type === c.key ? "chip-active" : ""}`}
            >
              {c.label}
              <span className="opacity-70">
                {c.raiseCount} · {fmtMoneyCompact(c.target)}
              </span>
            </button>
          ))}
        </div>

        {/* Sticky section bar */}
        <nav
          aria-label="Page sections"
          className="sticky top-0 z-20 -mx-4 mt-6 border-y border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-white/10 dark:bg-[#0b1526]/90 sm:-mx-6 sm:px-6"
        >
          <div className="flex gap-1 overflow-x-auto py-2">
            {[
              { id: "raises", label: "Raises" },
              { id: "matching", label: "Matching" },
              { id: "action-center", label: "Action Center" },
            ].map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="chip min-h-[44px] shrink-0"
              >
                {s.label}
              </a>
            ))}
          </div>
        </nav>

        <section id="raises" aria-label="Raises" className="mt-6 scroll-mt-24">
          <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
            Raises
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            Open a raise for its investor book, matching, documents, reports, economics and
            closing.
          </p>
          {startError && (
            <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">
              {startError}
            </p>
          )}
          <div className="mt-4">
            {dealsLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
                {Array.from({ length: 6 }).map((_, i) => (
                  <CardSkeleton key={i} lines={3} />
                ))}
              </div>
            ) : dealsError ? (
              <ErrorState onRetry={() => void loadDeals()} />
            ) : (
              <RaiseViews
                raises={raises}
                dealsWithoutRaise={dealsWithoutRaise}
                showTestData={showTestData}
                onShowTestDataChange={setShowTestData}
                onStartRaise={(deal) => void startRaise(deal)}
                startingDealId={startingDealId}
              />
            )}
          </div>
        </section>

        <section id="matching" aria-label="Matching" className="mt-10 scroll-mt-24">
          <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
            Matching
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            Who is in which raise, each investor&apos;s exposure and capacity, and the top
            suggested matches per raise.
          </p>
          <div className="mt-4">
            <MatchingSection typeKey={type} typeOptions={summary?.types ?? []} />
          </div>
        </section>

        <section id="action-center" aria-label="Action Center" className="mt-10 scroll-mt-24">
          <h2 className="font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">
            Action Center
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            Stale touches, unsigned documents, unfunded commitments, upcoming closings and
            raises behind target.
          </p>
          <div className="mt-4">
            <ActionCenter typeKey={type} />
          </div>
        </section>
      </div>

      <NewRaiseDialog
        open={newRaiseOpen}
        candidates={newRaiseCandidates}
        onClose={() => setNewRaiseOpen(false)}
      />
    </div>
  );
}
