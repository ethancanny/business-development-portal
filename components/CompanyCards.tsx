"use client";

/**
 * Company profile cards (Phase 1, Oct 21, 2026 — workstream C).
 *
 * Renders the CompanyCard[] shape served by GET /api/platform/overview
 * (summary payload) or GET /api/platform/companies?limit=24 (standalone).
 * PlatformOverview owns the one fetch + filter state and passes filtered
 * cards in; used standalone (no `cards` prop) this component fetches the
 * list endpoint itself, once on mount — no polling (PROJECT_RULES).
 *
 * Defensive by contract: while the Neon DB is down the fetch fails and
 * the grid degrades to a clean empty/error state, never a crash.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { EmptyState, SkeletonRows } from "@/components/ui";
import { fmtRelTime } from "@/lib/format";

export type CompanyStageGroup = "pipeline" | "diligence" | "portfolio";
export type RagStatus = "green" | "amber" | "red";

export interface CompanyCard {
  id: string;
  name: string;
  vertical: string | null;
  stage: CompanyStageGroup;
  dealStage: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  thesisFit: string | null;
  ownerContext: string | null;
  nextAction: string | null;
  lastActivityAt: string | null;
  rag: RagStatus | null;
  logoUrl: string | null;
  heroUrl: string | null;
}

export interface CompanyCardFilters {
  stage: "all" | CompanyStageGroup;
  vertical: string; // "all" or a vertical name
  query: string; // operator / free-text match across name, city, owner context, next action
}

export const STAGE_GROUP_LABELS: Record<CompanyStageGroup, string> = {
  pipeline: "Pipeline",
  diligence: "Diligence",
  portfolio: "Portfolio",
};

export const RAG_DOT: Record<RagStatus, string> = {
  green: "bg-green-500",
  amber: "bg-amber-400",
  red: "bg-red-500",
};

export function ragDot(rag: RagStatus | null | undefined) {
  if (!rag) return null;
  return (
    <span
      aria-label={`RAG ${rag}`}
      title={`RAG: ${rag}`}
      className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${RAG_DOT[rag]}`}
    />
  );
}

export function applyCardFilters(
  cards: CompanyCard[],
  filters: CompanyCardFilters,
): CompanyCard[] {
  const q = filters.query.trim().toLowerCase();
  return cards.filter((c) => {
    if (filters.stage !== "all" && c.stage !== filters.stage) return false;
    if (filters.vertical !== "all" && (c.vertical ?? "") !== filters.vertical)
      return false;
    if (q) {
      const hay = [c.name, c.city, c.state, c.vertical, c.ownerContext, c.nextAction]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function CardShell({ card }: { card: CompanyCard }) {
  const initial = (card.name || "?").trim().charAt(0).toUpperCase();
  const place = [card.city, card.state].filter(Boolean).join(", ");
  return (
    <article className="card-surface card-hover flex flex-col overflow-hidden">
      {/* Hero: uploaded banner, else the navy brand gradient with the
          company's serif initial (no stock/AI imagery per PROJECT_RULES). */}
      <div className="relative h-28 w-full shrink-0 overflow-hidden bg-[#0d1f3c]">
        {card.heroUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={card.heroUrl}
            alt=""
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex h-full w-full items-center justify-center"
            style={{
              background:
                "radial-gradient(120% 140% at 20% 0%, #1d3a63 0%, #0d1f3c 55%, #081426 100%)",
            }}
          >
            <span className="font-display text-6xl font-semibold text-white/25">
              {initial}
            </span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/35 to-transparent" />
        <div className="absolute bottom-2 left-3 flex items-center gap-1.5">
          <span className="badge bg-white/90 text-[#0d1f3c]">
            {STAGE_GROUP_LABELS[card.stage] ?? card.stage}
          </span>
          {card.dealStage && (
            <span className="badge bg-black/45 text-white">{card.dealStage}</span>
          )}
        </div>
        {card.stage === "portfolio" && card.rag && (
          <div className="absolute right-3 top-2.5 rounded-full bg-black/40 p-1">
            {ragDot(card.rag)}
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start gap-3">
          {card.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={card.logoUrl}
              alt=""
              loading="lazy"
              className="h-10 w-10 shrink-0 rounded-lg object-contain ring-1 ring-slate-200 dark:ring-white/10"
            />
          ) : (
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0d1f3c] font-display text-lg font-semibold text-[#b8975a]"
            >
              {initial}
            </span>
          )}
          <div className="min-w-0">
            <Link
              href={`/companies/${card.id}`}
              className="block truncate font-display text-lg font-semibold leading-snug text-navy-900 hover:text-gold-700 dark:text-white dark:hover:text-gold-400"
            >
              {card.name}
            </Link>
            <p className="truncate text-xs text-caption">
              {[card.vertical, place].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        </div>

        {card.thesisFit && (
          <p className="mt-3 text-sm leading-snug text-slate-700 dark:text-white/80">
            {card.thesisFit}
          </p>
        )}
        {card.ownerContext && (
          <p className="mt-1.5 text-xs leading-snug text-caption">
            {card.ownerContext}
          </p>
        )}

        <div className="mt-auto pt-3">
          {/* Key financials land with the Phase 4 financials module. */}
          <p className="text-xs font-medium text-caption">
            Financials <span className="text-slate-400 dark:text-white/35">— Phase 4</span>
          </p>
          {card.nextAction && (
            <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-[#0d1f3c] dark:text-gold-300">
              <span aria-hidden className="mt-0.5 text-[#b8975a]">→</span>
              <span className="min-w-0">{card.nextAction}</span>
            </p>
          )}
          {card.lastActivityAt && (
            <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/35">
              Last activity {fmtRelTime(card.lastActivityAt)}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

export default function CompanyCards({
  cards,
  filters,
}: {
  /** When provided, the parent owns fetching + (optionally) filtering. */
  cards?: CompanyCard[];
  filters?: CompanyCardFilters;
}) {
  const standalone = cards === undefined;
  const [fetched, setFetched] = useState<CompanyCard[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!standalone) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/companies?limit=24");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: unknown = await res.json();
        if (cancelled) return;
        const list: unknown = Array.isArray(data)
          ? data
          : ((data as { cards?: unknown; companies?: unknown })?.cards ??
            (data as { companies?: unknown })?.companies);
        setFetched(Array.isArray(list) ? (list as CompanyCard[]) : []);
      } catch {
        if (!cancelled) setLoadFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [standalone]);

  const source = standalone ? fetched : (cards ?? []);
  const visible = filters && source ? applyCardFilters(source, filters) : source;

  if (standalone && loadFailed) {
    return (
      <EmptyState
        title="Companies unavailable"
        message="The company list could not be loaded — the database may be unavailable. Try again in a moment."
      />
    );
  }
  if (visible === null) {
    return <SkeletonRows rows={3} />;
  }
  if (visible.length === 0) {
    return (
      <EmptyState
        title="No companies to show"
        message={
          filters
            ? "No companies match the current filters."
            : "Companies will appear here as deals and portfolio holdings are added."
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {visible.map((card) => (
        <CardShell key={card.id} card={card} />
      ))}
    </div>
  );
}
