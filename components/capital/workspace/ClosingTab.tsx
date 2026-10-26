"use client";

/**
 * Closing tab (redesign Step 1) — closing checklist computed from
 * this deal's bundle + IC record, wire-instruction status per
 * investor, a per-investor funding tracker (hard vs funded), and
 * the key dates list.
 *
 * Calendar: no tab-level calendar-create service exists in the
 * portal (executed contracts and commitment key dates surface via
 * /api/calendar/platform-events, read-only) — so this tab is
 * list-only and says so; it does not invent a create call.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  api,
  cardCls,
  fmtDateShort,
  fmtMoneyN,
  selectCls,
  type CapitalTabProps,
  type IcData,
} from "@/components/capital/types";
import {
  WIRE_STATUSES,
  bucketAmount,
  docStatusOf,
  fetchBundle,
  labelOfSafe,
  pipelineStageOf,
  updateCommitment,
  wireStatusOf,
  type WorkspaceBundle,
} from "@/components/capital/workspace/shared";

export default function ClosingTab({ dealId, refreshSummary }: CapitalTabProps) {
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [ic, setIc] = useState<IcData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [b, icData] = await Promise.all([
        fetchBundle(dealId),
        api<IcData>(`${API}/deals/${encodeURIComponent(dealId)}/ic`).catch(() => null),
      ]);
      setBundle(b);
      setIc(icData);
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  const computed = useMemo(() => {
    if (!bundle) return null;
    const participants = bundle.commitments.filter(
      (c) => pipelineStageOf(c) !== "passed"
    );
    const filed = participants.filter((c) => docStatusOf(c) === "filed").length;
    const withHard = participants.filter((c) => bucketAmount(c, "hard") > 0);
    const allFunded =
      withHard.length > 0 &&
      withHard.every((c) => bucketAmount(c, "funded") >= bucketAmount(c, "hard"));
    const wireRelevant = participants.filter(
      (c) => bucketAmount(c, "hard") > 0 || bucketAmount(c, "funded") > 0
    );
    const wiresReceived =
      wireRelevant.length > 0 &&
      wireRelevant.every((c) => wireStatusOf(c) === "received");
    const target =
      bundle.summary?.targetRaise ?? bundle.raise?.targetRaise ?? 0;
    const hardTotal =
      bundle.summary?.hardTotal ??
      participants.reduce((s, c) => s + bucketAmount(c, "hard"), 0);
    const checklist: Array<{ label: string; done: boolean; detail: string }> = [
      {
        label: "IC decision recorded",
        done: (ic?.decisions ?? []).length > 0,
        detail:
          (ic?.decisions ?? []).length > 0
            ? `${ic!.decisions.length} decision${ic!.decisions.length === 1 ? "" : "s"} on record — latest ${fmtDateShort(ic!.decisions[0]?.decidedAt)}`
            : "No IC decision yet — record one in the IC tab",
      },
      {
        label: "Documents filed",
        done: participants.length > 0 && filed === participants.length,
        detail: `${filed} of ${participants.length} participants have doc status “filed” (statuses live on the commitment book / contracts register)`,
      },
      {
        label: "All hard commitments funded",
        done: allFunded,
        detail:
          withHard.length === 0
            ? "No hard commitments in the book yet"
            : `${withHard.filter((c) => bucketAmount(c, "funded") >= bucketAmount(c, "hard")).length} of ${withHard.length} hard commitments fully funded`,
      },
      {
        label: "Wire instructions received",
        done: wiresReceived,
        detail:
          wireRelevant.length === 0
            ? "No funded / hard investors to track wires for yet"
            : `${wireRelevant.filter((c) => wireStatusOf(c) === "received").length} of ${wireRelevant.length} wires received`,
      },
      {
        label: "Raise target covered by hard commitments",
        done: target > 0 && hardTotal >= target,
        detail:
          target > 0
            ? `Hard ${fmtMoneyN(hardTotal)} of ${fmtMoneyN(target)} target`
            : "No target set on this raise",
      },
    ];
    const keyDates: Array<{ label: string; date: string }> = [];
    if (bundle.raise?.nextMilestoneDate) {
      keyDates.push({
        label: bundle.raise.nextMilestone
          ? `Milestone — ${bundle.raise.nextMilestone}`
          : "Next milestone",
        date: bundle.raise.nextMilestoneDate,
      });
    }
    for (const c of bundle.commitments) {
      if (c.expectedFundingDate) {
        keyDates.push({
          label: `Expected funding — ${c.investorName || "Investor"}`,
          date: c.expectedFundingDate,
        });
      }
    }
    const dealRec = (bundle.deal ?? {}) as Record<string, unknown>;
    for (const [k, label] of [
      ["targetCloseDate", "Target close"],
      ["targetClose", "Target close"],
      ["closingDate", "Closing date"],
      ["closeDate", "Close date"],
    ] as const) {
      const v = dealRec[k];
      if (typeof v === "string" && v) keyDates.push({ label, date: v });
    }
    keyDates.sort((a, b) => a.date.localeCompare(b.date));
    return { participants, checklist, keyDates };
  }, [bundle, ic]);

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !bundle || !computed) return <ErrorState onRetry={() => void load()} />;

  const setWire = async (id: string, wireStatus: string) => {
    setBusyId(id);
    setError("");
    try {
      await updateCommitment(id, { wireStatus });
      await load();
      refreshSummary?.();
    } catch {
      setError("Could not save that wire status.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {/* Checklist */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Closing checklist</h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          Computed from this deal&apos;s bundle and IC record — nothing here is checked by hand.
        </p>
        <ul className="mt-3 space-y-2">
          {computed.checklist.map((item) => (
            <li key={item.label} className="flex items-start gap-3 rounded-xl border border-slate-100 px-3 py-2.5 dark:border-white/5">
              <span aria-hidden className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${item.done ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                {item.done ? "✓" : "…"}
              </span>
              <span>
                <span className="block text-sm font-semibold text-[#0d1f3c] dark:text-white">
                  {item.label} — {item.done ? "done" : "pending"}
                </span>
                <span className="block text-xs text-slate-500 dark:text-white/50">{item.detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Funding tracker + wires */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Funding tracker</h3>
        {computed.participants.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">No participants in this raise yet.</p>
        ) : (
          <ul className="mt-3 space-y-4">
            {computed.participants.map((c) => {
              const hard = bucketAmount(c, "hard");
              const funded = bucketAmount(c, "funded");
              const pct = hard > 0 ? Math.min(100, (funded / hard) * 100) : funded > 0 ? 100 : 0;
              return (
                <li key={c.id}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">{c.investorName || "Investor"}</span>
                      <span className="block text-xs text-slate-500 dark:text-white/50">
                        Hard {fmtMoneyN(hard)} · Funded {fmtMoneyN(funded)}
                        {hard > funded ? ` · ${fmtMoneyN(hard - funded)} outstanding` : hard > 0 ? " · fully funded" : ""}
                      </span>
                    </span>
                    <label className="sr-only" htmlFor={`wire-${c.id}`}>Wire status for {c.investorName}</label>
                    <select
                      id={`wire-${c.id}`}
                      className={`${selectCls} min-h-[44px] w-44`}
                      value={wireStatusOf(c)}
                      disabled={busyId === c.id}
                      onChange={(e) => void setWire(c.id, e.target.value)}
                    >
                      {WIRE_STATUSES.map((s) => (
                        <option key={s.key} value={s.key}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                    <div className="h-full rounded-full bg-gradient-to-r from-[#b8975a] to-[#d4b37a]" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-slate-400 dark:text-white/40">Wire: {labelOfSafe(WIRE_STATUSES, wireStatusOf(c))}</p>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Key dates */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Key dates</h3>
        {computed.keyDates.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No milestone, expected-funding, or target-close dates are recorded for this raise yet.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {computed.keyDates.map((d, i) => (
              <li key={`${d.label}-${i}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 text-sm dark:border-white/5">
                <span className="text-slate-600 dark:text-white/80">{d.label}</span>
                <span className="font-semibold text-[#0d1f3c] dark:text-white">{fmtDateShort(d.date)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400 dark:text-white/40">
          List only: there is no tab-level calendar-create service in the portal —
          executed-contract key dates and commitment dates surface on the Calendar
          through the platform-events feed, so dates recorded here and in the Book
          are what the Calendar reads.
        </p>
      </div>
    </div>
  );
}
