"use client";

/**
 * Book tab (redesign Step 1) — the commitment book: per investor,
 * indicated / soft / hard / funded amounts (editable), document
 * status, wire status, expected funding date and owner. Amount
 * edits ride the existing commitment routes (PATCH, PUT fallback)
 * with the extended bucket fields.
 *
 * The totals footer sums the ROWS shown and reconciles them
 * against the stored raise summary: equal → "Reconciles to the
 * raise summary ✓"; different → each differing bucket is called
 * out with both numbers. Nothing is silently adjusted.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  cardCls,
  fmtMoneyN,
  inputCls,
  labelCls,
  parseNum,
  selectCls,
  tdCls,
  thCls,
  type CapitalTabProps,
} from "@/components/capital/types";
import {
  DOC_STATUSES,
  WIRE_STATUSES,
  bucketAmount,
  deleteCommitment,
  docStatusOf,
  fetchBundle,
  labelOfSafe,
  updateCommitment,
  wireStatusOf,
  type ExtCommitment,
  type WorkspaceBundle,
} from "@/components/capital/workspace/shared";

interface RowForm {
  indicated: string;
  soft: string;
  hard: string;
  funded: string;
  docStatus: string;
  wireStatus: string;
  expectedFundingDate: string;
  owner: string;
}

function formFrom(c: ExtCommitment): RowForm {
  const num = (v: number) => (v ? String(v) : "");
  return {
    indicated: num(bucketAmount(c, "indicated")),
    soft: num(bucketAmount(c, "soft")),
    hard: num(bucketAmount(c, "hard")),
    funded: num(bucketAmount(c, "funded")),
    docStatus: docStatusOf(c),
    wireStatus: wireStatusOf(c),
    expectedFundingDate: (c.expectedFundingDate ?? "").slice(0, 10),
    owner: c.owner ?? "",
  };
}

export default function BookTab({ dealId, refreshSummary }: CapitalTabProps) {
  const [bundle, setBundle] = useState<WorkspaceBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<RowForm | null>(null);
  const [busyId, setBusyId] = useState("");

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

  const totals = useMemo(() => {
    const t = { indicated: 0, soft: 0, hard: 0, funded: 0 };
    for (const c of bundle?.commitments ?? []) {
      t.indicated += bucketAmount(c, "indicated");
      t.soft += bucketAmount(c, "soft");
      t.hard += bucketAmount(c, "hard");
      t.funded += bucketAmount(c, "funded");
    }
    return t;
  }, [bundle]);

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed || !bundle) return <ErrorState onRetry={() => void load()} />;

  const { commitments, summary, raise } = bundle;
  const target = summary?.targetRaise ?? raise?.targetRaise ?? 0;

  const saveRow = async (c: ExtCommitment) => {
    if (!form) return;
    setBusyId(c.id);
    setError("");
    try {
      await updateCommitment(c.id, {
        indicatedAmount: parseNum(form.indicated),
        softAmount: parseNum(form.soft),
        hardAmount: parseNum(form.hard),
        fundedAmount: parseNum(form.funded),
        docStatus: form.docStatus,
        wireStatus: form.wireStatus,
        expectedFundingDate: form.expectedFundingDate || null,
        owner: form.owner.trim(),
      });
      setEditId(null);
      await load();
      refreshSummary?.();
    } catch {
      setError("Could not save that row. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const quickPatch = async (c: ExtCommitment, patch: Record<string, unknown>) => {
    setBusyId(c.id);
    setError("");
    try {
      await updateCommitment(c.id, patch);
      await load();
      refreshSummary?.();
    } catch {
      setError("Could not save that change. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (c: ExtCommitment) => {
    if (!window.confirm(`Remove ${c.investorName || "this investor"} from the book?`)) return;
    setBusyId(c.id);
    setError("");
    try {
      await deleteCommitment(c.id);
      await load();
      refreshSummary?.();
    } catch {
      setError("Could not remove that commitment.");
    } finally {
      setBusyId("");
    }
  };

  // Reconciliation of row sums vs the stored summary.
  const summaryBuckets: Array<{ key: keyof typeof totals; label: string; summary: number | undefined }> = [
    { key: "indicated", label: "Indicated", summary: summary?.indicatedTotal },
    { key: "soft", label: "Soft", summary: summary?.softTotal },
    { key: "hard", label: "Hard", summary: summary?.hardTotal },
    { key: "funded", label: "Funded", summary: summary?.fundedTotal },
  ];
  const diffs = summary
    ? summaryBuckets.filter(
        (b) => b.summary !== undefined && Math.abs(b.summary - totals[b.key]) > 0.01
      )
    : [];

  const rowFields = (c: ExtCommitment, f: RowForm, set: (p: Partial<RowForm>) => void) => (
    <>
      {(["indicated", "soft", "hard", "funded"] as const).map((k) => (
        <div key={k}>
          <label className={labelCls}>{k} ($)</label>
          <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={f[k]} onChange={(e) => set({ [k]: e.target.value } as Partial<RowForm>)} />
        </div>
      ))}
      <div>
        <label className={labelCls}>Doc status</label>
        <select className={`${selectCls} min-h-[44px]`} value={f.docStatus} onChange={(e) => set({ docStatus: e.target.value })}>
          {DOC_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Wire status</label>
        <select className={`${selectCls} min-h-[44px]`} value={f.wireStatus} onChange={(e) => set({ wireStatus: e.target.value })}>
          {WIRE_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </div>
      <div>
        <label className={labelCls}>Expected funding</label>
        <input type="date" className={`${inputCls} min-h-[44px]`} value={f.expectedFundingDate} onChange={(e) => set({ expectedFundingDate: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Owner</label>
        <input className={`${inputCls} min-h-[44px]`} value={f.owner} onChange={(e) => set({ owner: e.target.value })} />
      </div>
    </>
  );

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Commitment book</h3>
        {commitments.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No commitments yet" message="Add investors from the Investors tab — their indicated / soft / hard / funded amounts are kept here." />
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="mt-3 hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-white/5">
                    <th className={thCls}>Investor</th>
                    <th className={`${thCls} text-right`}>Indicated</th>
                    <th className={`${thCls} text-right`}>Soft</th>
                    <th className={`${thCls} text-right`}>Hard</th>
                    <th className={`${thCls} text-right`}>Funded</th>
                    <th className={thCls}>Doc status</th>
                    <th className={thCls}>Wire</th>
                    <th className={thCls}>Expected funding</th>
                    <th className={thCls}>Owner</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {commitments.map((c) => (
                    <tr key={c.id} className="border-t border-slate-100 dark:border-white/5">
                      <td className={tdCls}>
                        <span className="font-semibold">{c.investorName}</span>
                        {c.investorFirm && <span className="block text-xs text-slate-500 dark:text-white/50">{c.investorFirm}</span>}
                      </td>
                      <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(bucketAmount(c, "indicated"))}</td>
                      <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(bucketAmount(c, "soft"))}</td>
                      <td className={`${tdCls} tnum text-right`}>{fmtMoneyN(bucketAmount(c, "hard"))}</td>
                      <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(bucketAmount(c, "funded"))}</td>
                      <td className={tdCls}>
                        <select className={`${selectCls} min-h-[44px] w-32`} value={docStatusOf(c)} disabled={busyId === c.id} onChange={(e) => void quickPatch(c, { docStatus: e.target.value })} aria-label={`Doc status for ${c.investorName}`}>
                          {DOC_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className={tdCls}>{labelOfSafe(WIRE_STATUSES, wireStatusOf(c))}</td>
                      <td className={tdCls}>{c.expectedFundingDate ? c.expectedFundingDate.slice(0, 10) : "—"}</td>
                      <td className={tdCls}>{c.owner || "—"}</td>
                      <td className={tdCls}>
                        <span className="flex gap-1.5">
                          <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => { setEditId(c.id); setForm(formFrom(c)); }}>Edit</button>
                          <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" disabled={busyId === c.id} onClick={() => void remove(c)}>Remove</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-slate-200 dark:border-white/15">
                    <td className={`${tdCls} font-semibold`}>Totals (rows)</td>
                    <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(totals.indicated)}</td>
                    <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(totals.soft)}</td>
                    <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(totals.hard)}</td>
                    <td className={`${tdCls} tnum text-right font-semibold`}>{fmtMoneyN(totals.funded)}</td>
                    <td className={tdCls} colSpan={5}>
                      Target {fmtMoneyN(target)} · Remaining vs hard {fmtMoneyN(Math.max(0, target - totals.hard))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile / tablet cards */}
            <div className="mt-3 space-y-3 lg:hidden">
              {commitments.map((c) => (
                <div key={c.id} className="rounded-2xl border border-slate-200 p-4 dark:border-white/10">
                  <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{c.investorName}</p>
                  {c.investorFirm && <p className="text-xs text-slate-500 dark:text-white/50">{c.investorFirm}</p>}
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                    <div className="flex justify-between"><dt className="text-slate-500 dark:text-white/50">Indicated</dt><dd className="tnum font-semibold">{fmtMoneyN(bucketAmount(c, "indicated"))}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500 dark:text-white/50">Soft</dt><dd className="tnum font-semibold">{fmtMoneyN(bucketAmount(c, "soft"))}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500 dark:text-white/50">Hard</dt><dd className="tnum font-semibold">{fmtMoneyN(bucketAmount(c, "hard"))}</dd></div>
                    <div className="flex justify-between"><dt className="text-slate-500 dark:text-white/50">Funded</dt><dd className="tnum font-semibold">{fmtMoneyN(bucketAmount(c, "funded"))}</dd></div>
                  </dl>
                  <p className="mt-2 text-xs text-slate-500 dark:text-white/50">
                    Doc {labelOfSafe(DOC_STATUSES, docStatusOf(c))} · Wire {labelOfSafe(WIRE_STATUSES, wireStatusOf(c))}
                    {c.expectedFundingDate ? ` · Expected ${c.expectedFundingDate.slice(0, 10)}` : ""}
                    {c.owner ? ` · ${c.owner}` : ""}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => { setEditId(c.id); setForm(formFrom(c)); }}>Edit</button>
                    <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" disabled={busyId === c.id} onClick={() => void remove(c)}>Remove</button>
                  </div>
                </div>
              ))}
              <p className="text-sm text-slate-600 dark:text-white/70">
                Totals — Indicated {fmtMoneyN(totals.indicated)} · Soft {fmtMoneyN(totals.soft)} · Hard {fmtMoneyN(totals.hard)} · Funded {fmtMoneyN(totals.funded)} · Target {fmtMoneyN(target)} · Remaining vs hard {fmtMoneyN(Math.max(0, target - totals.hard))}
              </p>
            </div>

            {/* Row edit form */}
            {editId && form && (
              <div className="mt-4 rounded-2xl border border-[#b8975a]/50 p-4">
                <h4 className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                  Edit — {commitments.find((c) => c.id === editId)?.investorName ?? "commitment"}
                </h4>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {rowFields(commitments.find((c) => c.id === editId) as ExtCommitment, form, (p) => setForm((f) => (f ? { ...f, ...p } : f)))}
                </div>
                <div className="mt-3 flex gap-2">
                  <Button onClick={() => { const c = commitments.find((x) => x.id === editId); if (c) void saveRow(c); }} loading={busyId === editId} className="min-h-[44px]">Save row</Button>
                  <Button variant="ghost" onClick={() => setEditId(null)} className="min-h-[44px]">Cancel</Button>
                </div>
              </div>
            )}

            {/* Reconciliation */}
            <div className="mt-4 border-t border-slate-100 pt-3 dark:border-white/5">
              {!summary ? (
                <p className="text-sm text-slate-500 dark:text-white/50">No stored raise summary was returned, so there is nothing to reconcile the row totals against.</p>
              ) : diffs.length === 0 ? (
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  Reconciles to the raise summary ✓ — row totals match the stored summary on every bucket it reports
                  ({summaryBuckets.filter((b) => b.summary !== undefined).map((b) => `${b.label} ${fmtMoneyN(totals[b.key])}`).join(" · ") || "no buckets reported"}).
                </p>
              ) : (
                <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                  <p className="font-semibold">Row totals differ from the stored raise summary:</p>
                  <ul className="mt-1 list-disc pl-5">
                    {diffs.map((b) => (
                      <li key={b.key}>{b.label}: rows {fmtMoneyN(totals[b.key])} vs summary {fmtMoneyN(b.summary)} (difference {fmtMoneyN(totals[b.key] - (b.summary ?? 0))})</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
