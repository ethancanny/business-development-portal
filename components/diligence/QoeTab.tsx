"use client";

/**
 * QoE Workbench — quality-of-earnings adjustments.
 *
 * EBITDA and SDE are DISTINCT views and are never summed or blended
 * here: the EBITDA card bridges reported → adjusted; the SDE card
 * stands alone with its own basis note. Engine-suggested and manual
 * adjustments are decided (accept / reject) in place; accepted
 * amounts flow into the bridge on reload. Posting an adjusted draft
 * goes through the Phase 4 EBITDA gate — an override-required error
 * is surfaced verbatim.
 */

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  ApiError,
  api,
  cardCls,
  inputCls,
  labelCls,
  selectCls,
  tdCls,
  thCls,
  fmtMoney,
  fmtSignedMoney,
  ADJUSTMENT_KINDS,
  labelOf,
  type TabProps,
} from "@/components/diligence/types";

const MarginBridgeChart = dynamic(
  () =>
    import("@/components/FinancialAnalysisCharts").then(
      (m) => m.MarginBridgeChart
    ),
  { ssr: false }
);

interface EngineAdjustment {
  id: string;
  kind: string;
  label: string;
  amount: number | null;
  direction: string;
  rationale: string;
  requiresInput: string | null;
  status: string;
  decidedAmount: number | null;
  decidedBy: string | null;
  source: Record<string, unknown>;
}

interface ManualAdjustment {
  id: string;
  kind: string;
  label: string;
  amount: number | null;
  direction: string;
  rationale: string;
  status: string;
  decidedAmount: number | null;
  reportedSetId: string;
  adjustedSetId: string | null;
}

interface StatementSetLite {
  id: string;
  layer: string;
  status: string;
  version: number;
  periodStart: string | null;
  periodEnd: string | null;
  periodType: string;
  ebitdaOverrideNote: string;
}

interface QoeData {
  companyId: string;
  engineAdjustments: EngineAdjustment[];
  manualAdjustments: ManualAdjustment[];
  bridge: {
    reportedSetId: string;
    reportedEbitda: number | null;
    items: { label: string; amount: number }[];
    adjustedEbitda: number | null;
    adjustedSetId: string | null;
  } | null;
  ebitdaView: { reported: number | null; adjusted: number | null };
  sdeView: { value: number | null; ownerCompAddBacks: number; basis: string };
  reportedSets: StatementSetLite[];
  adjustedDrafts: StatementSetLite[];
  adjustedPosted: StatementSetLite[];
  analysisStatus: string | null;
}

function setLabel(s: StatementSetLite): string {
  const period = s.periodEnd
    ? ` · period ending ${s.periodEnd}`
    : s.periodStart
      ? ` · from ${s.periodStart}`
      : "";
  return `v${s.version} (${s.periodType})${period} — ${s.id.slice(0, 12)}…`;
}

function statusBadge(status: string) {
  const cls =
    status === "accepted"
      ? "badge-fit"
      : status === "rejected"
        ? "badge-danger"
        : "badge-warn";
  return <span className={`badge ${cls}`}>{status}</span>;
}

