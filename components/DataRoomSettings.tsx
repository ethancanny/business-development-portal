"use client";

import { useCallback, useEffect, useState } from "react";
import { Button, ErrorState, SkeletonRows } from "@/components/ui";

interface Integration {
  key: string;
  name: string;
  status: string;
  lastSuccessAt?: string | null;
  lastError?: string | null;
  detail?: string | null;
}
interface TemplateRow {
  id: string;
  name: string;
  structure: { folders: { name: string; items: string[] }[] };
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const inputCls =
  "w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-[#0d1f3c] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-[#132847]/60 dark:text-white dark:placeholder:text-white/30";
const labelCls =
  "mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40";

function dotClass(status: string): string {
  if (status === "ok") return "bg-emerald-500";
  if (status === "error") return "bg-red-500";
  return "bg-slate-400";
}

export default function DataRoomSettings() {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [intLoading, setIntLoading] = useState(true);
  const [intError, setIntError] = useState("");

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [tplLoading, setTplLoading] = useState(true);
  const [tplError, setTplError] = useState("");
  const [selectedId, setSelectedId] = useState<string>("");
  const [tplName, setTplName] = useState("");
  const [folders, setFolders] = useState<{ name: string; itemsText: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  const loadIntegrations = useCallback(async () => {
    setIntLoading(true);
    setIntError("");
    try {
      const res = await fetch("/api/platform/integrations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { integrations?: Integration[] };
      const all = Array.isArray(data.integrations) ? data.integrations : [];
      setIntegrations(all.filter((i) => i.key === "document_storage" || i.key === "microsoft_sharepoint"));
    } catch {
      setIntError("Document storage status could not be loaded.");
    } finally {
      setIntLoading(false);
    }
  }, []);

  const applyTemplate = useCallback((tpl: TemplateRow) => {
    setSelectedId(tpl.id);
    setTplName(tpl.name);
    const f = tpl.structure?.folders ?? [];
    setFolders(f.map((folder) => ({ name: folder.name, itemsText: (folder.items ?? []).join("\n") })));
  }, []);

  const loadTemplates = useCallback(async () => {
    setTplLoading(true);
    setTplError("");
    try {
      const res = await fetch("/api/platform/datarooms/templates");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { templates?: TemplateRow[] };
      const list = Array.isArray(data.templates) ? data.templates : [];
      setTemplates(list);
      const pick = list.find((t) => t.isDefault) || list[0];
      if (pick) applyTemplate(pick);
      else {
        setSelectedId("");
        setTplName("Default data room");
        setFolders([{ name: "", itemsText: "" }]);
      }
    } catch {
      setTplError("Room templates could not be loaded.");
    } finally {
      setTplLoading(false);
    }
  }, [applyTemplate]);

  useEffect(() => {
    void loadIntegrations();
    void loadTemplates();
  }, [loadIntegrations, loadTemplates]);

  const saveTemplate = async () => {
    if (saving) return;
    setSaving(true);
    setSaveMsg("");
    try {
      const structure = {
        folders: folders
          .filter((f) => f.name.trim())
          .map((f) => ({
            name: f.name.trim(),
            items: f.itemsText.split("\n").map((s) => s.trim()).filter(Boolean),
          })),
      };
      const res = await fetch("/api/platform/datarooms/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: selectedId || undefined, name: tplName.trim() || "Default data room", structure, isDefault: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { template?: TemplateRow };
      if (data.template) {
        applyTemplate(data.template);
        setTemplates((prev) => {
          const others = prev.filter((t) => t.id !== data.template!.id);
          return [data.template!, ...others];
        });
      }
      setSaveMsg("Template saved.");
      await loadTemplates();
    } catch {
      setSaveMsg("Could not save the template. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8">
      {/* (a) Document storage status */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Document storage status</h3>
        <div className="mt-3">
          {intLoading ? (
            <SkeletonRows rows={2} />
          ) : intError ? (
            <ErrorState title="Could not load storage status" message={intError} onRetry={() => void loadIntegrations()} />
          ) : integrations.length === 0 ? (
            <p className="text-sm text-slate-400 dark:text-white/40">No document storage integrations are registered yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {integrations.map((it) => (
                <li key={it.key} className="flex items-start gap-3 py-3">
                  <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dotClass(it.status)}`} />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                      {it.name}
                      <span className="text-xs font-medium capitalize text-slate-400 dark:text-white/40">{it.status}</span>
                    </p>
                    {it.detail && <p className="mt-0.5 text-sm text-slate-500 dark:text-white/60">{it.detail}</p>}
                    {it.lastError && <p className="mt-0.5 text-xs text-red-600 dark:text-red-300">Last error: {it.lastError}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* (b) Room template editor */}
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-[#0d1f3c] dark:text-white">Room template editor</h3>
        <p className="mt-1 text-sm text-slate-500 dark:text-white/50">The default template seeds every new data room: its folders, and the checklist items inside each folder (one per line).</p>
        <div className="mt-3">
          {tplLoading ? (
            <SkeletonRows rows={4} />
          ) : tplError ? (
            <ErrorState title="Could not load templates" message={tplError} onRetry={() => void loadTemplates()} />
          ) : (
            <div>
              {templates.length > 1 && (
                <div className="mb-3">
                  <label className={labelCls} htmlFor="tpl-pick">Template</label>
                  <select
                    id="tpl-pick"
                    value={selectedId}
                    onChange={(e) => {
                      const t = templates.find((x) => x.id === e.target.value);
                      if (t) applyTemplate(t);
                    }}
                    className={inputCls}
                  >
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div>
                <label className={labelCls} htmlFor="tpl-name">Template name</label>
                <input id="tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} className={inputCls} />
              </div>

              <div className="mt-4 space-y-4">
                {folders.map((folder, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-200 px-4 py-3 dark:border-white/10">
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-0 flex-1">
                        <label className={labelCls} htmlFor={`tpl-folder-${idx}`}>Folder name</label>
                        <input
                          id={`tpl-folder-${idx}`}
                          value={folder.name}
                          onChange={(e) => setFolders((prev) => prev.map((f, i) => (i === idx ? { ...f, name: e.target.value } : f)))}
                          placeholder="e.g. Financials"
                          className={inputCls}
                        />
                      </div>
                      <Button variant="danger" size="sm" onClick={() => setFolders((prev) => prev.filter((_, i) => i !== idx))} className="min-h-[44px]">
                        Remove folder
                      </Button>
                    </div>
                    <div className="mt-3">
                      <label className={labelCls} htmlFor={`tpl-items-${idx}`}>Checklist items (one per line)</label>
                      <textarea
                        id={`tpl-items-${idx}`}
                        value={folder.itemsText}
                        onChange={(e) => setFolders((prev) => prev.map((f, i) => (i === idx ? { ...f, itemsText: e.target.value } : f)))}
                        rows={4}
                        className={inputCls}
                        placeholder={"Last 3 years tax returns\nYear-to-date financials"}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => setFolders((prev) => [...prev, { name: "", itemsText: "" }])} className="min-h-[44px]">
                  Add folder
                </Button>
                <Button onClick={() => void saveTemplate()} disabled={saving} className="min-h-[44px]">
                  {saving ? "Saving..." : "Save template"}
                </Button>
                {saveMsg && <span className="text-sm text-slate-500 dark:text-white/60">{saveMsg}</span>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
