"use client";

/**
 * Driver trees — KPI trees rendered as nested indented rows (no
 * drag-drop). Each node carries a kind chip, a financial line-key
 * chip, a target value and notes, with add-child / edit / delete.
 * Trees can start blank or from the margin template.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  TREE_NODE_KINDS,
  api,
  cardCls,
  fmtMoneyN,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  parseNum,
  selectCls,
  treeNodeKind,
  type TreeNode,
  type VcTabProps,
  type VcTree,
} from "@/components/valuecreation/types";

interface NodeForm {
  label: string;
  kind: string;
  lineKey: string;
  targetValue: string;
  notes: string;
  parentId: string;
}

const EMPTY: NodeForm = {
  label: "",
  kind: "driver",
  lineKey: "",
  targetValue: "",
  notes: "",
  parentId: "",
};

export default function TreesTab({ planId }: VcTabProps) {
  const [trees, setTrees] = useState<VcTree[]>([]);
  const [treeId, setTreeId] = useState("");
  const [nodes, setNodes] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [error, setError] = useState("");
  const [newTreeName, setNewTreeName] = useState("");
  const [creatingTree, setCreatingTree] = useState(false);

  const [form, setForm] = useState<NodeForm>(EMPTY);
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState("");

  const loadTrees = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const d = await api<Record<string, unknown>>(
        `${API}/plans/${encodeURIComponent(planId)}/trees`
      );
      const list = listFrom<VcTree>(d, "trees", "items");
      setTrees(list);
      setTreeId((cur) => cur || (list[0]?.id ?? ""));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void loadTrees();
  }, [loadTrees]);

  const loadNodes = useCallback(async () => {
    if (!treeId) {
      setNodes([]);
      return;
    }
    setLoadingNodes(true);
    try {
      const d = await api<{ tree?: VcTree; nodes?: TreeNode[] } & Record<string, unknown>>(
        `${API}/trees/${encodeURIComponent(treeId)}`
      );
      setNodes(listFrom<TreeNode>(d, "nodes", "items"));
    } catch {
      setNodes([]);
    } finally {
      setLoadingNodes(false);
    }
  }, [treeId]);

  useEffect(() => {
    void loadNodes();
  }, [loadNodes]);

  const createTree = async (template?: string) => {
    setCreatingTree(true);
    setError("");
    try {
      const name = template === "margin" ? "Margin driver tree" : newTreeName.trim();
      if (!name) return;
      const d = await api<{ tree: VcTree }>(
        `${API}/plans/${encodeURIComponent(planId)}/trees`,
        {
          method: "POST",
          body: JSON.stringify(
            template ? { name, template } : { name }
          ),
        }
      );
      setNewTreeName("");
      await loadTrees();
      if (d.tree?.id) setTreeId(d.tree.id);
    } catch {
      setError("Could not create that tree. Please try again.");
    } finally {
      setCreatingTree(false);
    }
  };

  const deleteTree = async () => {
    if (!treeId) return;
    setError("");
    try {
      await api(`${API}/trees/${encodeURIComponent(treeId)}`, { method: "DELETE" });
      setTreeId("");
      setNodes([]);
      await loadTrees();
    } catch {
      setError("Could not delete that tree. Please try again.");
    }
  };

  const saveNode = async () => {
    if (!form.label.trim() || !treeId || saving) return;
    setSaving(true);
    setError("");
    try {
      const body = {
        label: form.label.trim(),
        nodeKind: form.kind,
        lineKey: form.lineKey.trim() || null,
        targetValue: parseNum(form.targetValue),
        notes: form.notes,
        parentId: form.parentId || null,
      };
      if (editingId) {
        await api(`${API}/nodes/${encodeURIComponent(editingId)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api(`${API}/trees/${encodeURIComponent(treeId)}/nodes`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }
      setForm(EMPTY);
      setEditingId("");
      await loadNodes();
    } catch {
      setError("Could not save that node. A label is required.");
    } finally {
      setSaving(false);
    }
  };

  const removeNode = async (n: TreeNode) => {
    setBusyId(n.id);
    setError("");
    try {
      await api(`${API}/nodes/${encodeURIComponent(n.id)}`, { method: "DELETE" });
      if (editingId === n.id) {
        setEditingId("");
        setForm(EMPTY);
      }
      await loadNodes();
    } catch {
      setError("Could not delete that node. Please try again.");
    } finally {
      setBusyId("");
    }
  };

  /** Flatten the tree into indented rows (roots first, children after). */
  const rows = useMemo(() => {
    const childrenOf = new Map<string, TreeNode[]>();
    const roots: TreeNode[] = [];
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      if (n.parentId && ids.has(n.parentId)) {
        const arr = childrenOf.get(n.parentId) ?? [];
        arr.push(n);
        childrenOf.set(n.parentId, arr);
      } else {
        roots.push(n);
      }
    }
    const bySort = (a: TreeNode, b: TreeNode) =>
      (a.sort ?? 0) - (b.sort ?? 0) || a.label.localeCompare(b.label);
    const out: Array<{ node: TreeNode; depth: number }> = [];
    const walk = (n: TreeNode, depth: number) => {
      out.push({ node: n, depth });
      for (const c of (childrenOf.get(n.id) ?? []).sort(bySort)) walk(c, depth + 1);
    };
    for (const r of roots.sort(bySort)) walk(r, 0);
    return out;
  }, [nodes]);

  if (loading) return <SkeletonRows rows={5} />;
  if (loadFailed) return <ErrorState onRetry={() => void loadTrees()} />;

  const activeTree = trees.find((t) => t.id === treeId) ?? null;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Driver trees
        </h3>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className={labelCls}>Tree</label>
            <select
              className={`${selectCls} min-h-[44px]`}
              value={treeId}
              onChange={(e) => {
                setTreeId(e.target.value);
                setEditingId("");
                setForm(EMPTY);
              }}
            >
              {trees.length === 0 && <option value="">No trees yet</option>}
              {trees.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          {activeTree && (
            <button type="button" className="btn btn-danger btn-sm min-h-[44px]" onClick={() => void deleteTree()}>
              Delete tree
            </button>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className={labelCls}>New tree name</label>
            <input className={`${inputCls} min-h-[44px]`} value={newTreeName} onChange={(e) => setNewTreeName(e.target.value)} placeholder="e.g. Revenue growth tree" />
          </div>
          <Button size="sm" onClick={() => void createTree()} loading={creatingTree} disabled={!newTreeName.trim()}>
            New tree
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void createTree("margin")} loading={creatingTree}>
            Margin template
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate-500 dark:text-white/50">
          The margin template starts a tree aimed at expanding EBITDA margin (revenue → gross profit → EBITDA with its levers).
        </p>
      </div>

      {activeTree && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            {activeTree.name}
          </h3>
          {loadingNodes ? (
            <div className="mt-4"><SkeletonRows rows={4} /></div>
          ) : rows.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                title="No nodes yet"
                message="Add the outcome node first (e.g. EBITDA), then drivers and levers beneath it."
              />
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
              {rows.map(({ node, depth }) => (
                <li key={node.id} className="py-2.5" style={{ paddingLeft: `${Math.min(depth, 6) * 22}px` }}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span aria-hidden className="text-slate-300 dark:text-white/25">{depth > 0 ? "└" : "◆"}</span>
                    <span className="text-sm font-medium text-[#0d1f3c] dark:text-white">{node.label}</span>
                    <span className="badge badge-neutral">{labelOf(TREE_NODE_KINDS, treeNodeKind(node))}</span>
                    {node.lineKey && <span className="badge badge-fit">{node.lineKey}</span>}
                    <span className="tnum text-sm text-slate-600 dark:text-white/70">
                      {node.targetValue !== null && node.targetValue !== undefined
                        ? `target ${fmtMoneyN(node.targetValue)}`
                        : ""}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm min-h-[44px]"
                        onClick={() => {
                          setEditingId("");
                          setForm({ ...EMPTY, parentId: node.id, kind: "driver" });
                        }}
                      >
                        Add child
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm min-h-[44px]"
                        onClick={() => {
                          setEditingId(node.id);
                          setForm({
                            label: node.label,
                            kind: treeNodeKind(node),
                            lineKey: node.lineKey ?? "",
                            targetValue: node.targetValue === null || node.targetValue === undefined ? "" : String(node.targetValue),
                            notes: node.notes ?? "",
                            parentId: node.parentId ?? "",
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="btn btn-danger btn-sm min-h-[44px]" disabled={busyId === node.id} onClick={() => void removeNode(node)}>
                        Delete
                      </button>
                    </span>
                  </div>
                  {node.notes && (
                    <p className="mt-0.5 pl-6 text-xs text-slate-500 dark:text-white/50">{node.notes}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTree && (
        <div className={cardCls}>
          <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
            {editingId ? "Edit node" : "Add node"}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2">
              <label className={labelCls}>Label</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Gross margin" />
            </div>
            <div>
              <label className={labelCls}>Kind</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
                {TREE_NODE_KINDS.map((k) => (
                  <option key={k.key} value={k.key}>{k.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Parent</label>
              <select className={`${selectCls} min-h-[44px]`} value={form.parentId} onChange={(e) => setForm((f) => ({ ...f, parentId: e.target.value }))}>
                <option value="">(root)</option>
                {nodes.filter((n) => n.id !== editingId).map((n) => (
                  <option key={n.id} value={n.id}>{n.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Line key</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.lineKey} onChange={(e) => setForm((f) => ({ ...f, lineKey: e.target.value }))} placeholder="revenue · gross_profit · ebitda…" />
            </div>
            <div>
              <label className={labelCls}>Target value (USD)</label>
              <input type="number" className={`${inputCls} min-h-[44px]`} value={form.targetValue} onChange={(e) => setForm((f) => ({ ...f, targetValue: e.target.value }))} />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className={labelCls}>Notes</label>
              <input className={`${inputCls} min-h-[44px]`} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void saveNode()} loading={saving} disabled={!form.label.trim()}>
              {editingId ? "Save changes" : "Add node"}
            </Button>
            {(editingId || form.parentId) && (
              <Button variant="ghost" onClick={() => { setEditingId(""); setForm(EMPTY); }}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
