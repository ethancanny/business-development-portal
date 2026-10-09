"use client";

import { useEffect, useState } from "react";

type UpdateItem = { kind: string; title: string; detail: string; ts: string };

const KIND: Record<string, { label: string; cls: string }> = {
  business: { label: "New companies", cls: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300" },
  license: { label: "New licenses", cls: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300" },
  listing: { label: "Businesses for sale", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300" },
  acquisition: { label: "Acquisitions", cls: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300" },
  operator: { label: "New operators", cls: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" },
  multiple: { label: "Multiple move", cls: "bg-[#b8975a]/15 text-[#8a6f3e] dark:bg-[#b8975a]/20 dark:text-[#d4b37a]" },
};

/**
 * Update cards — aggregate deltas for the last 7 days only (Ethan,
 * Oct 9, 2026): "+N new companies / licenses / businesses for sale /
 * local acquisitions / operators" and market-multiple moves between
 * vintages. No individual listing or company cards. Self-fetches
 * /api/market/updates; renders nothing when there is nothing new.
 */
export default function UpdatesStrip() {
  const [items, setItems] = useState<UpdateItem[]>([]);
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/market/updates");
        if (r.ok) setItems(await r.json());
      } catch {
        /* the strip simply stays hidden */
      }
    })();
  }, []);
  if (items.length === 0) return null;
  const fmt = (ts: string) => {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  return (
    <div className="mb-6">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-white/50">
        Updates — last 7 days
      </p>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {items.map((u, i) => {
          const k = KIND[u.kind] ?? KIND.business;
          return (
            <div
              key={i}
              className="w-60 shrink-0 rounded-xl border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-[#132847]/60"
            >
              <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${k.cls}`}>
                {k.label}
              </span>
              <p className="mt-2 line-clamp-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">{u.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-white/50">{u.detail}</p>
              <p className="mt-1.5 text-[11px] text-slate-400 dark:text-white/30">{fmt(u.ts)}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
