"use client";

/**
 * Process maps (BPMN) — this plan's TO-BE process diagrams, each
 * optionally linked to a diligence AS-IS map (candidates come from
 * the plan's asis-candidates route). Adapted from the diligence
 * BpmnTab: the list never carries XML; a diagram's XML is fetched
 * only when opened. Editing happens in the bpmn-js Modeler with
 * EXPLICIT SAVE ONLY (POST /bpmn/[id]/save creates a new version).
 * Prior versions can be viewed read-only or restored by loading
 * them into the modeler and saving.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button, EmptyState, SkeletonRows } from "@/components/ui";
import {
  API,
  api,
  asIsCandidateId,
  cardCls,
  diagramAsIsLabel,
  fmtDateShort,
  inputCls,
  labelCls,
  listFrom,
  selectCls,
  type AsIsCandidate,
  type VcDiagramDetail,
  type VcDiagramMeta,
  type VcTabProps,
  type VcVersionMeta,
} from "@/components/valuecreation/types";
import type { VcBpmnEditorHandle } from "@/components/valuecreation/VcBpmnEditor";

const VcBpmnEditor = dynamic(
  () => import("@/components/valuecreation/VcBpmnEditor"),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[520px] items-center justify-center rounded-xl border border-slate-200 bg-white text-sm text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-white/50">
        Loading diagram editor…
      </div>
    ),
  }
);

export default function ProcessMapsTab({ planId }: VcTabProps) {
  const [diagrams, setDiagrams] = useState<VcDiagramMeta[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");

  const [candidates, setCandidates] = useState<AsIsCandidate[]>([]);
  const [createForm, setCreateForm] = useState({ name: "", asIsDiagramId: "" });
  const [creating, setCreating] = useState(false);

  const [selected, setSelected] = useState<VcDiagramDetail | null>(null);
  const [openingId, setOpeningId] = useState("");
  const [readOnly, setReadOnly] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  const [versions, setVersions] = useState<VcVersionMeta[] | null>(null);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<number | null>(null);
  const [versionXml, setVersionXml] = useState<string | null>(null);

  const editorRef = useRef<VcBpmnEditorHandle | null>(null);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    setListError("");
    try {
      const d = await api<Record<string, unknown>>(
        `${API}/plans/${encodeURIComponent(planId)}/bpmn`
      );
      setDiagrams(listFrom<VcDiagramMeta>(d, "maps", "diagrams", "items"));
    } catch {
      setListError("Could not load the process maps. Please try again.");
    } finally {
      setLoadingList(false);
    }
  }, [planId]);

  const loadCandidates = useCallback(async () => {
    try {
      const d = await api<Record<string, unknown>>(
        `${API}/plans/${encodeURIComponent(planId)}/asis-candidates`
      );
      setCandidates(listFrom<AsIsCandidate>(d, "candidates", "items"));
    } catch {
      setCandidates([]);
    }
  }, [planId]);

  useEffect(() => {
    void loadList();
    void loadCandidates();
  }, [loadList, loadCandidates]);

  const create = async () => {
    if (!createForm.name.trim() || creating) return;
    setCreating(true);
    setError("");
    try {
      const picked = candidates.find(
        (c) => asIsCandidateId(c) === createForm.asIsDiagramId
      );
      const d = await api<{ map?: VcDiagramMeta; diagram?: VcDiagramMeta }>(
        `${API}/plans/${encodeURIComponent(planId)}/bpmn`,
        {
          method: "POST",
          body: JSON.stringify({
            name: createForm.name.trim(),
            asIsDiagramId: createForm.asIsDiagramId || undefined,
            asIsLabel: picked?.name || undefined,
          }),
        }
      );
      const created = d.map ?? d.diagram;
      setCreateForm({ name: "", asIsDiagramId: "" });
      await loadList();
      if (created?.id) void openDiagram(created.id);
    } catch {
      setError("Could not create that process map. A name is required.");
    } finally {
      setCreating(false);
    }
  };

  const removeDiagram = async (dgm: VcDiagramMeta) => {
    setBusyId(dgm.id);
    setError("");
    try {
      await api(`${API}/bpmn/${encodeURIComponent(dgm.id)}`, { method: "DELETE" });
      if (selected?.id === dgm.id) setSelected(null);
      await loadList();
    } catch {
      setError("Could not delete that process map. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  const openDiagram = async (id: string) => {
    setOpeningId(id);
    setError("");
    setSaveMsg("");
    try {
      const d = await api<{ map?: VcDiagramDetail; diagram?: VcDiagramDetail }>(
        `${API}/bpmn/${encodeURIComponent(id)}`
      );
      const diagram = d.map ?? d.diagram;
      if (!diagram) throw new Error("no map");
      setSelected(diagram);
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
      const res = await api<{ version: number; pruned?: number }>(
        `${API}/bpmn/${encodeURIComponent(selected.id)}/save`,
        { method: "POST", body: JSON.stringify({ xml }) }
      );
      setDirty(false);
      setSelected((cur) =>
        cur ? { ...cur, currentVersion: res.version, saved: true, xml } : cur
      );
      setSaveMsg(
        `Saved as version ${res.version}.${res.pruned ? ` ${res.pruned} old version(s) pruned.` : ""}`
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
      const d = await api<Record<string, unknown>>(
        `${API}/bpmn/${encodeURIComponent(selected.id)}/versions`
      );
      setVersions(listFrom<VcVersionMeta>(d, "versions", "items"));
    } catch {
      setError("Could not load the version history. Please try again.");
    } finally {
      setLoadingVersions(false);
    }
  };

  const fetchVersionXml = async (version: number): Promise<string | null> => {
    if (!selected) return null;
    // The route returns { version: number, xml } at the top level.
    const d = await api<{ xml?: string; version?: { xml?: string } | number }>(
      `${API}/bpmn/${encodeURIComponent(selected.id)}/versions/${version}`
    );
    if (typeof d.xml === "string") return d.xml;
    if (d.version && typeof d.version === "object") return d.version.xml ?? null;
    return null;
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
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          To-be process maps
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          The target operating processes for this company, designed against the
          diligence as-is maps where one exists. Changes are saved only when
          you press Save — there is no autosave.
        </p>
        {loadingList ? (
          <div className="mt-4"><SkeletonRows rows={3} /></div>
        ) : listError ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-300">{listError}</p>
        ) : diagrams.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No to-be maps yet"
              message="Create the first to-be map below — link it to an as-is diligence map when one exists so the redesign traces to the current state."
            />
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 dark:divide-white/5">
            {diagrams.map((d) => {
              const asIs = diagramAsIsLabel(d);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-[200px] flex-1">
                    <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">{d.name}</p>
                    <p className="text-xs text-slate-500 dark:text-white/50">
                      {asIs ? `To-be of as-is: ${asIs} · ` : "No as-is link · "}
                      current version {d.currentVersion} · {d.versionCount} version(s) · updated {fmtDateShort(d.updatedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={`btn btn-sm min-h-[44px] ${selected?.id === d.id ? "btn-primary" : "btn-secondary"}`}
                    disabled={openingId === d.id}
                    onClick={() => void openDiagram(d.id)}
                  >
                    {openingId === d.id ? "Opening…" : "Open"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm min-h-[44px]"
                    disabled={busyId === d.id}
                    onClick={() => void removeDiagram(d)}
                  >
                    Delete
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 dark:border-white/5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div>
            <label className={labelCls}>New to-be map name</label>
            <input
              className={`${inputCls} min-h-[44px]`}
              value={createForm.name}
              onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Order-to-cash (to-be)"
            />
          </div>
          <div>
            <label className={labelCls}>Linked as-is map</label>
            <select
              className={`${selectCls} min-h-[44px]`}
              value={createForm.asIsDiagramId}
              onChange={(e) => setCreateForm((f) => ({ ...f, asIsDiagramId: e.target.value }))}
            >
              <option value="">No as-is link</option>
              {candidates.map((c) => (
                <option key={asIsCandidateId(c)} value={asIsCandidateId(c)}>
                  {c.name}
                  {c.dealName ? ` — ${c.dealName}` : c.companyName ? ` — ${c.companyName}` : ""}
                </option>
              ))}
            </select>
            {candidates.length === 0 && (
              <p className="mt-1 text-xs text-slate-500 dark:text-white/50">
                No as-is candidates — diligence process maps for this company will appear here.
              </p>
            )}
          </div>
          <Button onClick={() => void create()} loading={creating} disabled={!createForm.name.trim()}>
            Create map
          </Button>
        </div>
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
                  <span className="ml-2 font-semibold text-amber-600 dark:text-amber-400">● Unsaved changes</span>
                )}
                {!showingVersion && !dirty && !readOnly && (
                  <span className="ml-2 text-emerald-600 dark:text-emerald-400">All changes saved</span>
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
                    className={`btn btn-sm min-h-[44px] ${readOnly ? "btn-primary" : "btn-secondary"}`}
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
                    className="btn btn-ghost btn-sm min-h-[44px]"
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
              <VcBpmnEditor
                key={`v-${selected.id}-${viewingVersion}`}
                xml={versionXml}
                readOnly
                onDirty={() => undefined}
                onError={setError}
              />
            ) : (
              <VcBpmnEditor
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
              <p className="text-sm font-semibold text-[#0d1f3c] dark:text-white">Version history</p>
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
                          saved by {v.savedBy || "—"} · {fmtDateShort(v.createdAt)} · {(v.xmlBytes / 1024).toFixed(1)} KB
                        </span>
                      </p>
                      <button type="button" className="btn btn-secondary btn-sm min-h-[44px]" onClick={() => void viewVersion(v.version)}>
                        View
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm min-h-[44px]" onClick={() => void restoreVersion(v.version)}>
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
