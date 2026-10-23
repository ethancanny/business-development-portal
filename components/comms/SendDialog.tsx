"use client";

/**
 * SendDialog — deliver an APPROVED report to recipients.
 *
 * Contract-critical behavior:
 * - Recipient rows: pick a Directory person (search over
 *   /api/platform/directory) or type name + email manually; each row
 *   has an audience and an allow-PDF (email attachment) checkbox.
 * - "Run check" calls GET /reports/[id]/check and renders the
 *   blocked / flagged / excluded lists verbatim.
 * - "What this recipient will see" renders the /preview endpoint's
 *   audience-filtered render through <ReportView/> — never a locally
 *   filtered copy.
 * - Blocked checks require an explicit override + reason; the
 *   Deliver button stays disabled unless the report is approved,
 *   recipients are valid, and any block is overridden with a reason.
 * - Email outcomes are reported exactly as the delivery API returns
 *   them (sent vs setup_required is never glossed over).
 */

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui";
import ReportView from "@/components/comms/ReportView";
import {
  AUDIENCES,
  COMMS_API,
  CommsApiError,
  api,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  selectCls,
  str,
  type CheckResult,
  type CommsReport,
  type Rec,
  type ReportRender,
} from "@/components/comms/types";

interface RecipientRow {
  personId?: string;
  name: string;
  email: string;
  audience: string;
  allowPdf: boolean;
}

interface DirectoryHit {
  id: string;
  name: string;
  email: string;
  sub: string;
}

