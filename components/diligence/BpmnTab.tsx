"use client";

/**
 * Process maps (BPMN) — the workspace's as-is process diagrams.
 * The list endpoint never carries XML; a diagram's XML is fetched
 * only when it is opened. Editing happens in the bpmn-js Modeler
 * with EXPLICIT SAVE ONLY (no autosave): the dirty state is shown,
 * and Save PUTs a new version. Prior versions can be viewed
 * read-only or restored (loaded into the modeler — saving then
 * creates a new version; history is never rewritten).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button, EmptyState, SkeletonRows } from "@/components/ui";
import {
  api,
  cardCls,
  fmtDateShort,
  type TabProps,
} from "@/components/diligence/types";
import type { BpmnEditorHandle } from "@/components/diligence/BpmnEditor";

const BpmnEditor = dynamic(() => import("@/components/diligence/BpmnEditor"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[520px] items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-white/50">
      Loading diagram editor…
    </div>
  ),
});

interface DiagramMeta {
  id: string;
  processKey: string;
  name: string;
  currentVersion: number;
  versionCount: number;
  updatedAt: string;
}

interface DiagramDetail {
  id: string;
  processKey: string;
  name: string;
  currentVersion: number;
  xml: string;
  saved: boolean;
}

interface VersionMeta {
  version: number;
  savedBy: string;
  createdAt: string;
  xmlBytes: number;
}

export default function BpmnTab({ workspaceId }: TabProps) {
  const [diagrams, setDiagrams] = useState<DiagramMeta[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");

  const [selected, setSelected] = useState<DiagramDetail | null>(null);
  const [openingId, setOpeningId] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [error, setError] = useState("");

  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [versionXml, setVersionXml] = useState<string | null>(null);

  const editorRef = useRef<BpmnEditorHandle | null>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError("");
    try {
      const d = await api<{ diagrams: DiagramMeta[] }>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/bpmn`
      );
      setDiagrams(Array.isArray(d.diagrams) ? d.diagrams : []);
    } catch {
      setListError("Could not load the process maps. Please try again.");
    } finally {
      setLoadingList(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  const openDiagram = async (id: string) => {
    setOpeningId(id);
    setError("");
    setSaveMsg("");
    try {
      const d = await api<{ diagram: DiagramDetail }>(
        `/api/platform/diligence/bpmn/${encodeURIComponent(id)}`
      );
      setSelected(d.diagram);
      setReadOnly(false);
      setDirty(false);
      setVersions(null);
      setViewingVersion(null);
      setVersionXml(null);
    } catch {
      setError("Could not open that diagram. Please try again.");
    } finally {
      setOpeningId("");
    }
  };

  const save = async () => {
    if (!selected || saving) return;
    setSaving(true);
    setError("");
    setSaveMsg("");
    try {
      const xml = await editorRef.current?.getXml();
      if (!xml) throw new Error("no xml");
      const res = await api<{ version: number; pruned: number }>(
        `/api/platform/diligence/bpmn/${encodeURIComponent(selected.id)}`,
        { method: "PUT", body: JSON.stringify({ xml }) }
      );
      setDirty(false);
      setSelected((cur) =>
        cur ? { ...cur, currentVersion: res.version, saved: true, xml } : cur
      );
      setSaveMsg(
        `Saved as version ${res.version}.${res.pruned > 0 ? ` ${res.pruned} old version(s) pruned.` : ""}`
      );
      setVersions(null);
      await loadList();
    } catch {
      setError("Could not save the diagram. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const loadVersions = async () => {
    if (!selected) return;
    setLoadingVersions(true);
    setError("");
    try {
      const d = await api<{ versions: VersionMeta[] }>(
        `/api/platform/diligence/bpmn/${encodeURIComponent(selected.id)}/versions`
      );
      setVersions(Array.isArray(d.versions) ? d.versions : []);
    } catch {
      setError("Could not load the version history. Please try again.");
    } finally {
      setLoadingVersions(false);
    }
  };

  const fetchVersionXml = async (version: number): Promise<string | null> => {
    if (!selected) return null;
    const d = await api<{ version: { version: number; xml: string } }>(
      `/api/platform/diligence/bpmn/${encodeURIComponent(selected.id)}/versions/${version}`
    );
    return d.version.xml;
  };

  const viewVersion = async (version: number) => {
    setError("");
    try {
      const xml = await fetchVersionXml(version);
      if (xml === null) return;
      setVersionXml(xml);
      setViewingVersion(version);
    } catch {
      setError("Could not load that version. Please try again.");
    }
  };

  const restoreVersion = async (version: number) => {
    if (!selected) return;
    setError("");
    try {
      const xml = await fetchVersionXml(version);
      if (xml === null) return;
      // Load into the modeler as the working copy; saving creates a
      // NEW version — the restored-from version stays untouched.
      setSelected((cur) => (cur ? { ...cur, xml } : cur));
      setViewingVersion(null);
      setVersionXml(null);
      setReadOnly(false);
      setDirty(true);
      setSaveMsg(
        `Version ${version} loaded into the editor. Save to restore it as a new version.`
      );
    } catch {
      setError("Could not load that version. Please try again.");
    }
  };

  const backToCurrent = () => {
    setViewingVersion(null);
    setVersionXml(null);
    if (selected) void openDiagram(selected.id);
  };

  const showingVersion = viewingVersion !== null && versionXml !== null;

  return (
    <div className="space-y-5">
      {error && (
        <p className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Process maps
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          The target’s as-is processes, documented during diligence. Changes
          are saved only when you press Save — there is no autosave.
        </p>
        {loadingList ? (
          <div className="mt-4">
            <SkeletonRows rows={3} />
          </div>
        ) : listError ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-300">{listError}</p>
        ) : diagrams.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No process maps"
              message="The standard process maps are seeded when the workspace is created."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
            {diagrams.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-[200px] flex-1">
                  <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    {d.name}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-white/50">
                    {d.processKey} · current version {d.currentVersion} ·{" "}
                    {d.versionCount} version(s) · updated {fmtDateShort(d.updatedAt)}
                  </p>
                </div>
                <button
                  type="button"
                  className={`btn btn-sm ${selected?.id === d.id ? "btn-primary" : "btn-secondary"}`}
                  disabled={openingId === d.id}
                  onClick={() => void openDiagram(d.id)}
                >
                  {openingId === d.id ? "Opening…" : selected?.id === d.id ? "Open" : "Open"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {selected && (
        <div className={cardCls}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
                {selected.name}
                {showingVersion ? ` — version ${viewingVersion} (read-only)` : ""}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-white/50">
                {showingVersion
                  ? "You are viewing a saved version. It cannot be edited here."
                  : selected.saved
                    ? `Current version ${selected.currentVersion}.`
                    : "Starter diagram — not saved yet. Edit and Save to create version 1."}
                {!showingVersion && dirty && !readOnly && (
                  <span className="ml-2 font-semibold text-amber-600 dark:text-amber-400">
                    ● Unsaved changes
                  </span>
                )}
                {!showingVersion && !dirty && !readOnly && (
                  <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                    All changes saved
                  </span>
                )}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {showingVersion ? (
                <Button size="sm" variant="secondary" onClick={backToCurrent}>
                  Back to current version
                </Button>
              ) : (
                <>
                  <button
                    type="button"
                    className={`btn btn-sm ${readOnly ? "btn-primary" : "btn-secondary"}`}
                    onClick={() => setReadOnly((r) => !r)}
                  >
                    {readOnly ? "Switch to edit mode" : "Read-only viewer"}
                  </button>
                  {!readOnly && (
                    <Button size="sm" onClick={() => void save()} loading={saving} disabled={!dirty && selected.saved}>
                      Save new version
                    </Button>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => (versions ? setVersions(null) : void loadVersions())}
                  >
                    {versions ? "Hide versions" : "Version history"}
                  </button>
                </>
              )}
            </div>
          </div>

          {saveMsg && (
            <p className="mt-3 rounded-xl bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-700 dark:text-emerald-300">
              {saveMsg}
            </p>
          )}

          <div className="mt-4">
            {showingVersion ? (
              <BpmnEditor
                key={`v-${selected.id}-${viewingVersion}`}
                xml={versionXml}
                readOnly
                onDirty={() => undefined}
                onError={setError}
              />
            ) : (
              <BpmnEditor
                key={`${selected.id}-${readOnly ? "ro" : "edit"}`}
                ref={editorRef}
                xml={selected.xml}
                readOnly={readOnly}
                onDirty={() => setDirty(true)}
                onError={setError}
              />
            )}
          </div>

          {versions !== null && (
            <div className="mt-4 border-t border-slate-100 pt-4 dark:border-white/5">
              <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                Version history
              </p>
              {loadingVersions ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-white/50">Loading…</p>
              ) : versions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500 dark:text-white/50">
                  No saved versions yet — the first Save creates version 1.
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-slate-100 dark:divide-white/5">
                  {versions.map((v) => (
                    <li key={v.version} className="flex flex-wrap items-center gap-3 py-2.5">
                      <p className="min-w-[220px] flex-1 text-sm text-[#0d1f3c] dark:text-white/90">
                        Version {v.version}
                        <span className="ml-2 text-xs text-slate-500 dark:text-white/50">
                          saved by {v.savedBy || "—"} · {fmtDateShort(v.createdAt)} ·{" "}
                          {(v.xmlBytes / 1024).toFixed(1)} KB
                        </span>
                      </p>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => void viewVersion(v.version)}
                      >
                        View
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void restoreVersion(v.version)}
                      >
                        Restore as new version
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
