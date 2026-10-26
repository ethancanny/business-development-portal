"use client";

/**
 * Investors tab (redesign Step 1) — this raise's investors as a
 * Kanban over the 8 pipeline stages, with a table view.
 *
 * Drag-and-drop: the codebase has no card dnd pattern (grep found
 * only a bookmarklet drag in ManualSourcesSettings), so per the
 * build rule no dnd dependency is added — stage moves go through
 * the stage select on each card / row, which PUTs pipelineStage
 * (PATCH on the existing commitment route, PUT fallback).
 *
 * Mobile: the columns collapse to a stage selector + card list;
 * the table view collapses to cards.
 *
 * "Add investor" opens a picker drawer over the Directory investor
 * list (GET …/investors?limit=200) with match scores joined from
 * the matching endpoint by personId, plus an add-new-person mini
 * form (POST …/investors creates the Directory record, then the
 * person is added to this raise as a prospect commitment).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  api,
  cardCls,
  fmtMoneyN,
  inputCls,
  labelCls,
  listFrom,
  selectCls,
  tdCls,
  thCls,
  type CapitalTabProps,
  type InvestorListItem,
} from "@/components/capital/types";
import {
  DOC_STATUSES,
  PIPELINE_STAGES,
  createCommitment,
  currentAmount,
  docBadge,
  docStatusOf,
  fetchBundle,
  legacyStageFor,
  pipelineStageOf,
  updateCommitment,
  type ExtCommitment,
  type WorkspaceBundle,
} from "@/components/capital/workspace/shared";

interface MatchItem {
  personId: string;
  score: number;
}

export default function InvestorsTab({ dealId, refreshSummary }: CapitalTabProps) {
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [view, setView] = useState<"kanban" | "table">("kanban");
  const [q, setQ] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [docFilter, setDocFilter] = useState("");
  const [mobileStage, setMobileStage] = useState("prospect");

  const [scores, setScores] = useState<Record<string, number>>({});

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItems, setPickerItems] = useState<InvestorListItem[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerQ, setPickerQ] = useState("");
  const [addingId, setAddingId] = useState("");
  const [newPerson, setNewPerson] = useState({ name: "", firm: "", email: "" });
  const [creatingPerson, setCreatingPerson] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      setBundle(await fetchBundle(dealId));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Match scores for the picker — best-effort join by personId.
  useEffect(() => {
    let live = true;
    api<{ items: MatchItem[] }>(`${API}/deals/${encodeURIComponent(dealId)}/matching`)
      .then((d) => {
        if (!live) return;
        const map: Record<string, number> = {};
        for (const it of Array.isArray(d.items) ? d.items : []) {
          if (it.personId) map[it.personId] = typeof it.score === "number" ? it.score : 0;
        }
        setScores(map);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [dealId]);

  const commitments = useMemo(() => bundle?.commitments ?? [], [bundle]);

  const owners = useMemo(
    () => Array.from(new Set(commitments.map((c) => c.owner || "").filter(Boolean))).sort(),
    [commitments]
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return commitments.filter((c) => {
      if (needle && !`${c.investorName} ${c.investorFirm}`.toLowerCase().includes(needle)) return false;
      if (ownerFilter && (c.owner || "") !== ownerFilter) return false;
      if (docFilter && docStatusOf(c) !== docFilter) return false;
      return true;
    });
  }, [commitments, q, ownerFilter, docFilter]);

  const moveStage = async (c: ExtCommitment, stage: string) => {
    setBusyId(c.id);
    setError("");
    try {
      await updateCommitment(c.id, { pipelineStage: stage, stage: legacyStageFor(stage) });
      await load();
      refreshSummary?.();
    } catch {
      setError("Could not move that investor. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    try {
      const data = await api<Record<string, unknown>>(`${API}/investors?limit=200`);
      setPickerItems(listFrom<InvestorListItem>(data, "items", "investors"));
    } catch {
      setPickerItems([]);
    } finally {
      setPickerLoading(false);
    }
  };

  const addToRaise = async (personId: string) => {
    setAddingId(personId);
    setError("");
    try {
      await createCommitment(dealId, {
        investorPersonId: personId,
        pipelineStage: "prospect",
        stage: "indicated",
        kind: "soft",
        amount: 0,
      });
      await load();
      refreshSummary?.();
    } catch {
      setError("Could not add that investor to the raise.");
    } finally {
      setAddingId("");
    }
  };

  const addNewPerson = async () => {
    if (!newPerson.name.trim() || creatingPerson) return;
    setCreatingPerson(true);
    setError("");
    try {
      const data = await api<Record<string, unknown>>(`${API}/investors`, {
        method: "POST",
        body: JSON.stringify({
          name: newPerson.name.trim(),
          firm: newPerson.firm.trim() || undefined,
          email: newPerson.email.trim() || undefined,
        }),
      });
      const personId =
        (typeof data.personId === "string" && data.personId) ||
        (typeof (data.investor as { personId?: unknown })?.personId === "string"
          ? ((data.investor as { personId: string }).personId as string)
          : "");
      if (!personId) throw new Error("no_person_id");
      setNewPerson({ name: "", firm: "", email: "" });
      await addToRaise(personId);
      setPickerOpen(false);
    } catch {
      setError("Could not create that person. Check the name and try again.");
    } finally {
      setCreatingPerson(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !bundle) return <ErrorState onRetry={() => void load()} />;

  const inRaise = new Set(commitments.map((c) => c.investorPersonId));
  const pickerFiltered = pickerItems.filter((inv) => {
    const needle = pickerQ.trim().toLowerCase();
    return !needle || `${inv.name} ${inv.firm} ${inv.email}`.toLowerCase().includes(needle);
  });

  const card = (c: ExtCommitment) => (
    <div key={c.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-white/5">
      <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{c.investorName || "Investor"}</p>
      {c.investorFirm && <p className="text-xs text-slate-500 dark:text-white/50">{c.investorFirm}</p>}
      <p className="tnum mt-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">{fmtMoneyN(currentAmount(c))}</p>
      <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className={`badge ${docBadge(docStatusOf(c))}`}>Doc: {docStatusOf(c)}</span>
        {c.owner && <span className="badge badge-neutral">{c.owner}</span>}
      </p>
      <label className={`${labelCls} mt-2`}>Stage</label>
      <select
        className={`${selectCls} min-h-[44px]`}
        value={pipelineStageOf(c)}
        disabled={busyId === c.id}
        onChange={(e) => void moveStage(c, e.target.value)}
        aria-label={`Stage for ${c.investorName}`}
      >
        {PIPELINE_STAGES.map((s) => (
          <option key={s.key} value={s.key}>{s.label}</option>
        ))}
      </select>
    </div>
  );

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px]">
              <label className={labelCls}>Search</label>
              <input className={`${inputCls} min-h-[44px]`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or firm…" />
            </div>
            <div>
              <label className={labelCls}>Owner</label>
              <select className={`${selectCls} min-h-[44px]`} value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)}>
                <option value="">All owners</option>
                {owners.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Doc status</label>
              <select className={`${selectCls} min-h-[44px]`} value={docFilter} onChange={(e) => setDocFilter(e.target.value)}>
                <option value="">All</option>
                {DOC_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <span className="flex overflow-hidden rounded-xl border border-slate-200 dark:border-white/10" role="group" aria-label="View">
              <button type="button" className={`min-h-[44px] px-3 text-sm font-semibold ${view === "kanban" ? "bg-[#0d1f3c] text-white" : "text-slate-500 dark:text-white/60"}`} onClick={() => setView("kanban")}>Kanban</button>
              <button type="button" className={`min-h-[44px] px-3 text-sm font-semibold ${view === "table" ? "bg-[#0d1f3c] text-white" : "text-slate-500 dark:text-white/60"}`} onClick={() => setView("table")}>Table</button>
            </span>
            <Button onClick={() => void openPicker()} className="min-h-[44px]">Add investor</Button>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No investors in this raise yet" message="Add investors from the Directory with the picker — each starts as a Prospect. Filters above may also be hiding rows." />
          </div>
        ) : view === "kanban" ? (
          <>
            {/* Mobile: stage selector + card list */}
            <div className="mt-4 md:hidden">
              <label className={labelCls}>Stage</label>
              <select className={`${selectCls} min-h-[44px]`} value={mobileStage} onChange={(e) => setMobileStage(e.target.value)}>
                {PIPELINE_STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label} ({filtered.filter((c) => pipelineStageOf(c) === s.key).length})
                  </option>
                ))}
              </select>
              <div className="mt-3 space-y-2">
                {filtered.filter((c) => pipelineStageOf(c) === mobileStage).map(card)}
                {filtered.filter((c) => pipelineStageOf(c) === mobileStage).length === 0 && (
                  <p className="text-sm text-slate-500 dark:text-white/50">No investors at this stage.</p>
                )}
              </div>
            </div>
            {/* Desktop columns */}
            <div className="mt-4 hidden gap-3 overflow-x-auto pb-2 md:grid md:grid-flow-col md:auto-cols-[230px]">
              {PIPELINE_STAGES.map((s) => {
                const col = filtered.filter((c) => pipelineStageOf(c) === s.key);
                return (
                  <div key={s.key} className="rounded-2xl bg-slate-50 p-2 dark:bg-white/5">
                    <p className="px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
                      {s.label} · {col.length}
                    </p>
                    <div className="space-y-2">{col.map(card)}</div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div className="mt-4 hidden overflow-x-auto md:block">
              <table className="w-full min-w-[720px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-white/5">
                    <th className={thCls}>Investor</th>
                    <th className={thCls}>Stage</th>
                    <th className={`${thCls} text-right`}>Amount</th>
                    <th className={thCls}>Doc status</th>
                    <th className={thCls}>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className={tdCls}>
                        <span className="font-semibold">{c.investorName}</span>
                        {c.investorFirm && <span className="block text-xs text-slate-500 dark:text-white/50">{c.investorFirm}</span>}
                      </td>
                      <td className={tdCls}>
                        <select className={`${selectCls} min-h-[44px] w-36`} value={pipelineStageOf(c)} disabled={busyId === c.id} onChange={(e) => void moveStage(c, e.target.value)} aria-label={`Stage for ${c.investorName}`}>
                          {PIPELINE_STAGES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(currentAmount(c))}</td>
                      <td className={tdCls}><span className={`badge ${docBadge(docStatusOf(c))}`}>{docStatusOf(c)}</span></td>
                      <td className={tdCls}>{c.owner || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 space-y-2 md:hidden">{filtered.map(card)}</div>
          </>
        )}
      </div>

      {/* Add investor picker drawer */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex" role="dialog" aria-modal="true" aria-label="Add investor to raise">
          <button type="button" aria-label="Close" className="flex-1 bg-black/40" onClick={() => setPickerOpen(false)} />
          <div className="flex h-full w-full max-w-[520px] flex-col bg-white shadow-2xl dark:bg-[#0d1f3c]">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4 dark:border-white/10">
              <div>
                <h3 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">Add investor</h3>
                <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">Directory investors with their match score for this deal</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => setPickerOpen(false)}>Close</button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <input className={`${inputCls} min-h-[44px]`} value={pickerQ} onChange={(e) => setPickerQ(e.target.value)} placeholder="Search name, firm, email…" />
              {pickerLoading ? (
                <div className="mt-4"><SkeletonRows rows={4} /></div>
              ) : pickerFiltered.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500 dark:text-white/50">No Directory investors match.</p>
              ) : (
                <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
                  {pickerFiltered.map((inv) => {
                    const already = inRaise.has(inv.personId);
                    const score = scores[inv.personId];
                    return (
                      <li key={inv.personId} className="flex flex-wrap items-center gap-2 py-2.5">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">{inv.name}</span>
                          <span className="block text-xs text-slate-500 dark:text-white/50">{inv.firm || inv.title || ""}</span>
                        </span>
                        {typeof score === "number" && (
                          <span className="badge badge-neutral">Match {Math.round(score <= 1 ? score * 100 : score)}</span>
                        )}
                        <button
                          type="button"
                          className="btn btn-primary btn-sm min-h-[44px]"
                          disabled={already || addingId === inv.personId}
                          onClick={() => void addToRaise(inv.personId)}
                        >
                          {already ? "In raise" : addingId === inv.personId ? "Adding…" : "Add"}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-6 border-t border-slate-100 pt-4 dark:border-white/10">
                <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Add new person</h4>
                <p className="mt-1 text-xs text-slate-400 dark:text-white/40">Creates the Directory record, then adds them to this raise as a Prospect.</p>
                <div className="mt-3 grid gap-3">
                  <div>
                    <label className={labelCls}>Name *</label>
                    <input className={`${inputCls} min-h-[44px]`} value={newPerson.name} onChange={(e) => setNewPerson((f) => ({ ...f, name: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Firm</label>
                    <input className={`${inputCls} min-h-[44px]`} value={newPerson.firm} onChange={(e) => setNewPerson((f) => ({ ...f, firm: e.target.value }))} />
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input type="email" className={`${inputCls} min-h-[44px]`} value={newPerson.email} onChange={(e) => setNewPerson((f) => ({ ...f, email: e.target.value }))} />
                  </div>
                </div>
                <div className="mt-3">
                  <Button onClick={() => void addNewPerson()} loading={creatingPerson} disabled={!newPerson.name.trim()} className="min-h-[44px]">
                    Create &amp; add to raise
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
