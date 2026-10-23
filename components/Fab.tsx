"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  IconAddContact,
  IconAddDeal,
  IconFollowUp,
  IconLogTouch,
  IconPlus,
} from "@/components/icons";

/**
 * Floating quick-action button (CRM Phase 2; polished Oct 14, 2026
 * per Ethan's mobile spec §5). 48px. Hides while scrolling down and
 * returns on scroll up (always visible near the top); hidden entirely
 * on Market Intel, Analytics, Audit Trail, and Calendar, and on
 * /login + /offline as before. While it is rendered it flags
 * `fab-visible` on <html> so layout's `.page-pad` adds a FAB-height
 * of extra bottom padding to every page (globals.css), whether or
 * not the button is momentarily scrolled away. Menu order:
 *   Add follow-up → /overview?newtask=1   (Overview consumes this)
 *   Log touch     → /directory?touch=1
 *   Add deal      → /pipeline?new=deal
 *   Add contact   → /directory?new=contact
 * Desktop placement/behavior is unchanged from Phase 2.
 */

const ACTIONS: {
  label: string;
  href: string;
  Icon: (p: { className?: string }) => React.ReactNode;
}[] = [
  { label: "Add follow-up", href: "/overview?newtask=1", Icon: IconFollowUp },
  { label: "Log touch", href: "/directory?touch=1", Icon: IconLogTouch },
  { label: "Add deal", href: "/pipeline?new=deal", Icon: IconAddDeal },
  { label: "Add contact", href: "/directory?new=contact", Icon: IconAddContact },
];

const HIDDEN_ROUTES = ["/market-intel", "/analytics", "/settings/audit-trail", "/calendar"];

export default function Fab() {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [scrollHidden, setScrollHidden] = useState(false);

  const routeHidden =
    pathname === "/login" ||
    pathname === "/offline" ||
    pathname.startsWith("/room/") ||
    pathname === "/my-company" ||
    pathname.startsWith("/my-company/") ||
    HIDDEN_ROUTES.some((r) => pathname === r || pathname.startsWith(r + "/"));

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  /* Escape closes the quick-action menu. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open ]);

  /* Extra page bottom padding while the FAB is on this route. */
  useEffect(() => {
    document.documentElement.classList.toggle("fab-visible", !routeHidden);
    return () => {
      document.documentElement.classList.remove("fab-visible");
    };
  }, [routeHidden]);

  /* Hide on scroll down, show on scroll up / near the top. */
  useEffect(() => {
    if (routeHidden) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 80) setScrollHidden(false);
      else if (y > lastY + 4) setScrollHidden(true);
      else if (y < lastY - 4) setScrollHidden(false);
      lastY = y;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [routeHidden]);

  if (routeHidden) return null;

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const tucked = scrollHidden && !open;

  return (
    <>
      {open && (
        <button
          aria-label="Close quick actions"
          className="fixed inset-0 z-40 h-full w-full cursor-default bg-black/30"
          onClick={() => setOpen(false)}
        />
      )}
      <div
        className={`fab-root fixed bottom-[calc(94px+env(safe-area-inset-bottom))] right-4 z-50 flex flex-col items-end gap-2 md:bottom-6 md:right-6 ${
          tucked ? "pointer-events-none translate-y-24 opacity-0" : ""
        }`}
      >
        {open &&
          ACTIONS.map((a, i) => (
            <button
              key={a.label}
              onClick={() => go(a.href)}
              style={{ transitionDelay: `${i * 35}ms` }}
              className="toast-in flex min-h-[44px] items-center gap-2.5 rounded-full bg-white py-2.5 pl-4 pr-5 text-sm font-semibold text-[#0d1f3c] shadow-pop ring-1 ring-navy-900/[0.06] transition hover:bg-slate-50 active:scale-95 dark:bg-[#1a3358] dark:text-white dark:ring-white/10 dark:hover:bg-[#24436f]"
            >
              <span className="text-[#b8975a]">
                <a.Icon className="h-5 w-5" />
              </span>
              {a.label}
            </button>
          ))}
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close quick actions" : "Quick actions"}
          aria-expanded={open}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-gold-gradient text-[#0d1f3c] shadow-fab transition duration-200 hover:brightness-105 active:scale-95"
        >
          <span className={`block transition-transform duration-200 ${open ? "rotate-45" : ""}`}>
            <IconPlus className="h-6 w-6" />
          </span>
        </button>
      </div>
    </>
  );
}
