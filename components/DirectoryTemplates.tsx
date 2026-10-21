"use client";

/**
 * Directory email templates (Phase 2, Oct 21, 2026).
 *
 * List / create / delete reusable email templates, and a compose
 * area that fills {{name}} and {{company}} from a selected directory
 * record. Sending is mailto: + copy-to-clipboard ONLY — mail scope
 * is not consented for Graph sending, so there is deliberately no
 * send-through-the-portal path here.
 */

import { useEffect, useState } from "react";
import type { DirectoryItem } from "@/components/DirectoryUnified";

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

function normalizeTemplates(data: unknown): EmailTemplate[] {
  if (Array.isArray(data)) return data as EmailTemplate[];
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    if (Array.isArray(obj.templates)) return obj.templates as EmailTemplate[];
    if (Array.isArray(obj.items)) return obj.items as EmailTemplate[];
  }
  return [];
}

export function fillPlaceholders(
  text: string,
  record: DirectoryItem | null
): string {
  const name = record ? record.name : "";
  const company = record
    ? record.kind === "organization"
      ? record.name
      : record.organizationName || ""
    : "";
  return text
    .replace(/\{\{\s*name\s*\}\}/gi, name)
    .replace(/\{\{\s*company\s*\}\}/gi, company);
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white dark:placeholder:text-white/30";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

export default function DirectoryTemplates({
  selectedRecord,
  onClose,
}: {
  selectedRecord: DirectoryItem | null;
  onClose?: () => void;
}) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [form, setForm] = useState({ name: "", subject: "", body: "" });
  const [creating, setCreating] = useState(false);
  const [formMsg, setFormMsg] = useState("");

  const [composeId, setComposeId] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [copyMsg, setCopyMsg] = useState("");

  const load = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const r = await fetch("/api/platform/directory/templates");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTemplates(normalizeTemplates(await r.json()));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const create = async () => {
    if (!form.name.trim() || !form.subject.trim() || creating) return;
    setCreating(true);
    setFormMsg("");
    try {
      const r = await fetch("/api/platform/directory/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          subject: form.subject,
          body: form.body,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setForm({ name: "", subject: "", body: "" });
      setFormMsg("Template saved.");
      await load();
    } catch {
      setFormMsg("Could not save the template.");
    } finally {
      setCreating(false);
    }
  };

  const remove = async (tpl: EmailTemplate) => {
    try {
      const r = await fetch(
        `/api/platform/directory/templates/${encodeURIComponent(tpl.id)}`,
        { method: "DELETE" }
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setTemplates((ts) => ts.filter((t) => t.id !== tpl.id));
      if (composeId === tpl.id) {
        setComposeId("");
        setComposeSubject("");
        setComposeBody("");
      }
    } catch {
      /* leave the list as-is on failure */
    }
  };

  const useTemplate = (tpl: EmailTemplate) => {
    setComposeId(tpl.id);
    setComposeSubject(fillPlaceholders(tpl.subject, selectedRecord));
    setComposeBody(fillPlaceholders(tpl.body, selectedRecord));
    setCopyMsg("");
  };

  // Re-fill placeholders when the selected record changes mid-compose.
  useEffect(() => {
    if (!composeId) return;
    const tpl = templates.find((t) => t.id === composeId);
    if (!tpl) return;
    setComposeSubject(fillPlaceholders(tpl.subject, selectedRecord));
    setComposeBody(fillPlaceholders(tpl.body, selectedRecord));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRecord?.id]);

  const mailtoHref = `mailto:${selectedRecord?.email ? encodeURIComponent(selectedRecord.email) : ""}?subject=${encodeURIComponent(composeSubject)}&body=${encodeURIComponent(composeBody)}`;

  const copyCompose = async () => {
    const text = `${composeSubject}\n\n${composeBody}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyMsg("Copied to clipboard.");
    } catch {
      setCopyMsg("Copy failed — select the text and copy it manually.");
    }
  };

  return (
    <section className="card-surface p-5" aria-label="Email templates">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="font-display text-xl font-semibold text-navy-900 dark:text-white">
          Email templates
        </h3>
        {onClose && (
          <button type="button" onClick={onClose} className="btn btn-secondary btn-sm">
            Hide
          </button>
        )}
      </div>
      <p className="mb-4 text-xs text-slate-400 dark:text-white/40">
        Templates open in your own mail app (mailto) or copy to the clipboard —
        the portal does not send mail directly. Use {"{{name}}"} and {"{{company}}"}
        placeholders; they fill from the selected record
        {selectedRecord ? (
          <>
            {" "}(currently: <span className="font-semibold">{selectedRecord.name}</span>)
          </>
        ) : (
          " — open a record first to fill them"
        )}
        .
      </p>

      <div className="grid gap-5 lg:grid-cols-2">
        <div>
          <p className={labelCls}>Saved templates</p>
          {loading ? (
            <p className="text-sm text-slate-400 dark:text-white/40">Loading templates…</p>
          ) : loadError ? (
            <p className="text-sm text-slate-400 dark:text-white/40">
              Templates could not be loaded.{" "}
              <button
                type="button"
                onClick={() => void load()}
                className="font-semibold text-[#8a6f3e] underline decoration-[#b8975a] decoration-2 underline-offset-2 dark:text-[#d4b37a]"
              >
                Retry
              </button>
            </p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-white/40">
              No templates yet — create the first one on the right.
            </p>
          ) : (
            <ul className="space-y-2">
              {templates.map((tpl) => (
                <li
                  key={tpl.id}
                  className={`rounded-xl border p-3 ${
                    composeId === tpl.id
                      ? "border-[#b8975a] ring-1 ring-[#b8975a]"
                      : "border-slate-200 dark:border-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-sm font-semibold text-[#0d1f3c] dark:text-white">
                      {tpl.name}
                    </span>
                    <span className="flex shrink-0 gap-1.5">
                      <button
                        type="button"
                        onClick={() => useTemplate(tpl)}
                        className="btn btn-primary btn-sm"
                      >
                        Use
                      </button>
                      <button
                        type="button"
                        onClick={() => void remove(tpl)}
                        className="btn btn-ghost btn-sm"
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-400 dark:text-white/40">
                    {tpl.subject}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <p className={`${labelCls} mt-5`}>New template</p>
          <div className="space-y-2.5">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Template name (e.g. Intro to operator)"
              className={inputCls}
            />
            <input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
              placeholder="Subject — e.g. Introduction from Canny Capital"
              className={inputCls}
            />
            <textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder={"Body — e.g. Hi {{name}}, … your work at {{company}} …"}
              rows={5}
              className={inputCls}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={creating || !form.name.trim() || !form.subject.trim()}
                onClick={() => void create()}
                className="btn btn-primary btn-sm min-h-[44px]"
              >
                {creating ? "Saving…" : "Save template"}
              </button>
              {formMsg && (
                <span className="text-xs text-slate-500 dark:text-white/55">{formMsg}</span>
              )}
            </div>
          </div>
        </div>

        <div>
          <p className={labelCls}>Compose</p>
          {!composeId ? (
            <p className="text-sm text-slate-400 dark:text-white/40">
              Pick a template and tap “Use” to compose a message here.
            </p>
          ) : (
            <div className="space-y-2.5">
              <div>
                <label className={labelCls} htmlFor="dir-tpl-to">
                  To
                </label>
                <input
                  id="dir-tpl-to"
                  value={selectedRecord ? selectedRecord.email || "(no email on record)" : "(no record selected)"}
                  readOnly
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="dir-tpl-subject">
                  Subject
                </label>
                <input
                  id="dir-tpl-subject"
                  value={composeSubject}
                  onChange={(e) => setComposeSubject(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls} htmlFor="dir-tpl-body">
                  Body
                </label>
                <textarea
                  id="dir-tpl-body"
                  value={composeBody}
                  onChange={(e) => setComposeBody(e.target.value)}
                  rows={9}
                  className={inputCls}
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <a href={mailtoHref} className="btn btn-primary btn-sm min-h-[44px]">
                  Open in mail app
                </a>
                <button
                  type="button"
                  onClick={() => void copyCompose()}
                  className="btn btn-secondary btn-sm min-h-[44px]"
                >
                  Copy to clipboard
                </button>
                {copyMsg && (
                  <span className="text-xs text-slate-500 dark:text-white/55">{copyMsg}</span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
