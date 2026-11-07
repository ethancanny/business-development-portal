"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Data hygiene (Nov 7, 2026): the portal does not store anything that
 * has been cleared, dismissed, or deleted, and it does not keep data
 * from retired sources. Dismiss/delete actions are final on their own
 * now; this card runs the same purge on demand for anything left over
 * from before the rule (retired macro datasets, soft-deleted records,
 * dismissed companies) and shows exactly what was removed.
 */

interface Status {
  indicatorsMacro: number;
  warnRows: number;
  acquisitionsRetired: number;
  newsDismissed: number;
  syncLogOld: number;
  syncLogTotal: number;
  companiesDismissedRows: number;
  directoryPeople: number;
  directoryOrganizations: number;
  interactionsDeleted: number;
  platformCompanies: number;
  dealFlowDismissed: number;
  blocklistTotal: number;
}

interface PurgeResult {
  ranAt: string;
  counts: Record<string, number>;
  errors: Record<string, string>;
}

const ROWS: { key: keyof Status; label: string }[] = [
  { key: "indicatorsMacro", label: "Retired macro indicator series (FRED, BLS, Census, commodity spot, EBRC)" },
  { key: "warnRows", label: "WARN layoff notices (retired source)" },
  { key: "acquisitionsRetired", label: "Retired economic-event and bankruptcy rows" },
  { key: "newsDismissed", label: "Dismissed news stories" },
  { key: "companiesDismissedRows", label: "Dismissed companies (full records)" },
  { key: "directoryPeople", label: "Deleted Directory people" },
  { key: "directoryOrganizations", label: "Deleted Directory organizations" },
  { key: "interactionsDeleted", label: "Deleted CRM interactions" },
  { key: "platformCompanies", label: "Deleted platform companies" },
  { key: "dealFlowDismissed", label: "Dismissed Deal Flow items" },
  { key: "syncLogOld", label: "Sync log rows older than 30 days" },
];

export default function DataHygieneSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<PurgeResult | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/retention");
      if (!res.ok) throw new Error(`Status check failed (${res.status})`);
      setStatus((await res.json()) as Status);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/retention", { method: "POST" });
      if (!res.ok) throw new Error(`Purge failed (${res.status})`);
      setResult((await res.json()) as PurgeResult);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const total = status
    ? ROWS.reduce((sum, r) => sum + (status[r.key] ?? 0), 0)
    : 0;
  const removedTotal = result
    ? Object.values(result.counts).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div>
      <p className="mb-4 text-sm text-slate-500 dark:text-white/50">
        The portal does not keep cleared, dismissed, or deleted records,
        or data from retired sources. Dismissing and deleting are final
        when they happen; this purge clears anything left from before
        that rule and prunes the sync log to 30 days. Dismissed
        companies leave only a slim never-resurface tombstone (name,
        website domain, ID) so an import can never bring them back.
        Deal attachments are never touched.
      </p>

      {error && (
        <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <div className="skel h-10" />
          <div className="skel h-10" />
          <span className="sr-only">Loading data hygiene status…</span>
        </div>
      ) : status ? (
        <>
          <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-white/10 dark:border-white/10">
            {ROWS.map((r) => (
              <li
                key={r.key}
                className="flex items-start justify-between gap-4 px-4 py-3"
              >
                <span className="text-sm text-slate-600 dark:text-white/70">
                  {r.label}
                </span>
                <span className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                  {status[r.key] ?? 0}
                </span>
              </li>
            ))}
            <li className="flex items-start justify-between gap-4 px-4 py-3">
              <span className="text-sm text-slate-600 dark:text-white/70">
                Companies on the never-resurface blocklist (kept)
              </span>
              <span className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                {status.blocklistTotal}
              </span>
            </li>
          </ul>

          <div className="mt-4 flex items-center gap-3">
            <button
              type="button"
              onClick={run}
              disabled={running || total === 0}
              className="rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#16294d] disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-[#0d1f3c] dark:hover:bg-white/85"
            >
              {running ? "Purging…" : total === 0 ? "Nothing to purge" : `Purge ${total} stored items`}
            </button>
            {total === 0 && (
              <span className="text-sm text-emerald-600 dark:text-emerald-300">
                Storage is clean.
              </span>
            )}
          </div>

          {result && (
            <div className="mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              Purge ran at {new Date(result.ranAt).toLocaleString()} —{" "}
              {removedTotal} items removed
              {result.counts.companiesTombstones
                ? `, ${result.counts.companiesTombstones} company tombstones recorded`
                : ""}
              .
              {Object.keys(result.errors).length > 0 && (
                <span className="mt-1 block text-red-700 dark:text-red-300">
                  Steps that failed:{" "}
                  {Object.entries(result.errors)
                    .map(([k, v]) => `${k} (${v})`)
                    .join("; ")}
                </span>
              )}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
