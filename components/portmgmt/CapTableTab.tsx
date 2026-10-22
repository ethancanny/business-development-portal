"use client";

/**
 * Cap Table tab (Phase 9, internal) — holders with computed %
 * ownership (shares ÷ total shares from the served rows; a served
 * ownershipPct wins when present), holder CRUD, and distributions
 * (list + record form). The capital tie state is shown exactly as
 * the server reports it on each distribution / the table payload —
 * when the server reports none, the tab shows the recorded totals
 * and says the tie state is not reported, never a fabricated "tied".
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  dateOnly,
  fmtDateShort,
  fmtMoneyN,
  fmtPctPoints,
  inputCls,
  labelCls,
  parseNum,
  selectCls,
  type MonitoringTabProps,
} from "@/components/monitoring/types";
import { api, num, pick, pmCompany, rowsFrom, str, type Rec } from "@/components/portmgmt/pm";

const HOLDER_EMPTY = { name: "", kind: "investor", shares: "", capital: "", notes: "" };
const DIST_EMPTY = { holderId: "", date: "", amount: "", kind: "distribution", notes: "" };

export default function CapTableTab({ companyId }: MonitoringTabProps) {
  const base = `${pmCompany(companyId)}/cap-table`;
  const [table, setTable] = useState<Rec | null>(null);
  const [holders, setHolders] = useState<Rec[]>([]);
  const [distributions, setDistributions] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [editingHolder, setEditingHolder] = useState("");
  const [holderForm, setHolderForm] = useState(HOLDER_EMPTY);
  const [savingHolder, setSavingHolder] = useState(false);
  const [distForm, setDistForm] = useState(DIST_EMPTY);
  const [savingDist, setSavingDist] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [t, dist] = await Promise.all([
        api<Rec>(base),
        api<Rec>(`${base}/distributions`).catch(() => null),
      ]);
      setTable(t);
      setHolders(rowsFrom(t, "holders", "items"));
      setDistributions(dist ? rowsFrom(dist, "distributions", "items") : rowsFrom(t, "distributions"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalShares = useMemo(
    () => holders.reduce((sum, h) => sum + (num(pick(h, "shares", "units")) ?? 0), 0),
    [holders]
  );
  const totalCapital = useMemo(
    () => holders.reduce((sum, h) => sum + (num(pick(h, "capital", "capitalContributed", "invested")) ?? 0), 0),
    [holders]
  );
  const totalDistributed = useMemo(
    () => distributions.reduce((sum, d) => sum + (num(pick(d, "amount")) ?? 0), 0),
    [distributions]
  );
  const tieState = table ? pick(table, "capitalTied", "tieState", "tied") : undefined;

  const saveHolder = async () => {
    if (!holderForm.name.trim() || savingHolder) return;
    setSavingHolder(true);
    setError("");
    const payload = {
      name: holderForm.name.trim(),
      kind: holderForm.kind,
      shares: parseNum(holderForm.shares),
      capital: parseNum(holderForm.capital),
      notes: holderForm.notes.trim() || undefined,
    };
    try {
      if (editingHolder) {
        await api(`${base}/holders/${encodeURIComponent(editingHolder)}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api(`${base}/holders`, { method: "POST", body: JSON.stringify(payload) });
      }
      setHolderForm(HOLDER_EMPTY);
      setEditingHolder("");
      await load();
    } catch {
      setError("Could not save that holder.");
    } finally {
      setSavingHolder(false);
    }
  };

  const removeHolder = async (id: string) => {
    if (!window.confirm("Remove this holder from the cap table?")) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${base}/holders/${encodeURIComponent(id)}`, { method: "DELETE" });
      await load();
    } catch {
      setError("Could not remove that holder.");
    } finally {
      setBusyId("");
    }
  };

  const saveDistribution = async () => {
    const amount = parseNum(distForm.amount);
    if (amount === null || !distForm.date || savingDist) return;
    setSavingDist(true);
    setError("");
    try {
      await api(`${base}/distributions`, {
        method: "POST",
        body: JSON.stringify({
          holderId: distForm.holderId || undefined,
          date: distForm.date,
          amount,
          kind: distForm.kind,
          notes: distForm.notes.trim() || undefined,
        }),
      });
      setDistForm(DIST_EMPTY);
      await load();
    } catch {
      setError("Could not record that distribution.");
    } finally {
      setSavingDist(false);
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const ownershipOf = (h: Rec): string => {
    const served = num(pick(h, "ownershipPct", "ownership", "pct"));
    if (served !== null) return fmtPctPoints(served <= 1.5 ? served * 100 : served);
    const shares = num(pick(h, "shares", "units"));
    if (shares === null || totalShares <= 0) return "—";
    return fmtPctPoints((shares / totalShares) * 100);
  };

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <Section
        title="Cap table"
        caption="Holders and their ownership. Percentages are computed from the shares on this table unless the server serves an ownership figure, which then wins."
      >
        <div className="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-600 dark:text-white/70">
          <span>Total shares: <strong className="tnum text-[#0d1f3c] dark:text-white">{totalShares ? totalShares.toLocaleString("en-US") : "—"}</strong></span>
          <span>Capital in: <strong className="tnum text-[#0d1f3c] dark:text-white">{fmtMoneyN(totalCapital || null)}</strong></span>
          <span>Distributed: <strong className="tnum text-[#0d1f3c] dark:text-white">{fmtMoneyN(totalDistributed || null)}</strong></span>
          <span>
            Capital tie:{" "}
            <strong className="text-[#0d1f3c] dark:text-white">
              {tieState === undefined || tieState === null
                ? "not reported by the server"
                : tieState === true
                  ? "tied"
                  : String(tieState)}
            </strong>
          </span>
        </div>

        {holders.length === 0 ? (
          <EmptyState title="No holders yet" message="Add the first holder below — name, kind and shares are enough to start the table." />
        ) : (
          <SimpleTable
            rows={holders}
            rowKey={(r, i) => str(pick(r, "id")) || String(i)}
            columns={[
              { key: "name", label: "Holder", value: (r) => str(pick(r, "name")) || "—" },
              { key: "kind", label: "Kind", value: (r) => str(pick(r, "kind", "holderType")) || "—" },
              {
                key: "shares",
                label: "Shares / units",
                align: "right",
                value: (r) => {
                  const n = num(pick(r, "shares", "units"));
                  return n === null ? "—" : n.toLocaleString("en-US");
                },
              },
              { key: "ownership", label: "Ownership", align: "right", value: (r) => ownershipOf(r) },
              { key: "capital", label: "Capital", align: "right", value: (r) => fmtMoneyN(num(pick(r, "capital", "capitalContributed", "invested"))) },
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
                          setEditingHolder(id);
                          setHolderForm({
                            name: str(pick(r, "name")),
                            kind: str(pick(r, "kind", "holderType")) || "investor",
                            shares: String(num(pick(r, "shares", "units")) ?? ""),
                            capital: String(num(pick(r, "capital", "capitalContributed", "invested")) ?? ""),
                            notes: str(pick(r, "notes")),
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm min-h-[44px]"
                        disabled={busyId === id}
                        onClick={() => void removeHolder(id)}
                      >
                        Remove
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
            {editingHolder ? "Edit holder" : "Add a holder"}
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_150px_1fr_1fr_auto] lg:items-end">
            <div>
              <label className={labelCls}>Name</label>
              <input className={`${inputCls} min-h-[44px]`} value={holderForm.name} onChange={(e) => setHolderForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Kind</label>
              <select className={`${selectCls} min-h-[44px]`} value={holderForm.kind} onChange={(e) => setHolderForm((f) => ({ ...f, kind: e.target.value }))}>
                <option value="investor">Investor</option>
                <option value="lp">LP</option>
                <option value="sponsor">Sponsor</option>
                <option value="rollover">Rollover</option>
                <option value="management">Management</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Shares / units</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={holderForm.shares} onChange={(e) => setHolderForm((f) => ({ ...f, shares: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Capital ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={holderForm.capital} onChange={(e) => setHolderForm((f) => ({ ...f, capital: e.target.value }))} />
            </div>
            <Button className="min-h-[44px]" loading={savingHolder} disabled={!holderForm.name.trim()} onClick={() => void saveHolder()}>
              {editingHolder ? "Save holder" : "Add holder"}
            </Button>
          </div>
          {editingHolder && (
            <Button variant="ghost" className="mt-2 min-h-[44px]" onClick={() => { setEditingHolder(""); setHolderForm(HOLDER_EMPTY); }}>
              Cancel edit
            </Button>
          )}
        </div>
      </Section>

      <Section title="Distributions" caption="Cash returned to holders. Each row shows the capital tie state exactly as the server reports it.">
        {distributions.length === 0 ? (
          <EmptyState title="No distributions yet" message="Record the first distribution below when cash goes back to holders." />
        ) : (
          <SimpleTable
            rows={distributions}
            rowKey={(r, i) => str(pick(r, "id")) || String(i)}
            columns={[
              { key: "date", label: "Date", value: (r) => fmtDateShort(dateOnly(pick(r, "date", "paidAt")) || str(pick(r, "date"))) },
              { key: "holder", label: "Holder", value: (r) => str(pick(r, "holderName", "holder")) || str(pick(r, "holderId")) || "All holders" },
              { key: "kind", label: "Kind", value: (r) => str(pick(r, "kind")) || "—" },
              { key: "amount", label: "Amount", align: "right", value: (r) => fmtMoneyN(num(pick(r, "amount"))) },
              {
                key: "tie",
                label: "Capital tie",
                render: (r) => {
                  const t = pick(r, "capitalTied", "tied", "tieState");
                  if (t === undefined || t === null)
                    return <span className="text-slate-400 dark:text-white/40">not reported</span>;
                  return t === true ? (
                    <span className="badge badge-fit">tied</span>
                  ) : (
                    <span className="badge badge-warn">{String(t)}</span>
                  );
                },
              },
            ]}
          />
        )}

        <div className="mt-5 border-t border-slate-100 pt-4 dark:border-white/5">
          <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Record a distribution</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_170px_1fr_150px_auto] lg:items-end">
            <div>
              <label className={labelCls}>Holder (optional)</label>
              <select className={`${selectCls} min-h-[44px]`} value={distForm.holderId} onChange={(e) => setDistForm((f) => ({ ...f, holderId: e.target.value }))}>
                <option value="">All holders / pro-rata</option>
                {holders.map((h) => (
                  <option key={str(pick(h, "id"))} value={str(pick(h, "id"))}>
                    {str(pick(h, "name"))}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" className={`${inputCls} min-h-[44px]`} value={distForm.date} onChange={(e) => setDistForm((f) => ({ ...f, date: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Amount ($)</label>
              <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={distForm.amount} onChange={(e) => setDistForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <label className={labelCls}>Kind</label>
              <select className={`${selectCls} min-h-[44px]`} value={distForm.kind} onChange={(e) => setDistForm((f) => ({ ...f, kind: e.target.value }))}>
                <option value="distribution">Distribution</option>
                <option value="return_of_capital">Return of capital</option>
                <option value="dividend">Dividend</option>
                <option value="other">Other</option>
              </select>
            </div>
            <Button className="min-h-[44px]" loading={savingDist} disabled={parseNum(distForm.amount) === null || !distForm.date} onClick={() => void saveDistribution()}>
              Record
            </Button>
          </div>
        </div>
      </Section>
    </div>
  );
}
