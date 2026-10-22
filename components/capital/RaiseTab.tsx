"use client";

/**
 * Raise tab (Phase 7) — one open raise per deal: target, soft /
 * hard / funded progress against it, and the commitment book.
 * Commitments are edited through the shared commitment routes;
 * every write re-reads the raise so the summary (a stored read
 * model server-side) is always the server's numbers.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import {
  API,
  COMMITMENT_KINDS,
  COMMITMENT_STAGES,
  api,
  cardCls,
  commitmentStageBadge,
  fmtMoneyCompact,
  fmtMoneyN,
  fmtPct,
  fmtUpdated,
  inputCls,
  labelCls,
  labelOf,
  parseNum,
  selectCls,
  tdCls,
  thCls,
  type CapitalTabProps,
  type Commitment,
  type InvestorListItem,
  type Raise,
  type RaiseSummary,
} from "@/components/capital/types";

interface RaiseData {
  raise: Raise | null;
  summary: RaiseSummary | null;
  commitments: Commitment[];
}

export default function RaiseTab({ dealId, refreshSummary }: CapitalTabProps) {
  const base = `${API}/deals/${encodeURIComponent(dealId)}`;
  const [data, setData] = useState<RaiseData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");

  const [createForm, setCreateForm] = useState({ targetRaise: "", notes: "" });
  const [creating, setCreating] = useState(false);

  const [editForm, setEditForm] = useState({ targetRaise: "", status: "open", notes: "" });
  const [savingRaise, setSavingRaise] = useState(false);

  const [investors, setInvestors] = useState<InvestorListItem[]>([]);
  const [addForm, setAddForm] = useState({
    investorPersonId: "",
    amount: "",
    kind: "soft",
    stage: "indicated",
    notes: "",
  });
  const [adding, setAdding] = useState(false);

  const [editId, setEditId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState({ amount: "", kind: "soft", stage: "indicated", notes: "" });
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<RaiseData>(`${base}/raise`);
      setData({
        raise: d.raise ?? null,
        summary: d.summary ?? null,
        commitments: Array.isArray(d.commitments) ? d.commitments : [],
      });
      if (d.raise) {
        setEditForm({
          targetRaise: String(d.raise.targetRaise ?? ""),
          status: d.raise.status ?? "open",
          notes: d.raise.notes ?? "",
        });
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let live = true;
    api<{ investors: InvestorListItem[] }>(`${API}/investors?limit=50`)
      .then((d) => {
        if (live) setInvestors(Array.isArray(d.investors) ? d.investors : []);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const afterWrite = async () => {
    await load();
    refreshSummary?.();
  };

  const createRaise = async () => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      await api(`${base}/raise`, {
        method: "POST",
        body: JSON.stringify({
          targetRaise: parseNum(createForm.targetRaise) ?? 0,
          notes: createForm.notes.trim(),
        }),
      });
      await afterWrite();
    } catch {
      setError("Could not open the raise. This deal may already have an open raise.");
    } finally {
      setCreating(false);
    }
  };

  const saveRaise = async () => {
    if (savingRaise) return;
    setSavingRaise(true);
    setError("");
    try {
      await api(`${base}/raise`, {
        method: "PATCH",
        body: JSON.stringify({
          targetRaise: parseNum(editForm.targetRaise) ?? undefined,
          status: editForm.status,
          notes: editForm.notes.trim(),
        }),
      });
      await afterWrite();
    } catch {
      setError("Could not save the raise. Please try again.");
    } finally {
      setSavingRaise(false);
    }
  };

  const deleteRaise = async () => {
    if (!window.confirm("Delete this raise? Its commitments are removed with it. This cannot be undone from here.")) return;
    setError("");
    try {
      await api(`${base}/raise`, { method: "DELETE" });
      await afterWrite();
    } catch {
      setError("Could not delete the raise. Please try again.");
    }
  };

  const addCommitment = async () => {
    const amount = parseNum(addForm.amount);
    if (!addForm.investorPersonId || amount === null || adding) return;
    setAdding(true);
    setError("");
    try {
      await api(`${base}/commitments`, {
        method: "POST",
        body: JSON.stringify({
          investorPersonId: addForm.investorPersonId,
          amount,
          kind: addForm.kind,
          stage: addForm.stage,
          notes: addForm.notes.trim(),
        }),
      });
      setAddForm({ investorPersonId: "", amount: "", kind: "soft", stage: "indicated", notes: "" });
      await afterWrite();
    } catch {
      setError("Could not add that commitment. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (c: Commitment) => {
    setEditId(c.id);
    setEditRow({
      amount: String(c.amount ?? ""),
      kind: c.kind,
      stage: c.stage,
      notes: c.notes ?? "",
    });
  };

  const saveEdit = async (id: string) => {
    const amount = parseNum(editRow.amount);
    if (amount === null) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${API}/commitments/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          amount,
          kind: editRow.kind,
          stage: editRow.stage,
          notes: editRow.notes.trim(),
        }),
      });
      setEditId(null);
      await afterWrite();
    } catch {
      setError("Could not save that commitment. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const removeCommitment = async (id: string) => {
    if (!window.confirm("Remove this commitment?")) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${API}/commitments/${encodeURIComponent(id)}`, { method: "DELETE" });
      await afterWrite();
    } catch {
      setError("Could not remove that commitment. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !data) return <ErrorState onRetry={() => void load()} />;

  const { raise, summary, commitments } = data;

  if (!raise) {
    return (
      <div className="space-y-5">
        {error && (
          <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
        )}
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            No raise open for this deal
          </h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-500 dark:text-white/50">
            Opening a raise sets the target and starts the commitment book.
            Nothing is committed until you add investors below — soft
            indications and hard commitments are tracked separately.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-[220px_1fr_auto] sm:items-end">
            <div>
              <label className={labelCls}>Target raise ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={createForm.targetRaise} onChange={(e) => setCreateForm((f) => ({ ...f, targetRaise: e.target.value }))} placeholder="2,000,000" />
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input className={`${inputCls} min-h-[44px]`} value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Structure, timing, minimum check…" />
            </div>
            <Button onClick={() => void createRaise()} loading={creating} className="min-h-[44px]">
              {creating ? "Opening…" : "Open raise"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const target = summary?.targetRaise ?? raise.targetRaise ?? 0;
  const fundedPct = target > 0 ? (summary?.fundedTotal ?? 0) / target : 0;
  const hardPct = target > 0 ? (summary?.hardTotal ?? 0) / target : 0;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {/* Progress */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="card-surface p-4">
          <StatTile label="Target raise" display={fmtMoneyN(target)} caption={`Raise is ${raise.status}`} />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Hard commitments" display={fmtMoneyCompact(summary?.hardTotal ?? 0)} title={fmtMoneyN(summary?.hardTotal)} caption={`${fmtPct(hardPct)} of target`} />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Soft indications" display={fmtMoneyCompact(summary?.softTotal ?? 0)} title={fmtMoneyN(summary?.softTotal)} caption="Indicated, not yet hard" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Funded" display={fmtMoneyCompact(summary?.fundedTotal ?? 0)} title={fmtMoneyN(summary?.fundedTotal)} caption={`${fmtPct(fundedPct)} of target · ${summary?.investorCount ?? 0} investors`} />
        </div>
      </div>
      <div className="card-surface p-4" aria-label="Raise progress">
        <div className="flex justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">
          <span>Funded {fmtPct(fundedPct)}</span>
          <span>Hard {fmtPct(hardPct)}</span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#b8975a] to-[#d4b37a]"
            style={{ width: `${Math.min(100, Math.max(0, fundedPct * 100))}%` }}
          />
        </div>
      </div>

      {/* Commitment book */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Commitment book
        </h3>
        {commitments.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No commitments yet"
              message="Add the first investor below — pick them from the investor list, set the amount, and mark soft vs hard and the stage."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className={thCls}>Investor</th>
                  <th className={`${thCls} text-right`}>Amount</th>
                  <th className={thCls}>Kind</th>
                  <th className={thCls}>Stage</th>
                  <th className={thCls}>Notes</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {commitments.map((c) =>
                  editId === c.id ? (
                    <tr key={c.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className={tdCls}>
                        <span className="font-semibold">{c.investorName}</span>
                        {c.investorFirm && <span className="block text-xs text-slate-500 dark:text-white/50">{c.investorFirm}</span>}
                      </td>
                      <td className={tdCls}>
                        <input inputMode="numeric" className={`${inputCls} min-h-[44px] w-32`} value={editRow.amount} onChange={(e) => setEditRow((r) => ({ ...r, amount: e.target.value }))} />
                      </td>
                      <td className={tdCls}>
                        <select className={`${selectCls} min-h-[44px] w-24`} value={editRow.kind} onChange={(e) => setEditRow((r) => ({ ...r, kind: e.target.value }))}>
                          {COMMITMENT_KINDS.map((k) => (
                            <option key={k.key} value={k.key}>{k.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className={tdCls}>
                        <select className={`${selectCls} min-h-[44px] w-32`} value={editRow.stage} onChange={(e) => setEditRow((r) => ({ ...r, stage: e.target.value }))}>
                          {COMMITMENT_STAGES.map((s) => (
                            <option key={s.key} value={s.key}>{s.label}</option>
                          ))}
                        </select>
                      </td>
                      <td className={tdCls}>
                        <input className={`${inputCls} min-h-[44px] w-40`} value={editRow.notes} onChange={(e) => setEditRow((r) => ({ ...r, notes: e.target.value }))} />
                      </td>
                      <td className={tdCls}>
                        <span className="flex gap-1.5">
                          <button type="button" className="btn btn-primary btn-sm min-h-[44px]" disabled={busyId === c.id} onClick={() => void saveEdit(c.id)}>Save</button>
                          <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => setEditId(null)}>Cancel</button>
                        </span>
                      </td>
                    </tr>
                  ) : (
                    <tr key={c.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className={tdCls}>
                        <span className="font-semibold">{c.investorName}</span>
                        {c.investorFirm && <span className="block text-xs text-slate-500 dark:text-white/50">{c.investorFirm}</span>}
                        {c.updatedAt && <span className="block text-xs text-slate-400 dark:text-white/40">Updated {fmtUpdated(c.updatedAt)}</span>}
                      </td>
                      <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(c.amount)}</td>
                      <td className={tdCls}>{labelOf(COMMITMENT_KINDS, c.kind)}</td>
                      <td className={tdCls}>
                        <span className={`badge ${commitmentStageBadge(c.stage)}`}>{labelOf(COMMITMENT_STAGES, c.stage)}</span>
                      </td>
                      <td className={tdCls}>{c.notes || "—"}</td>
                      <td className={tdCls}>
                        <span className="flex gap-1.5">
                          <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => startEdit(c)}>Edit</button>
                          <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" disabled={busyId === c.id} onClick={() => void removeCommitment(c.id)}>Remove</button>
                        </span>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Add commitment */}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Add a commitment</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_150px_110px_130px_1fr_auto] lg:items-end">
            <div>
              <label className={labelCls}>Investor</label>
              <select className={`${selectCls} min-h-[44px]`} value={addForm.investorPersonId} onChange={(e) => setAddForm((f) => ({ ...f, investorPersonId: e.target.value }))}>
                <option value="">Select investor…</option>
                {investors.map((inv) => (
                  <option key={inv.personId} value={inv.personId}>
                    {inv.name}{inv.firm ? ` — ${inv.firm}` : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Amount ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={addForm.amount} onChange={(e) => setAddForm((f) => ({ ...f, amount: e.target.value }))} placeholder="500,000" />
            </div>
            <div>
              <label className={labelCls}>Kind</label>
              <select className={`${selectCls} min-h-[44px]`} value={addForm.kind} onChange={(e) => setAddForm((f) => ({ ...f, kind: e.target.value }))}>
                {COMMITMENT_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Stage</label>
              <select className={`${selectCls} min-h-[44px]`} value={addForm.stage} onChange={(e) => setAddForm((f) => ({ ...f, stage: e.target.value }))}>
                {COMMITMENT_STAGES.map((s) => (
                  <option key={s.key} value={s.key}>{s.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Notes</label>
              <input className={`${inputCls} min-h-[44px]`} value={addForm.notes} onChange={(e) => setAddForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <Button onClick={() => void addCommitment()} loading={adding} disabled={!addForm.investorPersonId || parseNum(addForm.amount) === null} className="min-h-[44px]">
              Add
            </Button>
          </div>
          {investors.length === 0 && (
            <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
              No investors loaded — add investors in the Investors panel above the deal list, then they can be picked here.
            </p>
          )}
        </div>
      </div>

      {/* Raise settings */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Raise settings
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-[220px_160px_1fr] sm:items-end">
          <div>
            <label className={labelCls}>Target raise ($)</label>
            <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={editForm.targetRaise} onChange={(e) => setEditForm((f) => ({ ...f, targetRaise: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={`${selectCls} min-h-[44px]`} value={editForm.status} onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
            </select>
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={`${inputCls} min-h-[44px]`} value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void saveRaise()} loading={savingRaise} className="min-h-[44px]">
            Save raise
          </Button>
          <Button variant="danger" onClick={() => void deleteRaise()} className="min-h-[44px]">
            Delete raise
          </Button>
        </div>
      </div>
    </div>
  );
}
