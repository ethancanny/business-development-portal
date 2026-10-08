"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActivityEvent, ActivityType } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import PageHero from "@/components/PageHero";

const TYPE_STYLE: Record<ActivityType, { dot: string; label: string }> = {
  "deal.created": { dot: "bg-[#0d1f3c]", label: "New target" },
  "deal.updated": { dot: "bg-slate-400", label: "Updated" },
  "deal.stage": { dot: "bg-[#b8975a]", label: "Stage move" },
  "deal.claim": { dot: "bg-emerald-600", label: "Claim" },
  "deal.operators": { dot: "bg-violet-500", label: "Pairing" },
  "deal.deleted": { dot: "bg-red-500", label: "Removed" },
  "deal.contact": { dot: "bg-sky-500", label: "Contact" },
  "deal.interaction": { dot: "bg-indigo-500", label: "Touch" },
  "deal.attachment": { dot: "bg-amber-500", label: "File" },
  "flow.created": { dot: "bg-teal-500", label: "Deal flow" },
  "flow.converted": { dot: "bg-teal-700", label: "Converted" },
  "exec.created": { dot: "bg-[#0d1f3c]", label: "New candidate" },
  "exec.updated": { dot: "bg-slate-400", label: "Updated" },
  "exec.stage": { dot: "bg-[#b8975a]", label: "Stage move" },
  "exec.claim": { dot: "bg-emerald-600", label: "Claim" },
  "exec.deleted": { dot: "bg-red-500", label: "Removed" },
  "task.created": { dot: "bg-sky-500", label: "Follow-up" },
  "task.completed": { dot: "bg-emerald-500", label: "Done" },
  "task.reopened": { dot: "bg-amber-500", label: "Reopened" },
  "task.deleted": { dot: "bg-red-400", label: "Removed" },
};

type Filter = "all" | "deals" | "execs" | "tasks";

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return fmtDate(iso);
}

export default function AuditTrailPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    fetch("/api/activity?limit=200")
      .then((r) => {
        if (r.status === 401) {
          router.replace("/login");
          return null;
        }
        return r.json();
      })
      .then((d) => {
        if (d) setEvents(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    const prefix = filter === "deals" ? "deal." : filter === "execs" ? "exec." : "task.";
    return events.filter((e) => e.type.startsWith(prefix));
  }, [events, filter]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-white/50">Loading activity…</p>
      </div>
    );
  }

  const filters: { key: Filter; label: string }[] = [
    { key: "all", label: "Everything" },
    { key: "deals", label: "Acquisitions" },
    { key: "execs", label: "Executives" },
    { key: "tasks", label: "Follow-ups" },
  ];

  return (
    <>
      <PageHero
        eyebrow="Canny Capital Partners"
        title="Audit Trail"
        subtitle="Everything happening across the pipeline, newest first."
      />
      <main className="mx-auto max-w-[860px] px-4 py-6 sm:px-6">

      <div className="mb-5 flex gap-2">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              filter === f.key
                ? "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]"
                : "bg-white text-slate-600 ring-1 ring-slate-200 hover:ring-slate-300 dark:bg-white/10 dark:text-[#c8bfa8] dark:ring-white/10 dark:hover:bg-white/15"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-white/10 dark:bg-[#132847]">
          <p className="text-sm text-slate-400 dark:text-white/40">
            No activity yet. Add a deal, move a stage, or create a follow-up and
            it will show up here.
          </p>
        </div>
      ) : (
        <ol className="relative space-y-1 border-l-2 border-slate-200 pl-0 dark:border-white/10">
          {filtered.map((e) => {
            const style = TYPE_STYLE[e.type];
            return (
              <li key={e.id} className="relative pl-8 pb-5">
                <span
                  className={`absolute left-[-7px] top-1 h-3 w-3 rounded-full ring-2 ring-white ${style.dot}`}
                />
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-white/10 dark:bg-[#132847]">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-sm text-slate-800 dark:text-[#e8dfc8]">{e.message}</p>
                    <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-white/10 dark:text-[#c8bfa8]">
                      {style.label}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-center gap-3 text-xs text-slate-400 dark:text-white/40">
                    <span>{timeAgo(e.createdAt)}</span>
                    {e.dealId && (
                      <Link
                        href={`/deals/${e.dealId}`}
                        className="font-medium text-[#8a6f3c] hover:underline dark:text-[#d4b37a]"
                      >
                        Open account →
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      </main>
    </>
  );
}
