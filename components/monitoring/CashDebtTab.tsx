"use client";

/**
 * Cash & Debt tab (Phase 8) — three getter-fed sections:
 * - Cash position (GET /cash: latest snapshot + server-computed
 *   revolver availability) with a position form (PUT /cash), and the
 *   13-week cashflow table editor (PUT /cash { weeks }).
 * - AR/AP aging: latest snapshots from GET /aging + a snapshot form
 *   (POST /aging; buckets current / 31–60 / 61–90 / 90+).
 * - Debt tranches (GET /debt): CRUD through POST /debt and
 *   PATCH/DELETE /debt/[trancheId].
 * Figures shown are the server's; availability is read from the
 * position row, never recomputed here.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows, StatTile } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  companyBase,
  api,
  dateOnly,
  fmtDateShort,
  fmtMoneyC,
  fmtMoneyN,
  inputCls,
  labelCls,
  listFrom,
  num,
  parseNum,
  pick,
  selectCls,
  str,
  todayIso,
  type MonitoringTabProps,
  type Rec,
} from "@/components/monitoring/types";

interface WeekRow {
  weekStart: string;
  inflows: string;
  outflows: string;
  endingBalance: string;
}

export default function CashDebtTab({ companyId }: MonitoringTabProps) {
  const base = companyBase(companyId);
  const [cash, setCash] = useState<Rec | null>(null);
  const [aging, setAging] = useState<Rec | null>(null);
  const [tranches, setTranches] = useState<Rec[]>([]);
  const [debtTotals, setDebtTotals] = useState<Rec>({});
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");

  const [posForm, setPosForm] = useState({ asOf: todayIso(), cashBalance: "", revolverLimit: "", revolverDrawn: "" });
  const [savingPos, setSavingPos] = useState(false);
  const [weeks, setWeeks] = useState<WeekRow[]>([]);
  const [savingWeeks, setSavingWeeks] = useState(false);

  const [agingForm, setAgingForm] = useState({ kind: "ar", asOf: todayIso(), currentAmt: "", d31_60: "", d61_90: "", d90Plus: "" });
  const [savingAging, setSavingAging] = useState(false);

  const [trancheForm, setTrancheForm] = useState({ lender: "", kind: "term_loan", principal: "", currentBalance: "", ratePct: "", maturity: "", notes: "" });
  const [editingTranche, setEditingTranche] = useState<string | null>(null);
  const [savingTranche, setSavingTranche] = useState(false);
  const [busyTranche, setBusyTranche] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [cashD, agingD, debtD] = await Promise.all([
        api<Rec>(`${base}/cash`),
        api<Rec>(`${base}/aging`).catch(() => null),
        api<Rec>(`${base}/debt`).catch(() => null),
      ]);
      setCash(cashD);
      const latest = (pick(cashD, "latest") ?? {}) as Rec;
      setPosForm({
        asOf: dateOnly(pick(latest, "asOf")) || todayIso(),
        cashBalance: String(num(pick(cashD, "cashBalance")) ?? num(pick(latest, "cashBalance")) ?? ""),
        revolverLimit: String(num(pick(cashD, "revolverLimit")) ?? num(pick(latest, "revolverLimit")) ?? ""),
        revolverDrawn: String(num(pick(cashD, "revolverDrawn")) ?? num(pick(latest, "revolverDrawn")) ?? ""),
      });
      const weekRows = listFrom(cashD, "weeks");
      setWeeks(
        weekRows.map((w) => ({
          weekStart: dateOnly(pick(w, "weekStart")),
          inflows: String(num(pick(w, "inflows")) ?? ""),
          outflows: String(num(pick(w, "outflows")) ?? ""),
          endingBalance: String(num(pick(w, "endingBalance")) ?? ""),
        }))
      );
      setAging(agingD);
      setTranches(debtD ? listFrom(debtD, "tranches", "items") : []);
      setDebtTotals(debtD ? ((pick(debtD, "totals") ?? {}) as Rec) : {});
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePosition = async () => {
    const balance = parseNum(posForm.cashBalance);
    if (balance === null || !posForm.asOf || savingPos) return;
    setSavingPos(true);
    setError("");
    try {
      await api(`${base}/cash`, {
        method: "PUT",
        body: JSON.stringify({
          asOf: posForm.asOf,
          cashBalance: balance,
          revolverLimit: parseNum(posForm.revolverLimit),
          revolverDrawn: parseNum(posForm.revolverDrawn),
          source: "manual",
        }),
      });
      await load();
    } catch {
      setError("Could not save that cash position.");
    } finally {
      setSavingPos(false);
    }
  };

  const saveWeeks = async () => {
    if (savingWeeks) return;
    setSavingWeeks(true);
    setError("");
    try {
      await api(`${base}/cash`, {
        method: "PUT",
        body: JSON.stringify({
          weeks: weeks
            .filter((w) => w.weekStart)
            .slice(0, 13)
            .map((w) => ({
              weekStart: w.weekStart,
              inflows: parseNum(w.inflows),
              outflows: parseNum(w.outflows),
              endingBalance: parseNum(w.endingBalance),
            })),
        }),
      });
      await load();
    } catch {
      setError("Could not save the 13-week forecast.");
    } finally {
      setSavingWeeks(false);
    }
  };

  const saveAging = async () => {
    if (!agingForm.asOf || savingAging) return;
    setSavingAging(true);
    setError("");
    try {
      await api(`${base}/aging`, {
        method: "POST",
        body: JSON.stringify({
          asOf: agingForm.asOf,
          kind: agingForm.kind,
          currentAmt: parseNum(agingForm.currentAmt),
          d31_60: parseNum(agingForm.d31_60),
          d61_90: parseNum(agingForm.d61_90),
          d90Plus: parseNum(agingForm.d90Plus),
          source: "manual",
        }),
      });
      setAgingForm((f) => ({ ...f, currentAmt: "", d31_60: "", d61_90: "", d90Plus: "" }));
      await load();
    } catch {
      setError("Could not save that aging snapshot.");
    } finally {
      setSavingAging(false);
    }
  };

  const saveTranche = async () => {
    if (!trancheForm.lender.trim() || savingTranche) return;
    setSavingTranche(true);
    setError("");
    const payload = {
      lender: trancheForm.lender.trim(),
      kind: trancheForm.kind,
      principal: parseNum(trancheForm.principal),
      currentBalance: parseNum(trancheForm.currentBalance),
      ratePct: parseNum(trancheForm.ratePct),
      maturity: trancheForm.maturity || null,
      notes: trancheForm.notes.trim(),
    };
    try {
      if (editingTranche) {
        await api(`${base}/debt/${encodeURIComponent(editingTranche)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api(`${base}/debt`, { method: "POST", body: JSON.stringify(payload) });
      }
      setTrancheForm({ lender: "", kind: "term_loan", principal: "", currentBalance: "", ratePct: "", maturity: "", notes: "" });
      setEditingTranche(null);
      await load();
    } catch {
      setError("Could not save that tranche.");
    } finally {
      setSavingTranche(false);
    }
  };

  const deleteTranche = async (id: string) => {
    if (!window.confirm("Delete this debt tranche?")) return;
    setBusyTranche(id);
    setError("");
    try {
      await api(`${base}/debt/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch {
      setError("Could not delete that tranche.");
    } finally {
      setBusyTranche("");
    }
  };

  if (loading) return <SkeletonRows rows={6} />;
  if (loadFailed || !cash) return <ErrorState onRetry={() => void load()} />;

  const latest = (pick(cash, "latest") ?? {}) as Rec;
  const cashBalance = num(pick(cash, "cashBalance")) ?? num(pick(latest, "cashBalance"));
  const revolverAvailable = num(pick(cash, "revolverAvailable")) ?? num(pick(latest, "revolverAvailable"));
  const totalDebt = num(pick(debtTotals, "currentBalance")) ?? num(pick(cash, "totalDebt"));
  const agingRows: Rec[] = [];
  for (const kind of ["ar", "ap"] as const) {
    const snap = aging ? (pick(aging, kind) as Rec | undefined) : undefined;
    if (snap) agingRows.push({ ...snap, kindLabel: kind.toUpperCase() });
  }

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />

      <div className="grid grid-cols-3 gap-4">
        <div className="card-surface p-4">
          <StatTile label="Cash" display={fmtMoneyC(cashBalance)} title={fmtMoneyN(cashBalance)} caption={`As of ${fmtDateShort(dateOnly(pick(cash, "asOf")) || dateOnly(pick(latest, "asOf")))}`} />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Revolver availability" display={fmtMoneyC(revolverAvailable)} title={fmtMoneyN(revolverAvailable)} caption="Limit minus drawn, per the latest position" />
        </div>
        <div className="card-surface p-4">
          <StatTile label="Total debt" display={fmtMoneyC(totalDebt)} title={fmtMoneyN(totalDebt)} caption="Current tranche balances" />
        </div>
      </div>

      <Section title="Cash position" caption="A point-in-time snapshot — saving records a new one. Availability is computed server-side and stored on the position.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto] lg:items-end">
          <div>
            <label className={labelCls}>As of</label>
            <input type="date" className={`${inputCls} min-h-[44px]`} value={posForm.asOf} onChange={(e) => setPosForm((f) => ({ ...f, asOf: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Cash balance ($)</label>
            <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={posForm.cashBalance} onChange={(e) => setPosForm((f) => ({ ...f, cashBalance: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Revolver limit ($)</label>
            <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={posForm.revolverLimit} onChange={(e) => setPosForm((f) => ({ ...f, revolverLimit: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Revolver drawn ($)</label>
            <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={posForm.revolverDrawn} onChange={(e) => setPosForm((f) => ({ ...f, revolverDrawn: e.target.value }))} />
          </div>
          <Button onClick={() => void savePosition()} loading={savingPos} disabled={parseNum(posForm.cashBalance) === null} className="min-h-[44px]">
            Save position
          </Button>
        </div>
      </Section>

      <Section
        title="13-week cashflow"
        caption="Weekly inflows, outflows and ending balance — the working liquidity forecast. Edit any cell and save the table."
        actions={
          <Button variant="secondary" size="sm" className="min-h-[44px]" loading={savingWeeks} onClick={() => void saveWeeks()}>
            Save weeks
          </Button>
        }
      >
        {weeks.length === 0 ? (
          <EmptyState title="No forecast weeks yet" message="Add the first week below — up to 13 weeks are kept." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px]">
              <thead>
                <tr className="border-b border-slate-100 dark:border-white/5">
                  <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Week starting</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Inflows</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Outflows</th>
                  <th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40">Ending balance</th>
                  <th className="px-3 py-2"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w, i) => (
                  <tr key={i} className="border-t border-slate-100 dark:border-white/5">
                    <td className="px-3 py-2">
                      <input type="date" className={`${inputCls} min-h-[44px]`} value={w.weekStart} onChange={(e) => setWeeks((ws) => ws.map((x, j) => (j === i ? { ...x, weekStart: e.target.value } : x)))} aria-label={`Week ${i + 1} start`} />
                    </td>
                    <td className="px-3 py-2">
                      <input inputMode="numeric" className={`${inputCls} min-h-[44px] text-right`} value={w.inflows} onChange={(e) => setWeeks((ws) => ws.map((x, j) => (j === i ? { ...x, inflows: e.target.value } : x)))} aria-label={`Week ${i + 1} inflows`} />
                    </td>
                    <td className="px-3 py-2">
                      <input inputMode="numeric" className={`${inputCls} min-h-[44px] text-right`} value={w.outflows} onChange={(e) => setWeeks((ws) => ws.map((x, j) => (j === i ? { ...x, outflows: e.target.value } : x)))} aria-label={`Week ${i + 1} outflows`} />
                    </td>
                    <td className="px-3 py-2">
                      <input inputMode="numeric" className={`${inputCls} min-h-[44px] text-right`} value={w.endingBalance} onChange={(e) => setWeeks((ws) => ws.map((x, j) => (j === i ? { ...x, endingBalance: e.target.value } : x)))} aria-label={`Week ${i + 1} ending balance`} />
                    </td>
                    <td className="px-3 py-2">
                      <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => setWeeks((ws) => ws.filter((_, j) => j !== i))}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {weeks.length < 13 && (
          <div className="mt-3">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-[44px]"
              onClick={() => setWeeks((ws) => [...ws, { weekStart: "", inflows: "", outflows: "", endingBalance: "" }])}
            >
              + Add week
            </Button>
          </div>
        )}
      </Section>

      <Section title="Aging — latest snapshots" caption="Most recent AR and AP aging snapshots, with the four standard buckets.">
        {agingRows.length === 0 ? (
          <EmptyState title="No aging snapshots yet" message="Record the first AR or AP snapshot below." />
        ) : (
          <SimpleTable
            rows={agingRows}
            rowKey={(r) => str(pick(r, "kindLabel"))}
            columns={[
              { key: "kindLabel", label: "Kind", value: (r) => str(pick(r, "kindLabel")) },
              { key: "asOf", label: "As of", value: (r) => fmtDateShort(dateOnly(pick(r, "asOf"))) },
              { key: "currentAmt", label: "Current", align: "right", value: (r) => fmtMoneyN(num(pick(r, "currentAmt"))) },
              { key: "d31_60", label: "31–60", align: "right", value: (r) => fmtMoneyN(num(pick(r, "d31_60"))) },
              { key: "d61_90", label: "61–90", align: "right", value: (r) => fmtMoneyN(num(pick(r, "d61_90"))) },
              { key: "d90Plus", label: "90+", align: "right", value: (r) => fmtMoneyN(num(pick(r, "d90Plus"))) },
              { key: "total", label: "Total", align: "right", value: (r) => fmtMoneyN(num(pick(r, "total"))) },
            ]}
          />
        )}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">New snapshot</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[110px_1fr_1fr_1fr_1fr_1fr_auto] lg:items-end">
            <div>
              <label className={labelCls}>Kind</label>
              <select className={`${selectCls} min-h-[44px]`} value={agingForm.kind} onChange={(e) => setAgingForm((f) => ({ ...f, kind: e.target.value }))}>
                <option value="ar">AR</option>
                <option value="ap">AP</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>As of</label>
              <input type="date" className={`${inputCls} min-h-[44px]`} value={agingForm.asOf} onChange={(e) => setAgingForm((f) => ({ ...f, asOf: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Current ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={agingForm.currentAmt} onChange={(e) => setAgingForm((f) => ({ ...f, currentAmt: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>31–60 ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={agingForm.d31_60} onChange={(e) => setAgingForm((f) => ({ ...f, d31_60: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>61–90 ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={agingForm.d61_90} onChange={(e) => setAgingForm((f) => ({ ...f, d61_90: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>90+ ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={agingForm.d90Plus} onChange={(e) => setAgingForm((f) => ({ ...f, d90Plus: e.target.value }))} />
            </div>
            <Button onClick={() => void saveAging()} loading={savingAging} disabled={!agingForm.asOf} className="min-h-[44px]">
              Save
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Debt tranches" caption="Every facility on the company's balance sheet. Balances feed the portfolio leverage rollup.">
        {tranches.length === 0 ? (
          <EmptyState title="No debt tranches" message="Add the first tranche below — term loan, revolver, seller note, or other facility." />
        ) : (
          <SimpleTable
            rows={tranches}
            rowKey={(r, i) => str(pick(r, "id")) || String(i)}
            columns={[
              { key: "lender", label: "Lender", value: (r) => str(pick(r, "lender")) || "—" },
              { key: "kind", label: "Kind", value: (r) => str(pick(r, "kind")) || "—" },
              { key: "principal", label: "Principal", align: "right", value: (r) => fmtMoneyN(num(pick(r, "principal"))) },
              { key: "currentBalance", label: "Balance", align: "right", value: (r) => fmtMoneyN(num(pick(r, "currentBalance"))) },
              {
                key: "ratePct",
                label: "Rate",
                align: "right",
                value: (r) => {
                  const n = num(pick(r, "ratePct"));
                  return n === null ? "—" : `${n}%`;
                },
              },
              { key: "maturity", label: "Maturity", value: (r) => fmtDateShort(dateOnly(pick(r, "maturity"))) },
              {
                key: "actions",
                label: "Actions",
                render: (r) => {
                  const id = str(pick(r, "id"));
                  return (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm min-h-[44px]"
                        onClick={() => {
                          setEditingTranche(id);
                          setTrancheForm({
                            lender: str(pick(r, "lender")),
                            kind: str(pick(r, "kind")) || "term_loan",
                            principal: String(num(pick(r, "principal")) ?? ""),
                            currentBalance: String(num(pick(r, "currentBalance")) ?? ""),
                            ratePct: String(num(pick(r, "ratePct")) ?? ""),
                            maturity: dateOnly(pick(r, "maturity")),
                            notes: str(pick(r, "notes")),
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm min-h-[44px]"
                        disabled={busyTranche === id}
                        onClick={() => void deleteTranche(id)}
                      >
                        Delete
                      </button>
                    </div>
                  );
                },
              },
            ]}
          />
        )}
        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
            {editingTranche ? "Edit tranche" : "Add a tranche"}
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className={labelCls}>Lender</label>
              <input className={`${inputCls} min-h-[44px]`} value={trancheForm.lender} onChange={(e) => setTrancheForm((f) => ({ ...f, lender: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Kind</label>
              <select className={`${selectCls} min-h-[44px]`} value={trancheForm.kind} onChange={(e) => setTrancheForm((f) => ({ ...f, kind: e.target.value }))}>
                <option value="term_loan">Term loan</option>
                <option value="revolver">Revolver</option>
                <option value="seller_note">Seller note</option>
                <option value="equipment">Equipment</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Rate (% per year)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={trancheForm.ratePct} onChange={(e) => setTrancheForm((f) => ({ ...f, ratePct: e.target.value }))} placeholder="e.g. 8.5" />
            </div>
            <div>
              <label className={labelCls}>Principal ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={trancheForm.principal} onChange={(e) => setTrancheForm((f) => ({ ...f, principal: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Current balance ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={trancheForm.currentBalance} onChange={(e) => setTrancheForm((f) => ({ ...f, currentBalance: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Maturity</label>
              <input type="date" className={`${inputCls} min-h-[44px]`} value={trancheForm.maturity} onChange={(e) => setTrancheForm((f) => ({ ...f, maturity: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelCls}>Notes</label>
              <input className={`${inputCls} min-h-[44px]`} value={trancheForm.notes} onChange={(e) => setTrancheForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => void saveTranche()} loading={savingTranche} disabled={!trancheForm.lender.trim()} className="min-h-[44px]">
              {editingTranche ? "Save tranche" : "Add tranche"}
            </Button>
            {editingTranche && (
              <Button
                variant="ghost"
                className="min-h-[44px]"
                onClick={() => {
                  setEditingTranche(null);
                  setTrancheForm({ lender: "", kind: "term_loan", principal: "", currentBalance: "", ratePct: "", maturity: "", notes: "" });
                }}
              >
                Cancel edit
              </Button>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
