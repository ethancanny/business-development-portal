"use client";

/**
 * Platform activity feed (Phase 2, workstream D): renders
 * core.activity_log rows from GET /api/platform/activity as an
 * icon-dot timeline. With entityKind/entityId it is the per-record
 * feed; without them it is the global feed (used by the notification
 * center's Activity tab). Fetched once on mount — no polling.
 */

import { useEffect, useState } from "react";
import { fmtRelTime } from "@/lib/format";

export interface ActivityItem {
  id: string;
  entityKind: string;
  entityId: string;
  actor: string;
  kind: string;
  message: string;
  source: string;
  createdAt: string;
}

const KIND_DOT: Record<string, string> = {
  comment: "bg-[#b8975a]",
  deal_stage_changed: "bg-sky-500",
  deal_closed: "bg-green-500",
  document_uploaded: "bg-violet-500",
  contact_updated: "bg-teal-500",
};

export default function ActivityFeed({
  entityKind,
  entityId,
  limit = 25,
}: {
  entityKind?: string;
  entityId?: string;
  limit?: number;
}) {
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams();
        if (entityKind) params.set("entityKind", entityKind);
        if (entityId) params.set("entityId", entityId);
        params.set("limit", String(limit));
        const res = await fetch(`/api/platform/activity?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { items?: ActivityItem[] };
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
  }, [entityKind, entityId, limit]);

  if (failed) {
    return <p className="text-sm text-caption">Activity could not be loaded.</p>;
  }
  if (items === null) {
    return (
      <div className="space-y-3" aria-busy="true">
        <div className="skel h-10" />
        <div className="skel h-10" />
        <span className="sr-only">Loading activity…</span>
      </div>
    );
  }
  if (items.length === 0) {
    return <p className="text-sm text-caption">No activity recorded yet.</p>;
  }

  return (
    <ol className="relative space-y-4 border-l border-slate-200 pl-4 dark:border-white/10">
      {items.map((it) => (
        <li key={it.id} className="relative">
          <span
            aria-hidden
            className={`absolute -left-[1.3rem] top-1.5 h-2 w-2 rounded-full ${
              KIND_DOT[it.kind] ?? "bg-slate-400"
            }`}
          />
          <p className="text-sm leading-snug text-slate-800 dark:text-white/90">
            {it.message}
          </p>
          <p className="mt-0.5 text-xs text-caption">
            {[it.actor, it.createdAt ? fmtRelTime(it.createdAt) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </li>
      ))}
    </ol>
  );
}
