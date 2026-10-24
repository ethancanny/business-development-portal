"use client";

/**
 * Initiative drawer (VCP redesign, §5).
 *
 * Create mode: ONLY title, lever, owner and EBITDA impact are visible
 * up front; everything else lives under a collapsed "More details"
 * section with sensible defaults (status Planned, plan start date,
 * effort 3). Detail mode (row click): the full record — description,
 * KPI with baseline + target, milestones checklist, budget vs actual
 * spend, dependencies, risks, linked documents + process maps,
 * comments with @mentions (the shared platform Comments component),
 * and history. Delete lives only in the header menu, with a confirm.
 */

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui";
import Comments from "@/components/Comments";
import PersonAvatar from "@/components/PersonAvatar";
import Drawer from "@/components/valuecreation/Drawer";
import {
  API,
  INITIATIVE_STATUSES,
  PLAYBOOK_CATEGORIES,
  api,
  fmtDateShort,
  fmtMoneyN,
  inputCls,
  labelCls,
  labelOf,
  parseNum as numOrNull,
  selectCls,
  type Initiative,
  type InitiativeLink,
  type InitiativeMilestone,
  type VcPlan,
} from "@/components/valuecreation/types";

function parseSourceRef(ref: Initiative["sourceRef"]): Record<string, unknown> | null {
  if (!ref) return null;
  if (typeof ref === "object") return ref as Record<string, unknown>;
  try {
    const parsed = JSON.parse(ref) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

interface FormState {
  title: string;
  category: string;
  ownerName: string;
  status: string;
  startDate: string;
  endDate: string;
  oneTimeCost: string;
  recurringCost: string;
  ebitdaImpact: string;
  confidencePct: string;
  effort: string;
  description: string;
  kpiName: string;
  kpiBaseline: string;
  kpiTarget: string;
  kpiUnit: string;
  actualSpend: string;
  risks: string;
  dependsOn: string[];
}

function formFrom(i: Initiative | null, plan: VcPlan): FormState {
  if (!i) {
    return {
      title: "", category: "operations", ownerName: "", status: "planned",
      startDate: plan.planStartDate ? plan.planStartDate.slice(0, 10) : "",
      endDate: "", oneTimeCost: "", recurringCost: "", ebitdaImpact: "",
      confidencePct: "", effort: "3", description: "", kpiName: "",
      kpiBaseline: "", kpiTarget: "", kpiUnit: "", actualSpend: "", risks: "",
      dependsOn: [],
    };
  }
  return {
    title: i.title,
    category: i.category ?? "operations",
    ownerName: i.ownerName ?? "",
    status: i.status,
    startDate: i.startDate ? i.startDate.slice(0, 10) : "",
    endDate: i.endDate ? i.endDate.slice(0, 10) : "",
    oneTimeCost: i.oneTimeCost === null || i.oneTimeCost === undefined ? "" : String(i.oneTimeCost),
    recurringCost: i.recurringCost === null || i.recurringCost === undefined ? "" : String(i.recurringCost),
    ebitdaImpact: i.ebitdaImpact === null || i.ebitdaImpact === undefined ? "" : String(i.ebitdaImpact),
    confidencePct: i.confidence === null || i.confidence === undefined ? "" : String(Math.round(i.confidence * 100)),
    effort: i.effort === null || i.effort === undefined ? "3" : String(i.effort),
    description: i.description ?? "",
    kpiName: i.kpiName ?? "",
    kpiBaseline: i.kpiBaseline === null || i.kpiBaseline === undefined ? "" : String(i.kpiBaseline),
    kpiTarget: i.kpiTarget === null || i.kpiTarget === undefined ? "" : String(i.kpiTarget),
    kpiUnit: i.kpiUnit ?? "",
    actualSpend: i.actualSpend === null || i.actualSpend === undefined ? "" : String(i.actualSpend),
    risks: i.risks ?? "",
    dependsOn: [...(i.dependsOn ?? [])],
  };
}

function sectionTitle(text: string) {
  return (
    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/45">
      {text}
    </h4>
  );
}

export default function InitiativeDrawer({
  planId,
  plan,
  initiatives,
  initiative,
  onClose,
  onSaved,
}: {
  planId: string;
  plan: VcPlan;
  initiatives: Initiative[];
  /** null = create mode. */
  initiative: Initiative | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const isCreate = initiative === null;
  const [form, setForm] = useState<FormState>(() => formFrom(initiative, plan));
  const [moreOpen, setMoreOpen] = useState(!isCreate);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const depCandidates = useMemo(
    () => initiatives.filter((i) => !initiative || i.id !== initiative.id),
    [initiatives, initiative]
  );

  const save = async () => {
    if (!form.title.trim()) {
      setError("Give the initiative a title.");
      return;
    }
    setSaving(true);
    setError("");
    const pct = numOrNull(form.confidencePct);
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      category: form.category || undefined,
      ownerName: form.ownerName.trim(),
      status: form.status,
      startDate: form.startDate || null,
      endDate: form.endDate || null,
      oneTimeCost: numOrNull(form.oneTimeCost),
      recurringCost: numOrNull(form.recurringCost),
      ebitdaImpact: numOrNull(form.ebitdaImpact),
      confidence: pct === null ? null : Math.min(100, Math.max(0, pct)) / 100,
      effort: numOrNull(form.effort),
      description: form.description,
      kpiName: form.kpiName,
      kpiBaseline: numOrNull(form.kpiBaseline),
      kpiTarget: numOrNull(form.kpiTarget),
      kpiUnit: form.kpiUnit,
      actualSpend: numOrNull(form.actualSpend),
      risks: form.risks,
    };
    try {
      let id = initiative?.id;
      if (isCreate) {
        const created = await api<{ initiative: Initiative }>(
          `${API}/plans/${encodeURIComponent(planId)}/initiatives`,
          { method: "POST", body: JSON.stringify(body) }
        );
        id = created.initiative.id;
      } else {
        await api(`${API}/initiatives/${encodeURIComponent(initiative!.id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      if (id && (!isCreate || form.dependsOn.length > 0)) {
        await api(`${API}/initiatives/${encodeURIComponent(id)}/dependencies`, {
          method: "PUT",
          body: JSON.stringify({ dependsOnIds: form.dependsOn }),
        }).catch(() => undefined);
      }
      await onSaved();
      if (isCreate) onClose();
    } catch {
      setError("Could not save the initiative. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!initiative) return;
    setDeleting(true);
    try {
      await api(`${API}/initiatives/${encodeURIComponent(initiative.id)}`, { method: "DELETE" });
      await onSaved();
      onClose();
    } catch {
      setError("Could not delete the initiative. Please try again.");
      setDeleting(false);
    }
  };

  const menu = !isCreate ? (
    <div className="relative shrink-0">
      <button
        type="button"
        aria-label="Initiative actions"
        onClick={() => setMenuOpen((o) => !o)}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 transition hover:bg-[#f0f4fa] hover:text-[#0d1f3c] dark:text-white/60 dark:hover:bg-white/5 dark:hover:text-white"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" />
        </svg>
      </button>
      {menuOpen && (
        <div className="absolute right-0 top-full z-10 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-white/10 dark:bg-[#12294d]">
          <button
            type="button"
            onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
            className="flex min-h-[44px] w-full items-center px-3 text-left text-sm text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
          >
            Delete initiative…
          </button>
        </div>
      )}
    </div>
  ) : undefined;

  const sourceRef = initiative ? parseSourceRef(initiative.sourceRef) : null;

  return (
    <Drawer
      title={isCreate ? "New initiative" : form.title || "Initiative"}
      subtitle={
        isCreate
          ? plan.name
          : `${labelOf(PLAYBOOK_CATEGORIES, form.category)} · ${labelOf(INITIATIVE_STATUSES, form.status)}`
      }
      onClose={onClose}
      menu={menu}
      wide={!isCreate}
    >
      <div className="space-y-5">
        {error && (
          <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
        )}

        {confirmDelete && initiative && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
            <p className="text-sm font-medium text-red-800 dark:text-red-200">
              Delete “{initiative.title}”? Its milestones, comments and links go with it. This cannot be undone.
            </p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="danger" onClick={() => void remove()} loading={deleting}>
                Delete initiative
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Button>
            </div>
          </div>
        )}

        {/* Core fields — the only ones shown up front in create mode. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls}>Title</label>
            <input className={`${inputCls} min-h-[44px]`} value={form.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Reprice top-20 SKUs" autoFocus={isCreate} />
          </div>
          <div>
            <label className={labelCls}>Lever</label>
            <select className={`${selectCls} min-h-[44px]`} value={form.category} onChange={(e) => set({ category: e.target.value })}>
              {PLAYBOOK_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
              {form.category && !PLAYBOOK_CATEGORIES.some((c) => c.key === form.category) && (
                <option value={form.category}>{form.category}</option>
              )}
            </select>
          </div>
          <div>
            <label className={labelCls}>Owner</label>
            <div className="flex items-center gap-2">
              {form.ownerName.trim() && <PersonAvatar name={form.ownerName} size={28} />}
              <input className={`${inputCls} min-h-[44px]`} value={form.ownerName} onChange={(e) => set({ ownerName: e.target.value })} placeholder="Name" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Run-rate EBITDA impact ($ / yr)</label>
            <input inputMode="decimal" className={`${inputCls} min-h-[44px]`} value={form.ebitdaImpact} onChange={(e) => set({ ebitdaImpact: e.target.value })} placeholder="0" />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={`${selectCls} min-h-[44px]`} value={form.status} onChange={(e) => set({ status: e.target.value })}>
              {INITIATIVE_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          className="flex min-h-[40px] w-full items-center justify-between rounded-xl border border-slate-200 px-3.5 text-sm font-medium text-[#0d1f3c] transition hover:bg-[#f0f4fa] dark:border-white/10 dark:text-white dark:hover:bg-white/5"
        >
          More details
          <span aria-hidden="true" className="text-slate-400">{moreOpen ? "▾" : "▸"}</span>
        </button>

        {moreOpen && (
          <div className="space-y-5">
            <div>
              <label className={labelCls}>Description</label>
              <textarea className={`${inputCls} min-h-[72px]`} value={form.description} onChange={(e) => set({ description: e.target.value })} placeholder="What changes, where, and how it produces the impact" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Start date</label>
                <input type="date" className={`${inputCls} min-h-[44px]`} value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>End date</label>
                <input type="date" className={`${inputCls} min-h-[44px]`} value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>One-time cost ($)</label>
                <input inputMode="decimal" className={`${inputCls} min-h-[44px]`} value={form.oneTimeCost} onChange={(e) => set({ oneTimeCost: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Recurring cost ($ / yr)</label>
                <input inputMode="decimal" className={`${inputCls} min-h-[44px]`} value={form.recurringCost} onChange={(e) => set({ recurringCost: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Actual spend to date ($)</label>
                <input inputMode="decimal" className={`${inputCls} min-h-[44px]`} value={form.actualSpend} onChange={(e) => set({ actualSpend: e.target.value })} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Confidence (%)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.confidencePct} onChange={(e) => set({ confidencePct: e.target.value })} placeholder="80" />
              </div>
              <div>
                <label className={labelCls}>Effort (1–5)</label>
                <input inputMode="numeric" className={`${inputCls} min-h-[44px]`} value={form.effort} onChange={(e) => set({ effort: e.target.value })} placeholder="3" />
              </div>
            </div>

            {!isCreate && initiative && (
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm dark:bg-white/5">
                <p className="font-medium text-[#0d1f3c] dark:text-white">Budget vs actual</p>
                <p className="tnum mt-1 text-slate-600 dark:text-white/70">
                  One-time budget {fmtMoneyN(initiative.oneTimeCost)} · actual {fmtMoneyN(initiative.actualSpend)}
                  {initiative.oneTimeCost != null && initiative.actualSpend != null && (
                    <> · variance <span className={initiative.actualSpend > initiative.oneTimeCost ? "font-semibold text-red-600 dark:text-red-300" : "font-semibold text-emerald-600 dark:text-emerald-300"}>{fmtMoneyN(initiative.oneTimeCost - initiative.actualSpend)}</span></>
                  )}
                  {" · "}recurring {fmtMoneyN(initiative.recurringCost)}/yr
                </p>
              </div>
            )}

            <div>
              {sectionTitle("KPI")}
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <label className={labelCls}>KPI name</label>
                  <input className={`${inputCls} min-h-[44px]`} value={form.kpiName} onChange={(e) => set({ kpiName: e.target.value })} placeholder="e.g. Gross margin %" />
                </div>
                <div>
                  <label className={labelCls}>Baseline</label>
                  <input inputMode="decimal" className={`${inputCls} min-h-[44px]`} value={form.kpiBaseline} onChange={(e) => set({ kpiBaseline: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>Target</label>
                  <input inputMode="decimal" className={`${inputCls} min-h-[44px]`} value={form.kpiTarget} onChange={(e) => set({ kpiTarget: e.target.value })} />
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  <input className={`${inputCls} min-h-[44px]`} value={form.kpiUnit} onChange={(e) => set({ kpiUnit: e.target.value })} placeholder="%, $, days…" />
                </div>
              </div>
            </div>

            <div>
              <label className={labelCls}>Risks</label>
              <textarea className={`${inputCls} min-h-[56px]`} value={form.risks} onChange={(e) => set({ risks: e.target.value })} placeholder="What could block or shrink this impact" />
            </div>

            <div>
              {sectionTitle("Depends on")}
              {depCandidates.length === 0 ? (
                <p className="mt-1.5 text-sm text-slate-500 dark:text-white/50">No other initiatives in this plan yet.</p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {depCandidates.map((d) => {
                    const on = form.dependsOn.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set({ dependsOn: on ? form.dependsOn.filter((x) => x !== d.id) : [...form.dependsOn, d.id] })}
                        className={`min-h-[36px] rounded-full border px-3 text-[13px] transition ${
                          on
                            ? "border-[#b8975a] bg-[#b8975a]/10 font-medium text-[#0d1f3c] dark:text-white"
                            : "border-slate-200 text-slate-500 hover:text-[#0d1f3c] dark:border-white/10 dark:text-white/55 dark:hover:text-white"
                        }`}
                      >
                        {d.title}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2 border-t border-slate-100 pt-4 dark:border-white/10">
          <Button onClick={() => void save()} loading={saving}>
            {isCreate ? "Add initiative" : "Save changes"}
          </Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>

        {!isCreate && initiative && (
          <>
            <MilestonesSection planId={planId} initiative={initiative} onChanged={onSaved} />
            <LinksSection planId={planId} initiative={initiative} />
            <div>
              {sectionTitle("Comments")}
              <div className="mt-2">
                <Comments entityKind="vc_initiative" entityId={initiative.id} />
              </div>
            </div>
            <div>
              {sectionTitle("History")}
              <dl className="mt-2 space-y-1 text-sm text-slate-600 dark:text-white/70">
                <div className="flex justify-between gap-3"><dt>Source</dt><dd className="font-medium text-[#0d1f3c] dark:text-white">{initiative.sourceKind}</dd></div>
                {sourceRef && (
                  <div className="flex justify-between gap-3">
                    <dt>Source detail</dt>
                    <dd className="min-w-0 truncate text-right">
                      {String(sourceRef.playbookName ?? sourceRef.findingTitle ?? sourceRef.areaLabel ?? sourceRef.area ?? "—")}
                    </dd>
                  </div>
                )}
                {initiative.createdAt && (
                  <div className="flex justify-between gap-3"><dt>Created</dt><dd>{fmtDateShort(initiative.createdAt)}</dd></div>
                )}
                {initiative.updatedAt && (
                  <div className="flex justify-between gap-3"><dt>Last updated</dt><dd>{fmtDateShort(initiative.updatedAt)}</dd></div>
                )}
                <div className="flex justify-between gap-3">
                  <dt>Progress</dt>
                  <dd>{initiative.progressPct ?? 0}%{initiative.milestonesTotal ? ` · ${initiative.milestonesDone ?? 0}/${initiative.milestonesTotal} milestones` : ""}</dd>
                </div>
              </dl>
            </div>
          </>
        )}
      </div>
    </Drawer>
  );
}

/* ------------------------------ milestones ------------------------------ */

function MilestonesSection({
  initiative,
  onChanged,
}: {
  planId: string;
  initiative: Initiative;
  onChanged: () => Promise<void>;
}) {
  const [items, setItems] = useState<InitiativeMilestone[] | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const d = await api<{ milestones: InitiativeMilestone[] }>(
        `${API}/initiatives/${encodeURIComponent(initiative.id)}/milestones`
      );
      setItems(d.milestones ?? []);
    } catch {
      setItems([]);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initiative.id]);

  const add = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    try {
      await api(`${API}/initiatives/${encodeURIComponent(initiative.id)}/milestones`, {
        method: "POST",
        body: JSON.stringify({ title: title.trim(), dueDate: due || null }),
      });
      setTitle(""); setDue("");
      await load();
      await onChanged();
    } catch { /* surfaced by list staying stale; keep simple */ } finally { setBusy(false); }
  };

  const toggle = async (m: InitiativeMilestone) => {
    await api(`${API}/initiatives/${encodeURIComponent(initiative.id)}/milestones/${encodeURIComponent(m.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ done: !m.done }),
    }).catch(() => undefined);
    await load();
    await onChanged();
  };

  const removeM = async (m: InitiativeMilestone) => {
    await api(`${API}/initiatives/${encodeURIComponent(initiative.id)}/milestones/${encodeURIComponent(m.id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    await load();
    await onChanged();
  };

  return (
    <div>
      {sectionTitle("Milestones")}
      {items === null ? (
        <div className="mt-2 space-y-2" aria-busy="true"><div className="skel h-9" /><div className="skel h-9" /></div>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
          {items.map((m) => (
            <li key={m.id} className="flex min-h-[44px] items-center gap-2.5 py-1.5">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-[#b8975a]"
                checked={m.done}
                onChange={() => void toggle(m)}
                aria-label={`Mark ${m.title} ${m.done ? "not done" : "done"}`}
              />
              <span className={`min-w-0 flex-1 truncate text-sm ${m.done ? "text-slate-400 line-through dark:text-white/35" : "text-[#0d1f3c] dark:text-white/90"}`}>
                {m.title}
              </span>
              {m.dueDate && <span className="tnum shrink-0 text-xs text-slate-500 dark:text-white/50">{fmtDateShort(m.dueDate)}</span>}
              <button type="button" onClick={() => void removeM(m)} aria-label={`Remove milestone ${m.title}`} className="shrink-0 rounded px-1.5 py-1 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300">
                Remove
              </button>
            </li>
          ))}
          {items.length === 0 && (
            <li className="py-2 text-sm text-slate-500 dark:text-white/50">No milestones yet — add the first checkpoint below.</li>
          )}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <input className={`${inputCls} min-h-[40px] min-w-[160px] flex-1`} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Milestone title" />
        <input type="date" className={`${inputCls} min-h-[40px] w-[150px]`} value={due} onChange={(e) => setDue(e.target.value)} aria-label="Milestone due date" />
        <Button size="sm" onClick={() => void add()} loading={busy} disabled={!title.trim()}>Add</Button>
      </div>
    </div>
  );
}

/* --------------------------------- links -------------------------------- */

function LinksSection({ planId, initiative }: { planId: string; initiative: Initiative }) {
  const [links, setLinks] = useState<InitiativeLink[] | null>(null);
  const [diagrams, setDiagrams] = useState<Array<{ id: string; name: string }>>([]);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try {
      const d = await api<{ links: InitiativeLink[] }>(
        `${API}/initiatives/${encodeURIComponent(initiative.id)}/links`
      );
      setLinks(d.links ?? []);
    } catch { setLinks([]); }
    try {
      const d = await api<{ diagrams?: Array<{ id: string; name: string }> }>(
        `${API}/plans/${encodeURIComponent(planId)}/bpmn`
      );
      setDiagrams(d.diagrams ?? []);
    } catch { /* process-map picker is optional */ }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [initiative.id]);

  const addUrl = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    try {
      await api(`${API}/initiatives/${encodeURIComponent(initiative.id)}/links`, {
        method: "POST",
        body: JSON.stringify({ kind: "url", label: label.trim() || url.trim(), url: url.trim() }),
      });
      setLabel(""); setUrl("");
      await load();
    } catch { /* noop */ } finally { setBusy(false); }
  };

  const addMap = async (diagramId: string) => {
    const d = diagrams.find((x) => x.id === diagramId);
    if (!d || busy) return;
    setBusy(true);
    try {
      await api(`${API}/initiatives/${encodeURIComponent(initiative.id)}/links`, {
        method: "POST",
        body: JSON.stringify({ kind: "process_map", label: d.name, refId: d.id }),
      });
      await load();
    } catch { /* noop */ } finally { setBusy(false); }
  };

  const removeL = async (l: InitiativeLink) => {
    await api(`${API}/initiatives/${encodeURIComponent(initiative.id)}/links/${encodeURIComponent(l.id)}`, {
      method: "DELETE",
    }).catch(() => undefined);
    await load();
  };

  return (
    <div>
      {sectionTitle("Linked documents & process maps")}
      {links === null ? (
        <div className="mt-2" aria-busy="true"><div className="skel h-9" /></div>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {links.map((l) => (
            <li key={l.id} className="flex min-h-[36px] items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm dark:bg-white/5">
              <span className="badge badge-neutral shrink-0">{l.kind === "process_map" ? "Process map" : l.kind === "document" ? "Document" : "Link"}</span>
              {l.url ? (
                <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium text-[#0d1f3c] underline decoration-[#b8975a]/60 underline-offset-2 dark:text-white">{l.label}</a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-[#0d1f3c] dark:text-white/90">{l.label}</span>
              )}
              <button type="button" onClick={() => void removeL(l)} aria-label={`Remove link ${l.label}`} className="shrink-0 rounded px-1.5 py-1 text-xs text-slate-400 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300">
                Remove
              </button>
            </li>
          ))}
          {links.length === 0 && (
            <li className="text-sm text-slate-500 dark:text-white/50">Nothing linked yet.</li>
          )}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-2">
        <input className={`${inputCls} min-h-[40px] min-w-[120px] flex-1`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
        <input className={`${inputCls} min-h-[40px] min-w-[160px] flex-1`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <Button size="sm" variant="secondary" onClick={() => void addUrl()} loading={busy} disabled={!url.trim()}>Add link</Button>
      </div>
      {diagrams.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-slate-500 dark:text-white/50">Attach a process map:</span>
          {diagrams.map((d) => (
            <button key={d.id} type="button" onClick={() => void addMap(d.id)} className="min-h-[32px] rounded-full border border-slate-200 px-2.5 text-xs text-slate-600 transition hover:border-[#b8975a]/60 hover:text-[#0d1f3c] dark:border-white/10 dark:text-white/60 dark:hover:text-white">
              {d.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
