"use client";

/**
 * Due Diligence index (Phase 5) — every deal with its diligence
 * workspace status, checklist progress and red-flag counts. Deals
 * without a workspace get a "Start diligence" action that creates
 * the workspace (seeded server-side) and navigates into it.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import {
  api,
  cardCls,
  type DealIndexItem,
} from "@/components/diligence/types";

export default function DiligenceIndex() {
  const router = useRouter();
  const [items, setItems] = useState<DealIndexItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [startingId, setStartingId] = useState<string>("");
  const [startError, setStartError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await api<{ items: DealIndexItem[] }>(
        "/api/platform/diligence/deals"
      );
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const start = async (dealId: string) => {
    if (startingId) return;
    setStartingId(dealId);
    setStartError("");
    try {
      await api("/api/platform/diligence/workspaces", {
        method: "POST",
        body: JSON.stringify({ dealId }),
      });
      router.push(`/due-diligence/${encodeURIComponent(dealId)}`);
    } catch {
      setStartError("Could not start diligence for that deal. Please try again.");
      setStartingId("");
    }
  };

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <CardSkeleton key={i} lines={3} />
        ))}
      </div>
    );
  }
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (items.length === 0) {
    return (
      <EmptyState
        title="No deals yet"
        message="Deals in the pipeline will appear here so diligence can be started on them."
      />
    );
  }

  return (
    <div>
      {startError && (
        <p className="mb-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {startError}
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => {
          const { deal, workspace } = item;
          const pct =
            item.checklistTotal > 0
              ? Math.round((item.checklistDone / item.checklistTotal) * 100)
              : 0;
          return (
            <div key={deal.dealId} className={cardCls}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">
                    {deal.dealName || deal.companyName || "Untitled deal"}
                  </h3>
                  {deal.companyName && deal.companyName !== deal.dealName && (
                    <p className="truncate text-sm text-slate-500 dark:text-white/50">
                      {deal.companyName}
                    </p>
                  )}
                </div>
                {deal.stage && (
                  <span className="badge badge-neutral shrink-0">{deal.stage}</span>
                )}
              </div>

              {workspace ? (
                <>
                  <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                    Workspace · {workspace.status}
                  </p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="tnum font-display text-3xl font-semibold text-[#0d1f3c] dark:text-white">
                      {pct}%
                    </span>
                    <span className="text-sm text-slate-500 dark:text-white/50">
                      checklist · {item.checklistDone}/{item.checklistTotal} done
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-[#b8975a]"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    <span
                      className={`badge ${item.openRedFlags > 0 ? "badge-danger" : "badge-neutral"}`}
                    >
                      {item.openRedFlags} open red flag
                      {item.openRedFlags === 1 ? "" : "s"}
                    </span>
                    {item.candidateRedFlags > 0 && (
                      <span className="badge badge-warn">
                        {item.candidateRedFlags} candidate
                        {item.candidateRedFlags === 1 ? "" : "s"} to review
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Link
                      href={`/due-diligence/${encodeURIComponent(deal.dealId)}`}
                      className="btn btn-primary btn-sm"
                    >
                      Open workspace
                    </Link>
                    {item.roomId && (
                      <Link
                        href={`/data-rooms/${encodeURIComponent(item.roomId)}`}
                        className="btn btn-secondary btn-sm"
                      >
                        Data room
                      </Link>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
                    No diligence workspace yet. Starting one seeds the standard
                    checklist, scorecard, tax profile and process maps.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={startingId === deal.dealId}
                      onClick={() => void start(deal.dealId)}
                    >
                      {startingId === deal.dealId
                        ? "Starting…"
                        : "Start diligence"}
                    </button>
                    {item.roomId && (
                      <Link
                        href={`/data-rooms/${encodeURIComponent(item.roomId)}`}
                        className="btn btn-secondary btn-sm"
                      >
                        Data room
                      </Link>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
