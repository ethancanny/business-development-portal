"use client";

/**
 * GenerateReportButton — the reusable "Generate report" placement
 * used on company / deal / investor / portfolio surfaces. Opens a
 * dialog with a template select (filtered to templates whose
 * subject_kinds include the surface kind; templates with no declared
 * kinds are treated as general-purpose) and a sample toggle, then
 * POSTs to the comms reports API and routes to the new report.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import {
  COMMS_API,
  api,
  inputCls,
  labelCls,
  listFrom,
  selectCls,
  str,
  templateSubjectKinds,
  type CommsTemplate,
} from "@/components/comms/types";

export default function GenerateReportButton({
  subjectKind,
  companyId,
  dealId,
  personId,
  label = "Generate report",
}: {
  subjectKind: string;
  companyId?: string;
  dealId?: string;
  personId?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [templates, setTemplates] = useState<CommsTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [templateId, setTemplateId] = useState("");
  const [isSample, setIsSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<Record<string, unknown>>(`${COMMS_API}/templates`);
      const all = listFrom<CommsTemplate>(data, "items", "templates");
      const filtered = all.filter((t) => {
        const kinds = templateSubjectKinds(t);
        return kinds.length === 0 || kinds.includes(subjectKind);
      });
      setTemplates(filtered);
      setTemplateId((prev) => prev || (filtered[0]?.id ?? ""));
    } catch {
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, [subjectKind]);

  useEffect(() => {
    if (open) void loadTemplates();
  }, [open, loadTemplates]);

  const create = async () => {
    if (!templateId || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api<Record<string, unknown>>(`${COMMS_API}/reports`, {
        method: "POST",
        body: JSON.stringify({
          templateId,
          subjectKind,
          companyId,
          dealId,
          personId,
          isSample,
        }),
      });
      const report = (data.report ?? data) as Record<string, unknown>;
      const id = str(report.id);
      if (!id) throw new Error("no_id");
      setOpen(false);
      router.push(`/communications/reports/${encodeURIComponent(id)}`);
    } catch {
      setError("Could not create the report. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="min-h-[44px]"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/60 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-label="Generate report"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="card-surface w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
              Generate report
            </h3>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
              Creates a draft from live data. Nothing is sent until the
              report is reviewed, approved, and delivered from the
              report page.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className={labelCls} htmlFor="grb-template">
                  Template
                </label>
                <select
                  id="grb-template"
                  className={`${selectCls} min-h-[44px]`}
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  disabled={loading}
                >
                  {templates.length === 0 && (
                    <option value="">
                      {loading ? "Loading…" : "No templates for this subject"}
                    </option>
                  )}
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
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
              <div>
                <label className={labelCls}>Subject</label>
                <input
                  className={inputCls}
                  value={subjectKind.replace(/_/g, " ")}
                  readOnly
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-700 dark:text-red-300">
                {error}
              </p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={() => void create()}
                disabled={!templateId || busy}
                loading={busy}
              >
                Create draft
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
