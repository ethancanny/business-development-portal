"use client";

/**
 * Initiatives (VCP redesign, §5) — four views over the same plan
 * initiatives, switched by the workspace's Initiatives sub-chips:
 *   Table (default): compact table, grouped by lever or 100-day
 *     phase, filter by lever/owner/status/risk, inline edit of
 *     status, owner and dates; row click opens the detail drawer.
 *   Board: Kanban by status.  Timeline: Gantt with dependencies
 *     (a scrollable list on mobile).  Matrix: the existing impact /
 *     effort chart, bubbles sized by one-time cost.
 * The old always-open add form is replaced by a "+ New initiative"
 * button opening the create drawer; playbook instantiation lives in
 * the Playbooks group; diligence conversion in the Import panel.
 * A plan with no initiatives shows the three §6 start cards.
 */

import { useEffect, useMemo, useState } from "react";
import { Button, EmptyState } from "@/components/ui";
import PersonAvatar from "@/components/PersonAvatar";
import ImportPanel from "@/components/valuecreation/ImportPanel";
import InitiativeDrawer from "@/components/valuecreation/InitiativeDrawer";
import MatrixTab from "@/components/valuecreation/MatrixTab";
import {
  API,
  INITIATIVE_STATUSES,
  PLAYBOOK_CATEGORIES,
  api,
  cardCls,
  dayOffset,
  fmtDateShort,
  fmtMoneyN,
  fmtPayback,
  initiativeStatusBadge,
  inputCls,
  labelOf,
  paybackYears,
  selectCls,
  type Initiative,
  type VcTabProps,
} from "@/components/valuecreation/types";

const AD_INDUSTRY = "Aerospace & Defense";

function isOverdue(i: Initiative): boolean {
  if (!i.endDate || i.status === "done" || i.status === "deferred") return false;
  return i.endDate.slice(0, 10) < new Date().toISOString().slice(0, 10);
}

function needsAttention(i: Initiative): boolean {
  return i.status === "at_risk" || isOverdue(i);
}

function MiniTimeline({ i, min, max }: { i: Initiative; min: string; max: string }) {
  const total = Math.max(1, dayOffset(min, max));
  const startOff = i.startDate ? Math.max(0, dayOffset(min, i.startDate)) : 0;
  const endOff = i.endDate ? Math.min(total, dayOffset(min, i.endDate)) : total;
  const left = (startOff / total) * 100;
  const width = Math.max(3, ((endOff - startOff) / total) * 100);
  const pct = i.progressPct ?? 0;
  return (
    <div className="min-w-[110px]" title={`${fmtDateShort(i.startDate)} → ${fmtDateShort(i.endDate)} · ${pct}% complete`}>
      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
        <div
          className="absolute inset-y-0 rounded-full bg-[#54708f]/40"
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        <div
          className={`absolute inset-y-0 rounded-full ${i.status === "at_risk" ? "bg-red-500" : i.status === "done" ? "bg-emerald-500" : "bg-[#b8975a]"}`}
          style={{ left: `${left}%`, width: `${(width * pct) / 100}%` }}
        />
      </div>
      <p className="tnum mt-1 whitespace-nowrap text-[11px] text-slate-500 dark:text-white/50">
        {fmtDateShort(i.startDate)} → {fmtDateShort(i.endDate)}
      </p>
    </div>
  );
}

