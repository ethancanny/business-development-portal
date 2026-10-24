"use client";

/**
 * ReportsList — the Communications home Reports tab: every report
 * with status chips and SAMPLE / STALE / UNREVIEWED badges, a status
 * filter, and the New report dialog (template + subject pickers +
 * sample toggle). Subject lists come from the existing platform
 * APIs: companies (/api/platform/companies), deals
 * (/api/platform/capital/deals), investors
 * (/api/platform/capital/investors), Directory people
 * (/api/platform/directory).
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  COMMS_API,
  SUBJECT_KINDS,
  api,
  bool,
  fmtDate,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  num,
  pick,
  reportStatusBadge,
  selectCls,
  str,
  type CommsReport,
  type CommsTemplate,
  type Rec,
} from "@/components/comms/types";

interface SubjectOption {
  id: string;
  label: string;
}

const STATUS_FILTERS = [
  { key: "", label: "All" },
  { key: "generating", label: "Generating" },
  { key: "draft", label: "Draft" },
  { key: "in_review", label: "In review" },
  { key: "approved", label: "Approved" },
  { key: "sent", label: "Sent" },
  { key: "discarded", label: "Discarded" },
];

export default function ReportsList() {
  const router = useRouter();
  const [reports, setReports] = useState<CommsReport[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [statusFilter, setStatusFilter] = useState("");
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const qs = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
      const data = await api<Record<string, unknown>>(`${COMMS_API}/reports${qs}`);
      setReports(listFrom<CommsReport>(data, "items", "reports"));
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (r: CommsReport) => {
    if (!window.confirm(`Delete "${r.title || "Untitled report"}"?`)) return;
    try {
      await api(`${COMMS_API}/reports/${encodeURIComponent(r.id)}`, {
        method: "DELETE",
      });
      void load();
    } catch {
      window.alert("Could not delete the report.");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={statusFilter === f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`chip min-h-[36px] ${statusFilter === f.key ? "chip-active" : ""}`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <Button variant="primary" size="sm" className="min-h-[44px]" onClick={() => setShowNew(true)}>
          New report
        </Button>
      </div>

      <div className="mt-4">
        {phase === "loading" && <SkeletonRows rows={5} />}
        {phase === "error" && <ErrorState onRetry={() => void load()} />}
        {phase === "ready" && reports.length === 0 && (
          <EmptyState
            title="No reports yet"
            message="Generate a report from a template — or from any company, deal, investor, or portfolio page."
            actionLabel="New report"
            onAction={() => setShowNew(true)}
          />
        )}
        {phase === "ready" && reports.length > 0 && (
          <div className="overflow-x-auto">
            <table className="tbl-grad w-full min-w-[720px] text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Report</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Subject</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Updated</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => {
                  const isSample = bool(pick(r as Rec, "isSample", "is_sample"));
                  const stale = bool(pick(r as Rec, "stale"));
                  const unreviewed = bool(pick(r as Rec, "hasUnreviewed", "has_unreviewed"));
                  const version = num(pick(r as Rec, "currentVersion", "current_version"));
                  return (
                    <tr key={r.id} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                      <td className="px-3 py-2.5">
                        <Link
                          href={`/communications/reports/${encodeURIComponent(r.id)}`}
                          className="font-semibold text-navy-900 hover:underline dark:text-white"
                        >
                          {str(pick(r as Rec, "title")) || "Untitled report"}
                        </Link>
                        <span className="block text-xs text-slate-400 dark:text-white/40">
                          {str(pick(r as Rec, "templateName", "template_name")) || "—"}
                          {version ? ` · v${version}` : ""}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-600 dark:text-white/70">
                        {labelOf(SUBJECT_KINDS, str(pick(r as Rec, "subjectKind", "subject_kind")))}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="flex flex-wrap gap-1.5">
                          <span className={`badge ${reportStatusBadge(r.status)}`}>
                            {r.status.replace(/_/g, " ")}
                          </span>
                          {isSample && <span className="badge badge-warn">SAMPLE</span>}
                          {stale && <span className="badge badge-warn">STALE</span>}
                          {unreviewed && <span className="badge badge-danger">UNREVIEWED</span>}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 dark:text-white/50">
                        {r.updatedAt ? fmtDate(r.updatedAt) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="flex justify-end gap-2">
                          <Link
                            href={`/communications/reports/${encodeURIComponent(r.id)}`}
                            className="btn btn-secondary btn-sm"
                          >
                            Open
                          </Link>
                          <Button variant="ghost" size="sm" onClick={() => void remove(r)}>
                            Delete
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showNew && (
        <NewReportDialog
          onClose={() => setShowNew(false)}
          onCreated={(id) => router.push(`/communications/reports/${encodeURIComponent(id)}`)}
        />
      )}
    </div>
  );
}

function NewReportDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [templates, setTemplates] = useState<CommsTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [subjectKind, setSubjectKind] = useState("company");
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [subjectsLoading, setSubjectsLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [isSample, setIsSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const data = await api<Record<string, unknown>>(`${COMMS_API}/templates`);
        const items = listFrom<CommsTemplate>(data, "items", "templates");
        setTemplates(items);
        setTemplateId(items[0]?.id ?? "");
      } catch {
        setTemplates([]);
      }
    })();
  }, []);

  useEffect(() => {
    let live = true;
    setSubjects([]);
    setSubjectId("");
    setSubjectsLoading(true);
    void (async () => {
      try {
        let opts: SubjectOption[] = [];
        if (subjectKind === "company" || subjectKind === "portfolio_company") {
          const res = await fetch("/api/platform/companies?limit=50", { cache: "no-store" });
          const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
          const rows = listFrom<Rec>(data, "companies", "items");
          opts = rows
            .map((c) => ({ id: str(c.id), label: str(c.name) || str(c.id) }))
            .filter((o) => o.id);
        } else if (subjectKind === "deal") {
          const data = await api<Record<string, unknown>>("/api/platform/capital/deals");
          const rows = listFrom<Rec>(data, "items", "deals");
          opts = rows
            .map((d) => ({
              id: str(pick(d, "dealId", "id")),
              label:
                str(pick(d, "dealName", "name", "companyName")) ||
                str(pick(d, "dealId", "id")),
            }))
            .filter((o) => o.id);
        } else if (subjectKind === "investor") {
          const data = await api<Record<string, unknown>>(
            "/api/platform/capital/investors?limit=50"
          );
          const rows = listFrom<Rec>(data, "items", "investors");
          opts = rows
            .map((p) => ({
              id: str(pick(p, "personId", "id")),
              label: str(pick(p, "name")) || str(pick(p, "personId", "id")),
            }))
            .filter((o) => o.id);
        }
        if (live) {
          setSubjects(opts);
          setSubjectId(opts[0]?.id ?? "");
        }
      } catch {
        if (live) setSubjects([]);
      } finally {
        if (live) setSubjectsLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [subjectKind]);

  const create = async () => {
    if (!templateId || busy) return;
    if (!isSample && !subjectId) {
      setError("Pick a subject, or switch on Sample mode.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        templateId,
        subjectKind,
        isSample,
        title: title.trim() || undefined,
      };
      if (subjectKind === "company" || subjectKind === "portfolio_company") {
        body.companyId = subjectId || undefined;
      } else if (subjectKind === "deal") {
        body.dealId = subjectId || undefined;
      } else if (subjectKind === "investor") {
        body.personId = subjectId || undefined;
      }
      const data = await api<Record<string, unknown>>(`${COMMS_API}/reports`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const report = (data.report ?? data) as Rec;
      const id = str(report.id);
      if (!id) throw new Error("no_id");
      onCreated(id);
    } catch {
      setError("Could not create the report. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="New report"
      onClick={() => !busy && onClose()}
    >
      <div className="card-surface w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
          New report
        </h3>
        <div className="mt-4 space-y-3">
          <div>
            <label className={labelCls} htmlFor="nr-template">Template</label>
            <select
              id="nr-template"
              className={`${selectCls} min-h-[44px]`}
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
            >
              {templates.length === 0 && <option value="">No templates available</option>}
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="nr-kind">Subject type</label>
            <select
              id="nr-kind"
              className={`${selectCls} min-h-[44px]`}
              value={subjectKind}
              onChange={(e) => setSubjectKind(e.target.value)}
            >
              {SUBJECT_KINDS.map((k) => (
                <option key={k.key} value={k.key}>{k.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="nr-subject">Subject</label>
            <select
              id="nr-subject"
              className={`${selectCls} min-h-[44px]`}
              value={subjectId}
              onChange={(e) => setSubjectId(e.target.value)}
              disabled={subjectsLoading || isSample}
            >
              {subjects.length === 0 && (
                <option value="">{subjectsLoading ? "Loading…" : "No subjects found"}</option>
              )}
              {subjects.map((o) => (
                <option key={o.id} value={o.id}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="nr-title">Title (optional)</label>
            <input
              id="nr-title"
              className={`${inputCls} min-h-[44px]`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Defaults to the template + subject"
            />
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-slate-700 dark:text-white/80">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={isSample}
              onChange={(e) => setIsSample(e.target.checked)}
            />
            Sample report (canned data, clearly watermarked)
          </label>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" size="sm" onClick={() => void create()} disabled={!templateId || busy} loading={busy}>
            Create draft
          </Button>
        </div>
      </div>
    </div>
  );
}
