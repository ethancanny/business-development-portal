"use client";

/**
 * Findings & proposed deal terms — each finding can propose a term
 * (working-capital peg, holdback, earnout, …) that is accepted or
 * rejected, optionally linked to a red flag.
 */

import { useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  selectCls,
  SEVERITIES,
  TERM_TYPES,
  labelOf,
  type Finding,
  type TabProps,
} from "@/components/diligence/types";

export default function FindingsTab({ workspaceId, bundle, reload }: TabProps) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "",
    detail: "",
    category: "",
    severity: "medium",
    proposedTermType: "other",
    proposedTermDetail: "",
    redFlagId: "",
  });
  const [adding, setAdding] = useState(false);

  const findings = bundle.findings;

  const decide = async (finding: Finding, status: "accepted" | "rejected") => {
    setBusyId(finding.id);
    setError("");
    try {
      await api(`/api/platform/diligence/findings/${encodeURIComponent(finding.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await reload();
    } catch {
      setError("Could not update that finding. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (finding: Finding) => {
    setBusyId(finding.id);
    setError("");
    try {
      await api(`/api/platform/diligence/findings/${encodeURIComponent(finding.id)}`, {
        method: "DELETE",
      });
      await reload();
    } catch {
      setError("Could not delete that finding. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const add = async () => {
    if (!form.title.trim() || adding) return;
    setAdding(true);
    setError("");
    try {
      await api(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/findings`, {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          detail: form.detail.trim(),
          category: form.category.trim(),
          severity: form.severity,
          proposedTermType: form.proposedTermType,
          proposedTermDetail: form.proposedTermDetail.trim(),
          redFlagId: form.redFlagId || undefined,
        }),
      });
      setForm({
        title: "",
        detail: "",
        category: "",
        severity: "medium",
        proposedTermType: "other",
        proposedTermDetail: "",
        redFlagId: "",
      });
      await reload();
    } catch {
      setError("Could not add that finding. Please try again.");
    } finally {
      setAdding(false);
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
          Findings & proposed terms
        </h3>
        {findings.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No findings yet. Add the first one below.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            {findings.map((f) => (
              <li key={f.id} className="py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-[180px] flex-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    {f.title}
                  </p>
                  <span
                    className={`badge ${
                      f.severity === "high"
                        ? "badge-danger"
                        : f.severity === "low"
                          ? "badge-neutral"
                          : "badge-warn"
                    }`}
                  >
                    {f.severity}
                  </span>
                  <span
                    className={`badge ${
                      f.status === "accepted"
                        ? "badge-fit"
                        : f.status === "rejected"
                          ? "badge-danger"
                          : "badge-warn"
                    }`}
                  >
                    {f.status}
                  </span>
                </div>
                {f.detail && (
                  <p className="mt-1.5 text-sm text-slate-600 dark:text-white/70">{f.detail}</p>
                )}
                <p className="mt-1.5 text-sm text-[#0d1f3c] dark:text-white/90">
                  <span className="font-medium">
                    Proposed term — {labelOf(TERM_TYPES, f.proposedTermType)}:
                  </span>{" "}
                  {f.proposedTermDetail || "—"}
                </p>
                <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                  {f.category ? `Category: ${f.category} · ` : ""}
                  {f.redFlagId
                    ? `Linked red flag: ${bundle.redFlags.find((r) => r.id === f.redFlagId)?.title ?? f.redFlagId} · `
                    : ""}
                  {f.status !== "proposed" && f.decidedBy
                    ? `Decided by ${f.decidedBy}`
                    : ""}
                </p>
                <div className="mt-2.5 flex gap-1.5">
                  {f.status === "proposed" && (
                    <>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={busyId === f.id}
                        onClick={() => void decide(f, "accepted")}
                      >
                        Accept term
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        disabled={busyId === f.id}
                        onClick={() => void decide(f, "rejected")}
                      >
                        Reject term
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busyId === f.id}
                    onClick={() => void remove(f)}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Add finding
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls}>Title</label>
            <input
              className={inputCls}
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Customer concentration above threshold"
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Detail</label>
            <textarea
              className={`${inputCls} min-h-[80px]`}
              value={form.detail}
              onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
              placeholder="What was found, and the evidence behind it"
            />
          </div>
          <div>
            <label className={labelCls}>Category</label>
            <input
              className={inputCls}
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="e.g. Revenue quality"
            />
          </div>
          <div>
            <label className={labelCls}>Severity</label>
            <select
              className={selectCls}
              value={form.severity}
              onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Proposed term type</label>
            <select
              className={selectCls}
              value={form.proposedTermType}
              onChange={(e) =>
                setForm((f) => ({ ...f, proposedTermType: e.target.value }))
              }
            >
              {TERM_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Linked red flag (optional)</label>
            <select
              className={selectCls}
              value={form.redFlagId}
              onChange={(e) => setForm((f) => ({ ...f, redFlagId: e.target.value }))}
            >
              <option value="">None</option>
              {bundle.redFlags.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Proposed term detail</label>
            <textarea
              className={`${inputCls} min-h-[70px]`}
              value={form.proposedTermDetail}
              onChange={(e) =>
                setForm((f) => ({ ...f, proposedTermDetail: e.target.value }))
              }
              placeholder="e.g. $250K holdback for 12 months against the top-customer receivable"
            />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => void add()} loading={adding} disabled={!form.title.trim()}>
            Add finding
          </Button>
        </div>
        {findings.length === 0 && (
          <div className="mt-4">
            <EmptyState
              title="Nothing recorded yet"
              message="Findings translate diligence discoveries into proposed deal terms for negotiation."
            />
          </div>
        )}
      </div>
    </div>
  );
}
