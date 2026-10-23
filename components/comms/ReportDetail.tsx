"use client";

/**
 * ReportDetail — one report end to end: workflow actions by status,
 * unreviewed/stale banners, the narrative panel (statements with
 * figure-link chips, edit mode, honest Generate-with-AI states), the
 * internal full render, the appendix with source links + verification
 * chips, SendDialog, versions + diff, deliveries with tracking +
 * revoke, and the discussion thread.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";
import ReportView from "@/components/comms/ReportView";
import SendDialog from "@/components/comms/SendDialog";
import {
  COMMS_API,
  CommsApiError,
  api,
  bool,
  fmtDate,
  formatFigureValue,
  inputCls,
  labelCls,
  listFrom,
  num,
  pick,
  reportStatusBadge,
  selectCls,
  str,
  type AppendixFigure,
  type CommsDelivery,
  type CommsReport,
  type Rec,
  type RenderBlock,
  type ReportRender,
} from "@/components/comms/types";

interface VersionRow extends Rec {
  version?: number;
  createdBy?: string;
  createdAt?: string;
  note?: string;
}

interface CommentRow extends Rec {
  id: string;
  author?: string;
  body?: string;
  createdAt?: string;
}

export default function ReportDetail({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<CommsReport | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [deliveries, setDeliveries] = useState<CommsDelivery[]>([]);
  const [audit, setAudit] = useState<Rec[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [showSend, setShowSend] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const data = await api<Record<string, unknown>>(
        `${COMMS_API}/reports/${encodeURIComponent(reportId)}`
      );
      const rec = (data.report ?? data) as CommsReport;
      setReport(rec);
      setVersions(
        listFrom<VersionRow>(data, "versions") ||
          listFrom<VersionRow>(rec as Rec, "versions")
      );
      setDeliveries(
        listFrom<CommsDelivery>(data, "deliveries").length
          ? listFrom<CommsDelivery>(data, "deliveries")
          : listFrom<CommsDelivery>(rec as Rec, "deliveries")
      );
      setAudit(
        listFrom<Rec>(data, "audit").length
          ? listFrom<Rec>(data, "audit")
          : listFrom<Rec>(rec as Rec, "audit")
      );
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshDeliveries = useCallback(async () => {
    try {
      const data = await api<Record<string, unknown>>(
        `${COMMS_API}/reports/${encodeURIComponent(reportId)}/deliveries`
      );
      setDeliveries(listFrom<CommsDelivery>(data, "deliveries", "items"));
    } catch {
      /* deliveries refresh is best-effort; main load covers it */
    }
    void load();
  }, [reportId, load]);

  if (phase === "loading") return <SkeletonRows rows={8} />;
  if (phase === "error" || !report)
    return <ErrorState onRetry={() => void load()} />;

  const r = report as Rec;
  const status = report.status;
  const render = (pick(r, "render") ?? null) as ReportRender | null;
  const appendix = (Array.isArray(pick(r, "appendix"))
    ? (pick(r, "appendix") as AppendixFigure[])
    : []) as AppendixFigure[];
  const isSample = bool(pick(r, "isSample", "is_sample"));
  const stale = bool(pick(r, "stale"));
  const staleReason = str(pick(r, "staleReason", "stale_reason"));
  const unreviewed = bool(pick(r, "hasUnreviewed", "has_unreviewed"));
  const narrativeStatus = str(pick(r, "narrativeStatus", "narrative_status"));
  const currentVersion = num(pick(r, "currentVersion", "current_version"));
  const narrativeBlocks = (render?.blocks ?? []).filter(
    (b) => b.type === "narrative"
  );

  const act = async (
    action: "generate" | "submit" | "approve" | "discard" | "delete"
  ) => {
    if (busy) return;
    if (action === "delete" && !window.confirm("Delete this report?")) return;
    if (action === "discard" && !window.confirm("Discard this report?")) return;
    setBusy(action);
    setError("");
    setNote("");
    try {
      if (action === "delete") {
        await api(`${COMMS_API}/reports/${encodeURIComponent(reportId)}`, {
          method: "DELETE",
        });
        window.location.href = "/communications";
        return;
      }
      await api(
        `${COMMS_API}/reports/${encodeURIComponent(reportId)}/${action}`,
        { method: "POST" }
      );
      if (action === "generate") {
        setNote("Regeneration queued — the new version appears when the job completes. Refresh in a moment.");
      }
      void load();
    } catch (err) {
      const code =
        err instanceof CommsApiError ? String(err.body.error ?? "") : "";
      setError(
        code === "invalid_transition"
          ? "That workflow step isn't available from the report's current status."
          : code === "report_locked"
            ? "This report is locked in its current status and can't be regenerated or edited."
            : "That action failed. Please try again."
      );
    } finally {
      setBusy("");
    }
  };

  return (
    <div>
      <Link
        href="/communications"
        className="text-xs font-semibold uppercase tracking-wider text-gold-700 hover:underline dark:text-gold-400"
      >
        ← Communications
      </Link>

      {/* Header + workflow */}
      <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-3xl font-semibold text-navy-900 dark:text-white">
            {str(pick(r, "title")) || "Untitled report"}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
            {[
              str(pick(r, "templateName", "template_name")),
              render?.subjectLabel,
              currentVersion ? `Version ${currentVersion}` : "",
              report.updatedAt ? `Updated ${fmtDate(report.updatedAt)}` : "",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-2 flex flex-wrap gap-1.5">
            <span className={`badge ${reportStatusBadge(status)}`}>
              {status.replace(/_/g, " ")}
            </span>
            {isSample && <span className="badge badge-warn">SAMPLE</span>}
            {stale && <span className="badge badge-warn">STALE</span>}
            {unreviewed && <span className="badge badge-danger">UNREVIEWED</span>}
            {narrativeStatus && narrativeStatus !== "none" && (
              <span className="badge badge-neutral">
                Narrative: {narrativeStatus.replace(/_/g, " ")}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => void act("generate")} loading={busy === "generate"} disabled={!!busy}>
            {currentVersion ? "Regenerate" : "Generate"}
          </Button>
          {status === "draft" && (
            <Button variant="secondary" size="sm" className="min-h-[44px]" onClick={() => void act("submit")} loading={busy === "submit"} disabled={!!busy}>
              Submit for review
            </Button>
          )}
          {status === "in_review" && (
            <Button variant="primary" size="sm" className="min-h-[44px]" onClick={() => void act("approve")} loading={busy === "approve"} disabled={!!busy}>
              Approve
            </Button>
          )}
          {(status === "approved" || status === "sent") && (
            <Button variant="primary" size="sm" className="min-h-[44px]" onClick={() => setShowSend(true)}>
              Send…
            </Button>
          )}
          <a
            href={`${COMMS_API}/reports/${encodeURIComponent(reportId)}/pdf`}
            className="btn btn-secondary btn-sm min-h-[44px]"
          >
            Download PDF
          </a>
          {(status === "draft" || status === "in_review") && (
            <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => void act("discard")} disabled={!!busy}>
              Discard
            </Button>
          )}
          <Button variant="ghost" size="sm" className="min-h-[44px]" onClick={() => void act("delete")} disabled={!!busy}>
            Delete
          </Button>
        </div>
      </div>

      {note && (
        <p className="mt-3 rounded-xl bg-slate-500/10 px-4 py-3 text-sm text-slate-700 dark:text-white/80">{note}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      {/* Banners */}
      {stale && (
        <p role="alert" className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 ring-1 ring-inset ring-amber-500/30 dark:text-amber-200">
          <span className="font-bold">Stale.</span>{" "}
          Source data changed after this report was generated
          {staleReason ? ` (${staleReason.replace(/_/g, " ")})` : ""}.
          Regenerate before sending.
        </p>
      )}
      {unreviewed && (
        <p role="alert" className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-800 ring-1 ring-inset ring-red-500/30 dark:text-red-200">
          <span className="font-bold">Unreviewed figures.</span>{" "}
          This report contains figures that have not been reviewed
          (draft analysis or unconfirmed extractions). They are flagged
          in the appendix and in the pre-send check — they do not block
          sending, but review them first.
        </p>
      )}
      {narrativeStatus === "setup_required" && (
        <p className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          AI narrative is not configured, so no narrative text was
          generated. Configure the provider (see the Communications
          status strip for the exact steps) or write the narrative
          manually below.
        </p>
      )}
      {narrativeStatus === "blocked_disabled" && (
        <p className="mt-4 rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          AI narrative is disabled for this deal (document processing is
          off in the deal&apos;s settings), so no narrative text was
          generated. Write it manually below.
        </p>
      )}
      {narrativeStatus === "error" && (
        <p className="mt-4 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          The last AI narrative run failed. You can retry below or write
          the narrative manually — no text was fabricated.
        </p>
      )}

      {/* Narrative panel */}
      {narrativeBlocks.length > 0 && (
        <NarrativePanel
          reportId={reportId}
          blocks={narrativeBlocks}
          appendix={appendix}
          narrativeStatus={narrativeStatus}
          editable={status === "draft" || status === "in_review"}
          onChanged={() => void load()}
        />
      )}

      {/* Internal full render */}
      <section className="card-surface mt-5 p-5" aria-label="Report preview (internal)">
        <p className="micro-label mb-3">Internal view — all blocks, including internal-only</p>
        {render ? (
          <ReportView render={render} />
        ) : (
          <p className="text-sm text-slate-500 dark:text-white/50">
            Not generated yet. Use Generate above — assembly pulls the
            live figures for this subject.
          </p>
        )}
      </section>

      {/* Appendix */}
      <section className="card-surface mt-5 p-5" aria-label="Appendix">
        <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
          Appendix — every figure, with its source
        </h3>
        {appendix.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
            No figures yet.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="tbl-grad w-full min-w-[640px] text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Figure</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Value</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Source</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Verification</th>
                </tr>
              </thead>
              <tbody>
                {appendix.map((f) => (
                  <tr key={f.key} className="border-t border-slate-100 dark:border-white/5">
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-navy-900 dark:text-white">{f.label}</span>
                      <span className="block text-xs text-slate-400 dark:text-white/40">{f.key}</span>
                    </td>
                    <td className="tnum px-3 py-2.5 font-semibold text-navy-900 dark:text-white">
                      {formatFigureValue(f)}
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-white/70">
                      {f.href ? (
                        <a href={f.href} className="font-semibold text-gold-700 hover:underline dark:text-gold-400">
                          {f.sourceLabel || f.sourceModule}
                        </a>
                      ) : (
                        f.sourceLabel || f.sourceModule
                      )}
                      {f.confidence !== null && f.confidence !== undefined && (
                        <span className="block text-xs text-slate-400 dark:text-white/40">
                          Confidence {(f.confidence * 100).toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`badge ${f.verification === "reviewed" ? "badge-fit" : "badge-danger"}`}>
                        {f.verification}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Versions + diff */}
      <VersionsPanel reportId={reportId} versions={versions} currentVersion={currentVersion} />

      {/* Deliveries */}
      <DeliveriesPanel
        reportId={reportId}
        deliveries={deliveries}
        onChanged={() => void refreshDeliveries()}
      />

      {/* Threads */}
      <ThreadsPanel reportId={reportId} />

      {/* Audit */}
      {audit.length > 0 && (
        <section className="card-surface mt-5 p-5" aria-label="Audit trail">
          <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">Audit</h3>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-white/70">
            {audit.map((a, i) => (
              <li key={i}>
                <span className="font-semibold text-navy-900 dark:text-white">
                  {str(pick(a, "action"))}
                </span>{" "}
                · {str(pick(a, "actor")) || "—"}
                {str(pick(a, "createdAt", "created_at"))
                  ? ` · ${fmtDate(str(pick(a, "createdAt", "created_at")))}`
                  : ""}
              </li>
            ))}
          </ul>
        </section>
      )}

      {showSend && (
        <SendDialog
          report={report}
          onClose={() => setShowSend(false)}
          onDelivered={() => void refreshDeliveries()}
        />
      )}
    </div>
  );
}

/* --------------------------- narrative --------------------------- */

function NarrativePanel({
  reportId,
  blocks,
  appendix,
  narrativeStatus,
  editable,
  onChanged,
}: {
  reportId: string;
  blocks: RenderBlock[];
  appendix: AppendixFigure[];
  narrativeStatus: string;
  editable: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<
    Record<string, Array<{ text: string; figureKeys: string[] }>>
  >({});
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");

  const startEdit = () => {
    const init: Record<string, Array<{ text: string; figureKeys: string[] }>> = {};
    for (const b of blocks) {
      init[b.key] = (b.narrative?.statements ?? []).map((s) => ({
        text: s.text,
        figureKeys: [...(s.figureKeys ?? [])],
      }));
    }
    setDrafts(init);
    setEditing(true);
    setMsg("");
  };

  const save = async () => {
    setBusy("save");
    setMsg("");
    try {
      await api(`${COMMS_API}/reports/${encodeURIComponent(reportId)}`, {
        method: "PATCH",
        body: JSON.stringify({ narrative: drafts }),
      });
      setEditing(false);
      setMsg("Narrative saved as a new version.");
      onChanged();
    } catch (err) {
      const code = err instanceof CommsApiError ? String(err.body.error ?? "") : "";
      setMsg(
        code === "report_locked"
          ? "This report is locked in its current status — narrative edits need a draft or in-review report."
          : "Could not save the narrative."
      );
    } finally {
      setBusy("");
    }
  };

  const generateAi = async () => {
    setBusy("ai");
    setMsg("");
    try {
      const data = await api<Record<string, unknown>>(
        `${COMMS_API}/reports/${encodeURIComponent(reportId)}/narrative`,
        { method: "POST", body: JSON.stringify({ mode: "ai" }) }
      );
      const st = str(data.narrativeStatus);
      if (st === "ready") {
        setMsg("AI narrative generated and stored as a new version.");
      } else if (st === "setup_required") {
        setMsg("AI is not configured — no text was generated. See the Communications status strip for setup steps, or write the narrative manually.");
      } else if (st === "blocked_disabled") {
        setMsg("AI narrative is disabled for this deal (document processing off) — no text was generated.");
      } else if (st === "error") {
        setMsg("The AI run failed — no text was generated. You can retry or write it manually.");
      } else if (st === "none") {
        setMsg("This report has no narrative blocks.");
      } else {
        setMsg(`Narrative status: ${st || "unchanged"}.`);
      }
      onChanged();
    } catch {
      setMsg("The AI narrative request failed.");
    } finally {
      setBusy("");
    }
  };

  const appendixByKey = useMemo(() => {
    const m = new Map<string, AppendixFigure>();
    for (const f of appendix) m.set(f.key, f);
    return m;
  }, [appendix]);

  return (
    <section className="card-surface mt-5 p-5" aria-label="Narrative">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
          Narrative
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void generateAi()} loading={busy === "ai"} disabled={!!busy}>
            Generate with AI
          </Button>
          {editable && !editing && (
            <Button variant="secondary" size="sm" onClick={startEdit} disabled={!!busy}>
              Edit manually
            </Button>
          )}
          {editing && (
            <>
              <Button variant="primary" size="sm" onClick={() => void save()} loading={busy === "save"} disabled={!!busy}>
                Save narrative
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={!!busy}>
                Cancel
              </Button>
            </>
          )}
        </div>
      </div>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
        Status: {narrativeStatus ? narrativeStatus.replace(/_/g, " ") : "—"}.
        AI text is only ever produced by the configured provider — never
        fabricated when it is unconfigured or disabled.
      </p>
      {msg && (
        <p className="mt-3 rounded-xl bg-slate-500/10 px-4 py-3 text-sm text-slate-700 dark:text-white/80">{msg}</p>
      )}

      <div className="mt-4 space-y-5">
        {blocks.map((b) => (
          <div key={b.key}>
            <p className="text-sm font-bold uppercase tracking-wide text-navy-900 dark:text-white">
              {b.heading || b.key}
            </p>
            {!editing &&
              (b.narrative?.statements ?? []).map((s, i) => (
                <p key={i} className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-white/80">
                  {s.text}
                  {(s.figureKeys ?? []).length > 0 && (
                    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
                      {s.figureKeys.map((k) => {
                        const fig = appendixByKey.get(k);
                        return (
                          <span key={k} className="chip" title={fig ? `${fig.label}: ${formatFigureValue(fig)}` : k}>
                            {fig ? `${fig.label} · ${formatFigureValue(fig)}` : k}
                          </span>
                        );
                      })}
                    </span>
                  )}
                </p>
              ))}
            {!editing && (b.narrative?.statements ?? []).length === 0 && (
              <p className="mt-2 text-sm text-slate-400 dark:text-white/40">
                No statements yet.
              </p>
            )}

            {editing && (
              <div className="mt-2 space-y-3">
                {(drafts[b.key] ?? []).map((s, i) => (
                  <div key={i} className="rounded-xl border border-slate-200 p-3 dark:border-white/10">
                    <label className={labelCls}>Statement {i + 1}</label>
                    <textarea
                      className={`${inputCls} min-h-[64px]`}
                      value={s.text}
                      onChange={(e) =>
                        setDrafts((d) => ({
                          ...d,
                          [b.key]: (d[b.key] ?? []).map((x, j) =>
                            j === i ? { ...x, text: e.target.value } : x
                          ),
                        }))
                      }
                    />
                    {appendix.length > 0 && (
                      <div className="mt-2">
                        <span className={labelCls}>Linked figures</span>
                        <div className="flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                          {appendix.map((f) => {
                            const on = s.figureKeys.includes(f.key);
                            return (
                              <label key={f.key} className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-white/70">
                                <input
                                  type="checkbox"
                                  className="h-3.5 w-3.5"
                                  checked={on}
                                  onChange={(e) =>
                                    setDrafts((d) => ({
                                      ...d,
                                      [b.key]: (d[b.key] ?? []).map((x, j) =>
                                        j === i
                                          ? {
                                              ...x,
                                              figureKeys: e.target.checked
                                                ? [...x.figureKeys, f.key]
                                                : x.figureKeys.filter((k) => k !== f.key),
                                            }
                                          : x
                                      ),
                                    }))
                                  }
                                />
                                {f.label}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="mt-2 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setDrafts((d) => ({
                            ...d,
                            [b.key]: (d[b.key] ?? []).filter((_, j) => j !== i),
                          }))
                        }
                      >
                        Remove statement
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setDrafts((d) => ({
                      ...d,
                      [b.key]: [...(d[b.key] ?? []), { text: "", figureKeys: [] }],
                    }))
                  }
                >
                  Add statement
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/* --------------------------- versions ---------------------------- */

function VersionsPanel({
  reportId,
  versions,
  currentVersion,
}: {
  reportId: string;
  versions: VersionRow[];
  currentVersion: number | null;
}) {
  const [from, setFrom] = useState<number | "">("");
  const [to, setTo] = useState<number | "">("");
  const [changes, setChanges] = useState<Rec[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const versionNums = versions
    .map((v) => num(pick(v, "version")) ?? 0)
    .filter((n) => n > 0)
    .sort((a, b) => a - b);
  const fallbackNums =
    versionNums.length > 0
      ? versionNums
      : currentVersion
        ? Array.from({ length: currentVersion }, (_, i) => i + 1)
        : [];

  const runDiff = async () => {
    if (from === "" || to === "" || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<Record<string, unknown>>(
        `${COMMS_API}/reports/${encodeURIComponent(reportId)}/diff?from=${from}&to=${to}`
      );
      setChanges(listFrom<Rec>(data, "changes", "diff"));
    } catch {
      setError("Could not compute the diff.");
      setChanges(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-surface mt-5 p-5" aria-label="Versions">
      <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">Versions</h3>
      {versions.length === 0 && fallbackNums.length === 0 && (
        <p className="mt-2 text-sm text-slate-500 dark:text-white/50">No versions yet.</p>
      )}
      {versions.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm text-slate-600 dark:text-white/70">
          {versions.map((v, i) => (
            <li key={i}>
              <span className="font-semibold text-navy-900 dark:text-white">
                v{num(pick(v, "version")) ?? "?"}
              </span>
              {str(pick(v, "note")) ? ` — ${str(pick(v, "note"))}` : ""}
              {str(pick(v, "createdBy", "created_by"))
                ? ` · ${str(pick(v, "createdBy", "created_by"))}`
                : ""}
              {str(pick(v, "createdAt", "created_at"))
                ? ` · ${fmtDate(str(pick(v, "createdAt", "created_at")))}`
                : ""}
            </li>
          ))}
        </ul>
      )}
      {fallbackNums.length >= 2 && (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div>
            <label className={labelCls}>From</label>
            <select className={`${selectCls} min-h-[40px] w-auto`} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
              <option value="">Select…</option>
              {fallbackNums.map((n) => (
                <option key={n} value={n}>v{n}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>To</label>
            <select className={`${selectCls} min-h-[40px] w-auto`} value={to} onChange={(e) => setTo(Number(e.target.value))}>
              <option value="">Select…</option>
              {fallbackNums.map((n) => (
                <option key={n} value={n}>v{n}</option>
              ))}
            </select>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void runDiff()} disabled={from === "" || to === "" || busy} loading={busy}>
            Compare
          </Button>
        </div>
      )}
      {error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {changes && (
        <ul className="mt-3 space-y-1.5 text-sm text-slate-700 dark:text-white/80">
          {changes.length === 0 && <li>No differences between these versions.</li>}
          {changes.map((c, i) => (
            <li key={i}>
              <span className="badge badge-neutral">{str(pick(c, "kind")).replace(/_/g, " ")}</span>{" "}
              {str(pick(c, "label")) || str(pick(c, "blockKey", "block_key"))}
              {pick(c, "from") !== undefined && pick(c, "from") !== null
                ? ` — ${String(pick(c, "from"))} → ${String(pick(c, "to") ?? "")}`
                : ""}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --------------------------- deliveries -------------------------- */

function DeliveriesPanel({
  reportId,
  deliveries,
  onChanged,
}: {
  reportId: string;
  deliveries: CommsDelivery[];
  onChanged: () => void;
}) {
  const [busyId, setBusyId] = useState("");
  const revoke = async (d: CommsDelivery) => {
    if (!window.confirm("Revoke this recipient's access? Their link stops working immediately.")) return;
    setBusyId(d.id);
    try {
      await api(
        `${COMMS_API}/reports/${encodeURIComponent(reportId)}/deliveries/${encodeURIComponent(d.id)}/revoke`,
        { method: "POST" }
      );
      onChanged();
    } catch {
      window.alert("Could not revoke this delivery.");
    } finally {
      setBusyId("");
    }
  };

  const when = (v: unknown) => {
    const s = typeof v === "string" ? v : "";
    return s ? fmtDate(s) : "—";
  };

  return (
    <section className="card-surface mt-5 p-5" aria-label="Deliveries">
      <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">Deliveries</h3>
      {deliveries.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
          Not delivered yet. Approve the report, then use Send.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="tbl-grad w-full min-w-[760px] text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Recipient</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Email</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Delivered</th>
                <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Opened / Viewed / Downloaded</th>
                <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Actions</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => {
                const rec = d as Rec;
                const revoked = d.status === "revoked";
                return (
                  <tr key={d.id} className="border-t border-slate-100 align-top dark:border-white/5">
                    <td className="px-3 py-2.5">
                      <span className="font-medium text-navy-900 dark:text-white">
                        {str(pick(rec, "recipientName", "recipient_name")) || "—"}
                      </span>
                      <span className="block text-xs text-slate-400 dark:text-white/40">
                        {str(pick(rec, "recipientEmail", "recipient_email"))}
                        {num(pick(rec, "version")) ? ` · v${num(pick(rec, "version"))}` : ""}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`badge ${revoked ? "badge-danger" : "badge-fit"}`}>{d.status}</span>
                    </td>
                    <td className="px-3 py-2.5 text-slate-600 dark:text-white/70">
                      {str(pick(rec, "emailStatus", "email_status")) || "—"}
                      {str(pick(rec, "emailDetail", "email_detail")) && (
                        <span className="block text-xs text-slate-400 dark:text-white/40">
                          {str(pick(rec, "emailDetail", "email_detail"))}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-white/50">
                      {when(pick(rec, "deliveredAt", "delivered_at"))}
                    </td>
                    <td className="px-3 py-2.5 text-slate-500 dark:text-white/50">
                      {when(pick(rec, "openedAt", "opened_at"))} /{" "}
                      {when(pick(rec, "viewedAt", "viewed_at"))} /{" "}
                      {when(pick(rec, "downloadedAt", "downloaded_at"))}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {!revoked && (
                        <Button variant="ghost" size="sm" disabled={busyId === d.id} onClick={() => void revoke(d)}>
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ----------------------------- threads --------------------------- */

function ThreadsPanel({ reportId }: { reportId: string }) {
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Record<string, unknown>>(
        `${COMMS_API}/reports/${encodeURIComponent(reportId)}/threads`
      );
      setComments(listFrom<CommentRow>(data, "items", "comments"));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [reportId]);

  useEffect(() => {
    void load();
  }, [load]);

  const post = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await api(`${COMMS_API}/reports/${encodeURIComponent(reportId)}/threads`, {
        method: "POST",
        body: JSON.stringify({ body: body.trim() }),
      });
      setBody("");
      void load();
    } catch {
      window.alert("Could not post the reply.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card-surface mt-5 p-5" aria-label="Discussion">
      <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
        Discussion
      </h3>
      <p className="mt-0.5 text-xs text-slate-400 dark:text-white/40">
        Recipient replies from the delivered link land here too.
      </p>
      {failed ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-white/50">
          Thread could not be loaded.{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : comments.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500 dark:text-white/50">No messages yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40">
                {str(pick(c, "author")) || "Unknown"}
                {str(pick(c, "createdAt", "created_at"))
                  ? ` · ${fmtDate(str(pick(c, "createdAt", "created_at")))}`
                  : ""}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700 dark:text-white/80">
                {str(pick(c, "body"))}
              </p>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4">
        <label className={labelCls} htmlFor="thread-reply">Reply</label>
        <textarea
          id="thread-reply"
          className={`${inputCls} min-h-[72px]`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Internal note or follow-up on this report…"
        />
        <div className="mt-2 flex justify-end">
          <Button variant="primary" size="sm" onClick={() => void post()} disabled={!body.trim() || busy} loading={busy}>
            Post reply
          </Button>
        </div>
      </div>
    </section>
  );
}
