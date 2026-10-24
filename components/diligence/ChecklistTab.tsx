"use client";

/**
 * Checklist — REDESIGNED Oct 2026 (spec §4). Compact table (~44px
 * rows, sticky navy header) grouped by collapsible workstream with
 * progress counts; inline edit of status / owner / due date; filters
 * + search + needs-attention toggle; bulk actions; Table / By-status
 * board switcher; quick-add per workstream; template packs via an
 * explicit apply action (never mutates existing items). Row click
 * opens the shared right-side drawer (description, notes, linked
 * data room documents, linked findings + requests, comments with
 * @mentions, history; Delete lives only in the drawer).
 *
 * Data: this tab fetches its own section only
 * (GET workspaces/[id]/checklist) — no full bundle load.
 */

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, ErrorState, SkeletonRows, BulkActionBar } from "@/components/ui";
import {
  CHECKLIST_PRIORITIES,
  CHECKLIST_STATUSES,
  WORKSTREAMS,
  api,
  fmtDateShort,
  isChecklistDone,
  labelOf,
  type ChecklistItem,
  type Finding,
  type RequestItem,
  type TabProps,
} from "@/components/diligence/types";
import {
  CommentsPanel,
  DrawerShell,
  drawerInputCls,
  drawerLabelCls,
} from "@/components/diligence/ItemDrawer";

const PARTNERS = ["Ethan Canny", "Ronan Canny", "Ian Canny"];

