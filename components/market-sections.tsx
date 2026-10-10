"use client";

import { useState, type ReactNode } from "react";
import type { MiAcquisition } from "@/lib/types";
import { fmtDate } from "@/lib/format";

/** Section primitives for Market Intel, extracted from the page file
 * (Oct 9, 2026) to keep page.tsx under the GitHub push channel's size cap.
 * Behavior is unchanged: collapsible Section/SubSection with the light
 * open-header tint, the always-open FullSection showcase wrapper, and the
 * major-events highlight strip. */

/** Stored rows ingested before RSS entity decoding may contain &amp; etc. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, " ");
}

/** Collapsible section: charts summarize, source data lives inside. */
export function Section({
  title,
  sub,
  alt = false,
  defaultOpen = false,
  children,
}: {
  title: string;
  sub?: string;
  alt?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mb-6">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`-mx-2 flex w-full items-center justify-between gap-3 rounded-lg border-b-2 px-2 pb-2 text-left transition-colors duration-200 ${
          open
            ? "border-[#b8975a] bg-[#e6edf6] dark:bg-white/[0.07]"
            : "border-[#b8975a]/50 hover:bg-[#f0f4fa] dark:hover:bg-white/[0.05]"
        }`}
      >
        <span>
          <span className="block text-lg font-bold text-[#0d1f3c] dark:text-white">{title}</span>
          {sub && <span className="block text-xs text-slate-500 dark:text-white/40">{sub}</span>}
        </span>
        <span className="text-xl leading-none text-[#8a6f3c] dark:text-[#d4b37a]">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="pt-4 [&>*:first-child]:border-t-0 [&>*:first-child]:pt-0">
          {children}
        </div>
      )}
    </section>
  );
}

/** Collapsible subsection, nested inside a Section. */
export function SubSection({
  title,
  alt = false,
  defaultOpen = false,
  children,
}: {
  title: string;
  alt?: boolean;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-5 border-t-2 border-slate-400 pt-4 dark:border-white/30">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`-mx-2 flex w-full items-center justify-between gap-3 rounded-lg px-2 pb-1.5 text-left transition-colors duration-200 ${
          open
            ? "bg-[#e6edf6] dark:bg-white/[0.07]"
            : "hover:bg-[#f0f4fa] dark:hover:bg-white/[0.05]"
        }`}
      >
        <span className="text-base font-bold text-[#0d1f3c] dark:text-white">{title}</span>
        <span className="text-lg leading-none text-[#8a6f3c] dark:text-[#d4b37a]">{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="pt-3">{children}</div>}
    </div>
  );
}

/** Full, always-open section (no collapse) — used for the page's two
 * showcase areas, Market Multiples and Industries. (Ethan, Oct 9, 2026
 * makeover: multiples + industries are full separate sections, not
 * collapsible; the reference data moved to tabs at the bottom.) */
export function FullSection({
  kicker,
  title,
  sub,
  children,
}: {
  kicker?: string;
  title: string;
  sub?: string;
  children: ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="border-b-2 border-[#b8975a] pb-2">
        {kicker && (
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-[#8a6f3c] dark:text-[#d4b37a]">{kicker}</p>
        )}
        <h2 className="text-xl font-bold text-[#0d1f3c] dark:text-white">{title}</h2>
        {sub && <p className="mt-0.5 text-xs text-slate-500 dark:text-white/40">{sub}</p>}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

/** Compact highlight strip of major events relevant to a section. */
export function EventStrip({
  items,
  onDismiss,
}: {
  items: MiAcquisition[];
  onDismiss: (a: MiAcquisition) => void;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (items.length === 0) return null;
  const typeLabel: Record<string, string> = {
    acquisition: "Acquisition",
    bankruptcy: "Bankruptcy",
    expansion: "Major Expansion",
    investment: "New Investment",
    contract: "Contract Award",
    relocation: "Relocation",
    ipo: "IPO",
    policy: "Market Policy",
  };
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-[#8a6f3c] dark:text-[#d4b37a]">
        ★ Major events
      </p>
      <div className="grid gap-2 md:grid-cols-3">
        {items.map((a) => (
          <div
            key={a.id}
            className="relative rounded-lg border border-[#b8975a]/40 bg-[#b8975a]/5 p-3 dark:bg-[#b8975a]/10"
          >
            <a href={a.sourceUrl || undefined} target="_blank" rel="noreferrer" className="block">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8a6f3c] dark:text-[#d4b37a]">
                {typeLabel[a.eventType] || a.eventType}
                {a.announcedDate ? ` · ${fmtDate(a.announcedDate)}` : ""}
              </p>
              <p className="mt-0.5 pr-4 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                {decodeEntities(a.headline || a.target || a.acquirer || "Unnamed")}
              </p>
              <p className="text-xs text-slate-500 dark:text-white/50">{a.publisher || "News"}</p>
            </a>
            {a.summary && (
              <div className="mt-1.5">
                <button
                  onClick={() => setOpenId(openId === a.id ? null : a.id)}
                  className="text-[11px] font-medium text-[#8a6f3c] underline-offset-2 hover:underline dark:text-[#d4b37a]"
                >
                  {openId === a.id ? "Hide summary ▴" : "Summary ▾"}
                </button>
                {openId === a.id && (
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-white/60">
                    {decodeEntities(a.summary)}
                  </p>
                )}
              </div>
            )}
            <button
              onClick={() => onDismiss(a)}
              aria-label="Dismiss event"
              title="Dismiss"
              className="absolute right-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-xs leading-none text-slate-400 transition hover:bg-black/5 hover:text-slate-700 dark:text-white/40 dark:hover:bg-white/10 dark:hover:text-white"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
