"use client";

/**
 * Org & Talent — the target organization as a nested list by
 * reportsTo (roots first, children indented), with key-person
 * badges, risk chips and vacancy styling; the hiring plan table
 * beneath it; and the plan-level management incentive notes editor
 * (PATCH on the plan).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, EmptyState, ErrorState, SkeletonRows } from "@/components/ui";
import {
  API,
  HIRING_STATUSES,
  PRIORITIES,
  RISK_LEVELS,
  api,
  cardCls,
  fmtDateShort,
  hiringRoleName,
  inputCls,
  labelCls,
  labelOf,
  listFrom,
  orgIsKeyPerson,
  orgIsVacant,
  orgNotes,
  orgReportsTo,
  riskBadge,

  selectCls,
  type HiringRole,
  type OrgNode,
  type VcTabProps,
} from "@/components/valuecreation/types";

/* ------------------------------ org form ------------------------------ */

interface NodeForm {
  name: string;
  title: string;
  reportsTo: string;
  keyPerson: boolean;
  riskLevel: string;
  vacant: boolean;
  notes: string;
  incentiveNotes: string;
}

const EMPTY_NODE: NodeForm = {
  name: "",
  title: "",
  reportsTo: "",
  keyPerson: false,
  riskLevel: "low",
  vacant: false,
  notes: "",
  incentiveNotes: "",
};

/* ------------------------------ hiring form ------------------------------ */

interface RoleForm {
  role: string;
  department: string;
  priority: string;
  targetDate: string;
  status: string;
  compRange: string;
  notes: string;
}

const EMPTY_ROLE: RoleForm = {
  role: "",
  department: "",
  priority: "medium",
  targetDate: "",
  status: "planned",
  compRange: "",
  notes: "",
};

