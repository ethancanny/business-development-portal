"use client";

import { useState } from "react";
import Link from "next/link";
import {
  PARTNER_NAMES,
  type Deal,
  type Executive,
  type Task,
  type TaskPriority,
  type TaskType,
} from "@/lib/types";

interface TaskListProps {
  tasks: Task[];
  deals: Deal[];
  execs: Executive[];
  onChanged: () => void;
  /** When set, new tasks are pre-linked and the link picker is hidden. */
  presetLink?: { kind: "deal" | "executive"; id: string; name: string } | null;
}

/* -------- Phoenix date/time helpers (America/Phoenix, no DST) -------- */

function phxToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const p: Record<string, string> = {};
  for (const part of parts) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

function ymd(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00`);
  d.setDate(d.getDate() + days);
  return ymd(d);
}

function diffDays(from: string, to: string): number {
  const a = new Date(`${from}T12:00:00`).getTime();
  const b = new Date(`${to}T12:00:00`).getTime();
  return Math.round((b - a) / 86400000);
}

function fmtDateLabel(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function fmtTimeLabel(time: string): string {
  const [h, m] = time.split(":").map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const TYPE_ICONS: Record<TaskType, string> = {
  Call: "📞",
  Email: "✉️",
  Meeting: "👥",
  "Send docs": "📄",
  Other: "📌",
};
const TASK_TYPES = Object.keys(TYPE_ICONS) as TaskType[];

const inputCls =
  "rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 outline-none focus:border-[#b8975a] dark:border-white/15 dark:bg-[#132847] dark:text-[#e8dfc8]";

interface EditState {
  id: string;
  title: string;
  dueDate: string;
  dueTime: string;
  type: TaskType;
  priority: TaskPriority;
  notes: string;
  owner: string;
  link: string;
}

export default function TaskList({
  tasks,
  deals,
  execs,
  onChanged,
  presetLink = null,
}: TaskListProps) {
  const today = phxToday();
  // Add form — the date defaults to today on every load, never a stale date.
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [dueTime, setDueTime] = useState("");
  const [taskType, setTaskType] = useState<TaskType>("Call");
  const [priority, setPriority] = useState<TaskPriority>("normal");
  const [notes, setNotes] = useState("");
  const [notesOpen, setNotesOpen] = useState(false);
  const [owner, setOwner] = useState("");
  const [link, setLink] = useState("__none__");
  const [busy, setBusy] = useState(false);
  // List state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [snoozeFor, setSnoozeFor] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [editFocusDate, setEditFocusDate] = useState(false);
  const [completedOpen, setCompletedOpen] = useState(false);
  const [notePrompt, setNotePrompt] = useState<Task | null>(null);
  const [noteText, setNoteText] = useState("");

  const resolveLink = (value: string) => {
    if (presetLink) {
      return {
        relatedKind: presetLink.kind as "deal" | "executive",
        relatedId: presetLink.id as string | null,
        relatedName: presetLink.name,
      };
    }
    if (value.startsWith("deal:")) {
      const id = value.slice(5);
      return {
        relatedKind: "deal" as const,
        relatedId: id as string | null,
        relatedName: deals.find((d) => d.id === id)?.companyName ?? "",
      };
    }
    if (value.startsWith("exec:")) {
      const id = value.slice(5);
      return {
        relatedKind: "executive" as const,
        relatedId: id as string | null,
        relatedName: execs.find((e) => e.id === id)?.name ?? "",
      };
    }
    return { relatedKind: null, relatedId: null, relatedName: "" };
  };

  const addTask = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        dueDate,
        dueTime: dueTime || null,
        type: taskType,
        priority,
        notes: notes.trim(),
        owner,
        ...resolveLink(link),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setDueDate(phxToday());
      setDueTime("");
      setTaskType("Call");
      setPriority("normal");
      setNotes("");
      setNotesOpen(false);
      setOwner("");
      setLink("__none__");
      onChanged();
    }
  };

  const put = async (task: Task, patch: Record<string, unknown>) => {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (res.ok) onChanged();
    return res.ok;
  };

  const toggle = async (task: Task) => {
    const ok = await put(task, { done: !task.done });
    if (ok && !task.done && task.relatedKind && task.relatedId) {
      // Offer the optional "Log a note?" prompt for the linked account.
      setNotePrompt(task);
      setNoteText("");
      setCompletedOpen(true);
    }
  };

  const saveNote = async () => {
    if (!notePrompt) return;
    const summary = noteText.trim();
    if (summary) {
      await fetch("/api/interactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "note",
          occurredAt: phxToday(),
          summary,
          ...(notePrompt.relatedKind === "deal"
            ? { dealId: notePrompt.relatedId }
            : { execId: notePrompt.relatedId }),
        }),
      });
    }
    setNotePrompt(null);
    setNoteText("");
    onChanged();
  };

  const snooze = async (task: Task, days: number) => {
    setSnoozeFor(null);
    const base =
      task.dueDate && task.dueDate >= today
        ? new Date(`${task.dueDate}T12:00:00`)
        : new Date();
    base.setDate(base.getDate() + days);
    // Only the date moves — the original time is kept.
    await put(task, { dueDate: ymd(base) });
  };

  const remove = async (task: Task) => {
    if (!window.confirm(`Delete follow-up "${task.title}"?`)) return;
    const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (res.ok) onChanged();
  };

  const startEdit = (task: Task, focusDate: boolean) => {
    setEditing({
      id: task.id,
      title: task.title,
      dueDate: task.dueDate || today,
      dueTime: task.dueTime ?? "",
      type: task.type,
      priority: task.priority,
      notes: task.notes,
      owner: task.owner,
      link: task.relatedKind
        ? `${task.relatedKind === "deal" ? "deal" : "exec"}:${task.relatedId}`
        : "__none__",
    });
    setEditFocusDate(focusDate);
    setSnoozeFor(null);
  };

  const saveEdit = async () => {
    if (!editing || !editing.title.trim()) return;
    const task = tasks.find((t) => t.id === editing.id);
    if (!task) return;
    const ok = await put(task, {
      title: editing.title.trim(),
      dueDate: editing.dueDate,
      dueTime: editing.dueTime || null,
      type: editing.type,
      priority: editing.priority,
      notes: editing.notes,
      owner: editing.owner,
      ...(presetLink ? {} : resolveLink(editing.link)),
    });
    if (ok) setEditing(null);
  };

  /* -------- Grouping: Overdue / Today / This week / Later -------- */
  const byDateTime = (a: Task, b: Task) => {
    const da = a.dueDate || "9999-12-31";
    const db = b.dueDate || "9999-12-31";
    if (da !== db) return da.localeCompare(db);
    // All-day items first, then timed items in order.
    const ta = a.dueTime ?? "";
    const tb = b.dueTime ?? "";
    if (ta !== tb) return ta.localeCompare(tb);
    return a.createdAt.localeCompare(b.createdAt);
  };
  const open = tasks.filter((t) => !t.done);
  const doneList = tasks
    .filter((t) => t.done)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""));
  const weekEnd = addDays(today, 7);
  const groups: { key: string; label: string; red?: boolean; items: Task[] }[] = [
    {
      key: "overdue",
      label: "Overdue",
      red: true,
      items: open.filter((t) => t.dueDate && t.dueDate < today).sort(byDateTime),
    },
    {
      key: "today",
      label: "Today",
      items: open.filter((t) => t.dueDate === today).sort(byDateTime),
    },
    {
      key: "week",
      label: "This week",
      items: open
        .filter((t) => t.dueDate && t.dueDate > today && t.dueDate <= weekEnd)
        .sort(byDateTime),
    },
    {
      key: "later",
      label: "Later",
      items: open.filter((t) => !t.dueDate || t.dueDate > weekEnd).sort(byDateTime),
    },
  ];

  const chips = [
    { label: "Today", days: 0 },
    { label: "Tomorrow", days: 1 },
    { label: "Next week", days: 7 },
    { label: "In 2 weeks", days: 14 },
  ];

  return (
    <div>
      {/* Add form */}
      <div className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/10 dark:bg-[#0d1f3c]">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addTask()}
          placeholder="Add a follow-up… e.g. Call the broker re: Harbor Foods"
          className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#b8975a] focus:ring-1 focus:ring-[#b8975a] dark:border-white/15 dark:bg-[#132847] dark:text-[#e8dfc8] dark:placeholder:text-white/30"
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={`${inputCls} min-w-0`}
            aria-label="Due date"
          />
          <input
            type="time"
            value={dueTime}
            onChange={(e) => setDueTime(e.target.value)}
            className={`${inputCls} min-w-0`}
            aria-label="Due time (optional — blank is all-day)"
            title="Optional — leave blank for all-day"
          />
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className={`${inputCls} min-w-0`}
          >
            <option value="">Anyone</option>
            {PARTNER_NAMES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          {!presetLink && (
            <select
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className={`${inputCls} w-full basis-full sm:w-[220px] sm:basis-auto sm:flex-none`}
            >
              <option value="__none__">No linked account</option>
              <optgroup label="Acquisition targets">
                {deals.map((d) => (
                  <option key={d.id} value={`deal:${d.id}`}>
                    {d.companyName}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Executives">
                {execs.map((e) => (
                  <option key={e.id} value={`exec:${e.id}`}>
                    {e.name}
                  </option>
                ))}
              </optgroup>
            </select>
          )}
          <button
            onClick={addTask}
            disabled={busy || !title.trim()}
            className="rounded-lg bg-[#0d1f3c] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
          >
            Add
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => setDueDate(addDays(phxToday(), c.days))}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                dueDate === addDays(phxToday(), c.days)
                  ? "border-[#b8975a] bg-[#b8975a]/15 text-[#8a6f3c] dark:text-[#d4b37a]"
                  : "border-slate-300 text-slate-500 hover:border-[#b8975a] hover:text-[#8a6f3c] dark:border-white/15 dark:text-white/50 dark:hover:text-[#d4b37a]"
              }`}
            >
              {c.label}
            </button>
          ))}
          <span className="mx-1 hidden h-4 w-px bg-slate-300 dark:bg-white/15 sm:block" />
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value as TaskType)}
            className={inputCls}
            aria-label="Type"
          >
            {TASK_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_ICONS[t]} {t}
              </option>
            ))}
          </select>
          <div
            className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-white/15"
            role="group"
            aria-label="Priority"
          >
            {(["normal", "high"] as TaskPriority[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`px-2 py-1.5 text-[11px] font-semibold transition ${
                  priority === p
                    ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                    : "bg-white text-slate-500 hover:text-slate-700 dark:bg-[#132847] dark:text-white/50"
                }`}
              >
                {p === "normal" ? "Normal" : "⚑ High"}
              </button>
            ))}
          </div>
        </div>
        {notesOpen ? (
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            autoFocus
            placeholder="Notes (optional) — context, talking points, what “done” looks like…"
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#b8975a] focus:ring-1 focus:ring-[#b8975a] dark:border-white/15 dark:bg-[#132847] dark:text-[#e8dfc8] dark:placeholder:text-white/30"
          />
        ) : (
          <button
            type="button"
            onClick={() => setNotesOpen(true)}
            className="self-start text-xs font-medium text-slate-400 transition hover:text-[#8a6f3c] dark:text-white/35 dark:hover:text-[#d4b37a]"
          >
            ＋ Add a note
          </button>
        )}
      </div>

      {/* Grouped list */}
      {tasks.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400 dark:text-white/40">
          No follow-ups. Add one above so nothing slips.
        </p>
      ) : (
        <div>
          {groups
            .filter((g) => g.items.length > 0)
            .map((g) => (
              <div key={g.key} className="mb-2">
                <h4
                  className={`flex items-center gap-2 pt-2 text-[11px] font-bold uppercase tracking-wider ${
                    g.red
                      ? "text-red-600 dark:text-red-400"
                      : "text-slate-500 dark:text-white/50"
                  }`}
                >
                  {g.label}
                  <span
                    className={`rounded-full px-1.5 py-px text-[10px] font-bold ${
                      g.red
                        ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
                        : "bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/60"
                    }`}
                  >
                    {g.items.length}
                  </span>
                </h4>
                <ul className="divide-y divide-slate-100 dark:divide-white/10">
                  {g.items.map((t) => {
                    const overdueDays =
                      t.dueDate && t.dueDate < today ? diffDays(t.dueDate, today) : 0;
                    const expanded = expandedId === t.id;
                    return (
                      <li key={t.id} className="py-2.5">
                        <div className="flex items-start gap-3">
                          <button
                            onClick={() => toggle(t)}
                            aria-label="Complete"
                            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-slate-300 transition hover:border-[#b8975a] dark:border-white/25"
                          />
                          <span className="mt-0.5 shrink-0 text-sm" title={t.type}>
                            {TYPE_ICONS[t.type]}
                          </span>
                          <div
                            className="min-w-0 flex-1 cursor-pointer"
                            onClick={() => setExpandedId(expanded ? null : t.id)}
                          >
                            <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-900 dark:text-white">
                              <span className="min-w-0">{t.title}</span>
                              {t.priority === "high" && (
                                <span className="rounded-full bg-[#b8975a]/20 px-1.5 py-px text-[10px] font-bold text-[#8a6f3c] dark:text-[#d4b37a]">
                                  ⚑ HIGH
                                </span>
                              )}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span
                                className={`text-[11px] font-medium ${
                                  g.red
                                    ? "text-red-600 dark:text-red-400"
                                    : "text-slate-500 dark:text-[#c8bfa8]"
                                }`}
                              >
                                {t.dueDate
                                  ? `${fmtDateLabel(t.dueDate)} · ${
                                      t.dueTime ? fmtTimeLabel(t.dueTime) : "All day"
                                    }`
                                  : "No date"}
                                {overdueDays > 0 &&
                                  ` — ${overdueDays} day${overdueDays === 1 ? "" : "s"} overdue`}
                              </span>
                              {t.owner && (
                                <span className="text-[11px] text-slate-500 dark:text-[#c8bfa8]">
                                  · {t.owner}
                                </span>
                              )}
                              {t.relatedName && t.relatedKind === "deal" && t.relatedId && (
                                <Link
                                  href={`/deals/${t.relatedId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] font-medium text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                                >
                                  {t.relatedName}
                                </Link>
                              )}
                              {t.relatedName && t.relatedKind === "executive" && (
                                <Link
                                  href={`/directory?q=${encodeURIComponent(t.relatedName)}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-[11px] font-medium text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                                >
                                  {t.relatedName}
                                </Link>
                              )}
                              {t.notes && (
                                <span className="text-[11px] text-slate-400 dark:text-white/35">
                                  {expanded ? "▾ notes" : "▸ notes"}
                                </span>
                              )}
                            </div>
                            {expanded && (
                              <div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600 dark:bg-white/[0.04] dark:text-white/70">
                                {t.notes || "No notes on this follow-up."}
                              </div>
                            )}
                          </div>
                          <div className="relative flex shrink-0 items-center gap-1">
                            <button
                              onClick={() => setSnoozeFor(snoozeFor === t.id ? null : t.id)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                              title="Snooze"
                            >
                              💤 ▾
                            </button>
                            {snoozeFor === t.id && (
                              <div className="absolute right-0 top-7 z-20 w-32 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-white/15 dark:bg-[#132847]">
                                {[
                                  { label: "1 day", days: 1 },
                                  { label: "3 days", days: 3 },
                                  { label: "1 week", days: 7 },
                                ].map((opt) => (
                                  <button
                                    key={opt.label}
                                    onClick={() => snooze(t, opt.days)}
                                    className="block w-full px-3 py-1.5 text-left text-xs text-slate-600 transition hover:bg-slate-50 hover:text-slate-900 dark:text-white/70 dark:hover:bg-white/5 dark:hover:text-white"
                                  >
                                    Snooze {opt.label}
                                  </button>
                                ))}
                              </div>
                            )}
                            <button
                              onClick={() => startEdit(t, true)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                              title="Reschedule — pick a new date and time"
                            >
                              📅
                            </button>
                            <button
                              onClick={() => startEdit(t, false)}
                              className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                              title="Edit"
                            >
                              ✎
                            </button>
                            <button
                              onClick={() => remove(t)}
                              className="rounded px-1.5 py-0.5 text-xs text-slate-300 transition hover:bg-red-50 hover:text-red-600 dark:text-white/25 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                              aria-label="Delete"
                            >
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* Inline editor (Edit + Reschedule share it) */}
                        {editing && editing.id === t.id && (
                          <div className="ml-8 mt-2 flex flex-col gap-2 rounded-xl border border-[#b8975a]/40 bg-slate-50 p-3 dark:border-[#b8975a]/30 dark:bg-[#0d1f3c]">
                            <input
                              value={editing.title}
                              onChange={(e) =>
                                setEditing({ ...editing, title: e.target.value })
                              }
                              onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                              autoFocus={!editFocusDate}
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#b8975a] focus:ring-1 focus:ring-[#b8975a] dark:border-white/15 dark:bg-[#132847] dark:text-[#e8dfc8]"
                              placeholder="Follow-up title"
                            />
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="date"
                                value={editing.dueDate}
                                autoFocus={editFocusDate}
                                onChange={(e) =>
                                  setEditing({ ...editing, dueDate: e.target.value })
                                }
                                className={`${inputCls} min-w-0`}
                                aria-label="Due date"
                              />
                              <input
                                type="time"
                                value={editing.dueTime}
                                onChange={(e) =>
                                  setEditing({ ...editing, dueTime: e.target.value })
                                }
                                className={`${inputCls} min-w-0`}
                                aria-label="Due time (blank = all-day)"
                                title="Blank = all-day"
                              />
                              <select
                                value={editing.type}
                                onChange={(e) =>
                                  setEditing({
                                    ...editing,
                                    type: e.target.value as TaskType,
                                  })
                                }
                                className={inputCls}
                                aria-label="Type"
                              >
                                {TASK_TYPES.map((tt) => (
                                  <option key={tt} value={tt}>
                                    {TYPE_ICONS[tt]} {tt}
                                  </option>
                                ))}
                              </select>
                              <div
                                className="flex overflow-hidden rounded-lg border border-slate-300 dark:border-white/15"
                                role="group"
                                aria-label="Priority"
                              >
                                {(["normal", "high"] as TaskPriority[]).map((p) => (
                                  <button
                                    key={p}
                                    type="button"
                                    onClick={() => setEditing({ ...editing, priority: p })}
                                    className={`px-2 py-1.5 text-[11px] font-semibold transition ${
                                      editing.priority === p
                                        ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                                        : "bg-white text-slate-500 hover:text-slate-700 dark:bg-[#132847] dark:text-white/50"
                                    }`}
                                  >
                                    {p === "normal" ? "Normal" : "⚑ High"}
                                  </button>
                                ))}
                              </div>
                              <select
                                value={editing.owner}
                                onChange={(e) =>
                                  setEditing({ ...editing, owner: e.target.value })
                                }
                                className={`${inputCls} min-w-0`}
                              >
                                <option value="">Anyone</option>
                                {PARTNER_NAMES.map((p) => (
                                  <option key={p} value={p}>
                                    {p}
                                  </option>
                                ))}
                              </select>
                              {!presetLink && (
                                <select
                                  value={editing.link}
                                  onChange={(e) =>
                                    setEditing({ ...editing, link: e.target.value })
                                  }
                                  className={`${inputCls} w-full basis-full sm:w-[220px] sm:basis-auto sm:flex-none`}
                                >
                                  <option value="__none__">No linked account</option>
                                  <optgroup label="Acquisition targets">
                                    {deals.map((d) => (
                                      <option key={d.id} value={`deal:${d.id}`}>
                                        {d.companyName}
                                      </option>
                                    ))}
                                  </optgroup>
                                  <optgroup label="Executives">
                                    {execs.map((e) => (
                                      <option key={e.id} value={`exec:${e.id}`}>
                                        {e.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                </select>
                              )}
                            </div>
                            <textarea
                              value={editing.notes}
                              onChange={(e) =>
                                setEditing({ ...editing, notes: e.target.value })
                              }
                              rows={2}
                              placeholder="Notes (optional)"
                              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#b8975a] focus:ring-1 focus:ring-[#b8975a] dark:border-white/15 dark:bg-[#132847] dark:text-[#e8dfc8] dark:placeholder:text-white/30"
                            />
                            <div className="flex items-center gap-2">
                              <button
                                onClick={saveEdit}
                                disabled={!editing.title.trim()}
                                className="rounded-lg bg-[#0d1f3c] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1a3455] disabled:opacity-50 dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
                              >
                                Save
                              </button>
                              <button
                                onClick={() => setEditing(null)}
                                className="rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-white/50 dark:hover:bg-white/10 dark:hover:text-white"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

          {/* Completed — collapsed by default */}
          {doneList.length > 0 && (
            <div className="mt-2 border-t border-slate-100 pt-2 dark:border-white/10">
              <button
                onClick={() => setCompletedOpen(!completedOpen)}
                className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-500 transition hover:text-slate-700 dark:text-white/50 dark:hover:text-white/80"
              >
                {completedOpen ? "▾" : "▸"} Completed
                <span className="rounded-full bg-slate-100 px-1.5 py-px text-[10px] font-bold text-slate-500 dark:bg-white/10 dark:text-white/60">
                  {doneList.length}
                </span>
              </button>

              {notePrompt && (
                <div className="mt-2 rounded-xl border border-[#b8975a]/40 bg-[#b8975a]/[0.07] p-3 dark:border-[#b8975a]/30">
                  <p className="text-xs font-semibold text-slate-700 dark:text-white/80">
                    Log a note on {notePrompt.relatedName || "the linked account"} about
                    “{notePrompt.title}”?
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input
                      value={noteText}
                      onChange={(e) => setNoteText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveNote()}
                      placeholder="e.g. Spoke with the broker — sending the CIM Friday"
                      className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 outline-none focus:border-[#b8975a] focus:ring-1 focus:ring-[#b8975a] dark:border-white/15 dark:bg-[#132847] dark:text-[#e8dfc8] dark:placeholder:text-white/30"
                    />
                    <button
                      onClick={saveNote}
                      className="rounded-lg bg-[#0d1f3c] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1a3455] dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
                    >
                      Save note
                    </button>
                    <button
                      onClick={() => setNotePrompt(null)}
                      className="rounded-lg px-2 py-1.5 text-xs font-semibold text-slate-500 transition hover:text-slate-700 dark:text-white/50 dark:hover:text-white"
                    >
                      Skip
                    </button>
                  </div>
                </div>
              )}

              {completedOpen && (
                <ul className="divide-y divide-slate-100 dark:divide-white/10">
                  {doneList.map((t) => (
                    <li key={t.id} className="flex items-start gap-3 py-2.5">
                      <button
                        onClick={() => toggle(t)}
                        aria-label="Reopen"
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-[#b8975a] bg-[#b8975a] text-white transition"
                      >
                        <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                          <path
                            d="M2.5 6.2 4.8 8.5 9.5 3.5"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                      <span className="mt-0.5 shrink-0 text-sm" title={t.type}>
                        {TYPE_ICONS[t.type]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-400 line-through dark:text-white/35">
                          {t.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-400 dark:text-white/35">
                          {t.completedAt
                            ? `Done ${new Date(t.completedAt).toLocaleDateString("en-US", {
                                month: "short",
                                day: "numeric",
                                timeZone: "America/Phoenix",
                              })}`
                            : "Done"}
                          {t.relatedName ? ` · ${t.relatedName}` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => remove(t)}
                        className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-300 transition hover:bg-red-50 hover:text-red-600 dark:text-white/25 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                        aria-label="Delete"
                      >
                        ✕
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