const STATUS_PILL: Record<string, string> = {
  not_started: "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60",
  requested: "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300",
  received: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-300",
  in_review: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  issue: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
  complete: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  na: "bg-slate-50 text-slate-400 dark:bg-white/5 dark:text-white/40",
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isOverdue(item: ChecklistItem): boolean {
  return Boolean(
    item.dueDate && item.dueDate < todayStr() && !isChecklistDone(item.status)
  );
}

interface RoomChecklistEntry {
  id: string;
  title: string;
  documents?: Array<{ id: string; fileName: string }>;
}

export default function ChecklistTab(props: TabProps) {
  const { workspaceId, bundle } = props;
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [fWorkstream, setFWorkstream] = useState("");
  const [fOwner, setFOwner] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fOverdue, setFOverdue] = useState(false);
  const [attention, setAttention] = useState(false);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [view, setView] = useState<"table" | "board">("table");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [quickAdd, setQuickAdd] = useState<Record<string, string>>({});
  const [roomEntries, setRoomEntries] = useState<RoomChecklistEntry[]>([]);
  const [packMsg, setPackMsg] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await api<{ items: ChecklistItem[] }>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/checklist`
      );
      setItems(data.items ?? []);
      setPhase("ready");
    } catch {
      setPhase("error");
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (props.intent?.checklist === "attention") setAttention(true);
  }, [props.intent]);

  useEffect(() => {
    const roomId = bundle.room?.id;
    if (!roomId) return;
    void (async () => {
      try {
        const data = await api<{ items: RoomChecklistEntry[] }>(
          `/api/platform/datarooms/rooms/${encodeURIComponent(roomId)}/checklist`
        );
        setRoomEntries(data.items ?? []);
      } catch {
        setRoomEntries([]);
      }
    })();
  }, [bundle.room?.id]);

  const patch = useCallback(
    async (itemId: string, body: Record<string, unknown>) => {
      setItems((cur) =>
        cur.map((i) =>
          i.id === itemId ? ({ ...i, ...body } as ChecklistItem) : i
        )
      );
      try {
        const data = await api<{ item: ChecklistItem }>(
          `/api/platform/diligence/checklist/${encodeURIComponent(itemId)}`,
          { method: "PATCH", body: JSON.stringify(body) }
        );
        setItems((cur) => cur.map((i) => (i.id === itemId ? data.item : i)));
        void props.reload();
      } catch {
        void load();
      }
    },
    [load, props]
  );

  const owners = useMemo(() => {
    const set = new Set<string>(PARTNERS);
    for (const i of items) if (i.owner) set.add(i.owner);
    return Array.from(set);
  }, [items]);

  const docCount = useCallback(
    (item: ChecklistItem): number => {
      if (!item.dataroomChecklistItemId) return 0;
      const entry = roomEntries.find((e) => e.id === item.dataroomChecklistItemId);
      return entry?.documents?.length ?? 0;
    },
    [roomEntries]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => {
      if (fWorkstream && i.workstream !== fWorkstream) return false;
      if (fOwner && i.owner !== fOwner) return false;
      if (fStatus && i.status !== fStatus) return false;
      if (fOverdue && !isOverdue(i)) return false;
      if (attention && !(isOverdue(i) || i.status === "issue")) return false;
      if (q && !`${i.title} ${i.notes} ${i.owner}`.toLowerCase().includes(q))
        return false;
      return true;
    });
  }, [items, fWorkstream, fOwner, fStatus, fOverdue, attention, search]);

  const groups = useMemo(() => {
    const ordered = [
      ...WORKSTREAMS.map((w) => w.key),
      ...Array.from(new Set(items.map((i) => i.workstream))).filter(
        (k) => !WORKSTREAMS.some((w) => w.key === k)
      ),
    ];
    return ordered
      .map((key) => {
        const all = items.filter((i) => i.workstream === key);
        const shown = filtered.filter((i) => i.workstream === key);
        return {
          key,
          all,
          shown,
          done: all.filter((i) => isChecklistDone(i.status)).length,
        };
      })
      .filter((g) => g.all.length > 0);
  }, [items, filtered]);

  const drawerItem = drawerId ? items.find((i) => i.id === drawerId) ?? null : null;

  const toggleSelect = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkApply = async (body: Record<string, unknown>) => {
    if (bulkBusy || selected.size === 0) return;
    setBulkBusy(true);
    try {
      for (const id of Array.from(selected)) {
        await api(`/api/platform/diligence/checklist/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      setSelected(new Set());
      await load();
      void props.reload();
    } finally {
      setBulkBusy(false);
    }
  };

  const addItem = async (workstream: string) => {
    const title = (quickAdd[workstream] ?? "").trim();
    if (!title) return;
    try {
      await api(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/checklist`,
        {
          method: "POST",
          body: JSON.stringify({ workstream, title }),
        }
      );
      setQuickAdd((q) => ({ ...q, [workstream]: "" }));
      await load();
      void props.reload();
    } catch {
      /* load state surfaces failures */
    }
  };

  const applyPack = async (pack: string) => {
    setPackMsg("");
    try {
      const data = await api<{ added: number; skipped: number }>(
        `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/checklist/apply-template`,
        { method: "POST", body: JSON.stringify({ pack }) }
      );
      setPackMsg(
        data.added > 0
          ? `Added ${data.added} item(s); ${data.skipped} already present.`
          : "All pack items are already on the checklist."
      );
      await load();
      void props.reload();
    } catch {
      setPackMsg("Could not apply that pack.");
    }
  };

  if (phase === "loading") return <SkeletonRows rows={8} />;
  if (phase === "error") return <ErrorState onRetry={() => void load()} />;

  const statusSelect = (item: ChecklistItem) => (
    <select
      aria-label="Status"
      className={`cursor-pointer rounded-full px-2 py-0.5 text-[11px] font-semibold outline-none ${STATUS_PILL[item.status] ?? STATUS_PILL.not_started}`}
      value={item.status}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => void patch(item.id, { status: e.target.value })}
    >
      {CHECKLIST_STATUSES.map((s) => (
        <option key={s.key} value={s.key}>
          {s.label}
        </option>
      ))}
    </select>
  );

  const ownerSelect = (item: ChecklistItem) => (
    <select
      aria-label="Owner"
      className="w-28 cursor-pointer truncate rounded-lg bg-transparent px-1 py-0.5 text-[13px] text-[#0d1f3c] outline-none hover:bg-slate-100 dark:text-white/90 dark:hover:bg-white/10"
      value={item.owner}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => void patch(item.id, { owner: e.target.value })}
    >
      <option value="">Unassigned</option>
      {owners.map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
      {item.owner && !owners.includes(item.owner) && (
        <option value={item.owner}>{item.owner}</option>
      )}
    </select>
  );

  const dueInput = (item: ChecklistItem) => (
    <input
      type="date"
      aria-label="Due date"
      className={`w-[8.5rem] rounded-lg bg-transparent px-1 py-0.5 text-[13px] outline-none hover:bg-slate-100 dark:hover:bg-white/10 ${
        isOverdue(item)
          ? "font-semibold text-red-600 dark:text-red-300"
          : "text-[#0d1f3c] dark:text-white/90"
      }`}
      value={item.dueDate ?? ""}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) =>
        void patch(item.id, { dueDate: e.target.value || null })
      }
    />
  );

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/10 dark:bg-white/5 dark:text-white sm:max-w-xs"
          placeholder="Search items…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost btn-sm md:hidden"
          onClick={() => setShowFilters((v) => !v)}
        >
          Filters
        </button>
        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            attention
              ? "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300"
              : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/60"
          }`}
        >
          <input
            type="checkbox"
            className="accent-[#b8975a]"
            checked={attention}
            onChange={(e) => setAttention(e.target.checked)}
          />
          Needs attention
        </label>
        <div className="ml-auto flex gap-1">
          {(["table", "board"] as const).map((v) => (
            <button
              key={v}
              type="button"
              className={`chip ${view === v ? "chip-active" : ""}`}
              onClick={() => setView(v)}
            >
              {v === "table" ? "Table" : "By status"}
            </button>
          ))}
        </div>
      </div>
      <div
        className={`${showFilters ? "flex" : "hidden"} mt-2 flex-wrap gap-2 md:flex`}
      >
        <select
          className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
          value={fWorkstream}
          onChange={(e) => setFWorkstream(e.target.value)}
        >
          <option value="">All workstreams</option>
          {WORKSTREAMS.map((w) => (
            <option key={w.key} value={w.key}>
              {w.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
          value={fOwner}
          onChange={(e) => setFOwner(e.target.value)}
        >
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <select
          className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
        >
          <option value="">All statuses</option>
          {CHECKLIST_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-500 dark:text-white/60">
          <input
            type="checkbox"
            className="accent-[#b8975a]"
            checked={fOverdue}
            onChange={(e) => setFOverdue(e.target.checked)}
          />
          Overdue only
        </label>
        <div className="flex items-center gap-1">
          <select
            id="dd-pack-select"
            className="rounded-xl border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-white/10 dark:bg-white/5 dark:text-white"
            defaultValue=""
          >
            <option value="" disabled>
              Apply template pack…
            </option>
            <option value="base">Standard checklist</option>
            <option value="ad">Aerospace &amp; Defense pack</option>
            <option value="addon">Add-on integration pack</option>
            <option value="early_stage">Early-stage pack</option>
          </select>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const sel = document.getElementById(
                "dd-pack-select"
              ) as HTMLSelectElement | null;
              if (sel?.value) void applyPack(sel.value);
            }}
          >
            Apply
          </button>
          {packMsg && (
            <span className="text-xs text-slate-500 dark:text-white/50">{packMsg}</span>
          )}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="No checklist items"
            message="Apply the standard template pack above, or add an item with a workstream quick-add once groups exist."
          />
        </div>
      ) : view === "board" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {CHECKLIST_STATUSES.map((s) => {
            const col = filtered.filter((i) => i.status === s.key);
            return (
              <div
                key={s.key}
                className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#132847]/60"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_PILL[s.key]}`}
                  >
                    {s.label}
                  </span>
                  <span className="text-xs text-slate-400">{col.length}</span>
                </div>
                <div className="mt-2 space-y-2">
                  {col.map((i) => (
                    <button
                      key={i.id}
                      type="button"
                      className="block w-full rounded-xl border border-slate-100 p-2 text-left hover:border-[#b8975a] dark:border-white/10"
                      onClick={() => setDrawerId(i.id)}
                    >
                      <span className="block truncate text-sm font-medium text-[#0d1f3c] dark:text-white/90">
                        {i.title}
                      </span>
                      <span className="text-xs text-slate-400">
                        {labelOf(WORKSTREAMS, i.workstream)}
                        {i.owner ? ` · ${i.owner}` : ""}
                        {i.dueDate ? ` · ${fmtDateShort(i.dueDate)}` : ""}
                      </span>
                    </button>
                  ))}
                  {col.length === 0 && (
                    <p className="text-xs text-slate-400">None</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="mt-4 hidden overflow-hidden rounded-2xl border border-slate-200 bg-white dark:border-white/10 dark:bg-[#132847]/60 md:block">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0d1f3c] text-left text-[#f5efe0]">
                  <th className="w-8 px-2 py-2" />
                  <th className="px-2 py-2 text-[11px] font-semibold uppercase tracking-wider">Item</th>
                  <th className="w-32 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider">Owner</th>
                  <th className="w-32 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider">Status</th>
                  <th className="w-36 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider">Due</th>
                  <th className="w-16 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider">Pri</th>
                  <th className="w-14 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider">Docs</th>
                  <th className="w-24 px-2 py-2 text-[11px] font-semibold uppercase tracking-wider">Updated</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => (
                  <Fragment key={g.key}>
                    <tr className="bg-slate-50 dark:bg-white/5">
                      <td colSpan={8} className="border-b-2 border-[#b8975a] px-2 py-1.5">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 text-left"
                          onClick={() =>
                            setCollapsed((cur) => {
                              const next = new Set(cur);
                              if (next.has(g.key)) next.delete(g.key);
                              else next.add(g.key);
                              return next;
                            })
                          }
                        >
                          <span className="text-xs">{collapsed.has(g.key) ? "▸" : "▾"}</span>
                          <span className="text-[13px] font-semibold text-[#0d1f3c] dark:text-white">
                            {labelOf(WORKSTREAMS, g.key)}
                          </span>
                          <span className="text-xs text-slate-400">
                            {g.done}/{g.all.length} done
                          </span>
                          <span className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-200 dark:bg-white/10">
                            <span
                              className="block h-full bg-[#b8975a]"
                              style={{
                                width: `${g.all.length ? Math.round((100 * g.done) / g.all.length) : 0}%`,
                              }}
                            />
                          </span>
                        </button>
                      </td>
                    </tr>
                    {!collapsed.has(g.key) &&
                      g.shown.map((item) => (
                        <tr
                          key={item.id}
                          className="cursor-pointer border-b border-slate-100 hover:bg-[#f0f4fa] dark:border-white/5 dark:hover:bg-white/5"
                          onClick={() => setDrawerId(item.id)}
                        >
                          <td className="px-2 py-1.5" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              className="accent-[#b8975a]"
                              checked={selected.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                            />
                          </td>
                          <td className="max-w-0 px-2 py-1.5">
                            <span className="block truncate text-[13px] text-[#0d1f3c] dark:text-white/90">
                              {item.title}
                              {item.notes && (
                                <span className="ml-1.5 text-slate-300" title="Has notes">
                                  ●
                                </span>
                              )}
                              {item.priority === "high" && (
                                <span className="ml-1.5 rounded bg-red-100 px-1 text-[10px] font-bold text-red-700 dark:bg-red-500/20 dark:text-red-300">
                                  HIGH
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-2 py-1.5">{ownerSelect(item)}</td>
                          <td className="px-2 py-1.5">{statusSelect(item)}</td>
                          <td className="px-2 py-1.5">{dueInput(item)}</td>
                          <td className="px-2 py-1.5 text-[13px] capitalize text-slate-500 dark:text-white/60">
                            {item.priority}
                          </td>
                          <td className="px-2 py-1.5 text-[13px] text-slate-500 dark:text-white/60">
                            {item.dataroomChecklistItemId ? docCount(item) : "—"}
                          </td>
                          <td className="px-2 py-1.5 text-xs text-slate-400">
                            {fmtDateShort(item.updatedAt)}
                          </td>
                        </tr>
                      ))}
                    {!collapsed.has(g.key) && (
                      <tr key={`q-${g.key}`}>
                        <td colSpan={8} className="px-2 py-1.5">
                          <div className="flex gap-2">
                            <input
                              className="min-w-0 flex-1 rounded-lg border border-dashed border-slate-200 px-2 py-1 text-[13px] outline-none placeholder:text-slate-300 focus:border-[#b8975a] dark:border-white/15 dark:bg-transparent dark:text-white"
                              placeholder={`Quick-add to ${labelOf(WORKSTREAMS, g.key)}…`}
                              value={quickAdd[g.key] ?? ""}
                              onChange={(e) =>
                                setQuickAdd((q) => ({ ...q, [g.key]: e.target.value }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void addItem(g.key);
                              }}
                            />
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => void addItem(g.key)}
                            >
                              Add
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="mt-4 space-y-4 md:hidden">
            {groups.map((g) => (
              <div key={g.key}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#0d1f3c] dark:text-white">
                    {labelOf(WORKSTREAMS, g.key)}
                  </span>
                  <span className="text-xs text-slate-400">
                    {g.done}/{g.all.length} done
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {g.shown.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#132847]/60"
                      onClick={() => setDrawerId(item.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium text-[#0d1f3c] dark:text-white/90">
                          {item.title}
                        </span>
                        {statusSelect(item)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {ownerSelect(item)}
                        {dueInput(item)}
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      className="min-w-0 flex-1 rounded-lg border border-dashed border-slate-200 px-2 py-1.5 text-sm outline-none focus:border-[#b8975a] dark:border-white/15 dark:bg-transparent dark:text-white"
                      placeholder="Quick-add…"
                      value={quickAdd[g.key] ?? ""}
                      onChange={(e) =>
                        setQuickAdd((q) => ({ ...q, [g.key]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void addItem(g.key);
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void addItem(g.key)}
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <BulkActionBar count={selected.size}>
        <select
          className="rounded-lg bg-white/10 px-2 py-1 text-sm text-white"
          defaultValue=""
          disabled={bulkBusy}
          onChange={(e) => {
            if (e.target.value) void bulkApply({ status: e.target.value });
            e.target.value = "";
          }}
        >
          <option value="" disabled>
            Set status…
          </option>
          {CHECKLIST_STATUSES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
        <select
          className="rounded-lg bg-white/10 px-2 py-1 text-sm text-white"
          defaultValue=""
          disabled={bulkBusy}
          onChange={(e) => {
            void bulkApply({ owner: e.target.value });
            e.target.value = "";
          }}
        >
          <option value="" disabled>
            Set owner…
          </option>
          <option value="">Unassigned</option>
          {owners.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 text-sm">
          Due
          <input
            type="date"
            className="rounded-lg bg-white/10 px-2 py-1 text-sm text-white"
            disabled={bulkBusy}
            onChange={(e) => {
              if (e.target.value) void bulkApply({ dueDate: e.target.value });
              e.target.value = "";
            }}
          />
        </label>
        <button
          type="button"
          className="text-sm text-white/70 hover:text-white"
          onClick={() => setSelected(new Set())}
        >
          Clear
        </button>
      </BulkActionBar>

      {drawerItem && (
        <ChecklistDrawer
          key={drawerItem.id}
          item={drawerItem}
          workspaceId={workspaceId}
          owners={owners}
          roomEntries={roomEntries}
          roomId={bundle.room?.id ?? null}
          patch={patch}
          onClose={() => setDrawerId(null)}
          onDeleted={async () => {
            setDrawerId(null);
            await load();
            void props.reload();
          }}
        />
      )}
    </div>
  );
}

function ChecklistDrawer({
  item,
  workspaceId,
  owners,
  roomEntries,
  roomId,
  patch,
  onClose,
  onDeleted,
}: {
  item: ChecklistItem;
  workspaceId: string;
  owners: string[];
  roomEntries: RoomChecklistEntry[];
  roomId: string | null;
  patch: (itemId: string, body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  onDeleted: () => Promise<void>;
}) {
  const [title, setTitle] = useState(item.title);
  const [description, setDescription] = useState(item.description);
  const [notes, setNotes] = useState(item.notes);
  const [linkedFindings, setLinkedFindings] = useState<Finding[]>([]);
  const [linkedRequests, setLinkedRequests] = useState<RequestItem[]>([]);
  const roomEntry = item.dataroomChecklistItemId
    ? roomEntries.find((e) => e.id === item.dataroomChecklistItemId)
    : null;

  useEffect(() => {
    void (async () => {
      try {
        const [f, r] = await Promise.all([
          api<{ findings: Finding[] }>(
            `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/findings`
          ),
          api<{ items: RequestItem[] }>(
            `/api/platform/diligence/workspaces/${encodeURIComponent(workspaceId)}/requests`
          ),
        ]);
        setLinkedFindings(
          (f.findings ?? []).filter((x) => x.checklistItemId === item.id)
        );
        setLinkedRequests(
          (r.items ?? []).filter((x) => x.checklistItemId === item.id)
        );
      } catch {
        /* linked lists are best-effort */
      }
    })();
  }, [workspaceId, item.id]);

  const saveText = () =>
    void patch(item.id, { title: title.trim() || item.title, description, notes });

  return (
    <DrawerShell
      title={item.title}
      subtitle={`${labelOf(WORKSTREAMS, item.workstream)} · Updated ${fmtDateShort(item.updatedAt)}`}
      onClose={onClose}
      deleteLabel="Delete checklist item"
      onDelete={async () => {
        await api(
          `/api/platform/diligence/checklist/${encodeURIComponent(item.id)}`,
          { method: "DELETE" }
        );
        await onDeleted();
      }}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={drawerLabelCls}>Status</label>
            <select
              className={drawerInputCls}
              value={item.status}
              onChange={(e) => void patch(item.id, { status: e.target.value })}
            >
              {CHECKLIST_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={drawerLabelCls}>Priority</label>
            <select
              className={drawerInputCls}
              value={item.priority}
              onChange={(e) => void patch(item.id, { priority: e.target.value })}
            >
              {CHECKLIST_PRIORITIES.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={drawerLabelCls}>Owner</label>
            <select
              className={drawerInputCls}
              value={item.owner}
              onChange={(e) => void patch(item.id, { owner: e.target.value })}
            >
              <option value="">Unassigned</option>
              {owners.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
              {item.owner && !owners.includes(item.owner) && (
                <option value={item.owner}>{item.owner}</option>
              )}
            </select>
          </div>
          <div>
            <label className={drawerLabelCls}>Due date</label>
            <input
              type="date"
              className={drawerInputCls}
              value={item.dueDate ?? ""}
              onChange={(e) =>
                void patch(item.id, { dueDate: e.target.value || null })
              }
            />
          </div>
        </div>

        <div>
          <label className={drawerLabelCls}>Title</label>
          <input
            className={drawerInputCls}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveText}
          />
        </div>
        <div>
          <label className={drawerLabelCls}>Description</label>
          <textarea
            className={drawerInputCls}
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={saveText}
            placeholder="What good looks like for this item…"
          />
        </div>
        <div>
          <label className={drawerLabelCls}>Notes</label>
          <textarea
            className={drawerInputCls}
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveText}
          />
        </div>

        <div>
          <span className={drawerLabelCls}>Linked data room item</span>
          {roomId ? (
            <>
              <select
                className={drawerInputCls}
                value={item.dataroomChecklistItemId ?? ""}
                onChange={(e) =>
                  void patch(item.id, {
                    dataroomChecklistItemId: e.target.value || null,
                  })
                }
              >
                <option value="">Not linked</option>
                {roomEntries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
              {roomEntry && (
                <div className="mt-2 space-y-1">
                  {(roomEntry.documents ?? []).length === 0 ? (
                    <p className="text-xs text-slate-400">
                      No documents filed against this item yet.
                    </p>
                  ) : (
                    (roomEntry.documents ?? []).map((d) => (
                      <a
                        key={d.id}
                        className="block truncate text-sm text-[#8a6d3b] hover:underline dark:text-[#b8975a]"
                        href={`/api/platform/datarooms/documents/${encodeURIComponent(d.id)}/download`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {d.fileName}
                      </a>
                    ))
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-500 dark:text-white/50">
              No data room is linked to this deal yet.
            </p>
          )}
        </div>

        {(linkedFindings.length > 0 || linkedRequests.length > 0) && (
          <div>
            <span className={drawerLabelCls}>Linked findings &amp; requests</span>
            <ul className="space-y-1 text-sm">
              {linkedFindings.map((f) => (
                <li key={f.id} className="text-[#0d1f3c] dark:text-white/85">
                  Finding · {f.title}{" "}
                  <span className="text-xs capitalize text-slate-400">
                    ({f.severity}, {f.status})
                  </span>
                </li>
              ))}
              {linkedRequests.map((r) => (
                <li key={r.id} className="text-[#0d1f3c] dark:text-white/85">
                  Request · {r.label}{" "}
                  <span className="text-xs capitalize text-slate-400">
                    ({r.status})
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <span className={drawerLabelCls}>History</span>
          <p className="text-xs text-slate-500 dark:text-white/50">
            Created {fmtDateShort(item.createdAt)} · Last updated{" "}
            {fmtDateShort(item.updatedAt)}. Status changes are recorded in
            the workspace activity feed on the Overview tab.
          </p>
        </div>

        <div>
          <span className={drawerLabelCls}>Comments</span>
          <CommentsPanel
            entityKind="diligence_checklist_item"
            entityId={item.id}
          />
        </div>
      </div>
    </DrawerShell>
  );
}