export default function QoeTab({
  workspaceId,
  view = "workbench",
}: TabProps & { view?: "workbench" | "analysis" }) {
  const [data, setData] = useState<QoeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  // Per-adjustment decision inputs (amount override / required input value).
  const [amountInputs, setAmountInputs] = useState<Record<string, string>>({});
  const [inputValues, setInputValues] = useState<Record<string, string>>({});

  // Manual adjustment form.
  const [manual, setManual] = useState({
    reportedSetId: "",
    kind: "other",
    label: "",
    amount: "",
    direction: "add",
    rationale: "",
  });
  const [creatingManual, setCreatingManual] = useState(false);

  // Post section.
  const [postSetId, setPostSetId] = useState("");
  const [posting, setPosting] = useState(false);
  const [postMsg, setPostMsg] = useState("");
  const [postError, setPostError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const d = await api<QoeData>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/qoe`
      );
      setData(d);
      setManual((m) => ({
        ...m,
        reportedSetId: m.reportedSetId || d.reportedSets[0]?.id || "",
      }));
      setPostSetId((cur) => cur || d.adjustedDrafts[0]?.id || "");
    } catch (err) {
      setLoadError(
        err instanceof ApiError && err.body.error === "company_required"
          ? "This deal has no company linked yet, so there are no financial statements to analyze."
          : "Could not load the QoE workbench. Please try again."
      );
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    const res = await api<Record<string, unknown>>(
      `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/qoe`,
      { method: "POST", body: JSON.stringify(body) }
    );
    return res;
  };

  const decideEngine = async (
    adj: EngineAdjustment,
    decision: "accept" | "reject"
  ) => {
    setBusyId(adj.id);
    setError("");
    try {
      const body: Record<string, unknown> = {
        action: "decide-engine",
        adjustmentId: adj.id,
        decision,
      };
      if (decision === "accept") {
        const amt = amountInputs[adj.id];
        if (amt !== undefined && amt.trim() !== "")
          body.amount = Number(amt);
        const iv = inputValues[adj.id];
        if (adj.requiresInput && iv !== undefined && iv.trim() !== "")
          body.inputValue = Number(iv);
      }
      await post(body);
      await load();
    } catch {
      setError(`Could not ${decision} “${adj.label}”. Please try again.`);
    } finally {
      setBusyId("");
    }
  };

  const decideManual = async (
    adj: ManualAdjustment,
    decision: "accept" | "reject"
  ) => {
    setBusyId(adj.id);
    setError("");
    try {
      const body: Record<string, unknown> = {
        action: "decide-manual",
        adjustmentId: adj.id,
        decision,
      };
      if (decision === "accept") {
        const amt = amountInputs[adj.id];
        if (amt !== undefined && amt.trim() !== "")
          body.amount = Number(amt);
      }
      await post(body);
      await load();
    } catch {
      setError(`Could not ${decision} “${adj.label}”. Please try again.`);
    } finally {
      setBusyId("");
    }
  };

  const createManual = async () => {
    if (!manual.label.trim() || !manual.reportedSetId || creatingManual) return;
    setCreatingManual(true);
    setError("");
    try {
      await post({
        action: "create-manual",
        reportedSetId: manual.reportedSetId,
        kind: manual.kind,
        label: manual.label.trim(),
        amount: manual.amount.trim() === "" ? undefined : Number(manual.amount),
        direction: manual.direction,
        rationale: manual.rationale.trim() || undefined,
      });
      setManual((m) => ({ ...m, label: "", amount: "", rationale: "" }));
      await load();
    } catch {
      setError("Could not add that manual adjustment. Please try again.");
    } finally {
      setCreatingManual(false);
    }
  };

  const postAdjusted = async () => {
    if (!postSetId || posting) return;
    setPosting(true);
    setPostMsg("");
    setPostError("");
    try {
      const res = await post({ action: "post", adjustedSetId: postSetId });
      const note =
        typeof res.overrideNote === "string" ? res.overrideNote : "";
      setPostMsg(
        `Adjusted set posted.${note ? ` Override note recorded: ${note}` : ""}`
      );
      await load();
    } catch (err) {
      if (err instanceof ApiError && err.body.error === "ebitda_override_required") {
        const stated = err.body.ebitdaStated;
        const computed = err.body.ebitdaComputed;
        const variance = err.body.ebitdaVariance;
        setPostError(
          `Posting blocked by the EBITDA gate: an override is required. ` +
            `Stated EBITDA ${typeof stated === "number" ? fmtMoney(stated) : "—"}, ` +
            `computed EBITDA ${typeof computed === "number" ? fmtMoney(computed) : "—"}, ` +
            `variance ${typeof variance === "number" ? fmtMoney(variance) : "—"}. ` +
            `Resolve the variance or record the override in Financials, then post again.`
        );
      } else if (err instanceof ApiError) {
        setPostError(`Posting failed (${err.message}). Please review the adjusted set and try again.`);
      } else {
        setPostError("Posting failed. Please try again.");
      }
    } finally {
      setPosting(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (!data) return <ErrorState message={loadError} onRetry={() => void load()} />;

  const bridge = data.bridge;

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {data.analysisStatus && (
        <p className="text-sm text-slate-500 dark:text-white/50">
          Financial analysis status: <strong>{data.analysisStatus}</strong>
        </p>
      )}

      {/* Financial Analysis view: statements, EBITDA / SDE views.
          The workbench view below holds adjustments + posting. Every
          control from the pre-redesign single tab lives in exactly
          one of the two views (redesign spec §2 mapping). */}
      {view === "analysis" && (
        <>
      {/* EBITDA view and SDE view — separate cards, never combined */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className={cardCls}>
          <p className="micro-label">EBITDA view</p>
          <div className="mt-3 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="text-xs text-slate-500 dark:text-white/50">Reported EBITDA</p>
              <p className="tnum font-display text-4xl font-semibold text-[#0d1f3c] dark:text-white">
                {fmtMoney(data.ebitdaView.reported)}
              </p>
            </div>
            <div aria-hidden className="pb-2 text-2xl text-[#b8975a]">→</div>
            <div>
              <p className="text-xs text-slate-500 dark:text-white/50">Adjusted EBITDA</p>
              <p className="tnum font-display text-4xl font-semibold text-[#b8975a]">
                {fmtMoney(data.ebitdaView.adjusted)}
              </p>
            </div>
          </div>
          {bridge && bridge.reportedEbitda !== null ? (
            <div className="mt-5">
              <MarginBridgeChart
                bridge={{
                  reportedEbitda: bridge.reportedEbitda,
                  items: bridge.items,
                  adjustedEbitda: bridge.adjustedEbitda,
                }}
              />
              <ul className="mt-2 space-y-1 text-sm">
                <li className="flex justify-between">
                  <span>Reported EBITDA</span>
                  <span className="tnum font-medium">{fmtMoney(bridge.reportedEbitda)}</span>
                </li>
                {bridge.items.map((item, i) => (
                  <li key={i} className="flex justify-between text-slate-600 dark:text-white/70">
                    <span>{item.label}</span>
                    <span className="tnum">{fmtSignedMoney(item.amount)}</span>
                  </li>
                ))}
                <li className="flex justify-between border-t border-slate-200 pt-1.5 font-semibold dark:border-white/10">
                  <span>Adjusted EBITDA</span>
                  <span className="tnum">{fmtMoney(bridge.adjustedEbitda)}</span>
                </li>
              </ul>
            </div>
          ) : (
            <p className="mt-4 text-sm text-slate-500 dark:text-white/50">
              No EBITDA bridge yet — run the financial analysis on this company
              to produce reported and adjusted EBITDA.
            </p>
          )}
        </div>

        <div className={`${cardCls} ring-1 ring-inset ring-[#b8975a]/50`}>
          <p className="micro-label">SDE view — shown separately</p>
          <p className="mt-3 text-xs text-slate-500 dark:text-white/50">
            Seller’s discretionary earnings
          </p>
          <p className="tnum font-display text-4xl font-semibold text-[#0d1f3c] dark:text-white">
            {fmtMoney(data.sdeView.value)}
          </p>
          <p className="mt-2 text-sm text-slate-600 dark:text-white/70">
            Owner-compensation add-backs included:{" "}
            <span className="tnum font-medium">{fmtMoney(data.sdeView.ownerCompAddBacks)}</span>
          </p>
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">{data.sdeView.basis}</p>
          <p className="mt-3 rounded-xl bg-[#b8975a]/10 px-3 py-2 text-xs text-[#0d1f3c] dark:text-white/80">
            SDE and EBITDA are different measures. They are displayed side by
            side for comparison only and are never added together.
          </p>
        </div>
      </div>
        </>
      )}

      {view === "workbench" && (
        <>
      {/* Engine adjustments */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Engine-suggested adjustments
        </h3>
        {data.engineAdjustments.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No engine adjustments — run the financial analysis to generate
            QoE suggestions.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={thCls}>Adjustment</th>
                  <th className={thCls}>Kind</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>Direction</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {data.engineAdjustments.map((adj) => (
                  <tr key={adj.id} className="border-b border-slate-100 align-top dark:border-white/5">
                    <td className={tdCls}>
                      <p className="font-medium">{adj.label}</p>
                      {adj.rationale && (
                        <p className="mt-0.5 max-w-md text-xs text-slate-500 dark:text-white/50">
                          {adj.rationale}
                        </p>
                      )}
                      {adj.status !== "proposed" && adj.decidedAmount !== null && (
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
                          Decided amount: {fmtMoney(adj.decidedAmount)}
                          {adj.decidedBy ? ` · by ${adj.decidedBy}` : ""}
                        </p>
                      )}
                    </td>
                    <td className={tdCls}>{labelOf(ADJUSTMENT_KINDS, adj.kind)}</td>
                    <td className={`${tdCls} tnum`}>{fmtMoney(adj.amount)}</td>
                    <td className={tdCls}>{adj.direction}</td>
                    <td className={tdCls}>{statusBadge(adj.status)}</td>
                    <td className={tdCls}>
                      {adj.status === "proposed" ? (
                        <div className="space-y-2">
                          {adj.requiresInput && (
                            <input
                              className={`${inputCls} w-44`}
                              type="number"
                              placeholder={`Input needed: ${adj.requiresInput}`}
                              value={inputValues[adj.id] ?? ""}
                              onChange={(e) =>
                                setInputValues((s) => ({ ...s, [adj.id]: e.target.value }))
                              }
                              aria-label={`Required input for ${adj.label}`}
                            />
                          )}
                          <input
                            className={`${inputCls} w-44`}
                            type="number"
                            placeholder="Amount override (optional)"
                            value={amountInputs[adj.id] ?? ""}
                            onChange={(e) =>
                              setAmountInputs((s) => ({ ...s, [adj.id]: e.target.value }))
                            }
                            aria-label={`Amount override for ${adj.label}`}
                          />
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={busyId === adj.id}
                              onClick={() => void decideEngine(adj, "accept")}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={busyId === adj.id}
                              onClick={() => void decideEngine(adj, "reject")}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-white/40">Decided</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual adjustments */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Manual adjustments
        </h3>
        {data.manualAdjustments.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No manual adjustments yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={thCls}>Adjustment</th>
                  <th className={thCls}>Kind</th>
                  <th className={thCls}>Amount</th>
                  <th className={thCls}>Direction</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Decision</th>
                </tr>
              </thead>
              <tbody>
                {data.manualAdjustments.map((adj) => (
                  <tr key={adj.id} className="border-b border-slate-100 align-top dark:border-white/5">
                    <td className={tdCls}>
                      <p className="font-medium">{adj.label}</p>
                      {adj.rationale && (
                        <p className="mt-0.5 max-w-md text-xs text-slate-500 dark:text-white/50">
                          {adj.rationale}
                        </p>
                      )}
                    </td>
                    <td className={tdCls}>{labelOf(ADJUSTMENT_KINDS, adj.kind)}</td>
                    <td className={`${tdCls} tnum`}>{fmtMoney(adj.amount)}</td>
                    <td className={tdCls}>{adj.direction}</td>
                    <td className={tdCls}>{statusBadge(adj.status)}</td>
                    <td className={tdCls}>
                      {adj.status === "proposed" ? (
                        <div className="space-y-2">
                          <input
                            className={`${inputCls} w-44`}
                            type="number"
                            placeholder="Amount override (optional)"
                            value={amountInputs[adj.id] ?? ""}
                            onChange={(e) =>
                              setAmountInputs((s) => ({ ...s, [adj.id]: e.target.value }))
                            }
                            aria-label={`Amount override for ${adj.label}`}
                          />
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm"
                              disabled={busyId === adj.id}
                              onClick={() => void decideManual(adj, "accept")}
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm"
                              disabled={busyId === adj.id}
                              onClick={() => void decideManual(adj, "reject")}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-white/40">
                          {adj.decidedAmount !== null
                            ? `Decided at ${fmtMoney(adj.decidedAmount)}`
                            : "Decided"}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
            Add a manual adjustment
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={labelCls}>Reported set</label>
              <select
                className={selectCls}
                value={manual.reportedSetId}
                onChange={(e) => setManual((m) => ({ ...m, reportedSetId: e.target.value }))}
              >
                <option value="">Select a reported set…</option>
                {data.reportedSets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {setLabel(s)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Kind</label>
              <select
                className={selectCls}
                value={manual.kind}
                onChange={(e) => setManual((m) => ({ ...m, kind: e.target.value }))}
              >
                {ADJUSTMENT_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Direction</label>
              <select
                className={selectCls}
                value={manual.direction}
                onChange={(e) => setManual((m) => ({ ...m, direction: e.target.value }))}
              >
                <option value="add">Add back</option>
                <option value="subtract">Subtract</option>
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Label</label>
              <input
                className={inputCls}
                placeholder="e.g. Owner salary above market"
                value={manual.label}
                onChange={(e) => setManual((m) => ({ ...m, label: e.target.value }))}
              />
            </div>
            <div>
              <label className={labelCls}>Amount (USD)</label>
              <input
                className={inputCls}
                type="number"
                placeholder="0"
                value={manual.amount}
                onChange={(e) => setManual((m) => ({ ...m, amount: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelCls}>Rationale</label>
              <input
                className={inputCls}
                placeholder="Why this adjustment belongs in adjusted EBITDA"
                value={manual.rationale}
                onChange={(e) => setManual((m) => ({ ...m, rationale: e.target.value }))}
              />
            </div>
          </div>
          <div className="mt-3">
            <Button
              onClick={() => void createManual()}
              loading={creatingManual}
              disabled={!manual.label.trim() || !manual.reportedSetId}
            >
              Add adjustment
            </Button>
          </div>
        </div>
      </div>

      {/* Post adjusted set */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Post adjusted set
        </h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
          Posting runs through the EBITDA gate: if the stated EBITDA on the
          adjusted set disagrees with the computed figure beyond tolerance, an
          override note naming the accepted adjustments is required and is
          recorded with the post.
        </p>
        {data.adjustedDrafts.length === 0 ? (
          <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
            No adjusted drafts available to post. Accepting adjustments creates
            the adjusted draft from the reported set.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <select
              className={`${selectCls} sm:flex-1`}
              value={postSetId}
              onChange={(e) => setPostSetId(e.target.value)}
              aria-label="Adjusted draft to post"
            >
              {data.adjustedDrafts.map((s) => (
                <option key={s.id} value={s.id}>
                  {setLabel(s)}
                </option>
              ))}
            </select>
            <Button onClick={() => void postAdjusted()} loading={posting} className="shrink-0">
              Post adjusted set
            </Button>
          </div>
        )}
        {postMsg && (
          <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
            {postMsg}
          </p>
        )}
        {postError && (
          <p className="mt-3 rounded-xl bg-red-500/10 px-4 py-2.5 text-sm text-red-700 dark:text-red-300">
            {postError}
          </p>
        )}
        {data.adjustedPosted.length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
              Posted adjusted sets
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-slate-600 dark:text-white/70">
              {data.adjustedPosted.map((s) => (
                <li key={s.id}>
                  {setLabel(s)}
                  {s.ebitdaOverrideNote
                    ? ` · override: ${s.ebitdaOverrideNote}`
                    : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
        {data.reportedSets.length === 0 && data.adjustedDrafts.length === 0 && (
          <div className="mt-4">
            <EmptyState
              title="No statement sets"
              message="Upload and post financial statements for this company to use the QoE workbench."
            />
          </div>
        )}
      </div>
        </>
      )}
    </div>
  );
}
