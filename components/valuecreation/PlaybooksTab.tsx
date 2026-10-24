"use client";

/**
 * Playbooks — reusable initiative bundles. Each card shows the
 * category, step count and total typical EBITDA impact; Instantiate
 * copies its steps into this plan as initiatives (owner + start
 * date supplied at instantiate time). Custom playbooks are created
 * with a simple repeatable-rows steps editor.
 */

import { useCallback, useEffect, useState } from "react";
import { Button, CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import {
  API,
  PLAYBOOK_CATEGORIES,
  api,
  cardCls,
  fmtMoneyN,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  parseNum,
  playbookStepImpact,
  playbookTypicalImpact,
  selectCls,
  todayIso,
  type Playbook,
  type PlaybookStep,
  type VcTabProps,
} from "@/components/valuecreation/types";

interface StepRow {
  title: string;
  description: string;
  ebitdaImpact: string;
  effort: string;
  confidencePct: string;
  durationDays: string;
}

const EMPTY_STEP: StepRow = {
  title: "",
  description: "",
  ebitdaImpact: "",
  effort: "3",
  confidencePct: "70",
  durationDays: "30",
};

export default function PlaybooksTab({ planId, reload, companyVertical }: VcTabProps) {
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [instFor, setInstFor] = useState<string>("");
  const [instForm, setInstForm] = useState({ ownerName: "", startDate: todayIso() });
  const [instBusy, setInstBusy] = useState(false);

  const [form, setForm] = useState({ name: "", category: PLAYBOOK_CATEGORIES[0].key, description: "" });
  const [steps, setSteps] = useState<StepRow[]>([{ ...EMPTY_STEP }]);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Record<string, unknown>>(`${API}/playbooks`);
      setPlaybooks(listFrom<Playbook>(d, "playbooks", "items"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const instantiate = async (p: Playbook) => {
    setInstBusy(true);
    setError("");
    setNotice("");
    try {
      const res = await api<{ created?: number; initiatives?: unknown[] }>(
        `${API}/plans/${encodeURIComponent(planId)}/playbooks/${encodeURIComponent(p.id)}/instantiate`,
        {
          method: "POST",
          body: JSON.stringify({
            ownerName: instForm.ownerName.trim() || undefined,
            startDate: instForm.startDate || undefined,
          }),
        }
      );
      const n = res.created ?? (Array.isArray(res.initiatives) ? res.initiatives.length : p.steps.length);
      setNotice(`“${p.name}” instantiated — ${n} initiative${n === 1 ? "" : "s"} added to the plan.`);
      setInstFor("");
      await reload();
    } catch {
      setError("Could not instantiate that playbook. Please try again.");
    } finally {
      setInstBusy(false);
    }
  };

  const save = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const payloadSteps: PlaybookStep[] = steps
        .filter((s) => s.title.trim())
        .map((s) => {
          const conf = parseNum(s.confidencePct);
          return {
            title: s.title.trim(),
            description: s.description,
            typicalImpact: parseNum(s.ebitdaImpact),
            effort: parseNum(s.effort),
            confidence: conf === null ? null : Math.min(100, Math.max(0, conf)) / 100,
            durationDays: parseNum(s.durationDays),
          };
        });
      const body = { name: form.name.trim(), category: form.category, description: form.description, steps: payloadSteps };
      if (editingId) {
        await api(`${API}/playbooks/${encodeURIComponent(editingId)}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`${API}/playbooks`, { method: "POST", body: JSON.stringify(body) });
      }
      setForm({ name: "", category: PLAYBOOK_CATEGORIES[0].key, description: "" });
      setSteps([{ ...EMPTY_STEP }]);
      setEditingId("");
      await load();
    } catch {
      setError("Could not save that playbook. A name is required.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Playbook) => {
    setBusyId(p.id);
    setError("");
    try {
      await api(`${API}/playbooks/${encodeURIComponent(p.id)}`, { method: "DELETE" });
      await load();
    } catch {
      setError("Could not delete that playbook. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const setStep = (idx: number, patch: Partial<StepRow>) =>
    setSteps((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  if (loading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
        {Array.from({ length: 3 }).map((_, i) => (
          <CardSkeleton key={i} lines={3} />
        ))}
      </div>
    );
  }
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}
      {notice && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>
      )}

      {playbooks.length === 0 ? (
        <EmptyState
          title="No playbooks yet"
          message="Create the first reusable playbook below — each one bundles the steps that become initiatives when instantiated into a plan."
        />
      ) : (
        <>
        {companyVertical && playbooks.some((p) => p.industry === companyVertical) && (
          <p className="rounded-xl bg-[#b8975a]/10 px-4 py-3 text-sm text-[#0d1f3c] dark:text-white/85">
            <span className="font-semibold">{companyVertical} playbooks</span> for this
            company are listed first — the seeded set covers quoting &amp; pricing,
            machine utilization &amp; OEE, scrap &amp; rework, quality systems,
            supplier consolidation, workforce &amp; apprenticeship and working capital.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...playbooks]
            .sort((a, b) => {
              const am = companyVertical && a.industry === companyVertical ? 0 : 1;
              const bm = companyVertical && b.industry === companyVertical ? 0 : 1;
              return am - bm;
            })
            .map((p) => (
            <div key={p.id} className={cardCls}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-display text-xl font-semibold text-[#0d1f3c] dark:text-white">{p.name}</h3>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="badge badge-neutral">{labelOf(PLAYBOOK_CATEGORIES, p.category)}</span>
                  {p.industry && (
                    <span className="badge badge-fit">{p.industry}</span>
                  )}
                </span>
              </div>
              {p.description && (
                <p className="mt-1 text-sm text-slate-500 dark:text-white/50">{p.description}</p>
              )}
              <p className="tnum mt-3 text-sm text-[#0d1f3c] dark:text-white/90">
                {(p.steps ?? []).length} step{(p.steps ?? []).length === 1 ? "" : "s"} · typical impact{" "}
                <span className="font-semibold">{fmtMoneyN(playbookTypicalImpact(p))}</span>
              </p>
              {(p.steps ?? []).length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-slate-500 dark:text-white/50">
                  {p.steps.slice(0, 5).map((s, i) => (
                    <li key={i}>{s.title}</li>
                  ))}
                  {p.steps.length > 5 && <li>… and {p.steps.length - 5} more</li>}
                </ul>
              )}
              {instFor === p.id ? (
                <div className="mt-4 space-y-2 border-t border-slate-100 pt-3 dark:border-white/5">
                  <div>
                    <label className={labelCls}>Owner for new initiatives</label>
                    <input className={`${inputCls} min-h-[44px]`} value={instForm.ownerName} onChange={(e) => setInstForm((f) => ({ ...f, ownerName: e.target.value }))} placeholder="Name" />
                  </div>
                  <div>
                    <label className={labelCls}>Start date</label>
                    <input type="date" className={`${inputCls} min-h-[44px]`} value={instForm.startDate} onChange={(e) => setInstForm((f) => ({ ...f, startDate: e.target.value }))} />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void instantiate(p)} loading={instBusy}>
                      Instantiate
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setInstFor("")}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm min-h-[44px]" onClick={() => setInstFor(p.id)}>
                    Instantiate into plan
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm min-h-[44px]"
                    onClick={() => {
                      setEditingId(p.id);
                      setForm({ name: p.name, category: p.category, description: p.description ?? "" });
                      setSteps(
                        (p.steps ?? []).map((s) => ({
                          title: s.title,
                          description: s.description ?? "",
                          ebitdaImpact: String(playbookStepImpact(s) || ""),
                          effort: s.effort === null || s.effort === undefined ? "3" : String(s.effort),
                          confidencePct: s.confidence === null || s.confidence === undefined ? "" : String(Math.round(s.confidence * 100)),
                          durationDays: s.durationDays === null || s.durationDays === undefined ? "" : String(s.durationDays),
                        }))
                      );
                    }}
                  >
                    Edit
                  </button>
                  <button type="button" className="btn btn-danger btn-sm min-h-[44px]" disabled={busyId === p.id} onClick={() => void remove(p)}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        </>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          {editingId ? "Edit playbook" : "New custom playbook"}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Name</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Pricing excellence sprint" />
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <select className={`${selectCls} min-h-[44px]`} value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {PLAYBOOK_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Description</label>
            <textarea className={`${inputCls} min-h-[56px]`} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="When this playbook applies and what it achieves" />
          </div>
        </div>

        <p className={`${labelCls} mt-4`}>Steps</p>
        <div className="space-y-3">
          {steps.map((s, idx) => (
            <div key={idx} className="rounded-xl border border-slate-100 p-3 dark:border-white/5">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                <div className="sm:col-span-2">
                  <label className={labelCls}>Step {idx + 1} title</label>
                  <input className={`${inputCls} min-h-[44px]`} value={s.title} onChange={(e) => setStep(idx, { title: e.target.value })} placeholder="Step title" />
                </div>
                <div>
                  <label className={labelCls}>EBITDA impact (USD)</label>
                  <input type="number" className={`${inputCls} min-h-[44px]`} value={s.ebitdaImpact} onChange={(e) => setStep(idx, { ebitdaImpact: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>Duration (days)</label>
                  <input type="number" className={`${inputCls} min-h-[44px]`} value={s.durationDays} onChange={(e) => setStep(idx, { durationDays: e.target.value })} />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelCls}>Description</label>
                  <input className={`${inputCls} min-h-[44px]`} value={s.description} onChange={(e) => setStep(idx, { description: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>Effort (1–5)</label>
                  <select className={`${selectCls} min-h-[44px]`} value={s.effort} onChange={(e) => setStep(idx, { effort: e.target.value })}>
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Confidence (%)</label>
                  <input type="number" min={0} max={100} className={`${inputCls} min-h-[44px]`} value={s.confidencePct} onChange={(e) => setStep(idx, { confidencePct: e.target.value })} />
                </div>
              </div>
              {steps.length > 1 && (
                <button type="button" className="btn btn-ghost btn-sm mt-2 min-h-[44px]" onClick={() => setSteps((rows) => rows.filter((_, i) => i !== idx))}>
                  Remove step
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" className="btn btn-secondary btn-sm mt-3 min-h-[44px]" onClick={() => setSteps((rows) => [...rows, { ...EMPTY_STEP }])}>
          + Add step
        </button>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void save()} loading={saving} disabled={!form.name.trim()}>
            {editingId ? "Save changes" : "Create playbook"}
          </Button>
          {editingId && (
            <Button variant="ghost" onClick={() => { setEditingId(""); setForm({ name: "", category: PLAYBOOK_CATEGORIES[0].key, description: "" }); setSteps([{ ...EMPTY_STEP }]); }}>
              Cancel edit
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
