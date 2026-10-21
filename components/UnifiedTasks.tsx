"use client";

/**
 * Unified tasks view (Phase 2, workstream D): a self-fetching read
 * model over GET /api/platform/tasks — legacy follow-up tasks with
 * assignee, due date, priority, status, calendar presence, and a
 * link to the linked company/person record resolved through core.
 *
 * NOT mounted yet by design (coordinator mounts it, likely on
 * Overview under PlatformOverview or the Business Development hub):
 *   import UnifiedTasks from "@/components/UnifiedTasks";
 *   <UnifiedTasks />            // no props — self-fetching
 * Fetched once on mount — no polling. Tables collapse to cards on
 * small screens via stacked rows (375px-safe).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { fmtDate } from "@/lib/format";

interface UnifiedTaskItem {
  id: string;
  title: string;
  dueAt: string;
  type: string;
  priority: string;
  status: "open" | "completed";
  assignee: string;
  linked: {
    kind: string;
    id: string;
    label: string;
    href: string;
  } | null;
  onCalendar: boolean;
}

export default function UnifiedTasks() {
  const [items, setItems] = useState<UnifiedTaskItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform/tasks");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { items?: UnifiedTaskItem[] };
        if (!cancelled) {
          setItems(Array.isArray(data.items) ? data.items : []);
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed) {
    return <p className="text-sm text-caption">Tasks could not be loaded.</p>;
  }
  if (items === null) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="skel h-12" />
        <div className="skel h-12" />
        <div className="skel h-12" />
        <span className="sr-only">Loading tasks…</span>
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="text-sm text-caption">No tasks yet.</p>;
  }

  const open = items.filter((t) => t.status === "open");
  const done = items.filter((t) => t.status === "completed");
  const ordered = [...open, ...done];

  return (
    <ul className="divide-y divide-slate-100 dark:divide-white/5">
      {ordered.map((t) => (
        <li
          key={t.id}
          className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-3 first:pt-0 last:pb-0"
        >
          <span
            aria-hidden
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${
              t.status === "completed"
                ? "bg-green-500/15 text-green-700 ring-green-500/40 dark:text-green-300"
                : "text-transparent ring-slate-300 dark:ring-white/25"
            }`}
          >
            ✓
          </span>
          <span
            className={`min-w-0 flex-1 basis-40 text-sm font-medium text-slate-800 dark:text-white/90 ${
              t.status === "completed" ? "text-caption line-through" : ""
            }`}
          >
            {t.title}
            {t.onCalendar && (
              <span
                className="badge badge-neutral ml-2 align-middle"
                title="Mirrored to the calendar"
              >
                📅 On calendar
              </span>
            )}
          </span>
          {t.priority === "high" && (
            <span className="badge badge-danger shrink-0">High</span>
          )}
          {t.type && <span className="badge badge-neutral shrink-0">{t.type}</span>}
          <span className="w-full text-xs text-caption sm:w-auto sm:text-right">
            {t.linked ? (
              <>
                {"Linked: "}
                <Link
                  href={t.linked.href}
                  className="font-semibold text-slate-700 hover:text-gold-700 dark:text-white/80 dark:hover:text-gold-400"
                >
                  {t.linked.label}
                </Link>
                {" · "}
              </>
            ) : null}
            {t.assignee ? `Assignee: ${t.assignee} · ` : ""}
            {t.dueAt ? `Due ${fmtDate(t.dueAt)}` : "No due date"}
            {` · ${t.status === "completed" ? "Completed" : "Open"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