export default function InitiativesTab(props: VcTabProps) {
  const { planId, plan, initiatives, reload, companyVertical, onNavigate, focusInitiativeId, onFocusHandled } = props;
  const view = props.view ?? "table";
  const [drawer, setDrawer] = useState<{ id: string | null } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [fLever, setFLever] = useState("");
  const [fOwner, setFOwner] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fAttention, setFAttention] = useState(false);
  const [groupBy, setGroupBy] = useState<"lever" | "phase" | "none">("lever");

  useEffect(() => {
    if (focusInitiativeId) {
      setDrawer({ id: focusInitiativeId });
      onFocusHandled?.();
    }
  }, [focusInitiativeId, onFocusHandled]);

  const owners = useMemo(
    () => Array.from(new Set(initiatives.map((i) => i.ownerName).filter(Boolean))).sort(),
    [initiatives]
  );
  const levers = useMemo(
    () => Array.from(new Set(initiatives.map((i) => i.category ?? "general"))).sort(),
    [initiatives]
  );

  const filtered = useMemo(
    () =>
      initiatives.filter((i) => {
        if (q && !`${i.title} ${i.description ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
        if (fLever && (i.category ?? "general") !== fLever) return false;
        if (fOwner && i.ownerName !== fOwner) return false;
        if (fStatus && i.status !== fStatus) return false;
        if (fAttention && !needsAttention(i)) return false;
        return true;
      }),
    [initiatives, q, fLever, fOwner, fStatus, fAttention]
  );

  const horizon = useMemo(() => {
    const starts = initiatives.map((i) => i.startDate).filter(Boolean) as string[];
    const ends = initiatives.map((i) => i.endDate ?? i.startDate).filter(Boolean) as string[];
    const min = plan.planStartDate ?? starts.sort()[0] ?? new Date().toISOString();
    let max = ends.sort().slice(-1)[0] ?? min;
    if (dayOffset(min, max) < 100 && plan.planStartDate) {
      const plus = new Date(`${plan.planStartDate.slice(0, 10)}T12:00:00`);
      plus.setDate(plus.getDate() + 100);
      max = plus.toISOString();
    }
    return { min, max };
  }, [initiatives, plan.planStartDate]);

  const patch = async (i: Initiative, body: Record<string, unknown>) => {
    setError("");
    try {
      await api(`${API}/initiatives/${encodeURIComponent(i.id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      await reload();
    } catch {
      setError("That change could not be saved. Please try again.");
    }
  };

  const drawerInitiative = drawer?.id ? initiatives.find((i) => i.id === drawer.id) ?? null : null;

  /* ------------------------------ empty state ----------------------------- */
  if (initiatives.length === 0) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <button type="button" onClick={() => onNavigate?.("playbooks-models", "playbooks")} className={`${cardCls} text-left transition hover:border-[#b8975a]/60`}>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Start from a playbook</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
              {companyVertical === AD_INDUSTRY
                ? "This company is Aerospace & Defense — the library includes the A&D set: quoting & pricing, machine utilization & OEE, scrap & rework, quality systems, supplier consolidation, workforce & apprenticeship, working capital."
                : "Open the playbook library and instantiate a proven bundle of steps as initiatives."}
            </p>
            <span className="mt-3 inline-block text-sm font-medium text-[#8a6f3c] dark:text-[#b8975a]">Browse playbooks →</span>
          </button>
          <button type="button" onClick={() => setImportOpen(true)} className={`${cardCls} text-left transition hover:border-[#b8975a]/60`}>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Import from diligence</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
              Convert open diligence findings and low scorecard areas into initiatives, linked back to their source.
            </p>
            <span className="mt-3 inline-block text-sm font-medium text-[#8a6f3c] dark:text-[#b8975a]">Review candidates →</span>
          </button>
          <button type="button" onClick={() => setDrawer({ id: null })} className={`${cardCls} text-left transition hover:border-[#b8975a]/60`}>
            <h3 className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">Add manually</h3>
            <p className="mt-1 text-sm text-slate-500 dark:text-white/50">
              Start with just a title, lever, owner and expected EBITDA impact — details can come later.
            </p>
            <span className="mt-3 inline-block text-sm font-medium text-[#8a6f3c] dark:text-[#b8975a]">New initiative →</span>
          </button>
        </div>
        {drawer && (
          <InitiativeDrawer
            planId={planId} plan={plan} initiatives={initiatives} initiative={null}
            onClose={() => setDrawer(null)} onSaved={reload}
          />
        )}
        {importOpen && (
          <ImportPanel planId={planId} onClose={() => setImportOpen(false)} onConverted={reload} />
        )}
      </div>
    );
  }

  /* --------------------------------- views -------------------------------- */
  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">{error}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setDrawer({ id: null })}>+ New initiative</Button>
        <Button variant="secondary" onClick={() => onNavigate?.("playbooks-models", "playbooks")}>From playbook</Button>
        <Button variant="secondary" onClick={() => setImportOpen(true)}>From diligence finding</Button>
        <span className="tnum ml-auto text-sm text-slate-500 dark:text-white/50">
          {filtered.length} of {initiatives.length} initiatives
        </span>
      </div>

      {view !== "matrix" && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputCls} min-h-[40px] w-52`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search initiatives…"
            aria-label="Search initiatives"
          />
          <select className={`${selectCls} min-h-[40px] w-auto`} value={fLever} onChange={(e) => setFLever(e.target.value)} aria-label="Filter by lever">
            <option value="">All levers</option>
            {levers.map((l) => (
              <option key={l} value={l}>{labelOf(PLAYBOOK_CATEGORIES, l)}</option>
            ))}
          </select>
          <select className={`${selectCls} min-h-[40px] w-auto`} value={fOwner} onChange={(e) => setFOwner(e.target.value)} aria-label="Filter by owner">
            <option value="">All owners</option>
            {owners.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <select className={`${selectCls} min-h-[40px] w-auto`} value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All statuses</option>
            {INITIATIVE_STATUSES.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <label className="flex min-h-[40px] cursor-pointer items-center gap-2 text-sm text-[#0d1f3c] dark:text-white">
            <input type="checkbox" className="h-4 w-4 accent-[#b8975a]" checked={fAttention} onChange={(e) => setFAttention(e.target.checked)} />
            Needs attention
          </label>
          {view === "table" && (
            <select className={`${selectCls} min-h-[40px] w-auto`} value={groupBy} onChange={(e) => setGroupBy(e.target.value as typeof groupBy)} aria-label="Group by">
              <option value="lever">Group by lever</option>
              <option value="phase">Group by phase</option>
              <option value="none">No grouping</option>
            </select>
          )}
        </div>
      )}

      {filtered.length === 0 && view !== "matrix" ? (
        <EmptyState title="No initiatives match" message="Loosen the filters — nothing in this plan matches the current selection." />
      ) : view === "table" ? (
        <TableView
          rows={filtered} groupBy={groupBy} plan={plan} horizon={horizon}
          patch={patch} open={(i) => setDrawer({ id: i.id })}
        />
      ) : view === "board" ? (
        <BoardView rows={filtered} patch={patch} open={(i) => setDrawer({ id: i.id })} />
      ) : view === "timeline" ? (
        <GanttView rows={filtered} all={initiatives} open={(i) => setDrawer({ id: i.id })} />
      ) : (
        <MatrixTab {...props} />
      )}

      {drawer && (
        <InitiativeDrawer
          planId={planId} plan={plan} initiatives={initiatives}
          initiative={drawer.id === null ? null : drawerInitiative}
          onClose={() => setDrawer(null)} onSaved={reload}
        />
      )}
      {importOpen && (
        <ImportPanel planId={planId} onClose={() => setImportOpen(false)} onConverted={reload} />
      )}
    </div>
  );
}

/* -------------------------------- table view ------------------------------ */

function groupRows(
  rows: Initiative[],
  groupBy: "lever" | "phase" | "none",
  plan: VcTabProps["plan"]
): Array<{ key: string; label: string; rows: Initiative[] }> {
  if (groupBy === "none") return [{ key: "all", label: "", rows }];
  const map = new Map<string, Initiative[]>();
  const labelFor = (i: Initiative): string => {
    if (groupBy === "lever") return labelOf(PLAYBOOK_CATEGORIES, i.category ?? "general");
    if (!plan.planStartDate || !i.startDate) return "Unscheduled";
    const off = dayOffset(plan.planStartDate, i.startDate);
    const phase = (plan.phases ?? []).find((p) => off >= p.fromDay && off <= p.toDay);
    return phase ? `${phase.name} (days ${phase.fromDay}–${phase.toDay})` : off < 0 ? "Before plan start" : "Beyond day 100";
  };
  for (const i of rows) {
    const label = labelFor(i);
    const arr = map.get(label) ?? [];
    arr.push(i);
    map.set(label, arr);
  }
  return Array.from(map.entries()).map(([label, rs]) => ({ key: label, label, rows: rs }));
}

function TableView({
  rows, groupBy, plan, horizon, patch, open,
}: {
  rows: Initiative[];
  groupBy: "lever" | "phase" | "none";
  plan: VcTabProps["plan"];
  horizon: { min: string; max: string };
  patch: (i: Initiative, body: Record<string, unknown>) => Promise<void>;
  open: (i: Initiative) => void;
}) {
  const groups = groupRows(rows, groupBy, plan);
  return (
    <div className="space-y-5">
      {groups.map((g) => (
        <div key={g.key}>
          {g.label && (
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/45">
              {g.label} · {g.rows.length}
            </h4>
          )}
          <div className="hidden overflow-x-auto md:block">
            <table className="tbl-grad w-full min-w-[980px] text-sm">
              <thead>
                <tr>
                  {["Initiative", "Lever", "Owner", "Status", "Timeline", "EBITDA impact", "Conf.", "One-time cost", "Payback", "Progress"].map((h, idx) => (
                    <th key={h} className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide ${idx >= 5 && idx <= 8 ? "text-right" : "text-left"}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.slice(0, 200).map((i) => (
                  <Row key={i.id} i={i} horizon={horizon} patch={patch} open={open} />
                ))}
              </tbody>
            </table>
          </div>
          {/* Cards on mobile */}
          <ul className="space-y-3 md:hidden">
            {g.rows.map((i) => (
              <li key={i.id} className="rounded-xl border border-slate-100 p-3.5 dark:border-white/5">
                <button type="button" className="w-full text-left" onClick={() => open(i)}>
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">{i.title}</span>
                    <span className={`badge ${initiativeStatusBadge(i.status)}`}>{labelOf(INITIATIVE_STATUSES, i.status)}</span>
                  </span>
                  <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500 dark:text-white/50">
                    {i.ownerName && <PersonAvatar name={i.ownerName} size={18} />} {i.ownerName || "No owner"} · {labelOf(PLAYBOOK_CATEGORIES, i.category ?? "general")}
                  </span>
                  <span className="tnum mt-1 block text-sm text-[#0d1f3c] dark:text-white/90">
                    Impact {fmtMoneyN(i.ebitdaImpact)} · cost {fmtMoneyN(i.oneTimeCost)} · payback {fmtPayback(paybackYears(i.oneTimeCost ?? 0, (i.ebitdaImpact ?? 0) * (i.confidence ?? 1)))}
                  </span>
                </button>
                <div className="mt-2">
                  <MiniTimeline i={i} min={horizon.min} max={horizon.max} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Row({
  i, horizon, patch, open,
}: {
  i: Initiative;
  horizon: { min: string; max: string };
  patch: (i: Initiative, body: Record<string, unknown>) => Promise<void>;
  open: (i: Initiative) => void;
}) {
  const [owner, setOwner] = useState(i.ownerName ?? "");
  const [start, setStart] = useState(i.startDate ? i.startDate.slice(0, 10) : "");
  const [end, setEnd] = useState(i.endDate ? i.endDate.slice(0, 10) : "");
  useEffect(() => { setOwner(i.ownerName ?? ""); }, [i.ownerName]);
  useEffect(() => { setStart(i.startDate ? i.startDate.slice(0, 10) : ""); setEnd(i.endDate ? i.endDate.slice(0, 10) : ""); }, [i.startDate, i.endDate]);

  const weighted = (i.ebitdaImpact ?? 0) * (i.confidence ?? 1);
  const pct = i.progressPct ?? 0;

  return (
    <tr className="cursor-pointer border-t border-slate-100 transition hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5" onClick={() => open(i)}>
      <td className="max-w-[260px] px-3 py-2.5">
        <span className="block truncate font-medium text-[#0d1f3c] dark:text-white">{i.title}</span>
        {i.sourceKind && i.sourceKind !== "manual" && (
          <span className="badge badge-neutral mt-0.5">{i.sourceKind}</span>
        )}
        {needsAttention(i) && <span className="badge badge-danger ml-1 mt-0.5">{isOverdue(i) ? "overdue" : "at risk"}</span>}
      </td>
      <td className="px-3 py-2.5 whitespace-nowrap">{labelOf(PLAYBOOK_CATEGORIES, i.category ?? "general")}</td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <span className="flex items-center gap-1.5">
          {owner.trim() && <PersonAvatar name={owner} size={22} />}
          <input
            className="w-28 min-w-0 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm transition hover:border-slate-200 focus:border-[#b8975a] focus:bg-white focus:outline-none dark:hover:border-white/15 dark:focus:bg-white/5"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            onBlur={() => { if (owner.trim() !== (i.ownerName ?? "")) void patch(i, { ownerName: owner.trim() }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            aria-label={`Owner of ${i.title}`}
            placeholder="Owner"
          />
        </span>
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <select
          className="min-h-[32px] rounded-full border border-slate-200 bg-white px-2 text-xs font-medium text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white"
          value={i.status}
          onChange={(e) => void patch(i, { status: e.target.value })}
          aria-label={`Status of ${i.title}`}
        >
          {INITIATIVE_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>{s.label}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
        <MiniTimeline i={i} min={horizon.min} max={horizon.max} />
        <span className="mt-1 flex gap-1">
          <input type="date" className="w-[118px] rounded border border-transparent bg-transparent px-1 text-[11px] text-slate-500 transition hover:border-slate-200 focus:border-[#b8975a] focus:outline-none dark:text-white/50 dark:hover:border-white/15" value={start} onChange={(e) => { setStart(e.target.value); void patch(i, { startDate: e.target.value || null }); }} aria-label={`Start date of ${i.title}`} />
          <input type="date" className="w-[118px] rounded border border-transparent bg-transparent px-1 text-[11px] text-slate-500 transition hover:border-slate-200 focus:border-[#b8975a] focus:outline-none dark:text-white/50 dark:hover:border-white/15" value={end} onChange={(e) => { setEnd(e.target.value); void patch(i, { endDate: e.target.value || null }); }} aria-label={`End date of ${i.title}`} />
        </span>
      </td>
      <td className="tnum px-3 py-2.5 text-right font-medium">{fmtMoneyN(i.ebitdaImpact)}</td>
      <td className="tnum px-3 py-2.5 text-right">{i.confidence === null || i.confidence === undefined ? "—" : `${Math.round(i.confidence * 100)}%`}</td>
      <td className="tnum px-3 py-2.5 text-right">{fmtMoneyN(i.oneTimeCost)}</td>
      <td className="tnum px-3 py-2.5 text-right">{fmtPayback(paybackYears(i.oneTimeCost ?? 0, weighted))}</td>
      <td className="px-3 py-2.5">
        <span className="flex items-center gap-2">
          <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
            <span className={`block h-full ${i.status === "at_risk" ? "bg-red-500" : i.status === "done" ? "bg-emerald-500" : "bg-[#b8975a]"}`} style={{ width: `${pct}%` }} />
          </span>
          <span className="tnum text-xs text-slate-500 dark:text-white/50">{pct}%</span>
        </span>
      </td>
    </tr>
  );
}

/* -------------------------------- board view ------------------------------ */

function BoardView({
  rows, patch, open,
}: {
  rows: Initiative[];
  patch: (i: Initiative, body: Record<string, unknown>) => Promise<void>;
  open: (i: Initiative) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {INITIATIVE_STATUSES.map((s) => {
        const col = rows.filter((i) => i.status === s.key);
        return (
          <div key={s.key} className="w-[270px] shrink-0">
            <h4 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-white/45">
              {s.label}
              <span className="tnum rounded-full bg-slate-100 px-2 py-0.5 dark:bg-white/10">{col.length}</span>
            </h4>
            <ul className="space-y-2">
              {col.map((i) => (
                <li key={i.id} className="rounded-xl border border-slate-100 bg-white p-3 shadow-sm dark:border-white/5 dark:bg-white/5">
                  <button type="button" className="w-full text-left" onClick={() => open(i)}>
                    <span className="block text-sm font-semibold text-[#0d1f3c] dark:text-white">{i.title}</span>
                    <span className="mt-1 block text-xs text-slate-500 dark:text-white/50">
                      {labelOf(PLAYBOOK_CATEGORIES, i.category ?? "general")} · {fmtMoneyN(i.ebitdaImpact)}
                    </span>
                    <span className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 dark:text-white/50">
                      {i.ownerName && <PersonAvatar name={i.ownerName} size={18} />}
                      {i.ownerName || "No owner"}
                      {i.endDate && <span className="tnum ml-auto">due {fmtDateShort(i.endDate)}</span>}
                    </span>
                    <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                      <span className={`block h-full ${i.status === "at_risk" ? "bg-red-500" : "bg-[#b8975a]"}`} style={{ width: `${i.progressPct ?? 0}%` }} />
                    </span>
                  </button>
                  <select
                    className="mt-2 min-h-[32px] w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-[#0d1f3c] outline-none focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white"
                    value={i.status}
                    onChange={(e) => void patch(i, { status: e.target.value })}
                    aria-label={`Move ${i.title}`}
                  >
                    {INITIATIVE_STATUSES.map((x) => (
                      <option key={x.key} value={x.key}>{x.label}</option>
                    ))}
                  </select>
                </li>
              ))}
              {col.length === 0 && (
                <li className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400 dark:border-white/10 dark:text-white/35">None</li>
              )}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------- gantt view ------------------------------- */

const STATUS_BAR: Record<string, string> = {
  done: "bg-emerald-600",
  on_track: "bg-emerald-500",
  in_progress: "bg-[#b8975a]",
  at_risk: "bg-red-500",
  deferred: "bg-red-400",
  planned: "bg-[#0d1f3c] dark:bg-[#54708f]",
};

function GanttView({
  rows, all, open,
}: {
  rows: Initiative[];
  all: Initiative[];
  open: (i: Initiative) => void;
}) {
  const dated = rows.filter((i) => i.startDate);
  const byId = new Map(all.map((i) => [i.id, i]));
  const undated = rows.filter((i) => !i.startDate);

  const model = useMemo(() => {
    if (dated.length === 0) return null;
    const min = dated.map((i) => i.startDate as string).sort()[0];
    const maxEnd = dated.reduce((m, i) => {
      const e = i.endDate ?? (i.startDate as string);
      return e > m ? e : m;
    }, min);
    const total = Math.max(30, dayOffset(min, maxEnd));
    return { min, total };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  if (!model) {
    return <EmptyState title="No dated initiatives" message="Give initiatives start dates to see the Gantt — the list view below still shows everything." />;
  }
  const todayOff = dayOffset(model.min, new Date().toISOString());
  const showToday = todayOff >= 0 && todayOff <= model.total;

  return (
    <div>
      {/* Gantt on md+ */}
      <div className={`${cardCls} hidden md:block`}>
        <div className="relative">
          {showToday && (
            <div className="absolute inset-y-0 z-10 w-px bg-[#b8975a]" style={{ left: `${(todayOff / model.total) * 100}%` }} aria-hidden="true">
              <span className="absolute -top-1 left-1 text-[10px] font-semibold uppercase tracking-wide text-[#8a6f3c] dark:text-[#b8975a]">Today</span>
            </div>
          )}
          <ul className="space-y-2.5 pt-4">
            {dated.map((i) => {
              const left = (dayOffset(model.min, i.startDate as string) / model.total) * 100;
              const width = Math.max(2, (Math.max(1, dayOffset(i.startDate as string, i.endDate ?? (i.startDate as string))) / model.total) * 100);
              const deps = (i.dependsOn ?? []).map((d) => byId.get(d)?.title).filter(Boolean) as string[];
              return (
                <li key={i.id}>
                  <button type="button" className="block w-full text-left" onClick={() => open(i)}>
                    <span className="flex flex-wrap items-baseline gap-x-2 text-sm">
                      <span className="font-medium text-[#0d1f3c] dark:text-white">{i.title}</span>
                      <span className="tnum text-xs text-slate-500 dark:text-white/50">
                        {fmtDateShort(i.startDate)} → {fmtDateShort(i.endDate)} · {i.progressPct ?? 0}%
                      </span>
                    </span>
                    <span className="relative mt-1 block h-4 overflow-hidden rounded bg-slate-100 dark:bg-white/5">
                      <span className={`absolute inset-y-0 rounded ${STATUS_BAR[i.status] ?? "bg-slate-400"}`} style={{ left: `${left}%`, width: `${width}%`, opacity: 0.45 }} />
                      <span className={`absolute inset-y-0 rounded ${STATUS_BAR[i.status] ?? "bg-slate-400"}`} style={{ left: `${left}%`, width: `${(width * (i.progressPct ?? 0)) / 100}%` }} />
                    </span>
                    {deps.length > 0 && (
                      <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/50">Depends on: {deps.join(", ")}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        {undated.length > 0 && (
          <p className="mt-3 text-xs text-slate-500 dark:text-white/50">
            {undated.length} initiative{undated.length === 1 ? " has" : "s have"} no start date and {undated.length === 1 ? "is" : "are"} not shown on the Gantt: {undated.map((i) => i.title).join(", ")}.
          </p>
        )}
      </div>
      {/* Scrollable list on mobile */}
      <ul className="space-y-2.5 md:hidden">
        {rows.map((i) => (
          <li key={i.id}>
            <button type="button" className="block w-full rounded-xl border border-slate-100 p-3.5 text-left dark:border-white/5" onClick={() => open(i)}>
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold text-[#0d1f3c] dark:text-white">{i.title}</span>
                <span className={`badge ${initiativeStatusBadge(i.status)}`}>{labelOf(INITIATIVE_STATUSES, i.status)}</span>
              </span>
              <span className="tnum mt-1 block text-xs text-slate-500 dark:text-white/50">
                {i.startDate ? `${fmtDateShort(i.startDate)} → ${fmtDateShort(i.endDate)}` : "No dates set"} · {i.progressPct ?? 0}% complete
              </span>
              {(i.dependsOn ?? []).length > 0 && (
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-white/50">
                  Depends on: {(i.dependsOn ?? []).map((d) => byId.get(d)?.title ?? d).join(", ")}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
