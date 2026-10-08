"use client";

import { useState } from "react";
import Link from "next/link";
import { PARTNER_NAMES, type Deal, type Executive, type Task } from "@/lib/types";

interface TaskListProps {
  tasks: Task[];
  deals: Deal[];
  execs: Executive[];
  onChanged: () => void;
  /** When set, new tasks are pre-linked and the link picker is hidden. */
  presetLink?: { kind: "deal" | "executive"; id: string; name: string } | null;
}

function dueBadge(dueDate: string, done: boolean): React.ReactNode {
  if (!dueDate || done) return null;
  const today = new Date().toISOString().slice(0, 10);
  if (dueDate < today)
    return (
      <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
        Overdue {dueDate}
      </span>
    );
  if (dueDate === today)
    return (
      <span className="rounded-full bg-[#b8975a]/20 px-2 py-0.5 text-[11px] font-semibold text-[#8a6f3c]">
        Due today
      </span>
    );
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/10 dark:text-[#c8bfa8]">
      Due {dueDate}
    </span>
  );
}

export default function TaskList({
  tasks,
  deals,
  execs,
  onChanged,
  presetLink = null,
}: TaskListProps) {
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [owner, setOwner] = useState("");
  const [link, setLink] = useState("__none__");
  const [busy, setBusy] = useState(false);

  const addTask = async () => {
    if (!title.trim() || busy) return;
    setBusy(true);
    let relatedKind: "deal" | "executive" | null = null;
    let relatedId: string | null = null;
    let relatedName = "";
    if (presetLink) {
      relatedKind = presetLink.kind;
      relatedId = presetLink.id;
      relatedName = presetLink.name;
    } else if (link.startsWith("deal:")) {
      relatedKind = "deal";
      relatedId = link.slice(5);
      relatedName = deals.find((d) => d.id === relatedId)?.companyName ?? "";
    } else if (link.startsWith("exec:")) {
      relatedKind = "executive";
      relatedId = link.slice(5);
      relatedName = execs.find((e) => e.id === relatedId)?.name ?? "";
    }
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title.trim(),
        dueDate,
        owner,
        relatedKind,
        relatedId,
        relatedName,
      }),
    });
    setBusy(false);
    if (res.ok) {
      setTitle("");
      setDueDate("");
      setOwner("");
      setLink("__none__");
      onChanged();
    }
  };

  const toggle = async (task: Task) => {
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !task.done }),
    });
    if (res.ok) onChanged();
  };

  const snooze = async (task: Task, days: number) => {
    const base =
      task.dueDate && task.dueDate >= new Date().toISOString().slice(0, 10)
        ? new Date(task.dueDate + "T12:00:00")
        : new Date();
    base.setDate(base.getDate() + days);
    const dueDate = base.toISOString().slice(0, 10);
    await fetch(`/api/tasks/${task.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dueDate }),
    });
    onChanged();
  };

  const remove = async (task: Task) => {
    if (!window.confirm(`Delete follow-up "${task.title}"?`)) return;
    const res = await fetch(`/api/tasks/${task.id}`, { method: "DELETE" });
    if (res.ok) onChanged();
  };

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
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-white/15 dark:bg-[#132847] dark:text-[#e8dfc8]"
          />
          <select
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-white/15 dark:bg-[#132847] dark:text-[#e8dfc8]"
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
              className="max-w-[220px] rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-white/15 dark:bg-[#132847] dark:text-[#e8dfc8]"
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
      </div>

      {/* List */}
      {tasks.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400 dark:text-white/40">
          No follow-ups. Add one above so nothing slips.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 dark:divide-white/10">
          {tasks.map((t) => (
            <li key={t.id} className="flex items-start gap-3 py-2.5">
              <button
                onClick={() => toggle(t)}
                aria-label={t.done ? "Reopen" : "Complete"}
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition ${
                  t.done
                    ? "border-[#b8975a] bg-[#b8975a] text-white"
                    : "border-slate-300 hover:border-[#b8975a] dark:border-white/25"
                }`}
              >
                {t.done && (
                  <svg viewBox="0 0 12 12" className="h-3 w-3" fill="none">
                    <path
                      d="M2.5 6.2 4.8 8.5 9.5 3.5"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                )}
              </button>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-medium ${
                    t.done ? "text-slate-400 line-through dark:text-white/35" : "text-slate-900 dark:text-white"
                  }`}
                >
                  {t.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {dueBadge(t.dueDate, t.done)}
                  {t.owner && (
                    <span className="text-[11px] text-slate-500 dark:text-[#c8bfa8]">{t.owner}</span>
                  )}
                  {t.relatedName && t.relatedKind === "deal" && t.relatedId && (
                    <Link
                      href={`/deals/${t.relatedId}`}
                      className="text-[11px] font-medium text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                    >
                      {t.relatedName}
                    </Link>
                  )}
                  {t.relatedName && t.relatedKind !== "deal" && (
                    <span className="text-[11px] text-slate-500 dark:text-[#c8bfa8]">
                      {t.relatedName}
                    </span>
                  )}
                </div>
              </div>
              {!t.done && (
                <div className="flex shrink-0 items-center gap-1">
                  {[
                    { label: "+1w", days: 7 },
                    { label: "+2w", days: 14 },
                    { label: "+1m", days: 30 },
                  ].map((opt) => (
                    <button
                      key={opt.label}
                      title={`Snooze ${opt.label}`}
                      onClick={() => snooze(t, opt.days)}
                      className="rounded px-1.5 py-0.5 text-[11px] font-semibold text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white/80"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={() => remove(t)}
                className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-300 hover:bg-red-50 hover:text-red-600 dark:text-white/25 dark:hover:bg-red-500/15 dark:hover:text-red-300"
                aria-label="Delete"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