export default function OrgTab({ planId, plan, reload }: VcTabProps) {
  const [nodes, setNodes] = useState<OrgNode[]>([]);
  const [roles, setRoles] = useState<HiringRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [nodeForm, setNodeForm] = useState<NodeForm>(EMPTY_NODE);
  const [editingNodeId, setEditingNodeId] = useState("");
  const [savingNode, setSavingNode] = useState(false);
  const [busyNodeId, setBusyNodeId] = useState("");

  const [roleForm, setRoleForm] = useState<RoleForm>(EMPTY_ROLE);
  const [editingRoleId, setEditingRoleId] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [busyRoleId, setBusyRoleId] = useState("");

  const [incentiveNotes, setIncentiveNotes] = useState(plan.incentiveNotes ?? "");
  const [savingIncentives, setSavingIncentives] = useState(false);

  useEffect(() => {
    setIncentiveNotes(plan.incentiveNotes ?? "");
  }, [plan.incentiveNotes]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [orgData, hiringData] = await Promise.all([
        api<Record<string, unknown>>(`${API}/plans/${encodeURIComponent(planId)}/org`),
        api<Record<string, unknown>>(`${API}/plans/${encodeURIComponent(planId)}/hiring`),
      ]);
      setNodes(listFrom<OrgNode>(orgData, "nodes", "org", "items"));
      setRoles(listFrom<HiringRole>(hiringData, "roles", "hiring", "items"));
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const childrenOf = new Map<string, OrgNode[]>();
    const roots: OrgNode[] = [];
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      const parent = orgReportsTo(n);
      if (parent && ids.has(parent)) {
        const arr = childrenOf.get(parent) ?? [];
        arr.push(n);
        childrenOf.set(parent, arr);
      } else {
        roots.push(n);
      }
    }
    const out: Array<{ node: OrgNode; depth: number }> = [];
    const walk = (n: OrgNode, depth: number) => {
      out.push({ node: n, depth });
      for (const c of childrenOf.get(n.id) ?? []) walk(c, depth + 1);
    };
    for (const r of roots) walk(r, 0);
    return out;
  }, [nodes]);

  const setN = (patch: Partial<NodeForm>) => setNodeForm((f) => ({ ...f, ...patch }));
  const setR = (patch: Partial<RoleForm>) => setRoleForm((f) => ({ ...f, ...patch }));

  const saveNode = async () => {
    if ((!nodeForm.name.trim() && !nodeForm.vacant) || !nodeForm.title.trim() || savingNode) return;
    setSavingNode(true);
    setError("");
    try {
      const body = {
        name: nodeForm.vacant ? "" : nodeForm.name.trim(),
        title: nodeForm.title.trim(),
        reportsToId: nodeForm.reportsTo || null,
        isKeyPerson: nodeForm.keyPerson,
        riskLevel: nodeForm.riskLevel,
        vacancy: nodeForm.vacant,
        riskNotes: nodeForm.notes,
        incentiveNotes: nodeForm.incentiveNotes,
      };
      if (editingNodeId) {
        await api(`${API}/org/${encodeURIComponent(editingNodeId)}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`${API}/plans/${encodeURIComponent(planId)}/org`, { method: "POST", body: JSON.stringify(body) });
      }
      setNodeForm(EMPTY_NODE);
      setEditingNodeId("");
      await load();
    } catch {
      setError("Could not save that org node. A title is required (name too, unless it is a vacancy).");
    } finally {
      setSavingNode(false);
    }
  };

  const removeNode = async (n: OrgNode) => {
    setBusyNodeId(n.id);
    setError("");
    try {
      await api(`${API}/org/${encodeURIComponent(n.id)}`, { method: "DELETE" });
      if (editingNodeId === n.id) {
        setEditingNodeId("");
        setNodeForm(EMPTY_NODE);
      }
      await load();
    } catch {
      setError("Could not delete that org node. Please try again.");
    } finally {
      setBusyNodeId("");
    }
  };

  const saveRole = async () => {
    if (!roleForm.role.trim() || savingRole) return;
    setSavingRole(true);
    setError("");
    try {
      const body = {
        role: roleForm.role.trim(),
        department: roleForm.department.trim(),
        priority: roleForm.priority,
        targetDate: roleForm.targetDate || null,
        status: roleForm.status,
        compRange: roleForm.compRange.trim(),
        notes: roleForm.notes,
      };
      if (editingRoleId) {
        await api(`${API}/hiring/${encodeURIComponent(editingRoleId)}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`${API}/plans/${encodeURIComponent(planId)}/hiring`, { method: "POST", body: JSON.stringify(body) });
      }
      setRoleForm(EMPTY_ROLE);
      setEditingRoleId("");
      await load();
    } catch {
      setError("Could not save that hiring role. A role title is required.");
    } finally {
      setSavingRole(false);
    }
  };

  const removeRole = async (r: HiringRole) => {
    setBusyRoleId(r.id);
    setError("");
    try {
      await api(`${API}/hiring/${encodeURIComponent(r.id)}`, { method: "DELETE" });
      if (editingRoleId === r.id) {
        setEditingRoleId("");
        setRoleForm(EMPTY_ROLE);
      }
      await load();
    } catch {
      setError("Could not delete that hiring role. Please try again.");
    } finally {
      setBusyRoleId("");
    }
  };

  const saveIncentives = async () => {
    setSavingIncentives(true);
    setError("");
    setNotice("");
    try {
      await api(`${API}/plans/${encodeURIComponent(planId)}`, {
        method: "PATCH",
        body: JSON.stringify({ incentiveNotes }),
      });
      setNotice("Management incentive notes saved.");
      await reload();
    } catch {
      setError("Could not save the incentive notes. Please try again.");
    } finally {
      setSavingIncentives(false);
    }
  };

  if (loading) return <SkeletonRows rows={6} />;
  if (loadFailed) return <ErrorState onRetry={() => void load()} />;

  return (
    <div className="space-y-5">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}
      {notice && (
        <p className="rounded-xl bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">{notice}</p>
      )}

      {/* Org chart */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Organization
        </h3>
        {nodes.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No org chart yet"
              message="Add the top of the house first (CEO / President), then the roles that report to it."
            />
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-slate-100 dark:divide-white/5">
            {rows.map(({ node, depth }) => {
              const vacant = orgIsVacant(node);
              return (
                <li key={node.id} className="py-2.5" style={{ paddingLeft: `${Math.min(depth, 6) * 22}px` }}>
                  <div className={`flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 ${vacant ? "border border-dashed border-amber-400/70 bg-amber-50/60 dark:bg-amber-500/5" : ""}`}>
                    <span aria-hidden className="text-slate-300 dark:text-white/25">{depth > 0 ? "└" : "◆"}</span>
                    <span className={`text-sm font-semibold ${vacant ? "italic text-amber-700 dark:text-amber-300" : "text-[#0d1f3c] dark:text-white"}`}>
                      {vacant ? "Vacant" : node.name}
                    </span>
                    <span className="text-sm text-slate-600 dark:text-white/70">{node.title}</span>
                    {orgIsKeyPerson(node) && <span className="badge badge-fit">Key person</span>}
                    <span className={`badge ${riskBadge(node.riskLevel)}`}>
                      {labelOf(RISK_LEVELS, node.riskLevel)}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm min-h-[44px]"
                        onClick={() => {
                          setEditingNodeId(node.id);
                          setNodeForm({
                            name: node.name ?? "",
                            title: node.title ?? "",
                            reportsTo: orgReportsTo(node) ?? "",
                            keyPerson: orgIsKeyPerson(node),
                            riskLevel: node.riskLevel || "low",
                            vacant,
                            notes: orgNotes(node),
                            incentiveNotes: node.incentiveNotes ?? "",
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button type="button" className="btn btn-danger btn-sm min-h-[44px]" disabled={busyNodeId === node.id} onClick={() => void removeNode(node)}>
                        Delete
                      </button>
                    </span>
                  </div>
                  {(orgNotes(node) || node.incentiveNotes) && (
                    <p className="mt-0.5 pl-6 text-xs text-slate-500 dark:text-white/50">
                      {orgNotes(node)}
                      {node.incentiveNotes ? `${orgNotes(node) ? " · " : ""}Incentives: ${node.incentiveNotes}` : ""}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          {editingNodeId ? "Edit org node" : "Add org node"}
        </h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelCls}>Name</label>
            <input className={`${inputCls} min-h-[44px]`} value={nodeForm.name} onChange={(e) => setN({ name: e.target.value })} disabled={nodeForm.vacant} placeholder={nodeForm.vacant ? "Vacancy" : "Person name"} />
          </div>
          <div>
            <label className={labelCls}>Title</label>
            <input className={`${inputCls} min-h-[44px]`} value={nodeForm.title} onChange={(e) => setN({ title: e.target.value })} placeholder="e.g. VP Operations" />
          </div>
          <div>
            <label className={labelCls}>Reports to</label>
            <select className={`${selectCls} min-h-[44px]`} value={nodeForm.reportsTo} onChange={(e) => setN({ reportsTo: e.target.value })}>
              <option value="">(top of house)</option>
              {nodes.filter((n) => n.id !== editingNodeId).map((n) => (
                <option key={n.id} value={n.id}>
                  {orgIsVacant(n) ? `Vacant — ${n.title}` : `${n.name} — ${n.title}`}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Risk level</label>
            <select className={`${selectCls} min-h-[44px]`} value={nodeForm.riskLevel} onChange={(e) => setN({ riskLevel: e.target.value })}>
              {RISK_LEVELS.map((r) => (
                <option key={r.key} value={r.key}>{r.label}</option>
              ))}
            </select>
          </div>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-[#0d1f3c] dark:text-white">
            <input type="checkbox" className="h-4 w-4 accent-[#b8975a]" checked={nodeForm.keyPerson} onChange={(e) => setN({ keyPerson: e.target.checked })} />
            Key person
          </label>
          <label className="flex min-h-[44px] items-center gap-2 text-sm text-[#0d1f3c] dark:text-white">
            <input type="checkbox" className="h-4 w-4 accent-[#b8975a]" checked={nodeForm.vacant} onChange={(e) => setN({ vacant: e.target.checked })} />
            Vacancy (role unfilled)
          </label>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelCls}>Notes</label>
            <input className={`${inputCls} min-h-[44px]`} value={nodeForm.notes} onChange={(e) => setN({ notes: e.target.value })} />
          </div>
          <div className="sm:col-span-2 lg:col-span-3">
            <label className={labelCls}>Incentive notes (this person)</label>
            <input className={`${inputCls} min-h-[44px]`} value={nodeForm.incentiveNotes} onChange={(e) => setN({ incentiveNotes: e.target.value })} placeholder="Equity, bonus plan, retention terms…" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void saveNode()} loading={savingNode} disabled={!nodeForm.title.trim() || (!nodeForm.vacant && !nodeForm.name.trim())}>
            {editingNodeId ? "Save changes" : "Add node"}
          </Button>
          {editingNodeId && (
            <Button variant="ghost" onClick={() => { setEditingNodeId(""); setNodeForm(EMPTY_NODE); }}>
              Cancel edit
            </Button>
          )}
        </div>
      </div>

      {/* Hiring plan */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Hiring plan
        </h3>
        {roles.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-white/50">No hiring roles planned yet. Add the first one below.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="tbl-grad w-full min-w-[720px] text-sm">
              <thead>
                <tr>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Role</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Department</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Priority</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Target date</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Status</th>
                  <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide">Comp range</th>
                  <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5">
                    <td className="px-3 py-2.5 font-medium text-[#0d1f3c] dark:text-white">{hiringRoleName(r)}</td>
                    <td className="px-3 py-2.5">{r.department || "—"}</td>
                    <td className="px-3 py-2.5">
                      <span className={`badge ${r.priority === "high" ? "badge-danger" : r.priority === "medium" ? "badge-warn" : "badge-neutral"}`}>
                        {labelOf(PRIORITIES, r.priority)}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{fmtDateShort(r.targetDate)}</td>
                    <td className="px-3 py-2.5">{labelOf(HIRING_STATUSES, r.status)}</td>
                    <td className="tnum px-3 py-2.5 text-right whitespace-nowrap">
                      {r.compRange ? r.compRange : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          onClick={() => {
                            setEditingRoleId(r.id);
                            setRoleForm({
                              role: hiringRoleName(r),
                              department: r.department ?? "",
                              priority: r.priority || "medium",
                              targetDate: r.targetDate ?? "",
                              status: r.status || "planned",
                              compRange: r.compRange ?? "",
                              notes: r.notes ?? "",
                            });
                          }}
                        >
                          Edit
                        </button>
                        <button type="button" className="btn btn-danger btn-sm" disabled={busyRoleId === r.id} onClick={() => void removeRole(r)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 dark:border-white/5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelCls}>{editingRoleId ? "Role (editing)" : "Role"}</label>
            <input className={`${inputCls} min-h-[44px]`} value={roleForm.role} onChange={(e) => setR({ role: e.target.value })} placeholder="e.g. Controller" />
          </div>
          <div>
            <label className={labelCls}>Department</label>
            <input className={`${inputCls} min-h-[44px]`} value={roleForm.department} onChange={(e) => setR({ department: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Priority</label>
            <select className={`${selectCls} min-h-[44px]`} value={roleForm.priority} onChange={(e) => setR({ priority: e.target.value })}>
              {PRIORITIES.map((p) => (
                <option key={p.key} value={p.key}>{p.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Target date</label>
            <input type="date" className={`${inputCls} min-h-[44px]`} value={roleForm.targetDate} onChange={(e) => setR({ targetDate: e.target.value })} />
          </div>
          <div>
            <label className={labelCls}>Status</label>
            <select className={`${selectCls} min-h-[44px]`} value={roleForm.status} onChange={(e) => setR({ status: e.target.value })}>
              {HIRING_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Comp range</label>
            <input className={`${inputCls} min-h-[44px]`} value={roleForm.compRange} onChange={(e) => setR({ compRange: e.target.value })} placeholder="e.g. $140K–$175K + bonus" />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button onClick={() => void saveRole()} loading={savingRole} disabled={!roleForm.role.trim()}>
            {editingRoleId ? "Save role" : "Add role"}
          </Button>
          {editingRoleId && (
            <Button variant="ghost" onClick={() => { setEditingRoleId(""); setRoleForm(EMPTY_ROLE); }}>
              Cancel edit
            </Button>
          )}
        </div>
      </div>

      {/* Plan-level incentive notes */}
      <div className={cardCls}>
        <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">
          Management incentive plan — notes
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-white/50">
          Plan-level notes on the management incentive structure (equity pool, vesting, bonus mechanics). Per-person terms live on each org node.
        </p>
        <textarea
          className={`${inputCls} mt-3 min-h-[96px]`}
          value={incentiveNotes}
          onChange={(e) => setIncentiveNotes(e.target.value)}
          placeholder="e.g. 10% option pool, 4-year vesting, annual EBITDA bonus pool at 110% of target…"
        />
        <div className="mt-3">
          <Button size="sm" onClick={() => void saveIncentives()} loading={savingIncentives}>
            Save incentive notes
          </Button>
        </div>
      </div>
    </div>
  );
}
