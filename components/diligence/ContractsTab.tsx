"use client";

/**
 * Contract register — material contracts with expiry / renewal
 * tracking. Expiries within 90 days are highlighted amber. Rows
 * expand to the full change-of-control, termination and key-terms
 * detail; the same form adds and edits.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  tdCls,
  thCls,
  fmtDateShort,
  fmtMoney,
  withinDays,
  type Contract,
  type TabProps,
} from "@/components/diligence/types";

interface ContractForm {
  counterparty: string;
  contractType: string;
  title: string;
  effectiveDate: string;
  expiryDate: string;
  renewalDate: string;
  autoRenew: boolean;
  changeOfControl: string;
  terminationTerms: string;
  keyTerms: string;
  annualValue: string;
  notes: string;
}

const EMPTY: ContractForm = {
  counterparty: "",
  contractType: "",
  title: "",
  effectiveDate: "",
  expiryDate: "",
  renewalDate: "",
  autoRenew: false,
  changeOfControl: "",
  terminationTerms: "",
  keyTerms: "",
  annualValue: "",
  notes: "",
};

function toForm(c: Contract): ContractForm {
  return {
    counterparty: c.counterparty,
    contractType: c.contractType,
    title: c.title,
    effectiveDate: c.effectiveDate ?? "",
    expiryDate: c.expiryDate ?? "",
    renewalDate: c.renewalDate ?? "",
    autoRenew: c.autoRenew,
    changeOfControl: c.changeOfControl,
    terminationTerms: c.terminationTerms,
    keyTerms: c.keyTerms,
    annualValue: c.annualValue === null ? "" : String(c.annualValue),
    notes: c.notes,
  };
}

function toPayload(f: ContractForm): Record<string, unknown> {
  return {
    counterparty: f.counterparty.trim(),
    contractType: f.contractType.trim(),
    title: f.title.trim(),
    effectiveDate: f.effectiveDate || null,
    expiryDate: f.expiryDate || null,
    renewalDate: f.renewalDate || null,
    autoRenew: f.autoRenew,
    changeOfControl: f.changeOfControl,
    terminationTerms: f.terminationTerms,
    keyTerms: f.keyTerms,
    annualValue: f.annualValue.trim() === "" ? null : Number(f.annualValue),
    notes: f.notes,
  };
}

export default function ContractsTab({ workspaceId, reload }: TabProps) {
  const [form, setForm] = useState<ContractForm>(EMPTY);
  const [editingId, setEditingId] = useState("");
  const [expandedId, setExpandedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  // Redesigned shell: section data is fetched per tab (the shell
  // passes a slim bundle — identity + counts only).
  const [contracts, setContracts] = useState<Contract[]>([]);
  const loadSection = useCallback(async () => {
    try {
      const d = await api<{ contracts: Contract[] }>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/contracts`
      );
      setContracts(d.contracts ?? []);
    } catch {
      /* keep the current list on a transient failure */
    }
  }, [workspaceId]);
  useEffect(() => {
    void loadSection();
  }, [loadSection]);

  const save = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      if (editingId) {
        await api(`/api/platform/diligence/contracts/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(form)),
        });
      } else {
        await api(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/contracts`, {
          method: "POST",
          body: JSON.stringify(toPayload(form)),
        });
      }
      setForm(EMPTY);
      setEditingId("");
      await loadSection();
    } catch {
      setError("Could not save that contract. A title is required.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (c: Contract) => {
    setBusyId(c.id);
    setError("");
    try {
      await api(`/api/platform/diligence/contracts/${encodeURIComponent(c.id)}`, {
        method: "DELETE",
      });
      if (editingId === c.id) {
        setEditingId("");
        setForm(EMPTY);
      }
      await loadSection();
    } catch {
      setError("Could not delete that contract. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const set = (patch: Partial<ContractForm>) =>
    setForm((f) => ({ ...f, ...patch }));

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Contract register
        </h3>
        {contracts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No contracts recorded yet. Add the first one below.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={thCls}>Counterparty</th>
                  <th className={thCls}>Title</th>
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Expires</th>
                  <th className={thCls}>Renews</th>
                  <th className={thCls}>Auto-renew</th>
                  <th className={thCls}>Annual value</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {contracts.map((c) => {
                  const expiringSoon = withinDays(c.expiryDate, 90);
                  const expanded = expandedId === c.id;
                  return [
                    <tr
                      key={c.id}
                      className={`border-b border-slate-100 dark:border-white/5 ${
                        expiringSoon ? "bg-amber-50 dark:bg-amber-500/10" : ""
                      }`}
                    >
                      <td className={`${tdCls} font-medium`}>{c.counterparty || "—"}</td>
                      <td className={tdCls}>{c.title}</td>
                      <td className={tdCls}>{c.contractType || "—"}</td>
                      <td className={tdCls}>
                        {fmtDateShort(c.expiryDate)}
                        {expiringSoon && (
                          <span className="badge badge-warn ml-2">≤ 90 days</span>
                        )}
                      </td>
                      <td className={tdCls}>{fmtDateShort(c.renewalDate)}</td>
                      <td className={tdCls}>{c.autoRenew ? "Yes" : "No"}</td>
                      <td className={`${tdCls} tnum`}>{fmtMoney(c.annualValue)}</td>
                      <td className={tdCls}>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => setExpandedId(expanded ? "" : c.id)}
                          >
                            {expanded ? "Hide" : "Terms"}
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setEditingId(c.id);
                              setForm(toForm(c));
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busyId === c.id}
                            onClick={() => void remove(c)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>,
                    expanded ? (
                      <tr key={`${c.id}-detail`} className="border-b border-slate-100 dark:border-white/5">
                        <td colSpan={8} className="px-3 py-3">
                          <div className="grid gap-3 text-sm sm:grid-cols-3">
                            <div>
                              <p className={labelCls}>Change of control</p>
                              <p className="whitespace-pre-wrap text-slate-600 dark:text-white/70">
                                {c.changeOfControl || "—"}
                              </p>
                            </div>
                            <div>
                              <p className={labelCls}>Termination terms</p>
                              <p className="whitespace-pre-wrap text-slate-600 dark:text-white/70">
                                {c.terminationTerms || "—"}
                              </p>
                            </div>
                            <div>
                              <p className={labelCls}>Key terms</p>
                              <p className="whitespace-pre-wrap text-slate-600 dark:text-white/70">
                                {c.keyTerms || "—"}
                              </p>
                            </div>
                          </div>
                          <p className="mt-3 text-xs text-slate-500 dark:text-white/50">
                            Effective {fmtDateShort(c.effectiveDate)}
                            {c.documentId ? ` · data room document ${c.documentId}` : ""}
                            {c.notes ? ` · ${c.notes}` : ""}
                          </p>
                        </td>
                      </tr>
                    ) : null,
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          {editingId ? "Edit contract" : "Add contract"}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelCls}>Counterparty</label>
            <input className={inputCls} value={form.counterparty} onChange={(e) => set({ counterparty: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Title</label>
            <input className={inputCls} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Master services agreement" />
          </div>
          <div>
            <label className={labelCls}>Type</label>
            <input className={inputCls} value={form.contractType} onChange={(e) => set({ contractType: e.target.value })} placeholder="customer / vendor / lease / loan…" />
          </div>
          <div>
            <label className={labelCls}>Effective date</label>
            <input type="date" className={inputCls} value={form.effectiveDate} onChange={(e) => set({ effectiveDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Expiry date</label>
            <input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Renewal date</label>
            <input type="date" className={inputCls} value={form.renewalDate} onChange={(e) => set({ renewalDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Annual value (USD)</label>
            <input type="number" className={inputCls} value={form.annualValue} onChange={(e) => set({ annualValue: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 pt-5 text-sm text-[#0d1f3c] dark:text-white">
            <input
              type="checkbox"
              checked={form.autoRenew}
              onChange={(e) => set({ autoRenew: e.target.checked })}
              className="h-4 w-4 accent-[#b8975a]"
            />
            Auto-renews
          </label>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={inputCls} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelCls}>Change of control</label>
            <textarea className={`${inputCls} min-h-[70px]`} value={form.changeOfControl} onChange={(e) => set({ changeOfControl: e.target.value })} placeholder="Consent required? Assignment restrictions? Termination right on change of control?" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelCls}>Termination terms</label>
            <textarea className={`${inputCls} min-h-[70px]`} value={form.terminationTerms} onChange={(e) => set({ terminationTerms: e.target.value })} placeholder="Notice period, termination for convenience / cause, fees" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelCls}>Key terms</label>
            <textarea className={`${inputCls} min-h-[70px]`} value={form.keyTerms} onChange={(e) => set({ keyTerms: e.target.value })} placeholder="Pricing, exclusivity, non-compete, IP, liability caps…" />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => void save()} loading={saving} disabled={!form.title.trim()}>
            {editingId ? "Save changes" : "Add contract"}
          </Button>
          {editingId && (
            <Button
              variant="ghost"
              onClick={() => {
                setEditingId("");
                setForm(EMPTY);
              }}
            >
              Cancel edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
