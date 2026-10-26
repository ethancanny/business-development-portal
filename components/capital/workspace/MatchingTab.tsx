"use client";

/**
 * Matching tab (redesign Step 1) — ranked Directory investors for
 * this deal from GET …/deals/[dealId]/matching, fetched ONLY when
 * this tab opens (the shell mounts tabs on selection). Score bar +
 * number, plain-English reasons with ✓ matched (green) / ✗ missed
 * (red) / ◐ partial (amber), the scoring weights as returned, and
 * one-click [Add to raise] / [Log outreach] (POST …/investors/
 * [personId]/touch).
 */

import { useCallback, useEffect, useState } from "react";
import { ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  api,
  cardCls,
  type CapitalTabProps,
} from "@/components/capital/types";
import {
  createCommitment,
} from "@/components/capital/workspace/shared";

interface MatchReason {
  criterion: string;
  matched: boolean;
  partial?: boolean;
  text: string;
}

interface MatchItem {
  personId: string;
  name: string;
  firm: string;
  score: number;
  inRaise: boolean;
  reasons: MatchReason[];
}

interface MatchingData {
  items: MatchItem[];
  weights: unknown;
}

const WEIGHT_LABELS: Record<string, string> = {
  type: "Type",
  investmentType: "Type",
  checkSize: "Check size",
  check_size: "Check size",
  sector: "Sector",
  structure: "Structure",
  geography: "Geography",
  activity: "Activity",
};

function weightsLine(weights: unknown): string {
  if (weights && typeof weights === "object" && !Array.isArray(weights)) {
    const parts = Object.entries(weights as Record<string, unknown>)
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => `${WEIGHT_LABELS[k] ?? k} ${v as number}`);
    if (parts.length > 0) return `${parts.join(" · ")} — edit in Settings`;
  }
  if (Array.isArray(weights)) {
    const parts = weights
      .map((w) => {
        const rec = (w ?? {}) as Record<string, unknown>;
        const label = String(rec.label ?? rec.criterion ?? rec.key ?? "");
        const val = rec.weight ?? rec.value;
        return label && typeof val === "number" ? `${label} ${val}` : "";
      })
      .filter(Boolean);
    if (parts.length > 0) return `${parts.join(" · ")} — edit in Settings`;
  }
  return "Scoring weights are configured in Settings.";
}

export default function MatchingTab({ dealId, refreshSummary }: CapitalTabProps) {
  const [data, setData] = useState<MatchingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [added, setAdded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<MatchingData>(
        `${API}/deals/${encodeURIComponent(dealId)}/matching`
      );
      setData({ items: Array.isArray(d.items) ? d.items : [], weights: d.weights });
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const addToRaise = async (item: MatchItem) => {
    setBusyId(item.personId);
    setError("");
    setNotice("");
    try {
      await createCommitment(dealId, {
        investorPersonId: item.personId,
        pipelineStage: "prospect",
        stage: "indicated",
        kind: "soft",
        amount: 0,
      });
      setAdded((s) => new Set(s).add(item.personId));
      refreshSummary?.();
    } catch {
      setError(`Could not add ${item.name} to the raise.`);
    } finally {
      setBusyId("");
    }
  };

  const logOutreach = async (item: MatchItem) => {
    setBusyId(item.personId);
    setError("");
    setNotice("");
    try {
      await api(`${API}/investors/${encodeURIComponent(item.personId)}/touch`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      setNotice(`Outreach logged for ${item.name} — last touch is now today.`);
    } catch {
      setError(`Could not log outreach for ${item.name} — the touch endpoint did not accept it.`);
    } finally {
      setBusyId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !data) {
    return (
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Matching unavailable</h3>
        <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
          The matching endpoint for this deal did not return a ranked list, so no scores are shown rather than estimated ones.
        </p>
        <div className="mt-4">
          <ErrorState onRetry={() => void load()} />
        </div>
      </div>
    );
  }

  const scorePct = (s: number) => Math.max(0, Math.min(100, s <= 1 ? s * 100 : s));

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}
      {notice && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">{notice}</p>
      )}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Suggested matches for this deal</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-white/50">{weightsLine(data.weights)}</p>
        {data.items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-white/50">
            No ranked matches returned for this deal yet. Matches are scored from investors&apos; capital profiles in the Directory.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {data.items.map((item) => {
              const pct = scorePct(item.score);
              const isIn = item.inRaise || added.has(item.personId);
              return (
                <li key={item.personId} className="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">{item.name}</span>
                      {item.firm && <span className="block text-xs text-slate-500 dark:text-white/50">{item.firm}</span>}
                    </span>
                    <span className="tnum font-display text-2xl font-semibold text-[#0d1f3c] dark:text-white">{Math.round(pct)}</span>
                    <span className="flex gap-2">
                      {!isIn && (
                        <button type="button" className="btn btn-primary btn-sm min-h-[44px]" disabled={busyId === item.personId} onClick={() => void addToRaise(item)}>
                          Add to raise
                        </button>
                      )}
                      {isIn && <span className="badge badge-fit">In raise</span>}
                      <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" disabled={busyId === item.personId} onClick={() => void logOutreach(item)}>
                        Log outreach
                      </button>
                    </span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10" aria-label={`Match score ${Math.round(pct)}`}>
                    <div className="h-full rounded-full bg-gradient-to-r from-[#b8975a] to-[#d4b37a]" style={{ width: `${pct}%` }} />
                  </div>
                  {(item.reasons ?? []).length > 0 && (
                    <ul className="mt-3 space-y-1">
                      {item.reasons.map((r, i) => {
                        const state = r.matched ? "matched" : r.partial ? "partial" : "missed";
                        return (
                          <li key={i} className={`flex items-start gap-2 text-sm ${state === "matched" ? "text-emerald-700 dark:text-emerald-300" : state === "partial" ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"}`}>
                            <span aria-hidden className="font-bold">{state === "matched" ? "✓" : state === "partial" ? "◐" : "✗"}</span>
                            <span>
                              <span className="font-semibold">{r.criterion}: </span>
                              {r.text}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