export default function SendDialog({
  report,
  onClose,
  onDelivered,
}: {
  report: CommsReport;
  onClose: () => void;
  onDelivered: () => void;
}) {
  const reportAudience =
    str((report as Rec).audience) || "internal";
  const approved = report.status === "approved";
  const [rows, setRows] = useState<RecipientRow[]>([
    { name: "", email: "", audience: reportAudience, allowPdf: false },
  ]);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checkAudience, setCheckAudience] = useState(reportAudience);
  const [checking, setChecking] = useState(false);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [preview, setPreview] = useState<ReportRender | null>(null);
  const [previewNote, setPreviewNote] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [override, setOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<Rec[] | null>(null);

  const updateRow = (i: number, patch: Partial<RecipientRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const runCheck = useCallback(async () => {
    setChecking(true);
    try {
      const data = await api<Record<string, unknown>>(
        `${COMMS_API}/reports/${encodeURIComponent(report.id)}/check?audience=${encodeURIComponent(checkAudience)}`
      );
      const c = (data.check ?? data) as unknown as CheckResult;
      setCheck({
        blocked: c.blocked ?? [],
        flagged: c.flagged ?? [],
        excluded: c.excluded ?? [],
      });
    } catch {
      setCheck(null);
      setError("The pre-send check could not be run.");
    } finally {
      setChecking(false);
    }
  }, [report.id, checkAudience]);

  const loadPreview = useCallback(
    async (idx: number) => {
      const row = rows[idx];
      if (!row) return;
      setPreviewLoading(true);
      setPreviewNote("");
      try {
        const qs = new URLSearchParams({ audience: row.audience });
        if (row.personId) qs.set("personId", row.personId);
        const data = await api<Record<string, unknown>>(
          `${COMMS_API}/reports/${encodeURIComponent(report.id)}/preview?${qs.toString()}`
        );
        const render = (data.render ?? null) as ReportRender | null;
        setPreview(render);
        if (!render) {
          setPreviewNote("No generated render to preview yet — generate the report first.");
        }
      } catch {
        setPreview(null);
        setPreviewNote("Preview could not be loaded.");
      } finally {
        setPreviewLoading(false);
      }
    },
    [report.id, rows]
  );

  useEffect(() => {
    void loadPreview(previewIdx);
    // Re-run when the selected row's audience changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewIdx, rows[previewIdx]?.audience, rows[previewIdx]?.personId]);

  const blocked = check?.blocked ?? [];
  const rowsValid =
    rows.length > 0 &&
    rows.every((r) => r.name.trim() && /.+@.+\..+/.test(r.email.trim()));
  const canDeliver =
    approved &&
    rowsValid &&
    !busy &&
    (blocked.length === 0 || (override && overrideReason.trim().length > 0));

  const deliver = async () => {
    if (!canDeliver) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<Record<string, unknown>>(
        `${COMMS_API}/reports/${encodeURIComponent(report.id)}/deliver`,
        {
          method: "POST",
          body: JSON.stringify({
            recipients: rows.map((r) => ({
              personId: r.personId,
              name: r.name.trim(),
              email: r.email.trim(),
              allowPdf: r.allowPdf,
            })),
            override: blocked.length > 0 ? override : undefined,
            overrideReason:
              blocked.length > 0 ? overrideReason.trim() : undefined,
          }),
        }
      );
      const deliveries = listFrom<Rec>(data, "deliveries");
      setResult(deliveries);
      onDelivered();
    } catch (err) {
      if (err instanceof CommsApiError && err.status === 409) {
        const c = (err.body.check ?? null) as CheckResult | null;
        if (c) {
          setCheck({
            blocked: c.blocked ?? [],
            flagged: c.flagged ?? [],
            excluded: c.excluded ?? [],
          });
        }
        setError("Delivery is blocked by the pre-send check. Review the blocks below — overriding requires a reason and is audit-logged.");
      } else if (err instanceof CommsApiError && err.body.error === "report_not_approved") {
        setError("Only an approved report can be delivered.");
      } else {
        setError("Delivery failed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Send report"
      onClick={() => !busy && onClose()}
    >
      <div
        className="card-surface max-h-[92vh] w-full max-w-3xl overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
              Send report
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
              Each recipient gets a tracked, expiring link. The email
              contains the link only — the PDF is attached only where
              “Allow PDF” is checked (and only when the mail transport
              is available).
            </p>
          </div>
          <span className={`badge ${approved ? "badge-fit" : "badge-warn"}`}>
            {approved ? "Approved" : `Status: ${report.status.replace(/_/g, " ")}`}
          </span>
        </div>

        {!approved && (
          <p className="mt-3 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
            This report is not approved yet — delivery is disabled until
            it has been submitted and approved.
          </p>
        )}

        {result ? (
          <div className="mt-4 space-y-3">
            <p className="rounded-xl bg-green-500/10 px-4 py-3 text-sm text-green-800 dark:text-green-300">
              Report delivered. Per-recipient outcomes:
            </p>
            {result.map((d, i) => (
              <p key={i} className="text-sm text-slate-600 dark:text-white/70">
                <span className="font-semibold">
                  {str(d.recipientName ?? d.recipient_name) || str(d.recipientEmail ?? d.recipient_email)}
                </span>{" "}
                — link {str(d.status) || "created"} · email:{" "}
                {str(d.emailStatus ?? d.email_status) || "unknown"}
                {str(d.emailDetail ?? d.email_detail)
                  ? ` (${str(d.emailDetail ?? d.email_detail)})`
                  : ""}
              </p>
            ))}
            <div className="flex justify-end">
              <Button variant="primary" size="sm" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <>
            {/* Recipients */}
            <div className="mt-4 space-y-3">
              {rows.map((row, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                  <DirectoryPicker
                    onPick={(hit) =>
                      updateRow(i, {
                        personId: hit.id,
                        name: hit.name,
                        email: hit.email || row.email,
                      })
                    }
                  />
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <div>
                      <label className={labelCls}>Name</label>
                      <input
                        className={`${inputCls} min-h-[40px]`}
                        value={row.name}
                        onChange={(e) => updateRow(i, { name: e.target.value, personId: undefined })}
                        placeholder="Recipient name"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Email</label>
                      <input
                        className={`${inputCls} min-h-[40px]`}
                        value={row.email}
                        onChange={(e) => updateRow(i, { email: e.target.value })}
                        placeholder="name@example.com"
                      />
                    </div>
                    <div>
                      <label className={labelCls}>Audience (drives filtering)</label>
                      <select
                        className={`${selectCls} min-h-[40px]`}
                        value={row.audience}
                        onChange={(e) => updateRow(i, { audience: e.target.value })}
                      >
                        {AUDIENCES.map((a) => (
                          <option key={a.key} value={a.key}>{a.label}</option>
                        ))}
                      </select>
                    </div>
                    <label className="flex min-h-[40px] items-end gap-2 pb-1 text-sm text-slate-700 dark:text-white/80">
                      <input
                        type="checkbox"
                        className="h-4 w-4"
                        checked={row.allowPdf}
                        onChange={(e) => updateRow(i, { allowPdf: e.target.checked })}
                      />
                      Allow PDF attachment
                    </label>
                  </div>
                  {rows.length > 1 && (
                    <div className="mt-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                        Remove recipient
                      </Button>
                    </div>
                  )}
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() =>
                  setRows((rs) => [
                    ...rs,
                    { name: "", email: "", audience: reportAudience, allowPdf: false },
                  ])
                }
              >
                Add recipient
              </Button>
            </div>

            {/* Pre-send check */}
            <div className="mt-5 rounded-xl bg-slate-50 p-4 dark:bg-white/5">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-bold uppercase tracking-wide text-navy-900 dark:text-white">
                  Pre-send check
                </h4>
                <select
                  className={`${selectCls} min-h-[36px] w-auto`}
                  value={checkAudience}
                  onChange={(e) => setCheckAudience(e.target.value)}
                  aria-label="Check audience"
                >
                  {AUDIENCES.map((a) => (
                    <option key={a.key} value={a.key}>{a.label}</option>
                  ))}
                </select>
                <Button variant="secondary" size="sm" onClick={() => void runCheck()} loading={checking} disabled={checking}>
                  Run check
                </Button>
              </div>
              {!check && (
                <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
                  Run the check before delivering — it lists anything
                  blocked, flagged, or excluded for this audience.
                </p>
              )}
              {check && (
                <div className="mt-3 space-y-3 text-sm">
                  <IssueList title="Blocked" items={check.blocked} cls="text-red-700 dark:text-red-300" empty="Nothing blocked." />
                  <IssueList title="Flagged" items={check.flagged} cls="text-amber-800 dark:text-amber-200" empty="Nothing flagged." />
                  <IssueList title="Excluded by audience filter" items={check.excluded} cls="text-slate-600 dark:text-white/70" empty="Nothing excluded." />
                </div>
              )}
              {blocked.length > 0 && (
                <div className="mt-3 rounded-xl bg-red-500/10 px-4 py-3">
                  <label className="flex items-start gap-2 text-sm text-red-800 dark:text-red-200">
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4"
                      checked={override}
                      onChange={(e) => setOverride(e.target.checked)}
                    />
                    <span>
                      Override the block and deliver anyway (recorded in
                      the audit log).
                    </span>
                  </label>
                  {override && (
                    <input
                      className={`${inputCls} mt-2 min-h-[40px]`}
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Override reason (required)"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Recipient preview — from /preview, never locally filtered */}
            <div className="mt-5">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-bold uppercase tracking-wide text-navy-900 dark:text-white">
                  What this recipient will see
                </h4>
                <select
                  className={`${selectCls} min-h-[36px] w-auto`}
                  value={previewIdx}
                  onChange={(e) => setPreviewIdx(Number(e.target.value))}
                  aria-label="Preview recipient"
                >
                  {rows.map((r, i) => (
                    <option key={i} value={i}>
                      {r.name || r.email || `Recipient ${i + 1}`} ({labelOf(AUDIENCES, r.audience)})
                    </option>
                  ))}
                </select>
              </div>
              <div className="card-surface mt-2 max-h-[420px] overflow-y-auto p-5">
                {previewLoading && <p className="text-sm text-slate-400">Loading preview…</p>}
                {!previewLoading && previewNote && (
                  <p className="text-sm text-slate-500 dark:text-white/50">{previewNote}</p>
                )}
                {!previewLoading && preview && <ReportView render={preview} />}
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void deliver()}
                disabled={!canDeliver}
                loading={busy}
                title={!approved ? "Report must be approved first" : undefined}
              >
                Deliver
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IssueList({
  title,
  items,
  cls,
  empty,
}: {
  title: string;
  items: Array<{ code: string; message: string; blockKey?: string }>;
  cls: string;
  empty: string;
}) {
  return (
    <div>
      <p className={`text-xs font-bold uppercase tracking-wide ${cls}`}>
        {title} ({items.length})
      </p>
      {items.length === 0 ? (
        <p className="mt-0.5 text-slate-500 dark:text-white/50">{empty}</p>
      ) : (
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          {items.map((it, i) => (
            <li key={i} className="text-slate-700 dark:text-white/80">
              {it.message}
              <span className="ml-1 text-xs text-slate-400 dark:text-white/40">
                [{it.code}{it.blockKey ? ` · ${it.blockKey}` : ""}]
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DirectoryPicker({
  onPick,
}: {
  onPick: (hit: DirectoryHit) => void;
}) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<DirectoryHit[]>([]);
  const [open, setOpen] = useState(false);

  const search = async (term: string) => {
    setQ(term);
    if (term.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    try {
      const res = await fetch(
        `/api/platform/directory?q=${encodeURIComponent(term.trim())}&limit=10`,
        { cache: "no-store" }
      );
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const rows = listFrom<Rec>(data, "items", "records");
      setHits(
        rows.map((r) => ({
          id: str(r.personId ?? r.id),
          name: str(r.name),
          email: str(r.email),
          sub: [str(r.firm), str(r.title), str(r.kind)].filter(Boolean).join(" · "),
        })).filter((h) => h.id && h.name)
      );
      setOpen(true);
    } catch {
      setHits([]);
    }
  };

  return (
    <div className="relative">
      <label className={labelCls}>Find in Directory</label>
      <input
        className={`${inputCls} min-h-[40px]`}
        value={q}
        onChange={(e) => void search(e.target.value)}
        placeholder="Search people by name…"
      />
      {open && hits.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-pop dark:border-white/10 dark:bg-[#132847]">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-[#f0f4fa] dark:hover:bg-white/5"
                onClick={() => {
                  onPick(h);
                  setQ(h.name);
                  setOpen(false);
                }}
              >
                <span className="font-medium text-navy-900 dark:text-white">{h.name}</span>
                <span className="truncate text-xs text-slate-400 dark:text-white/40">
                  {h.email || h.sub}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
