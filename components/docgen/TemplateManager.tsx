"use client";

/**
 * TemplateManager (Contract generation, Oct 24, 2026) — Settings →
 * Templates. Lists the contract template library with version,
 * status (draft / approved) and the approved-by record; supports
 * creating and editing text templates (with a merge-field picker),
 * uploading a .docx template file, approving (an approved-by note is
 * required), returning to draft, and soft-deleting.
 *
 * Content edits bump the version and return the template to draft —
 * approval applies to a version, so a changed template must be
 * re-approved before it can generate again.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import { fmtDate } from "@/lib/format";

interface Template {
  id: string;
  key: string;
  name: string;
  description: string;
  body: string;
  version: number;
  status: "draft" | "approved";
  approvedBy: string;
  approvedNote: string;
  approvedAt: string | null;
  scope: "deal" | "investor" | "general";
  sourceFormat: "text" | "docx";
  docxFilename: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

const MERGE_FIELDS = [
  "deal.companyName", "deal.industry", "deal.city", "deal.stage",
  "deal.contactName", "deal.contactEmail", "deal.broker", "deal.owner",
  "deal.askingPrice", "deal.dealValue", "deal.revenue", "deal.ebitda",
  "company.name", "company.city",
  "fin.latestRevenue", "fin.latestEbitda", "fin.latestPeriodEnd",
  "counterparty.name", "counterparty.title", "counterparty.company",
  "counterparty.email", "counterparty.phone", "counterparty.address",
  "investor.name", "investor.entity", "investor.contactName",
  "investor.title", "investor.email", "investor.address",
  "investor.commitment",
  "firm.name", "firm.legalName", "firm.address",
  "date.today", "date.year",
];

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

const SCOPE_LABEL: Record<Template["scope"], string> = {
  deal: "Deal / company",
  investor: "Investor",
  general: "General",
};

export default function TemplateManager() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      // no-store is load-bearing (Send anywhere, Oct 25, 2026): the
      // GET route sends Cache-Control: private, max-age=60, and a
      // cached pre-approval list made successful approvals look like
      // they never saved.
      const res = await fetch("/api/platform/docgen/templates", {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { templates?: Template[] };
      setTemplates(Array.isArray(data.templates) ? data.templates : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  /** Merge a mutation response's template straight into the list —
   * the row's status flips from the PATCH result itself, never from
   * a refetch that could be stale. */
  const mergeTemplate = useCallback((updated: Template) => {
    setTemplates((list) =>
      list.map((t) => (t.id === updated.id ? updated : t))
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load, reloadTick]);

  const refresh = () => setReloadTick((t) => t + 1);

  if (loading) return <SkeletonRows rows={5} />;
  if (error) {
    return (
      <ErrorState
        title="Could not load templates"
        message="The template library could not be loaded — try again in a moment."
        onRetry={refresh}
      />
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500 dark:text-white/50">
          {templates.length} template{templates.length === 1 ? "" : "s"} ·{" "}
          {templates.filter((t) => t.status === "approved").length} approved
        </p>
        <button
          type="button"
          className="btn btn-primary btn-sm min-h-[44px]"
          onClick={() => setShowCreate((s) => !s)}
        >
          {showCreate ? "Cancel" : "New template"}
        </button>
      </div>

      {notice && (
        <p className="mb-4 rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
          {notice}
        </p>
      )}

      {showCreate && (
        <TemplateForm
          onDone={(msg) => {
            setShowCreate(false);
            setNotice(msg);
            refresh();
          }}
        />
      )}

      {templates.length === 0 ? (
        <EmptyState
          title="No templates yet"
          message="Create the first template, or upload a .docx — it stays in draft until you approve it."
        />
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/5">
          {templates.map((t) => (
            <li key={t.id} className="py-4 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-[#0d1f3c] dark:text-white">
                  {t.name}
                </span>
                <span className="badge badge-neutral">
                  {SCOPE_LABEL[t.scope]}
                </span>
                <span className="badge badge-neutral">v{t.version}</span>
                <span
                  className={`badge ${t.status === "approved" ? "badge-fit" : "badge-warn"}`}
                >
                  {t.status === "approved" ? "Approved" : "Draft"}
                </span>
                <span className="badge badge-neutral">
                  {t.sourceFormat === "docx"
                    ? `DOCX${t.docxFilename ? ` · ${t.docxFilename}` : ""}`
                    : "Text"}
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm min-h-[44px]"
                  onClick={() => setOpenId(openId === t.id ? null : t.id)}
                >
                  {openId === t.id ? "Close" : "Manage"}
                </button>
              </div>
              {t.description && (
                <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
                  {t.description}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                {t.status === "approved"
                  ? `Approved by ${t.approvedBy}${t.approvedAt ? ` · ${fmtDate(t.approvedAt)}` : ""}${t.approvedNote ? ` · “${t.approvedNote}”` : ""}`
                  : "Not approved — cannot generate documents."}{" "}
                · Updated {fmtDate(t.updatedAt)}
              </p>
              {openId === t.id && (
                <TemplateForm
                  template={t}
                  onUpdated={mergeTemplate}
                  onDone={(msg) => {
                    setOpenId(null);
                    setNotice(msg);
                    refresh();
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TemplateForm({
  template,
  onDone,
  onUpdated,
}: {
  template?: Template;
  onDone: (msg: string) => void;
  onUpdated?: (t: Template) => void;
}) {
  const isEdit = Boolean(template);
  const [name, setName] = useState(template?.name ?? "");
  const [scope, setScope] = useState<Template["scope"]>(
    template?.scope ?? "deal"
  );
  const [description, setDescription] = useState(template?.description ?? "");
  const [body, setBody] = useState(template?.body ?? "");
  const [approvedBy, setApprovedBy] = useState("");
  const [approveNote, setApproveNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const insertField = (field: string) => {
    const ta = bodyRef.current;
    const token = `{{${field}}}`;
    if (!ta) {
      setBody((b) => b + token);
      return;
    }
    const start = ta.selectionStart ?? body.length;
    const end = ta.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const call = async (
    fn: () => Promise<Response>,
    okMsg: string,
    failMsg: string
  ) => {
    setBusy(true);
    setFormError(null);
    try {
      const res = await fn();
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        template?: Template;
      };
      if (!res.ok) {
        setFormError(
          data.error === "approved_by_required"
            ? "Approval needs a name: enter who approved this template in the “Approved by” field — the approval is recorded against that name and is rejected without it. The template is still a draft."
            : `${failMsg} (${data.error ?? res.status})`
        );
        return;
      }
      // Apply the server's returned row immediately — the visible
      // status comes from the mutation result, not a later refetch.
      if (data.template && onUpdated) onUpdated(data.template);
      onDone(okMsg);
    } catch {
      setFormError(failMsg);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    void call(
      () =>
        isEdit
          ? fetch(`/api/platform/docgen/templates/${template!.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, description, body, scope }),
            })
          : fetch("/api/platform/docgen/templates", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name, description, body, scope }),
            }),
      isEdit
        ? "Template saved. Content changes bump the version and return it to draft."
        : "Template created in draft. Approve it before it can generate documents.",
      "Could not save the template."
    );

  const approve = () => {
    // Never an inert button (Send anywhere, Oct 25, 2026): clicking
    // Approve without a name produces this visible error and the
    // template stays clearly draft — the API rejects a nameless
    // approval (approved_by_required), so the click must say why.
    if (!approvedBy.trim()) {
      setFormError(
        "Approval needs a name: enter who approved this template in the “Approved by” field above — the approval is recorded against that name. Nothing was approved; the template is still a draft."
      );
      return;
    }
    void call(
      () =>
        fetch(`/api/platform/docgen/templates/${template!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "approve",
            approvedBy: approvedBy.trim(),
            note: approveNote.trim(),
          }),
        }),
      `Template approved (v${template!.version}). It can now generate documents.`,
      "Could not approve the template."
    );
  };

  const unapprove = () =>
    void call(
      () =>
        fetch(`/api/platform/docgen/templates/${template!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "unapprove" }),
        }),
      "Template returned to draft — it can no longer generate documents.",
      "Could not return the template to draft."
    );

  const remove = () =>
    void call(
      () =>
        fetch(`/api/platform/docgen/templates/${template!.id}`, {
          method: "DELETE",
        }),
      "Template deleted.",
      "Could not delete the template."
    );

  const uploadDocx = async (file: File) => {
    if (!template) return;
    setBusy(true);
    setFormError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const res = await fetch(
        `/api/platform/docgen/templates/${template.id}/docx`,
        { method: "POST", body: form }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setFormError(`DOCX upload failed (${data.error ?? res.status}).`);
        return;
      }
      onDone(
        "DOCX template uploaded. The version bumped and the template is back in draft — re-approve to generate."
      );
    } catch {
      setFormError("DOCX upload failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 p-4 dark:border-white/10">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Name</label>
          <input
            className={`${inputCls} min-h-[44px]`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Mutual NDA"
          />
        </div>
        <div>
          <label className={labelCls}>Scope</label>
          <select
            className={`${inputCls} min-h-[44px]`}
            value={scope}
            onChange={(e) => setScope(e.target.value as Template["scope"])}
          >
            <option value="deal">Deal / company</option>
            <option value="investor">Investor</option>
            <option value="general">General (both)</option>
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Description</label>
          <input
            className={`${inputCls} min-h-[44px]`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>
            Body — merge fields fill at generation
          </label>
          <textarea
            ref={bodyRef}
            className={`${inputCls} min-h-[220px] font-mono text-[13px] leading-relaxed`}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"AGREEMENT\n\nThis agreement is between {{firm.legalName}} and {{counterparty.name}}…"}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MERGE_FIELDS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => insertField(f)}
                className="rounded-full border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-[#b8975a] hover:text-[#8a6f3c] dark:border-white/15 dark:text-white/60"
              >
                {`{{${f}}}`}
              </button>
            ))}
          </div>
          {template?.sourceFormat === "docx" && (
            <p className="mt-2 text-xs text-slate-400 dark:text-white/40">
              This template generates from its uploaded DOCX file
              {template.docxFilename ? ` (${template.docxFilename})` : ""};
              the text body above is kept for reference.
            </p>
          )}
        </div>
      </div>

      {formError && (
        <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {formError}
        </p>
      )}

      {isEdit && (
        <div className="mb-5 border-b border-slate-100 pb-4 dark:border-white/5">
          <h4 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">
            Approval
          </h4>
          {template!.status === "approved" ? (
            <>
              <p className="mt-1 text-sm text-slate-600 dark:text-white/70">
                Approved by {template!.approvedBy}
                {template!.approvedNote ? ` — “${template!.approvedNote}”` : ""}.
                This version (v{template!.version}) can generate documents.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-3 min-h-[44px]"
                disabled={busy}
                onClick={unapprove}
              >
                Return to draft
              </button>
            </>
          ) : (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Approved by *</label>
                <input
                  className={`${inputCls} min-h-[44px]`}
                  value={approvedBy}
                  onChange={(e) => setApprovedBy(e.target.value)}
                  placeholder="Who approved this template"
                />
              </div>
              <div>
                <label className={labelCls}>Note</label>
                <input
                  className={`${inputCls} min-h-[44px]`}
                  value={approveNote}
                  onChange={(e) => setApproveNote(e.target.value)}
                  placeholder="e.g. Reviewed against firm standard, Oct 2026"
                />
              </div>
              <div>
                <button
                  type="button"
                  className="btn btn-primary btn-sm min-h-[44px]"
                  disabled={busy}
                  onClick={approve}
                >
                  Approve v{template!.version}
                </button>
                <p className="mt-1 text-xs text-slate-400 dark:text-white/40">
                  Approval is recorded against the name above and applies
                  to this version only.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary btn-sm min-h-[44px]"
          disabled={busy || !name.trim() || !body.trim()}
          onClick={save}
        >
          {busy ? "Saving…" : isEdit ? "Save changes" : "Create template"}
        </button>
        {isEdit && (
          <button
            type="button"
            className="btn btn-secondary btn-sm min-h-[44px]"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            Upload .docx template
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void uploadDocx(f);
            e.target.value = "";
          }}
        />
        {isEdit &&
          (confirmDelete ? (
            <>
              <button
                type="button"
                className="btn btn-sm min-h-[44px] bg-red-600 text-white hover:bg-red-700"
                disabled={busy}
                onClick={remove}
              >
                Confirm delete
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm min-h-[44px]"
                onClick={() => setConfirmDelete(false)}
              >
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm min-h-[44px]"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </button>
          ))}
      </div>

    </div>
  );
}
