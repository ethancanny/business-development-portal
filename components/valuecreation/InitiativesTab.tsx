"use client";

/**
 * Initiatives — the plan's value-creation initiatives with status,
 * owner, dates, costs, EBITDA impact, confidence and effort, plus
 * dependency links (set through the dedicated dependencies route).
 * A remediation section appears at the top when the company's
 * diligence scorecard has low areas that have not been converted.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import {
  API,
  INITIATIVE_STATUSES,
  api,
  cardCls,
  fmtConfidence,
  fmtDateShort,
  fmtMoneyN,
  initiativeStatusBadge,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  parseNum,
  selectCls,
  type Initiative,
  type RemediationCandidate,
  type VcTabProps,
} from "@/components/valuecreation/types";

interface InitForm {
  title: string;
  description: string;
  status: string;
  ownerName: string;
  startDate: string;
  endDate: string;
  oneTimeCost: string;
  recurringCost: string;
  ebitdaImpact: string;
  confidencePct: string;
  effort: string;
  dependsOn: string[];
}

const EMPTY: InitForm = {
  title: "",
  description: "",
  status: "planned",
  ownerName: "",
  startDate: "",
  endDate: "",
  oneTimeCost: "",
  recurringCost: "",
  ebitdaImpact: "",
  confidencePct: "",
  effort: "3",
  dependsOn: [],
};

function toForm(i: Initiative): InitForm {
  return {
    title: i.title,
    description: i.description ?? "",
    status: i.status,
    ownerName: i.ownerName ?? "",
    startDate: i.startDate ?? "",
    endDate: i.endDate ?? "",
    oneTimeCost: i.oneTimeCost === null ? "" : String(i.oneTimeCost),
    recurringCost: i.recurringCost === null ? "" : String(i.recurringCost),
    ebitdaImpact: i.ebitdaImpact === null ? "" : String(i.ebitdaImpact),
    confidencePct:
      i.confidence === null ? "" : String(Math.round(i.confidence * 100)),
    effort: i.effort === null ? "3" : String(i.effort),
    dependsOn: [...(i.dependsOn ?? [])],
  };
}

function toPayload(f: InitForm): Record<string, unknown> {
  const conf = parseNum(f.confidencePct);
  return {
    title: f.title.trim(),
    description: f.description,
    status: f.status,
    ownerName: f.ownerName.trim(),
    startDate: f.startDate || null,
    endDate: f.endDate || null,
    oneTimeCost: parseNum(f.oneTimeCost),
    recurringCost: parseNum(f.recurringCost),
    ebitdaImpact: parseNum(f.ebitdaImpact),
    confidence: conf === null ? null : Math.min(100, Math.max(0, conf)) / 100,
    effort: parseNum(f.effort),
  };
}

export default function InitiativesTab({
  planId,
  initiatives,
  reload,
}: VcTabProps) {
  const [form, setForm] = useState<InitForm>(EMPTY);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  /* remediation */
  const [candidates, setCandidates] = useState<RemediationCandidate[]>([]);
  const [convertingKey, setConvertingKey] = useState("");
  const [convertForm, setConvertForm] = useState<{ ownerName: string; dueDate: string }>({
    ownerName: "",
    dueDate: "",
  });

  const loadCandidates = useCallback(async () => {
    try {
      const d = await api<Record<string, unknown>>(
        `${API}/plans/${encodeURIComponent(planId)}/remediation`
      );
      setCandidates(
        listFrom<RemediationCandidate>(d, "candidates", "items").filter(
          (c) => !c.alreadyConverted
        )
      );
    } catch {
      setCandidates([]);
    }
  }, [planId]);

  useEffect(() => {
    void loadCandidates();
  }, [loadCandidates]);

  const byId = new Map(initiatives.map((i) => [i.id, i]));
  const titleOf = (id: string) => byId.get(id)?.title ?? id;

  const set = (patch: Partial<InitForm>) => setForm((f) => ({ ...f, ...patch }));

  const toggleDep = (id: string) =>
    setForm((f) => ({
      ...f,
      dependsOn: f.dependsOn.includes(id)
        ? f.dependsOn.filter((d) => d !== id)
        : [...f.dependsOn, id],
    }));

  const saveDependencies = async (initiativeId: string, ids: string[]) => {
    await api(
      `${API}/initiatives/${encodeURIComponent(initiativeId)}/dependencies`,
      { method: "PUT", body: JSON.stringify({ dependsOnIds: ids }) }
    );
  };

  const save = async () => {
    if (!form.title.trim() || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      let id = editingId;
      if (editingId) {
        await api(`${API}/initiatives/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify(toPayload(form)),
        });
      } else {
        const created = await api<{ initiative: Initiative }>(
          `${API}/plans/${encodeURIComponent(planId)}/initiatives`,
          { method: "POST", body: JSON.stringify(toPayload(form)) }
        );
        id = created.initiative?.id ?? "";
      }
      if (id) {
        try {
          await saveDependencies(id, form.dependsOn);
        } catch {
          setNotice(
            "Initiative saved, but its dependencies could not be updated — edit it and save again to retry."
          );
        }
      }
      setForm(EMPTY);
      setEditingId("");
      await reload();
    } catch {
      setError("Could not save that initiative. A title is required.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (i: Initiative) => {
    setBusyId(i.id);
    setError("");
    try {
      await api(`${API}/initiatives/${encodeURIComponent(i.id)}`, {
        method: "DELETE",
      });
      if (editingId === i.id) {
        setEditingId("");
        setForm(EMPTY);
      }
      await reload();
    } catch {
      setError("Could not delete that initiative. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const convert = async (c: RemediationCandidate) => {
    const key = `${c.workspaceId}:${c.areaKey}`;
    setConvertingKey(key);
    setError("");
    setNotice("");
    try {
      await api(`${API}/plans/${encodeURIComponent(planId)}/remediation`, {
        method: "POST",
        body: JSON.stringify({
          workspaceId: c.workspaceId,
          areaKey: c.areaKey,
          ownerName: convertForm.ownerName.trim() || undefined,
          dueDate: convertForm.dueDate || undefined,
        }),
      });
      setNotice(
        `Converted “${c.areaLabel ?? c.label ?? c.areaKey}” into an initiative.`
      );
      setConvertForm({ ownerName: "", dueDate: "" });
      await loadCandidates();
      await reload();
    } catch {
      setError("Could not convert that area. Please try again.");
    } finally {
      setConvertingKey("");
    }
  };

  const depOptions = initiatives.filter((i) => i.id !== editingId);

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          {notice}
        </p>
      )}

      {candidates.length > 0 && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            Remediation candidates
          </h3>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            Low diligence scorecard areas for this company that have not yet
            become value-creation work. Converting one creates an initiative
            sourced from the scorecard.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div>
              <label className={labelCls}>Owner (for the conversion)</label>
              <input
                className={`${inputCls} min-h-[44px]`}
                value={convertForm.ownerName}
                onChange={(e) => setConvertForm((f) => ({ ...f, ownerName: e.target.value }))}
                placeholder="e.g. Portfolio ops lead"
              />
            </div>
            <div>
              <label className={labelCls}>Due date</label>
              <input
                type="date"
                className={`${inputCls} min-h-[44px]`}
                value={convertForm.dueDate}
                onChange={(e) => setConvertForm((f) => ({ ...f, dueDate: e.target.value }))}
              />
            </div>
          </div>
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            {candidates.map((c) => {
              const key = `${c.workspaceId}:${c.areaKey}`;
              return (
                <li key={key} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-[200px] flex-1">
                    <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                      {c.areaLabel ?? c.label ?? c.areaKey}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-white/50">
                      Scorecard score {c.score ?? "—"} / 5
                      {c.notes ? ` · ${c.notes}` : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm min-h-[44px]"
                    disabled={convertingKey === key}
                    onClick={() => void convert(c)}
                  >
                    {convertingKey === key ? "Converting…" : "Convert to initiative"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Initiatives
        </h3>
        {initiatives.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No initiatives yet"
              message="Add the first initiative below, instantiate a playbook, or convert a remediation candidate."
            />
          </div>
        ) : (
          <>
            {/* Table on wider screens */}
            <div className="mt-3 hidden overflow-x-auto md:block">
              <table className="tbl-grad w-full min-w-[900px] text-sm">
                <thead>
                  <tr>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Initiative</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Owner</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Window</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Costs (one-time / rec.)</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">EBITDA impact</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Conf.</th>
                    <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Effort</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Depends on</th>
                    <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {initiatives.map((i) => (
                    <tr key={i.id} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                      <td className="px-3 py-2.5">
                        <span className="font-medium text-[#0d1f3c] dark:text-white">{i.title}</span>
                        {i.sourceKind && i.sourceKind !== "manual" && (
                          <span className="badge badge-neutral ml-2">{i.sourceKind}</span>
                        )}
                        {i.description && (
                          <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/50">{i.description}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`badge ${initiativeStatusBadge(i.status)}`}>
                          {labelOf(INITIATIVE_STATUSES, i.status)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">{i.ownerName || "—"}</td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {fmtDateShort(i.startDate)} → {fmtDateShort(i.endDate)}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right">
                        {fmtMoneyN(i.oneTimeCost)} / {fmtMoneyN(i.recurringCost)}
                      </td>
                      <td className="tnum px-3 py-2.5 text-right font-medium">{fmtMoneyN(i.ebitdaImpact)}</td>
                      <td className="tnum px-3 py-2.5 text-right">{fmtConfidence(i.confidence)}</td>
                      <td className="tnum px-3 py-2.5 text-right">{i.effort ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {(i.dependsOn ?? []).length === 0
                          ? "—"
                          : i.dependsOn.map(titleOf).join(", ")}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1.5">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setEditingId(i.id); setForm(toForm(i)); }}>
                            Edit
                          </button>
                          <button type="button" className="btn btn-danger btn-sm" disabled={busyId === i.id} onClick={() => void remove(i)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Cards on mobile */}
            <ul className="mt-3 space-y-3 md:hidden">
              {initiatives.map((i) => (
                <li key={i.id} className="rounded-xl border border-slate-100 p-3.5 dark:border-white/5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">{i.title}</span>
                    <span className={`badge ${initiativeStatusBadge(i.status)}`}>
                      {labelOf(INITIATIVE_STATUSES, i.status)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                    {i.ownerName || "No owner"} · {fmtDateShort(i.startDate)} → {fmtDateShort(i.endDate)}
                  </p>
                  <p className="tnum mt-1 text-sm text-[#0d1f3c] dark:text-white/90">
                    Impact {fmtMoneyN(i.ebitdaImpact)} · conf. {fmtConfidence(i.confidence)} · effort {i.effort ?? "—"}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-white/50">
                    Costs {fmtMoneyN(i.oneTimeCost)} one-time · {fmtMoneyN(i.recurringCost)} recurring
                    {(i.dependsOn ?? []).length > 0 && (
                      <> · depends on {i.dependsOn.map(titleOf).join(", ")}</>
                    )}
                  </p>
                  <div className="mt-2 flex gap-1.5">
                    <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => { setEditingId(i.id); setForm(toForm(i)); }}>
                      Edit
                    </button>
                    <button type="button" className="btn btn-danger btn-sm min-h-[44px]" disabled={busyId === i.id} onClick={() => void remove(i)}>
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          {editingId ? "Edit initiative" : "Add initiative"}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={labelCls}>Title</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Reprice the top 20 SKUs" />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={`${selectCls} min-h-[44px]`} value={form.status} onChange={(e) => set({ status: e.target.value })}>
              {INITIATIVE_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Owner</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} placeholder="Name" />
          </div>
          <div>
            <label className={labelCls}>Start date</label>
            <input type="date" className={`${inputCls} min-h-[44px]`} value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>End date</label>
            <input type="date" className={`${inputCls} min-h-[44px]`} value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>EBITDA impact (USD / yr)</label>
            <input type="number" className={`${inputCls} min-h-[44px]`} value={form.ebitdaImpact} onChange={(e) => set({ ebitdaImpact: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>One-time cost (USD)</label>
            <input type="number" className={`${inputCls} min-h-[44px]`} value={form.oneTimeCost} onChange={(e) => set({ oneTimeCost: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Recurring cost (USD / yr)</label>
            <input type="number" className={`${inputCls} min-h-[44px]`} value={form.recurringCost} onChange={(e) => set({ recurringCost: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Confidence (%)</label>
            <input type="number" min={0} max={100} className={`${inputCls} min-h-[44px]`} value={form.confidencePct} onChange={(e) => set({ confidencePct: e.target.value })} placeholder="e.g. 70" />
          </div>
          <div>
            <label className={labelCls}>Effort (1–5)</label>
            <select className={`${selectCls} min-h-[44px]`} value={form.effort} onChange={(e) => set({ effort: e.target.value })}>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelCls}>Description</label>
            <textarea className={`${inputCls} min-h-[64px]`} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What changes, where, and how it is measured" />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <span className={labelCls}>Depends on</span>
            {depOptions.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-white/50">No other initiatives to depend on yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {depOptions.map((i) => {
                  const active = form.dependsOn.includes(i.id);
                  return (
                    <button
                      key={i.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleDep(i.id)}
                      className={`chip min-h-[44px] ${active ? "chip-active" : ""}`}
                    >
                      {i.title}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void save()} loading={saving} disabled={!form.title.trim()}>
            {editingId ? "Save changes" : "Add initiative"}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={() => { setEditingId(""); setForm(EMPTY); }}>
              Cancel edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
