"use client";

import { useState } from "react";
import { DEAL_STAGES, EXEC_STAGES, PARTNER_NAMES, type Deal, type Executive } from "@/lib/types";
import { fmtMoney, fmtDate } from "@/lib/format";

const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#b8975a] focus:outline-none dark:border-white/15 dark:bg-[#0d1f3c] dark:text-[#e8dfc8] dark:placeholder:text-white/30";
const labelCls = "mb-1 block text-xs font-medium text-slate-600 dark:text-[#c8bfa8]";

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 dark:bg-black/60"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-white/10 dark:bg-[#132847] dark:shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-900 dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-white/40">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-slate-800 dark:text-[#e8dfc8]">{value || "—"}</p>
    </div>
  );
}

// ---------------- Deal modal ----------------

function DupeWarning({
  deal,
  allDeals,
  name,
}: {
  deal: Deal | null;
  allDeals: Deal[];
  name: string;
}) {
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, "");
  const q = norm(name);
  if (q.length <= 2) return null;
  const dupe = allDeals.find(
    (d) =>
      d.id !== deal?.id &&
      (norm(d.companyName) === q ||
        norm(d.companyName).includes(q) ||
        q.includes(norm(d.companyName)))
  );
  if (!dupe) return null;
  return (
    <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/15 dark:text-amber-200">
      Possible duplicate: &ldquo;{dupe.companyName}&rdquo; is already in the
      pipeline ({dupe.stage}).
    </p>
  );
}

interface DealModalProps {
  deal: Deal | null; // null = create new
  executives?: Executive[];
  allDeals?: Deal[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function DealModal({ deal, executives = [], allDeals = [], onClose, onSaved, onDeleted }: DealModalProps) {
  const isNew = !deal;
  const [editing, setEditing] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    companyName: deal?.companyName ?? "",
    industry: deal?.industry ?? "",
    stage: deal?.stage ?? ("Sourcing" as Deal["stage"]),
    dealValue: deal?.dealValue?.toString() ?? "",
    contactName: deal?.contactName ?? "",
    contactEmail: deal?.contactEmail ?? "",
    notes: deal?.notes ?? "",
    owner: deal?.owner ?? "",
    city: deal?.city ?? "",
    operatorIds: deal?.operatorIds ?? [],
    revenue: deal?.revenue != null ? String(deal.revenue) : "",
    ebitda: deal?.ebitda != null ? String(deal.ebitda) : "",
    askingPrice: deal?.askingPrice != null ? String(deal.askingPrice) : "",
    broker: deal?.broker ?? "",
    source: deal?.source ?? "",
    links: (deal?.links ?? [])
      .map((l) => ({ label: l.label ?? "", url: l.url ?? "" }))
      .concat([{ label: "", url: "" }]),
  });

  const setLink = (i: number, k: "label" | "url", v: string) =>
    setForm((f) => ({
      ...f,
      links: f.links.map((l, j) => (j === i ? { ...l, [k]: v } : l)),
    }));

  const addLinkRow = () =>
    setForm((f) => ({ ...f, links: [...f.links, { label: "", url: "" }] }));

  const removeLinkRow = (i: number) =>
    setForm((f) => ({ ...f, links: f.links.filter((_, j) => j !== i) }));

