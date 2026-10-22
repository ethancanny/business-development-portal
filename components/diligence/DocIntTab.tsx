"use client";

/**
 * Document intelligence — OCR / term extraction over data room
 * documents. Extracted fields stay PROVISIONAL until a reviewer
 * confirms or corrects them; only confirmed / corrected fields can
 * be applied to the contract register. Extraction is opt-in per
 * deal (settings toggle) and runs through the active provider
 * reported by the status endpoint.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  api,
  cardCls,
  inputCls,
  labelCls,
  tdCls,
  thCls,
  fmtDateShort,
  type DocintField,
  type DocintRun,
  type DocintStatus,
  type TabProps,
} from "@/components/diligence/types";

interface RoomDoc {
  documentId: string;
  name: string;
  mime: string;
  version: number;
  uploadedAt: string;
}

interface RoomPayload {
  folders?: Array<{ documents?: RoomDoc[] }>;
  unfiled?: RoomDoc[];
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return fmtDateShort(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function runPages(run: DocintRun): number | null {
  return run.pages ?? run.pageCount ?? null;
}

function runFieldCount(run: DocintRun): number | null {
  return run.fieldsExtracted ?? run.fieldCount ?? null;
}

function confidenceChip(confidence: number | null) {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) {
    return <span className="badge badge-neutral">no score</span>;
  }
  const pct = `${Math.round(confidence * 100)}%`;
  if (confidence >= 0.8) {
    return (
      <span className="badge bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
        {pct} confidence
      </span>
    );
  }
  if (confidence >= 0.5) {
    return <span className="badge badge-warn">{pct} confidence</span>;
  }
  return <span className="badge badge-danger">{pct} confidence</span>;
}

function fieldStatusPill(status: string) {
  const s = (status || "").toLowerCase();
  if (s === "confirmed" || s === "corrected") {
    return (
      <span className="badge bg-emerald-500/15 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300">
        {status}
      </span>
    );
  }
  if (s === "rejected") {
    return <span className="badge badge-neutral">{status}</span>;
  }
  // provisional (and anything unrecognized) reads amber.
  return <span className="badge badge-warn">{status || "Provisional"}</span>;
}

export default function DocIntTab({ workspaceId, bundle }: TabProps) {
  const dealId = bundle.deal?.dealId ?? bundle.workspace.dealId;
  const roomId = bundle.room?.id ?? null;

  const [status, setStatus] = useState<DocintStatus | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [runs, setRuns] = useState<DocintRun[]>([]);
  const [fields, setFields] = useState<DocintField[]>([]);
  const [docs, setDocs] = useState<RoomDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");

  const [toggling, setToggling] = useState(false);
  const [extractingId, setExtractingId] = useState("");
  const [extractMsg, setExtractMsg] = useState("");
  const [busyFieldId, setBusyFieldId] = useState("");
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [correctingId, setCorrectingId] = useState("");
  const [applyingRunId, setApplyingRunId] = useState("");
  const [applyMsg, setApplyMsg] = useState("");

  const loadRunsAndFields = useCallback(async () => {
    const [runsData, fieldsData] = await Promise.all([
      api<{ runs: DocintRun[] }>(
        `/api/platform/diligence/docint/runs?dealId=${encodeURIComponent(dealId)}`
      ).catch(() => ({ runs: [] as DocintRun[] })),
      api<{ fields: DocintField[] }>(
        `/api/platform/diligence/docint/fields?dealId=${encodeURIComponent(dealId)}`
      ).catch(() => ({ fields: [] as DocintField[] })),
    ]);
    setRuns(Array.isArray(runsData.runs) ? runsData.runs : []);
    setFields(Array.isArray(fieldsData.fields) ? fieldsData.fields : []);
  }, [dealId]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [statusData, settingsData] = await Promise.all([
        api<DocintStatus>("/api/platform/diligence/docint/status").catch(
          () => null
        ),
        api<{ settings: { dealId: string; enabled: boolean } }>(
          `/api/platform/diligence/docint/settings?dealId=${encodeURIComponent(dealId)}`
        ).catch(() => null),
      ]);
      setStatus(statusData);
      setEnabled(
        settingsData?.settings
          ? Boolean(settingsData.settings.enabled)
          : null
      );
      await loadRunsAndFields();
      if (roomId) {
        try {
          const room = await api<RoomPayload>(
            `/api/platform/datarooms/${encodeURIComponent(roomId)}`
          );
          const list: RoomDoc[] = [];
          for (const f of room.folders ?? []) list.push(...(f.documents ?? []));
          list.push(...(room.unfiled ?? []));
          setDocs(list);
        } catch {
          setDocs([]);
        }
      } else {
        setDocs([]);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [dealId, roomId, loadRunsAndFields]);

  useEffect(() => {
    void load();
  }, [load]);

  const docNameById = useMemo(() => {
    const m = new Map<string, string>();
    docs.forEach((d) => m.set(d.documentId, d.name));
    return m;
  }, [docs]);

  const fieldsByDoc = useMemo(() => {
    const m = new Map<string, DocintField[]>();
    for (const f of fields) {
      const arr = m.get(f.documentId) ?? [];
      arr.push(f);
      m.set(f.documentId, arr);
    }
    return m;
  }, [fields]);

  const toggleEnabled = async () => {
    if (enabled === null || toggling) return;
    const next = !enabled;
    setToggling(true);
    setError("");
    try {
      const data = await api<{
        settings: { dealId: string; enabled: boolean };
      }>("/api/platform/diligence/docint/settings", {
        method: "PUT",
        body: JSON.stringify({ dealId, enabled: next }),
      });
      setEnabled(Boolean(data.settings?.enabled));
    } catch {
      setError("Could not update the document intelligence setting.");
    } finally {
      setToggling(false);
    }
  };

  const extract = async (doc: RoomDoc) => {
    setExtractingId(doc.documentId);
    setExtractMsg("");
    setError("");
    try {
      const { run } = await api<{ run: DocintRun }>(
        "/api/platform/diligence/docint/extract",
        {
          method: "POST",
          body: JSON.stringify({ dealId, documentId: doc.documentId, sync: true }),
        }
      );
      const n = runFieldCount(run);
      setExtractMsg(
        `Extraction for “${doc.name}” finished with status ${run.status}${n !== null ? ` — ${n} field(s) extracted` : ""}. Review the fields below.`
      );
      await loadRunsAndFields();
    } catch {
      setError(`Extraction failed for “${doc.name}”. Please try again.`);
    } finally {
      setExtractingId("");
    }
  };

  const review = async (
    field: DocintField,
    action: "confirm" | "correct" | "reject",
    valueText?: string
  ) => {
    setBusyFieldId(field.id);
    setError("");
    try {
      await api(
        `/api/platform/diligence/docint/fields/${encodeURIComponent(field.id)}/review`,
        {
          method: "POST",
          body: JSON.stringify(
            action === "correct" ? { action, valueText } : { action }
          ),
        }
      );
      if (action === "correct") setCorrectingId("");
      await loadRunsAndFields();
    } catch {
      setError("Could not save that review. Please try again.");
    } finally {
      setBusyFieldId("");
    }
  };

  const applyRun = async (runId: string) => {
    setApplyingRunId(runId);
    setApplyMsg("");
    setError("");
    try {
      await api("/api/platform/diligence/docint/apply", {
        method: "POST",
        body: JSON.stringify({ runId }),
      });
      setApplyMsg(
        "Confirmed fields applied — the new contract is on the Contracts tab."
      );
      await loadRunsAndFields();
    } catch {
      setError("Could not apply those fields to the contract register.");
    } finally {
      setApplyingRunId("");
    }
  };

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  const activeProvider = status?.activeProvider ?? "local";
  const activeDetail =
    activeProvider === "azure" ? status?.azure.detail : status?.local.detail;
  const azureConfigured = status?.azure.configured ?? false;

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {/* Provider status */}
      <div className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
              Document intelligence
            </h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
              Active provider:{" "}
              <span className="font-semibold text-[#0d1f3c] dark:text-white">
                {activeProvider}
              </span>
              {status && (
                <>
                  {" "}· Azure {azureConfigured ? "configured" : "not configured"} ·
                  Local {status.local.configured ? "configured" : "not configured"}
                </>
              )}
            </p>
            {activeDetail && (
              <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-white/70">
                {activeDetail}
              </p>
            )}
            {status && !azureConfigured && status.azure.detail && (
              <p className="mt-2 max-w-2xl rounded-xl bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-200">
                Azure: {status.azure.detail}
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-500 dark:text-white/50">
              {enabled === null
                ? "Setting unavailable"
                : enabled
                  ? "Enabled for this deal"
                  : "Disabled for this deal"}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={enabled === true}
              disabled={enabled === null || toggling}
              onClick={() => void toggleEnabled()}
              className="btn btn-secondary min-h-[44px]"
            >
              {toggling ? "Saving…" : enabled ? "Disable" : "Enable"}
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400 dark:text-white/40">
          Workspace {workspaceId} · Extraction runs only when enabled, and
          every extracted field needs human review before it can be applied.
        </p>
      </div>

      {/* Room documents */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Data room documents
        </h3>
        {!roomId ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No data room is linked to this deal yet, so there are no documents
            to extract from.
          </p>
        ) : docs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            The linked data room has no documents yet.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            {docs.map((doc) => (
              <li
                key={doc.documentId}
                className="flex flex-wrap items-center gap-2 py-3"
              >
                <Link
                  href={`/documents?doc=${encodeURIComponent(doc.documentId)}`}
                  className="min-w-[180px] flex-1 truncate text-sm font-medium text-[#0d1f3c] hover:text-[#b8975a] dark:text-white"
                >
                  {doc.name}
                </Link>
                <span className="text-xs text-slate-400 dark:text-white/40">
                  {doc.mime || "—"} · v{doc.version}
                </span>
                <button
                  type="button"
                  className="btn btn-primary btn-sm min-h-[44px]"
                  disabled={
                    enabled !== true || extractingId === doc.documentId
                  }
                  onClick={() => void extract(doc)}
                >
                  {extractingId === doc.documentId
                    ? "Extracting…"
                    : "Extract terms"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {enabled === false && (
          <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
            Enable document intelligence for this deal to run extractions.
          </p>
        )}
        {extractMsg && (
          <p className="mt-3 rounded-xl bg-[#b8975a]/10 px-4 py-2.5 text-sm text-[#0d1f3c] dark:text-white/90">
            {extractMsg}
          </p>
        )}
      </div>

      {/* Runs */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Extraction runs
        </h3>
        {runs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No extraction runs yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-white/10">
                  <th className={thCls}>Provider</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Document</th>
                  <th className={thCls}>Pages</th>
                  <th className={thCls}>Fields</th>
                  <th className={thCls}>Time</th>
                  <th className={thCls}>Apply</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const runFields = fields.filter((f) => f.runId === run.id);
                  const applicable = runFields.filter(
                    (f) =>
                      (f.status === "confirmed" || f.status === "corrected") &&
                      !f.appliedContractId
                  ).length;
                  const pages = runPages(run);
                  const count = runFieldCount(run);
                  return (
                    <tr
                      key={run.id}
                      className="border-b border-slate-100 dark:border-white/5"
                    >
                      <td className={`${tdCls} font-medium`}>{run.provider}</td>
                      <td className={tdCls}>
                        <span
                          className={`badge ${
                            run.status === "completed" || run.status === "succeeded"
                              ? "badge-fit"
                              : run.status === "failed"
                                ? "badge-danger"
                                : "badge-warn"
                          }`}
                        >
                          {run.status}
                        </span>
                        {run.error && (
                          <span className="ml-2 text-xs text-red-600 dark:text-red-300">
                            {run.error}
                          </span>
                        )}
                      </td>
                      <td className={tdCls}>
                        {run.documentId
                          ? (docNameById.get(run.documentId) ?? run.documentId)
                          : "—"}
                      </td>
                      <td className={`${tdCls} tnum`}>{pages ?? "—"}</td>
                      <td className={`${tdCls} tnum`}>
                        {count ?? runFields.length}
                      </td>
                      <td className={tdCls}>{fmtDateTime(run.createdAt)}</td>
                      <td className={tdCls}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm min-h-[44px]"
                          disabled={applicable === 0 || applyingRunId === run.id}
                          onClick={() => void applyRun(run.id)}
                          title={
                            applicable === 0
                              ? "Confirm or correct at least one unapplied field first"
                              : undefined
                          }
                        >
                          {applyingRunId === run.id
                            ? "Applying…"
                            : "Apply confirmed fields to contract register"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {applyMsg && (
          <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
            {applyMsg} Switch to the <strong>Contracts</strong> tab above to
            review the register entry.
          </p>
        )}
      </div>

      {/* Extracted fields, grouped by document */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Extracted fields
        </h3>
        {fields.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              title="No extracted fields yet"
              message="Run “Extract terms” on a document above and its fields will appear here for review."
            />
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {Array.from(fieldsByDoc.entries()).map(([documentId, docFields]) => (
              <div key={documentId}>
                <p className={labelCls}>
                  {docNameById.get(documentId) ?? documentId}
                </p>
                <ul className="divide-y divide-slate-100 dark:divide-white/5">
                  {docFields.map((f) => {
                    const displayValue = f.correctedValue ?? f.valueText ?? "—";
                    const isCorrecting = correctingId === f.id;
                    return (
                      <li key={f.id} className="py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="min-w-[160px] flex-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                            {f.label || f.fieldKey}
                          </p>
                          {confidenceChip(f.confidence)}
                          {fieldStatusPill(f.status)}
                          {f.appliedContractId && (
                            <span className="badge badge-fit">
                              Applied to contract
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm text-slate-600 dark:text-white/80">
                          {displayValue}
                          {f.page !== null && f.page !== undefined && (
                            <span className="ml-2 text-xs text-slate-400 dark:text-white/40">
                              Page {f.page}
                            </span>
                          )}
                        </p>
                        {f.passage && (
                          <blockquote className="mt-2 rounded-xl bg-slate-50 px-4 py-2.5 text-sm italic text-slate-500 dark:bg-white/5 dark:text-white/50">
                            “{f.passage}”
                          </blockquote>
                        )}
                        {isCorrecting ? (
                          <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
                            <input
                              className={inputCls}
                              value={corrections[f.id] ?? displayValue}
                              onChange={(e) =>
                                setCorrections((s) => ({
                                  ...s,
                                  [f.id]: e.target.value,
                                }))
                              }
                              aria-label={`Corrected value for ${f.label || f.fieldKey}`}
                            />
                            <button
                              type="button"
                              className="btn btn-primary btn-sm min-h-[44px] shrink-0"
                              disabled={busyFieldId === f.id}
                              onClick={() =>
                                void review(
                                  f,
                                  "correct",
                                  (corrections[f.id] ?? displayValue).trim()
                                )
                              }
                            >
                              Save correction
                            </button>
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm min-h-[44px] shrink-0"
                              onClick={() => setCorrectingId("")}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="mt-2.5 flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              className="btn btn-primary btn-sm min-h-[44px]"
                              disabled={busyFieldId === f.id}
                              onClick={() => void review(f, "confirm")}
                            >
                              Confirm
                            </button>
                            <button
                              type="button"
                              className="btn btn-secondary btn-sm min-h-[44px]"
                              disabled={busyFieldId === f.id}
                              onClick={() => {
                                setCorrections((s) => ({
                                  ...s,
                                  [f.id]: displayValue,
                                }));
                                setCorrectingId(f.id);
                              }}
                            >
                              Correct
                            </button>
                            <button
                              type="button"
                              className="btn btn-danger btn-sm min-h-[44px]"
                              disabled={busyFieldId === f.id}
                              onClick={() => void review(f, "reject")}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
