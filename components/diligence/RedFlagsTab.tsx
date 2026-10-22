"use client";

/**
 * Red flag register — analysis anomalies arrive as CANDIDATES and
 * are never auto-confirmed: a reviewer confirms (→ open, with owner
 * and mitigation) or dismisses each one. Manual flags start open.
 * "Sync from analysis" pulls the current financial analysis's
 * anomalies in as new candidates.
 */

import { useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  selectCls,
  tdCls,
  thCls,
  fmtDateShort,
  SEVERITIES,
  type RedFlag,
  type TabProps,
} from "@/components/diligence/types";

const FLAG_STATUSES = ["open", "mitigating", "resolved", "dismissed"] as const;

function severityBadge(severity: string) {
  const cls =
    severity === "high"
      ? "badge-danger"
      : severity === "low"
        ? "badge-neutral"
        : "badge-warn";
  return <span className={`badge ${cls}`}>{severity}</span>;
}

export default function RedFlagsTab({ workspaceId, bundle, reload }: TabProps) {
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  // Per-candidate confirm fields.
  const [confirmFields, setConfirmFields] = useState<
    Record<string, { owner: string; mitigation: string }>
  >({});

  const [form, setForm] = useState({
    title: "",
    detail: "",
    severity: "medium",
    owner: "",
    mitigation: "",
  });
  const [adding, setAdding] = useState(false);

  const flags = bundle.redFlags;
  const candidates = flags.filter((f) => f.status === "candidate");
  const register = flags.filter((f) => f.status !== "candidate");

  const patch = async (flagId: string, body: Record<string, unknown>) => {
    setBusyId(flagId);
    setError("");
    try {
      await api(`/api/platform/diligence/red-flags/${encodeURIComponent(flagId)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await reload();
    } catch {
      setError("Could not update that red flag. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const remove = async (flagId: string) => {
    setBusyId(flagId);
    setError("");
    try {
      await api(`/api/platform/diligence/red-flags/${encodeURIComponent(flagId)}`, {
        method: "DELETE",
      });
      await reload();
    } catch {
      setError("Could not delete that red flag. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const sync = async () => {
    setSyncing(true);
    setSyncMsg("");
    setError("");
    try {
      const data = await api<{
        analysisId: string | null;
        analysisStatus: string | null;
        created: number;
        totalCandidates: number;
      }>(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/red-flags/sync`, {
        method: "POST",
      });
      setSyncMsg(
        data.analysisId
          ? `Sync complete: ${data.created} new candidate(s) created from analysis ${data.analysisId} (status: ${data.analysisStatus ?? "—"}). ${data.totalCandidates} candidate(s) in total awaiting review.`
          : "No financial analysis exists for this company yet, so there are no anomalies to sync."
      );
      await reload();
    } catch {
      setError("Sync failed. Please try again.");
    } finally {
      setSyncing(false);
    }
  };

  const addManual = async () => {
    if (!form.title.trim() || adding) return;
    setAdding(true);
    setError("");
    try {
      await api(`/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/red-flags`, {
        method: "POST",
        body: JSON.stringify({
          title: form.title.trim(),
          detail: form.detail.trim() || undefined,
          severity: form.severity,
          owner: form.owner.trim() || undefined,
          mitigation: form.mitigation.trim() || undefined,
        }),
      });
      setForm({ title: "", detail: "", severity: "medium", owner: "", mitigation: "" });
      await reload();
    } catch {
      setError("Could not add that red flag. Please try again.");
    } finally {
      setAdding(false);
    }
  };

  const renderFlagMeta = (f: RedFlag) => (
    <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
      Source: {f.source}
      {f.anomalyRule ? ` · rule: ${f.anomalyRule}` : ""}
      {f.periodEnd ? ` · period ending ${fmtDateShort(f.periodEnd)}` : ""}
      {f.analysisId ? ` · analysis ${f.analysisId}` : ""}
      {f.confirmedBy ? ` · confirmed by ${f.confirmedBy}` : ""}
    </p>
  );

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Sync */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Analysis candidates
            </h3>
            <p className="mt-0.5 max-w-xl text-sm text-slate-500 dark:text-white/50">
              Anomalies from the financial analysis arrive as candidates.
              They never become open flags on their own — confirm or dismiss
              each one below.
            </p>
          </div>
          <Button onClick={() => void sync()} loading={syncing}>
            Sync from analysis
          </Button>
        </div>
        {syncMsg && (
          <p className="mt-3 rounded-xl bg-[#b8975a]/10 px-4 py-2.5 text-sm text-[#0d1f3c] dark:text-white/90">
            {syncMsg}
          </p>
        )}

        {candidates.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500 dark:text-white/50">
            No candidates awaiting review.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
            {candidates.map((f) => {
              const fields = confirmFields[f.id] ?? { owner: f.owner, mitigation: f.mitigation };
              return (
                <li key={f.id} className="py-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-[180px] flex-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                      {f.title}
                    </p>
                    {severityBadge(f.severity)}
                    <span className="badge badge-warn">candidate</span>
                  </div>
                  {f.detail && (
                    <p className="mt-1 text-sm text-slate-600 dark:text-white/70">{f.detail}</p>
                  )}
                  {renderFlagMeta(f)}
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    <input
                      className={inputCls}
                      placeholder="Owner (required to confirm)"
                      value={fields.owner}
                      onChange={(e) =>
                        setConfirmFields((s) => ({
                          ...s,
                          [f.id]: { ...fields, owner: e.target.value },
                        }))
                      }
                      aria-label={`Owner for ${f.title}`}
                    />
                    <input
                      className={inputCls}
                      placeholder="Mitigation plan"
                      value={fields.mitigation}
                      onChange={(e) =>
                        setConfirmFields((s) => ({
                          ...s,
                          [f.id]: { ...fields, mitigation: e.target.value },
                        }))
                      }
                      aria-label={`Mitigation for ${f.title}`}
                    />
                  </div>
                  <div className="mt-2.5 flex gap-1.5">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      disabled={busyId === f.id}
                      onClick={() =>
                        void patch(f.id, {
                          status: "open",
                          owner: fields.owner,
                          mitigation: fields.mitigation,
                        })
                      }
                    >
                      Confirm as open flag
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={busyId === f.id}
                      onClick={() => void patch(f.id, { status: "dismissed" })}
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger btn-sm"
                      disabled={busyId === f.id}
                      onClick={() => void remove(f.id)}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Register */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Red flag register
        </h3>
        {register.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No red flags on the register"
              message="Confirmed and manual flags will appear here."
            />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={thCls}>Flag</th>
                  <th className={thCls}>Severity</th>
                  <th className={thCls}>Owner</th>
                  <th className={thCls}>Mitigation</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {register.map((f) => (
                  <tr key={f.id} className="border-b border-slate-100 align-top dark:border-white/5">
                    <td className={tdCls}>
                      <p className="font-medium">{f.title}</p>
                      {f.detail && (
                        <p className="mt-0.5 max-w-sm text-xs text-slate-500 dark:text-white/50">
                          {f.detail}
                        </p>
                      )}
                      {renderFlagMeta(f)}
                    </td>
                    <td className={tdCls}>{severityBadge(f.severity)}</td>
                    <td className={tdCls}>
                      <input
                        className={`${inputCls} w-32`}
                        defaultValue={f.owner}
                        disabled={busyId === f.id}
                        onBlur={(e) => {
                          if (e.target.value !== f.owner)
                            void patch(f.id, { owner: e.target.value });
                        }}
                        aria-label={`Owner for ${f.title}`}
                      />
                    </td>
                    <td className={tdCls}>
                      <input
                        className={`${inputCls} w-52`}
                        defaultValue={f.mitigation}
                        disabled={busyId === f.id}
                        onBlur={(e) => {
                          if (e.target.value !== f.mitigation)
                            void patch(f.id, { mitigation: e.target.value });
                        }}
                        aria-label={`Mitigation for ${f.title}`}
                      />
                    </td>
                    <td className={tdCls}>
                      <select
                        className={`${selectCls} w-36`}
                        value={f.status}
                        disabled={busyId === f.id}
                        onChange={(e) => void patch(f.id, { status: e.target.value })}
                        aria-label={`Status for ${f.title}`}
                      >
                        {FLAG_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className={tdCls}>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        disabled={busyId === f.id}
                        onClick={() => void remove(f.id)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual add */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Add a manual red flag
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelCls}>Title</label>
            <input className={inputCls} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="e.g. Key-man dependence on founder" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Detail</label>
            <textarea className={`${inputCls} min-h-[70px]`} value={form.detail} onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))} />
          </div>
          <div>
            <label className={labelCls}>Severity</label>
            <select className={selectCls} value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Owner</label>
            <input className={inputCls} value={form.owner} onChange={(e) => setForm((f) => ({ ...f, owner: e.target.value }))} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Mitigation</label>
            <input className={inputCls} value={form.mitigation} onChange={(e) => setForm((f) => ({ ...f, mitigation: e.target.value }))} placeholder="How this gets resolved or priced into the deal" />
          </div>
        </div>
        <div className="mt-4">
          <Button onClick={() => void addManual()} loading={adding} disabled={!form.title.trim()}>
            Add red flag
          </Button>
        </div>
      </div>
    </div>
  );
}
