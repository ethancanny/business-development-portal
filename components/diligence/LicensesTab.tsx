"use client";

/**
 * License & permit register — transferability is the diligence
 * question (does the license survive the transaction?), so it is a
 * first-class column. Expiries within 90 days highlight amber.
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  selectCls,
  tdCls,
  thCls,
  fmtDateShort,
  withinDays,
  TRANSFERABILITY,
  labelOf,
  type License,
  type TabProps,
} from "@/components/diligence/types";

interface LicenseForm {
  licenseType: string;
  issuingBody: string;
  licenseNumber: string;
  issuedDate: string;
  expiryDate: string;
  transferability: string;
  status: string;
  notes: string;
}

const EMPTY: LicenseForm = {
  licenseType: "",
  issuingBody: "",
  licenseNumber: "",
  issuedDate: "",
  expiryDate: "",
  transferability: "unknown",
  status: "active",
  notes: "",
};

function toForm(l: License): LicenseForm {
  return {
    licenseType: l.licenseType,
    issuingBody: l.issuingBody,
    licenseNumber: l.licenseNumber,
    issuedDate: l.issuedDate ?? "",
    expiryDate: l.expiryDate ?? "",
    transferability: l.transferability,
    status: l.status,
    notes: l.notes,
  };
}

export default function LicensesTab({ workspaceId, reload }: TabProps) {
  const [form, setForm] = useState<LicenseForm>(EMPTY);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  // Redesigned shell: section data is fetched per tab (the shell
  // passes a slim bundle — identity + counts only).
  const [licenses, setLicenses] = useState<License[]>([]);
  const loadSection = useCallback(async () => {
    try {
      const d = await api<{ licenses: License[] }>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/licenses`
      );
      setLicenses(d.licenses ?? []);
    } catch {
      /* keep the current list on a transient failure */
    }
  }, [workspaceId]);
  useEffect(() => {
    void loadSection();
  }, [loadSection]);
  const set = (patch: Partial<LicenseForm>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    if (!form.licenseType.trim() || saving) return;
    setSaving(true);
    setError("");
    const payload = {
      licenseType: form.licenseType.trim(),
      issuingBody: form.issuingBody.trim(),
      licenseNumber: form.licenseNumber.trim(),
      issuedDate: form.issuedDate || null,
      expiryDate: form.expiryDate || null,
      transferability: form.transferability,
      status: form.status.trim() || "active",
      notes: form.notes,
    };
    try {
      if (editingId) {
        await api(`/api/platform/diligence/licenses/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await api(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/licenses`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }
      setForm(EMPTY);
      setEditingId("");
      await loadSection();
    } catch {
      setError("Could not save that license. A license type is required.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (l: License) => {
    setBusyId(l.id);
    setError("");
    try {
      await api(`/api/platform/diligence/licenses/${encodeURIComponent(l.id)}`, {
        method: "DELETE",
      });
      if (editingId === l.id) {
        setEditingId("");
        setForm(EMPTY);
      }
      await loadSection();
    } catch {
      setError("Could not delete that license. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Licenses & permits
        </h3>
        {licenses.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No licenses recorded yet. Add the first one below.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={thCls}>Type</th>
                  <th className={thCls}>Issuing body</th>
                  <th className={thCls}>Number</th>
                  <th className={thCls}>Issued</th>
                  <th className={thCls}>Expires</th>
                  <th className={thCls}>Transferability</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {licenses.map((l) => {
                  const expiringSoon = withinDays(l.expiryDate, 90);
                  return (
                    <tr
                      key={l.id}
                      className={`border-b border-slate-100 dark:border-white/5 ${
                        expiringSoon ? "bg-amber-50 dark:bg-amber-500/10" : ""
                      }`}
                    >
                      <td className={`${tdCls} font-medium`}>{l.licenseType}</td>
                      <td className={tdCls}>{l.issuingBody || "—"}</td>
                      <td className={tdCls}>{l.licenseNumber || "—"}</td>
                      <td className={tdCls}>{fmtDateShort(l.issuedDate)}</td>
                      <td className={tdCls}>
                        {fmtDateShort(l.expiryDate)}
                        {expiringSoon && (
                          <span className="badge badge-warn ml-2">≤ 90 days</span>
                        )}
                      </td>
                      <td className={tdCls}>
                        <span
                          className={`badge ${
                            l.transferability === "non_transferable"
                              ? "badge-danger"
                              : l.transferability === "consent_required"
                                ? "badge-warn"
                                : l.transferability === "transferable"
                                  ? "badge-fit"
                                  : "badge-neutral"
                          }`}
                        >
                          {labelOf(TRANSFERABILITY, l.transferability)}
                        </span>
                      </td>
                      <td className={tdCls}>{l.status}</td>
                      <td className={tdCls}>
                        <div className="flex gap-1.5">
                          <button
                            type="button"
                            className="btn btn-secondary btn-sm"
                            onClick={() => {
                              setEditingId(l.id);
                              setForm(toForm(l));
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-danger btn-sm"
                            disabled={busyId === l.id}
                            onClick={() => void remove(l)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {licenses.some((l) => l.notes) && (
          <ul className="mt-3 space-y-1 text-xs text-slate-500 dark:text-white/50">
            {licenses
              .filter((l) => l.notes)
              .map((l) => (
                <li key={l.id}>
                  <strong>{l.licenseType}:</strong> {l.notes}
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          {editingId ? "Edit license" : "Add license"}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelCls}>License type</label>
            <input className={inputCls} value={form.licenseType} onChange={(e) => set({ licenseType: e.target.value })} placeholder="e.g. ROC contractor license" />
          </div>
          <div>
            <label className={labelCls}>Issuing body</label>
            <input className={inputCls} value={form.issuingBody} onChange={(e) => set({ issuingBody: e.target.value })} placeholder="e.g. Arizona Registrar of Contractors" />
          </div>
          <div>
            <label className={labelCls}>License number</label>
            <input className={inputCls} value={form.licenseNumber} onChange={(e) => set({ licenseNumber: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Issued date</label>
            <input type="date" className={inputCls} value={form.issuedDate} onChange={(e) => set({ issuedDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Expiry date</label>
            <input type="date" className={inputCls} value={form.expiryDate} onChange={(e) => set({ expiryDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Transferability</label>
            <select className={selectCls} value={form.transferability} onChange={(e) => set({ transferability: e.target.value })}>
              {TRANSFERABILITY.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <input className={inputCls} value={form.status} onChange={(e) => set({ status: e.target.value })} placeholder="active" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Notes</label>
            <input className={inputCls} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={() => void save()} loading={saving} disabled={!form.licenseType.trim()}>
            {editingId ? "Save changes" : "Add license"}
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
