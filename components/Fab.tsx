"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * Floating quick-action button (CRM Phase 2). Expands to the four
 * create flows; each navigates to the page that owns the flow with a
 * query param the page can consume:
 *   Add deal      → /pipeline?new=deal
 *   Add contact   → /directory?new=contact
 *   Add follow-up → /overview?newtask=1   (Overview consumes this one)
 *   Log touch     → /directory?touch=1
 * Sits above the mobile tab bar (and the home-bar safe area) on phones.
 */

const ACTIONS: { label: string; href: string; icon: React.ReactNode }[] = [
  {
    label: "Add deal",
    href: "/pipeline?new=deal",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h10" />
      </svg>
    ),
  },
  {
    label: "Add contact",
    href: "/directory?new=contact",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1m18 0v-1a4 4 0 0 0-3-3.85M15 3.85a4 4 0 0 1 0 7.3M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
      </svg>
    ),
  },
  {
    label: "Add follow-up",
    href: "/overview?newtask=1",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      </svg>
    ),
  },
  {
    label: "Log touch",
    href: "/directory?touch=1",
    icon: (
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.6 20.1a2 2 0 0 1-1.5-.7l-3.9-4a2 2 0 0 1 1.4-3.4h.6V6.1a2 2 0 1 1 4 0V10l.6-4.6a2 2 0 1 1 3.9.5l.4 3.3.8-2.9a2 2 0 1 1 3.9 1l-1.9 7.3a6 6 0 0 1-5.8 4.5l-2.5-.1Z" />
      </svg>
    ),
  },
];

export default function Fab() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  if (pathname === "/login" || pathname === "/offline") return null;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  return (
    <>
      {open && (
        <button
          aria-label="Close quick actions"
          className="fixed inset-0 z-40 h-full w-full cursor-default bg-black/30"
          onClick={() => setOpen(false)}
        />
      )}
      <div className="fixed bottom-[calc(5.25rem+env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-2 md:bottom-6 md:right-6">
        {open &&
          ACTIONS.map((a) => (
            <button
              key={a.label}
              onClick={() => go(a.href)}
              className="flex min-h-[44px] items-center gap-2.5 rounded-full bg-white py-2.5 pl-4 pr-5 text-sm font-semibold text-[#0d1f3c] shadow-xl transition hover:bg-slate-50 dark:bg-[#1a3358] dark:text-white dark:hover:bg-[#24436f]"
            >
              <span className="text-[#b8975a]">{a.icon}</span>
              {a.label}
            </button>
          ))}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close quick actions" : "Quick actions"}
          aria-expanded={open}
          className="flex h-14 w-14 items-center justify-center rounded-full bg-[#b8975a] text-[#0d1f3c] shadow-2xl transition hover:bg-[#d4b37a]"
        >
          <svg
            viewBox="0 0 24 24"
            className={`h-7 w-7 transition-transform duration-200 ${open ? "rotate-45" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
          >
            <path strokeLinecap="round" d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </>
  );
}
