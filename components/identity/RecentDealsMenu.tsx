"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import CompanyMark from "./CompanyMark";

interface RecentItem {
  companyId: string;
  dealId: string;
  name: string;
  stage: string;
  logoVersion: number;
  codename: string;
}

/**
 * Top-bar "Recent deals" dropdown (Deal Identity System): the last
 * 8 deals the signed-in user opened, most recent first, each with
 * its mark, name (codename beside it — internal surface), and
 * stage. Fetched lazily on first open, then kept for the session.
 */
export default function RecentDealsMenu() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || items !== null) return;
    fetch("/api/platform/identity/recent")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((j) => setItems((j.items ?? []) as RecentItem[]))
      .catch(() => setItems([]));
  }, [open, items]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open ]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-[#0d1f3c] dark:text-white/55 dark:hover:bg-white/5 dark:hover:text-white"
      >
        Recent deals ▾
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Recent deals"
          className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg dark:border-white/10 dark:bg-[#101b30]"
        >
          {items === null && (
            <p className="px-3 py-2.5 text-xs text-caption">Loading…</p>
          )}
          {items !== null && items.length === 0 && (
            <p className="px-3 py-2.5 text-xs text-caption">
              No deals opened yet — they&apos;ll collect here as you work.
            </p>
          )}
          {(items ?? []).map((item) => (
            <Link
              key={item.companyId}
              href={`/companies/${item.companyId}`}
              onClick={() => setOpen(false)}
              className="flex items-center gap-2.5 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <CompanyMark
                companyId={item.companyId}
                name={item.name}
                logoVersion={item.logoVersion}
                size={22}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">
                  {item.name}
                  {item.codename && (
                    <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-gold-700 dark:text-gold-400">
                      {item.codename}
                    </span>
                  )}
                </span>
                {item.stage && (
                  <span className="block text-[11px] text-caption">{item.stage}</span>
                )}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
