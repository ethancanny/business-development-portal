"use client";

/**
 * Settings → Duplicate detection & merge (Phase 1): candidate
 * duplicate pairs from GET /api/platform/duplicates?kind=, for
 * companies or people. Merge keeps A and folds B into it
 * (POST {kind, keepId, mergeId}) after an explicit confirm().
 * Failure renders a clean error state — never a crash.
 */

import { useCallback, useEffect, useState } from "react";
import { ErrorState, SkeletonRows } from "@/components/ui";

interface Pair {
  aId: string;
  aName: string;
  bId: string;
  bName: string;
  reason?: string;
  score?: number;
}

type Kind = "company" | "person";

function scoreLabel(score?: number): string {
  if (typeof score !== "number" || !Number.isFinite(score)) return "";
  if (score <= 1) return `${Math.round(score * 100)}% match`;
  return `Score ${score}`;
}

export default function DuplicatesPanel() {
  const [kind, setKind] = useState<Kind>("company");
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(
        `/api/platform/duplicates?kind=${encodeURIComponent(kind)}`
      );
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      const d = (await r.json()) as { pairs?: Pair[] };
      setPairs(Array.isArray(d.pairs) ? d.pairs : []);
    } catch {
      setError(
        "Duplicate pairs couldn't be loaded. The platform API or database may be unavailable."
      );
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    load();
  }, [load]);

  const merge = async (pair: Pair) => {
    const ok = window.confirm(
      `Merge "${pair.bName}" into "${pair.aName}"? The merged record keeps "${pair.aName}" and absorbs the other record's links. This cannot be undone from here.`
    );
    if (!ok) return;
    const key = `${pair.aId}-${pair.bId}`;
    setBusyKey(key);
    setActionError("");
    try {
      const r = await fetch("/api/platform/duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, keepId: pair.aId, mergeId: pair.bId }),
      });
      if (!r.ok) throw new Error(`Request failed (${r.status})`);
      await load();
    } catch {
      setActionError("That merge didn't go through — the records were left as-is.");
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {(
          [
            ["company", "Companies"],
            ["person", "People"],
          ] as [Kind, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={`chip ${kind === k ? "chip-active" : ""}`}
          >
            {label}
          </button>
        ))}
        <button onClick={load} className="btn btn-secondary btn-sm ml-auto">
          Refresh
        </button>
      </div>

      {actionError && (
        <p className="mb-3 text-xs text-red-600 dark:text-red-300">{actionError}</p>
      )}

      {loading ? (
        <SkeletonRows rows={3} />
      ) : error ? (
        <ErrorState title="Couldn't load duplicates" message={error} onRetry={load} />
      ) : pairs.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-white/40">
          No likely duplicates found for {kind === "company" ? "companies" : "people"}.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {pairs.map((pair) => {
            const key = `${pair.aId}-${pair.bId}`;
            return (
              <li key={key} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    {pair.aName}
                    <span className="mx-1.5 font-normal text-slate-400 dark:text-white/40">
                      vs
                    </span>
                    {pair.bName}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
                    {[pair.reason, scoreLabel(pair.score)]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <button
                  onClick={() => merge(pair)}
                  disabled={busyKey === key}
                  className="btn btn-secondary btn-sm shrink-0"
                >
                  {busyKey === key ? "Merging…" : "Merge"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
