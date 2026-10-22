"use client";

/**
 * Add-ons — the bolt-on acquisition pipeline for this platform
 * company: target, status (identified → contacted → diligence →
 * closed / passed), and synergy / revenue / EBITDA estimates.
 * Targets can link to a platform company (name links to its
 * profile) or be free text.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import CompanyPicker from "@/components/valuecreation/CompanyPicker";
import {
  ADDON_STATUSES,
  API,
  addonCompanyId,
  addonName,
  api,
  cardCls,
  fmtMoneyN,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  parseNum,
  selectCls,
  type Addon,
  type CompanyOption,
  type VcTabProps,
} from "@/components/valuecreation/types";

interface AddonForm {
  targetName: string;
  status: string;
  synergyEstimate: string;
  revenueEstimate: string;
  ebitdaEstimate: string;
  notes: string;
}

const EMPTY: AddonForm = {
  targetName: "",
  status: "identified",
  synergyEstimate: "",
  revenueEstimate: "",
  ebitdaEstimate: "",
  notes: "",
};

export default function AddonsTab({ planId }: VcTabProps) {
  const [addons, setAddons] = useState<Addon[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<AddonForm>(EMPTY);
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Record<string, unknown>>(
        `${API}/plans/${encodeURIComponent(planId)}/addons`
      );
      setAddons(listFrom<Addon>(d, "addons", "items"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (patch: Partial<AddonForm>) => setForm((f) => ({ ...f, ...patch }));

  const save = async () => {
    const name = company?.name ?? form.targetName.trim();
    if (!name || saving) return;
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        name,
        targetName: name,
        targetCompanyId: company?.id ?? null,
        status: form.status,
        synergyEstimate: parseNum(form.synergyEstimate),
        revenueEstimate: parseNum(form.revenueEstimate),
        ebitdaEstimate: parseNum(form.ebitdaEstimate),
        notes: form.notes,
      };
      if (editingId) {
        await api(`${API}/addons/${encodeURIComponent(editingId)}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`${API}/plans/${encodeURIComponent(planId)}/addons`, { method: "POST", body: JSON.stringify(body) });
      }
      setForm(EMPTY);
      setCompany(null);
      setEditingId("");
      await load();
    } catch {
      setError("Could not save that add-on. A target name is required.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (a: Addon, status: string) => {
    setBusyId(a.id);
    setError("");
    try {
      await api(`${API}/addons/${encodeURIComponent(a.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await load();
    } catch {
      setError("Could not update that add-on's status.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (a: Addon) => {
    setBusyId(a.id);
    setError("");
    try {
      await api(`${API}/addons/${encodeURIComponent(a.id)}`, { method: "DELETE" });
      if (editingId === a.id) {
        setEditingId("");
        setForm(EMPTY);
        setCompany(null);
      }
      await load();
    } catch {
      setError("Could not delete that add-on. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const totals = addons
    .filter((a) => a.status !== "passed")
    .reduce(
      (acc, a) => ({
        synergy: acc.synergy + (a.synergyEstimate ?? 0),
        ebitda: acc.ebitda + (a.ebitdaEstimate ?? 0),
      }),
      { synergy: 0, ebitda: 0 }
    );

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Add-on pipeline
          </h3>
          <p className="text-sm text-slate-500 dark:text-white/50">
            Pipeline (excl. passed): synergy {fmtMoneyN(totals.synergy)} · target EBITDA {fmtMoneyN(totals.ebitda)}
          </p>
        </div>
        {addons.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No add-on targets yet"
              message="Add the first bolt-on target below — link it to a platform company or enter the name directly."
            />
          </div>
        ) : (
          <>
            <div className="mt-3 hidden overflow-x-auto md:block">
              <table className="tbl-grad w-full min-w-[760px] text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Target</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Synergy est.</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Revenue est.</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">EBITDA est.</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {addons.map((a) => {
                    const cid = addonCompanyId(a);
                    return (
                      <tr key={a.id} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                        <td className="px-3 py-2.5 font-medium">
                          {cid ? (
                            <Link href={`/companies/${encodeURIComponent(cid)}`} className="text-gold-700 hover:underline dark:text-gold-400">
                              {addonName(a)}
                            </Link>
                          ) : (
                            <span className="text-[#0d1f3c] dark:text-white">{addonName(a)}</span>
                          )}
                          {a.notes && <span className="block text-xs font-normal text-slate-500 dark:text-white/50">{a.notes}</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <select
                            aria-label={`Status for ${addonName(a)}`}
                            className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
                            value={a.status}
                            disabled={busyId === a.id}
                            onChange={(e) => void changeStatus(a, e.target.value)}
                          >
                            {ADDON_STATUSES.map((s) => (
                              <option key={s.key} value={s.key}>{s.label}</option>
                            ))}
                          </select>
                        </td>
                        <td className="tnum px-3 py-2.5 text-right">{fmtMoneyN(a.synergyEstimate)}</td>
                        <td className="tnum px-3 py-2.5 text-right">{fmtMoneyN(a.revenueEstimate)}</td>
                        <td className="tnum px-3 py-2.5 text-right">{fmtMoneyN(a.ebitdaEstimate)}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex gap-1.5">
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm"
                              onClick={() => {
                                setEditingId(a.id);
                                setForm({
                                  targetName: addonName(a),
                                  status: a.status,
                                  synergyEstimate: a.synergyEstimate === null ? "" : String(a.synergyEstimate),
                                  revenueEstimate: a.revenueEstimate === null ? "" : String(a.revenueEstimate),
                                  ebitdaEstimate: a.ebitdaEstimate === null ? "" : String(a.ebitdaEstimate),
                                  notes: a.notes ?? "",
                                });
                                setCompany(cid ? { id: cid, name: addonName(a) } : null);
                              }}
                            >
                              Edit
                            </button>
                            <button type="button" className="btn btn-danger btn-sm" disabled={busyId === a.id} onClick={() => void remove(a)}>
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

            <ul className="mt-3 space-y-3 md:hidden">
              {addons.map((a) => {
                const cid = addonCompanyId(a);
                return (
                  <li key={a.id} className="rounded-xl border border-slate-100 p-3.5 dark:border-white/5">
                    <p className="text-sm font-semibold">
                      {cid ? (
                        <Link href={`/companies/${encodeURIComponent(cid)}`} className="text-gold-700 hover:underline dark:text-gold-400">{addonName(a)}</Link>
                      ) : (
                        <span className="text-[#0d1f3c] dark:text-white">{addonName(a)}</span>
                      )}
                    </p>
                    <p className="tnum mt-1 text-sm text-[#0d1f3c] dark:text-white/90">
                      {labelOf(ADDON_STATUSES, a.status)} · synergy {fmtMoneyN(a.synergyEstimate)} · EBITDA {fmtMoneyN(a.ebitdaEstimate)}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <select
                        aria-label={`Status for ${addonName(a)}`}
                        className="min-h-[44px] rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
                        value={a.status}
                        disabled={busyId === a.id}
                        onChange={(e) => void changeStatus(a, e.target.value)}
                      >
                        {ADDON_STATUSES.map((s) => (
                          <option key={s.key} value={s.key}>{s.label}</option>
                        ))}
                      </select>
                      <button type="button" className="btn btn-danger btn-sm min-h-[44px]" disabled={busyId === a.id} onClick={() => void remove(a)}>
                        Delete
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          {editingId ? "Edit add-on target" : "Add add-on target"}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <CompanyPicker
            label="Link a platform company (optional)"
            value={company}
            onChange={(c) => {
              setCompany(c);
              if (c) set({ targetName: c.name });
            }}
          />
          <div>
            <label className={labelCls}>Target name {company ? "(from company)" : ""}</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.targetName} onChange={(e) => set({ targetName: e.target.value })} placeholder="Free-text name when not in the platform" disabled={Boolean(company)} />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={`${selectCls} min-h-[44px]`} value={form.status} onChange={(e) => set({ status: e.target.value })}>
              {ADDON_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Synergy estimate (USD / yr)</label>
            <input type="number" className={`${inputCls} min-h-[44px]`} value={form.synergyEstimate} onChange={(e) => set({ synergyEstimate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Revenue estimate (USD)</label>
            <input type="number" className={`${inputCls} min-h-[44px]`} value={form.revenueEstimate} onChange={(e) => set({ revenueEstimate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>EBITDA estimate (USD)</label>
            <input type="number" className={`${inputCls} min-h-[44px]`} value={form.ebitdaEstimate} onChange={(e) => set({ ebitdaEstimate: e.target.value })} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Notes</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Owner, broker, timing, fit notes…" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void save()} loading={saving} disabled={!(company || form.targetName.trim())}>
            {editingId ? "Save changes" : "Add target"}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={() => { setEditingId(""); setForm(EMPTY); setCompany(null); }}>
              Cancel edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