  const toggleOperator = (id: string) =>
    setForm((f) => ({
      ...f,
      operatorIds: f.operatorIds.includes(id)
        ? f.operatorIds.filter((x) => x !== id)
        : [...f.operatorIds, id],
    }));

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.companyName.trim()) {
      setError("Company name is required");
      return;
    }
    setBusy(true);
    setError("");
    const payload = {
      ...form,
      dealValue: Number(form.dealValue) || 0,
      links: form.links.filter((l) => l.url.trim() !== ""),
      operatorIds: form.operatorIds,
      revenue: form.revenue.trim() === "" ? null : Number(form.revenue) || null,
      ebitda: form.ebitda.trim() === "" ? null : Number(form.ebitda) || null,
      askingPrice:
        form.askingPrice.trim() === "" ? null : Number(form.askingPrice) || null,
    };
    const res = await fetch(isNew ? "/api/deals" : `/api/deals/${deal!.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to save");
    }
  };

  const remove = async () => {
    if (!deal || !window.confirm(`Delete "${deal.companyName}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/deals/${deal.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onDeleted();
    else setError("Failed to delete");
  };

  return (
    <ModalShell title={isNew ? "New Acquisition Target" : deal!.companyName} onClose={onClose}>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}
      {editing && <DupeWarning deal={deal} allDeals={allDeals} name={form.companyName} />}

      {!editing && deal ? (
        <div className="flex flex-col divide-y divide-slate-100 dark:divide-white/10">
          <DetailRow label="Industry" value={deal.industry} />
          <DetailRow label="City" value={deal.city} />
          <DetailRow label="Stage" value={deal.stage} />
          <DetailRow label="Deal value" value={fmtMoney(deal.dealValue)} />
          <DetailRow
            label="Revenue"
            value={deal.revenue != null ? fmtMoney(deal.revenue) : "—"}
          />
          <DetailRow
            label="EBITDA"
            value={deal.ebitda != null ? fmtMoney(deal.ebitda) : "—"}
          />
          <DetailRow
            label="Asking price"
            value={deal.askingPrice != null ? fmtMoney(deal.askingPrice) : "—"}
          />
          <DetailRow label="Broker" value={deal.broker || "—"} />
          <DetailRow label="Source" value={deal.source || "—"} />
          <DetailRow label="Contact" value={deal.contactName} />
          <DetailRow label="Contact email" value={deal.contactEmail} />
          <DetailRow label="Owner" value={deal.owner} />
          <DetailRow
            label="Paired operators"
            value={
              deal.operatorIds && deal.operatorIds.length > 0 ? (
                <span className="flex flex-col gap-0.5">
                  {deal.operatorIds.map((id) => {
                    const op = executives.find((e) => e.id === id);
                    return (
                      <span key={id}>
                        {op ? op.name : "Unknown operator"}
                        {op && op.industries && op.industries.length > 0 && (
                          <span className="text-slate-400 dark:text-white/40">
                            {" "}
                            · {op.industries.join(", ")}
                          </span>
                        )}
                      </span>
                    );
                  })}
                </span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow
            label="Links"
            value={
              deal.links && deal.links.length > 0 ? (
                <span className="flex flex-col gap-1">
                  {deal.links.map((l, i) => (
                    <a
                      key={i}
                      href={l.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                    >
                      {l.label || l.url} ↗
                    </a>
                  ))}
                </span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow label="Notes" value={<span className="whitespace-pre-wrap text-slate-800 dark:text-[#e8dfc8]">{deal.notes}</span>} />
          <DetailRow label="Created" value={fmtDate(deal.createdAt)} />
          <DetailRow label="Updated" value={fmtDate(deal.updatedAt)} />
          <div className="flex gap-2 pt-4">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
            >
              Edit
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Company name *">
            <input className={inputCls} value={form.companyName} onChange={set("companyName")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Industry">
              <input className={inputCls} value={form.industry} onChange={set("industry")} />
            </Field>
            <Field label="City">
              <input
                className={inputCls}
                value={form.city}
                onChange={set("city")}
                placeholder="e.g. Scottsdale, AZ"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deal value (USD)">
              <input
                type="number"
                min="0"
                className={inputCls}
                value={form.dealValue}
                onChange={set("dealValue")}
              />
            </Field>
            <Field label="Asking price (USD)">
              <input
                type="number"
                min="0"
                className={inputCls}
                value={form.askingPrice}
                onChange={set("askingPrice")}
                placeholder="—"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Revenue (USD)">
              <input
                type="number"
                min="0"
                className={inputCls}
                value={form.revenue}
                onChange={set("revenue")}
                placeholder="—"
              />
            </Field>
            <Field label="EBITDA (USD)">
              <input
                type="number"
                min="0"
                className={inputCls}
                value={form.ebitda}
                onChange={set("ebitda")}
                placeholder="—"
              />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Broker / intermediary">
              <input
                className={inputCls}
                value={form.broker}
                onChange={set("broker")}
                placeholder="—"
              />
            </Field>
            <Field label="Source">
              <select className={inputCls} value={form.source} onChange={set("source")}>
                <option value="">—</option>
                <option value="Proprietary">Proprietary</option>
                <option value="Intermediated">Intermediated</option>
                <option value="Referral">Referral</option>
                <option value="Inbound">Inbound</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Stage">
              <select className={inputCls} value={form.stage} onChange={set("stage")}>
                {DEAL_STAGES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Contact name">
              <input className={inputCls} value={form.contactName} onChange={set("contactName")} />
            </Field>
            <Field label="Contact email">
              <input type="email" className={inputCls} value={form.contactEmail} onChange={set("contactEmail")} />
            </Field>
          </div>
          <Field label="Claimed by">
            <select
              className={inputCls}
              value={form.owner}
              onChange={set("owner")}
            >
              <option value="">Unclaimed</option>
              {PARTNER_NAMES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Paired operators">
            {executives.length === 0 ? (
              <p className="text-xs text-slate-400 dark:text-white/40">
                No executives yet — add candidates in Executive Sourcing first.
              </p>
            ) : (
              <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-slate-300 p-2 dark:border-white/15">
                {executives.map((e) => {
                  const isMatch =
                    form.industry.trim() !== "" &&
                    (e.industries ?? []).some(
                      (ind) =>
                        ind.toLowerCase() === form.industry.trim().toLowerCase()
                    );
                  return (
                    <label
                      key={e.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-slate-100 dark:hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        checked={form.operatorIds.includes(e.id)}
                        onChange={() => toggleOperator(e.id)}
                        className="h-4 w-4 accent-[#b8975a]"
                      />
                      <span className="text-slate-800 dark:text-[#e8dfc8]">
                        {e.name}
                      </span>
                      {isMatch && (
                        <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-px text-[10px] font-bold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
                          ✓ industry match
                        </span>
                      )}
                      {e.industries && e.industries.length > 0 && (
                        <span className="truncate text-xs text-slate-400 dark:text-white/40">
                          {e.industries.join(", ")}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}
          </Field>
          <Field label="Notes">
            <textarea className={inputCls} rows={3} value={form.notes} onChange={set("notes")} />
          </Field>
          <Field label="Links (CIM, data room, website…)">
            <div className="flex flex-col gap-2">
              {form.links.map((l, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    className={inputCls}
                    value={l.label}
                    onChange={(e) => setLink(i, "label", e.target.value)}
                    placeholder="Label"
                  />
                  <input
                    className={`${inputCls} flex-[2]`}
                    value={l.url}
                    onChange={(e) => setLink(i, "url", e.target.value)}
                    placeholder="https://…"
                  />
                  <button
                    type="button"
                    onClick={() => removeLinkRow(i)}
                    className="shrink-0 rounded-lg px-2 text-sm text-slate-400 hover:bg-red-50 hover:text-red-600 dark:text-white/40 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                    aria-label="Remove link"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={addLinkRow}
                className="self-start text-xs font-semibold text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
              >
                + Add link
              </button>
            </div>
          </Field>
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
            >
              {busy ? "Saving…" : isNew ? "Add deal" : "Save changes"}
            </button>
            {!isNew && (
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-[#e8dfc8] dark:hover:bg-white/15"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}

// ---------------- Executive modal ----------------

interface ExecutiveModalProps {
  exec: Executive | null; // null = create new
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

export function ExecutiveModal({ exec, onClose, onSaved, onDeleted }: ExecutiveModalProps) {
  const isNew = !exec;
  const [editing, setEditing] = useState(isNew);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    name: exec?.name ?? "",
    currentTitle: exec?.currentTitle ?? "",
    targetRole: exec?.targetRole ?? "",
    stage: exec?.stage ?? ("Sourcing" as Executive["stage"]),
    background: exec?.background ?? "",
    notes: exec?.notes ?? "",
    owner: exec?.owner ?? "",
    industries: (exec?.industries ?? []).join(", "),
  });

  const set = (k: keyof typeof form) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async () => {
    if (!form.name.trim()) {
      setError("Name is required");
      return;
    }
    setBusy(true);
    setError("");
    const payload = { ...form, industries: form.industries };
    const res = await fetch(isNew ? "/api/executives" : `/api/executives/${exec!.id}`, {
      method: isNew ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    setBusy(false);
    if (res.ok) onSaved();
    else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || "Failed to save");
    }
  };

  const remove = async () => {
    if (!exec || !window.confirm(`Delete "${exec.name}"?`)) return;
    setBusy(true);
    const res = await fetch(`/api/executives/${exec.id}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) onDeleted();
    else setError("Failed to delete");
  };

  return (
    <ModalShell title={isNew ? "New Executive Candidate" : exec!.name} onClose={onClose}>
      {error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-500/15 dark:text-red-300">{error}</p>
      )}

      {!editing && exec ? (
        <div className="flex flex-col divide-y divide-slate-100 dark:divide-white/10">
          <DetailRow label="Current title" value={exec.currentTitle} />
          <DetailRow label="Target role" value={exec.targetRole} />
          <DetailRow label="Stage" value={exec.stage} />
          <DetailRow label="Owner" value={exec.owner} />
          <DetailRow
            label="Industries"
            value={
              exec.industries && exec.industries.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {exec.industries.map((ind) => (
                    <span
                      key={ind}
                      className="rounded-full bg-[#b8975a]/15 px-2 py-0.5 text-xs font-medium text-[#8a6f3c] dark:text-[#d4b37a]"
                    >
                      {ind}
                    </span>
                  ))}
                </span>
              ) : (
                "—"
              )
            }
          />
          <DetailRow label="Background" value={<span className="whitespace-pre-wrap">{exec.background}</span>} />
          <DetailRow label="Notes" value={<span className="whitespace-pre-wrap">{exec.notes}</span>} />
          <DetailRow label="Created" value={fmtDate(exec.createdAt)} />
          <DetailRow label="Updated" value={fmtDate(exec.updatedAt)} />
          <div className="flex gap-2 pt-4">
            <button
              onClick={() => setEditing(true)}
              className="flex-1 rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
            >
              Edit
            </button>
            <button
              onClick={remove}
              disabled={busy}
              className="rounded-lg bg-red-50 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25"
            >
              Delete
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Field label="Name *">
            <input className={inputCls} value={form.name} onChange={set("name")} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current title">
              <input className={inputCls} value={form.currentTitle} onChange={set("currentTitle")} />
            </Field>
            <Field label="Target role">
              <input className={inputCls} value={form.targetRole} onChange={set("targetRole")} />
            </Field>
          </div>
          <Field label="Stage">
            <select className={inputCls} value={form.stage} onChange={set("stage")}>
              {EXEC_STAGES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="Claimed by">
            <select
              className={inputCls}
              value={form.owner}
              onChange={set("owner")}
            >
              <option value="">Unclaimed</option>
              {PARTNER_NAMES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="Industries / sectors (comma-separated)">
            <input
              className={inputCls}
              value={form.industries}
              onChange={set("industries")}
              placeholder="e.g. Industrial Services, Healthcare"
            />
          </Field>
          <Field label="Background">
            <textarea className={inputCls} rows={3} value={form.background} onChange={set("background")} />
          </Field>
          <Field label="Notes">
            <textarea className={inputCls} rows={3} value={form.notes} onChange={set("notes")} />
          </Field>
          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={busy}
              className="flex-1 rounded-lg bg-[#0d1f3c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
            >
              {busy ? "Saving…" : isNew ? "Add candidate" : "Save changes"}
            </button>
            {!isNew && (
              <button
                onClick={() => setEditing(false)}
                className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-200 dark:bg-white/10 dark:text-[#e8dfc8] dark:hover:bg-white/15"
              >
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
