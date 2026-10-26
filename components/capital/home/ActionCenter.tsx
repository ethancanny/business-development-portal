"use client";

/**
 * Action Center (Step 1 redesign) — one list from
 * GET /api/platform/capital/actions: stale touches, unsigned
 * documents, unfunded commitments, upcoming closings / calls, and
 * raises behind target, sorted as the endpoint returns them. Each
 * row links to its source.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { CardSkeleton, EmptyState, ErrorState } from "@/components/ui";
import { API, api, fmtDateShort } from "@/components/capital/types";
import { relDate } from "./shared";

interface ActionItem {
  kind: string;
  severity: "amber" | "red" | "info";
  title: string;
  detail: string;
  href: string;
  date: string | null;
}

const DOT: Record<ActionItem["severity"], string> = {
  red: "bg-red-500",
  amber: "bg-amber-500",
  info: "bg-sky-500",
};

export default function ActionCenter({ typeKey }: { typeKey: string }) {
  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(false);
    try {
      const d = await api<{ items: ActionItem[] }>(
        `${API}/actions?type=${encodeURIComponent(typeKey)}`
      );
      setItems(Array.isArray(d.items) ? d.items : []);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeKey]);

  if (loading && items.length === 0) return <CardSkeleton lines={4} />;
  if (error) return <ErrorState onRetry={() => void load()} />;
  if (items.length === 0) {
    return (
      <EmptyState title="Nothing needs action." message="Stale touches, unsigned documents, unfunded commitments and upcoming closings will appear here." />
    );
  }

  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:divide-white/5 dark:border-white/10 dark:bg-[#132847]/60">
      {items.map((item, i) => (
        <li key={`${item.kind}-${item.href}-${i}`}>
          <Link
            href={item.href || "#action-center"}
            className="flex min-h-[44px] items-start gap-3 px-5 py-3.5 hover:bg-slate-50/70 dark:hover:bg-white/5"
          >
            <span
              aria-hidden
              className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[item.severity] ?? DOT.info}`}
            />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium text-[#0d1f3c] dark:text-white">
                {item.title}
              </span>
              {item.detail && (
                <span className="mt-0.5 block text-sm text-slate-500 dark:text-white/50">
                  {item.detail}
                </span>
              )}
            </span>
            {item.date && (
              <span className="shrink-0 text-right text-xs text-slate-400 dark:text-white/40">
                {fmtDateShort(item.date)}
                <span className="block">{relDate(item.date)}</span>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
