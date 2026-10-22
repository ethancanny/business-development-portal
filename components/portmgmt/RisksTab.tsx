"use client";

/**
 * Risks tab (Phase 9, internal) — per-company risk register: CRUD
 * through /api/portmgmt/companies/[companyId]/risks with severity
 * chips, status, owner and mitigation notes. Editing is inline via
 * the same form used for creation (PATCH when an id is selected).
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { ErrorBanner, Section, SimpleTable } from "@/components/monitoring/shared";
import {
  dateOnly,
  fmtDateShort,
  inputCls,
  labelCls,
  selectCls,
  severityBadge,
  type MonitoringTabProps,
} from "@/components/monitoring/types";
import { api, pick, pmCompany, rowsFrom, str, type Rec } from "@/components/portmgmt/pm";

const SEVERITIES = ["low", "medium", "high", "critical"] as const;
const STATUSES = ["open", "mitigating", "accepted", "closed"] as const;

const EMPTY = { title: "", category: "", severity: "medium", likelihood: "", status: "open", owner: "", mitigation: "" };

export default function RisksTab({ companyId }: MonitoringTabProps) {
  const base = `${pmCompany(companyId)}/risks`;
  const [risks, setRisks] = useState<Rec[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Rec>(base);
      setRisks(rowsFrom(d, "risks", "items"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    setError("");
    const payload = {
      title: form.title.trim(),
      category: form.category.trim() || undefined,
      severity: form.severity,
      likelihood: form.likelihood.trim() || undefined,
      status: form.status,
      owner: form.owner.trim() || undefined,
      mitigation: form.mitigation.trim() || undefined,
      notes: form.mitigation.trim() || undefined,
    };
    try {
      if (editingId) {
        await api(`${base}/${encodeURIComponent(editingId)}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await api(base, { method: "POST", body: JSON.stringify(payload) });
      }
      setForm(EMPTY);
      setEditingId("");
      await load();
    } catch {
      setError("Could not save that risk.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm("Delete this risk from the register?")) return;
    setBusyId(id);
    setError("");
    try {
      await api(`${base}/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (editingId === id) {
        setEditingId("");
        setForm(EMPTY);
      }
      await load();
    } catch {
      setError("Could not delete that risk.");
    } finally {
      setBusyId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      <ErrorBanner message={error} />
      <Section title="Risk register" caption="The live risk register for this company. Severity is the chip; status tracks how the risk is being handled.">
        {risks.length === 0 ? (
          <EmptyState title="No risks recorded" message="The register is empty — add the first risk below." />
        ) : (
          <SimpleTable
            rows={risks}
            rowKey={(r, i) => str(pick(r, "id")) || String(i)}
            columns={[
              { key: "title", label: "Risk", value: (r) => str(pick(r, "title")) || "—" },
              { key: "category", label: "Category", value: (r) => str(pick(r, "category")) || "—" },
              {
                key: "severity",
                label: "Severity",
                render: (r) => {
                  const s = str(pick(r, "severity"));
                  return s ? <span className={`badge ${severityBadge(s)}`}>{s}</span> : "—";
                },
              },
              { key: "status", label: "Status", value: (r) => str(pick(r, "status")) || "—" },
              { key: "owner", label: "Owner", value: (r) => str(pick(r, "owner")) || "—" },
              { key: "updated", label: "Updated", value: (r) => fmtDateShort(dateOnly(pick(r, "updatedAt")) || str(pick(r, "updatedAt"))) },
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
                          setEditingId(id);
                          setForm({
                            title: str(pick(r, "title")),
                            category: str(pick(r, "category")),
                            severity: str(pick(r, "severity")) || "medium",
                            likelihood: str(pick(r, "likelihood")),
                            status: str(pick(r, "status")) || "open",
                            owner: str(pick(r, "owner")),
                            mitigation: str(pick(r, "mitigation", "notes")),
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm min-h-[44px]"
                        disabled={busyId === id}
                        onClick={() => void remove(id)}
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
            {editingId ? "Edit risk" : "Add a risk"}
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2">
              <label className={labelCls}>Title</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Customer concentration — top client is 32% of revenue" />
            </div>
            <div>
              <label className={labelCls}>Category</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Commercial" />
            </div>
            <div>
              <label className={labelCls}>Severity</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Likelihood</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.likelihood} onChange={(e) => setForm((f) => ({ ...f, likelihood: e.target.value }))} placeholder="e.g. Possible" />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Owner</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelCls}>Mitigation / notes</label>
              <textarea className={`${inputCls} min-h-[72px]`} value={form.mitigation} onChange={(e) => setForm((f) => ({ ...f, mitigation: e.target.value }))} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button className="min-h-[44px]" loading={saving} disabled={!form.title.trim()} onClick={() => void save()}>
              {editingId ? "Save risk" : "Add risk"}
            </Button>
            {editingId && (
              <Button
                variant="ghost"
                className="min-h-[44px]"
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
      </Section>
    </div>
  );
}
