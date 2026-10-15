"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import {
  IconActivity,
  IconAnalytics,
  IconAuditTrail,
  IconCalendar,
  IconClose,
  IconDirectory,
  IconLogOut,
  IconMarketIntel,
  IconMoon,
  IconMore,
  IconOverview,
  IconPipeline,
  IconSettings,
  IconSun,
} from "@/components/icons";

/**
 * Mobile bottom tab bar + "More" sheet (CRM Phase 2; polished Oct 14,
 * 2026 per Ethan's mobile spec §3–§4). Phones only (md:hidden).
 *
 * Tab bar: 64px + home-bar safe area, surface one step lighter than
 * the page (white in day mode, #16305a at night) at 95% opacity with
 * backdrop blur, a muted-gold top border and a soft upward shadow.
 * Active tab is gold with a pill indicator above the icon; inactive
 * labels are slate-600 (day) / #c3cede (night) — both ≥4.5:1 on the
 * bar surface. The bar slides away while the keyboard is open (the
 * `kb-open` class on <html>, driven by a visualViewport heuristic and
 * styled in globals.css).
 *
 * More sheet: sits above the tab bar (the bar stays visible and its
 * More tab reads active), backdrop dims only the area above the bar,
 * and it closes on X, backdrop tap, swipe-down, More-tab toggle,
 * browser back (a pushed history state), and choosing an item.
 * Bottom page clearance is handled by layout's `.page-pad`.
 */

const TABS: {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.ReactNode;
}[] = [
  { href: "/overview", label: "Overview", Icon: IconOverview },
  { href: "/pipeline", label: "Pipeline", Icon: IconPipeline },
  { href: "/activity", label: "Activity", Icon: IconActivity },
  { href: "/market-intel", label: "Market Intel", Icon: IconMarketIntel },
  { href: "/directory", label: "Directory", Icon: IconDirectory },
];

const MORE_LINKS: {
  href: string;
  label: string;
  Icon: (p: { className?: string }) => React.ReactNode;
}[] = [
  { href: "/calendar", label: "Calendar", Icon: IconCalendar },
  { href: "/analytics", label: "Analytics", Icon: IconAnalytics },
  { href: "/audit-trail", label: "Audit Trail", Icon: IconAuditTrail },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const pushedRef = useRef(false);
  const touchYRef = useRef<number | null>(null);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  /* --- hide the bar while the keyboard is open (§3) --- */
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const open =
        window.matchMedia("(max-width: 767px)").matches &&
        vv.height < window.screen.height * 0.75;
      document.documentElement.classList.toggle("kb-open", open);
    };
    vv.addEventListener("resize", onResize);
    onResize();
    return () => {
      vv.removeEventListener("resize", onResize);
      document.documentElement.classList.remove("kb-open");
    };
  }, []);

  /* --- sheet open/close + browser-back handling (§4) --- */
  const openSheet = useCallback(() => {
    setConfirmLogout(false);
    setMoreOpen(true);
    if (!pushedRef.current) {
      try {
        window.history.pushState({ ccpMoreSheet: true }, "");
        pushedRef.current = true;
      } catch {
        /* history unavailable — sheet still works without back-close */
      }
    }
  }, []);

  const closeSheet = useCallback(() => {
    setMoreOpen(false);
    setConfirmLogout(false);
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    const onPop = () => {
      if (pushedRef.current) {
        pushedRef.current = false;
        setMoreOpen(false);
        setConfirmLogout(false);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Navigating (tab tap or sheet item) always leaves the sheet closed.
  useEffect(() => {
    setMoreOpen(false);
    setConfirmLogout(false);
    pushedRef.current = false;
  }, [pathname]);

  if (pathname === "/login" || pathname === "/offline") return null;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  const onSheetItem = () => {
    // Close without history.back(): the Link's own navigation is
    // already in flight and consumes the flow from here.
    pushedRef.current = false;
    setMoreOpen(false);
    setConfirmLogout(false);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    touchYRef.current = e.touches[0].clientY;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (touchYRef.current === null) return;
    if (e.touches[0].clientY - touchYRef.current > 60) {
      touchYRef.current = null;
      closeSheet();
    }
  };

  const rowCls = (active: boolean) =>
    `relative flex h-14 w-full items-center gap-3 px-4 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10 ${
      active
        ? "font-semibold text-[#0d1f3c] dark:text-white"
        : "font-medium text-slate-700 dark:text-[#e8dfc8]"
    }`;

  return (
    <>
      <nav
        aria-label="Primary"
        className="mobile-tabbar pl-safe pr-safe fixed inset-x-0 bottom-0 z-40 border-t border-[#b8975a]/55 bg-white/95 shadow-[0_-4px_16px_rgba(0,0,0,0.12)] backdrop-blur dark:bg-[#16305a]/95 md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex h-16">
          {TABS.map((t) => {
            const active = isActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 ${
                  active ? "text-[#b8975a]" : "text-slate-600 dark:text-[#c3cede]"
                }`}
              >
                {active && (
                  <span className="absolute left-1/2 top-1.5 h-1 w-6 -translate-x-1/2 rounded-full bg-[#b8975a]" />
                )}
                <t.Icon className="h-6 w-6" />
                <span className="text-[11px] font-semibold leading-none">{t.label}</span>
              </Link>
            );
          })}
          <button
            onClick={() => (moreOpen ? closeSheet() : openSheet())}
            aria-label="More"
            aria-expanded={moreOpen}
            className={`relative flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 ${
              moreOpen ? "text-[#b8975a]" : "text-slate-600 dark:text-[#c3cede]"
            }`}
          >
            {moreOpen && (
              <span className="absolute left-1/2 top-1.5 h-1 w-6 -translate-x-1/2 rounded-full bg-[#b8975a]" />
            )}
            <IconMore className="h-6 w-6" />
            <span className="text-[11px] font-semibold leading-none">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div
          className="fixed inset-x-0 top-0 z-50 md:hidden"
          style={{ bottom: "calc(64px + env(safe-area-inset-bottom))" }}
          role="dialog"
          aria-label="More"
        >
          <button
            aria-label="Close menu"
            className="absolute inset-0 h-full w-full bg-black/60"
            onClick={closeSheet}
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl border-t border-black/10 bg-[#f7f4ec] shadow-2xl dark:border-white/10 dark:bg-[#1d3a66]"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-400/60 dark:bg-white/25" />
            <div className="flex items-center justify-between pl-4 pr-2">
              <p className="text-base font-bold text-[#0d1f3c] dark:text-white">More</p>
              <button
                onClick={closeSheet}
                aria-label="Close menu"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-500 transition hover:bg-black/5 hover:text-[#0d1f3c] dark:text-white/60 dark:hover:bg-white/10 dark:hover:text-white"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <div className="px-2 pb-2">
              {MORE_LINKS.map((l) => {
                const active = isActive(l.href);
                return (
                  <Link key={l.href} href={l.href} onClick={onSheetItem} className={rowCls(active)}>
                    {active && (
                      <span className="absolute inset-y-2 left-0 w-1 rounded-full bg-[#b8975a]" />
                    )}
                    <span className={active ? "text-[#b8975a]" : "text-slate-400 dark:text-white/50"}>
                      <l.Icon className="h-5 w-5" />
                    </span>
                    {l.label}
                  </Link>
                );
              })}

              {/* Appearance: Night / Day as a switch with line icons. */}
              <button onClick={toggle} className={rowCls(false)} role="switch" aria-checked={theme === "dark"}>
                <span className="text-slate-400 dark:text-white/50">
                  {theme === "dark" ? <IconMoon className="h-5 w-5" /> : <IconSun className="h-5 w-5" />}
                </span>
                {theme === "dark" ? "Night" : "Day"}
                <span
                  aria-hidden
                  className={`relative ml-auto h-6 w-11 shrink-0 rounded-full transition ${
                    theme === "dark" ? "bg-[#b8975a]" : "bg-slate-300"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      theme === "dark" ? "left-[1.375rem]" : "left-0.5"
                    }`}
                  />
                </span>
              </button>

              <div className="mx-2 my-1.5 border-t border-slate-900/10 dark:border-white/10" />

              {confirmLogout ? (
                <div className="flex h-14 items-center gap-2 px-4">
                  <span className="text-sm font-medium text-slate-700 dark:text-[#e8dfc8]">
                    Log out?
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <button
                      onClick={() => setConfirmLogout(false)}
                      className="min-h-[44px] rounded-lg px-3 text-sm font-medium text-slate-500 transition hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={logout}
                      className="min-h-[44px] rounded-lg bg-red-600 px-3.5 text-sm font-semibold text-white transition hover:bg-red-500"
                    >
                      Log out
                    </button>
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmLogout(true)}
                  className="flex h-14 w-full items-center gap-3 px-4 text-left text-sm font-medium text-red-600 transition hover:bg-red-500/10 dark:text-red-300"
                >
                  <IconLogOut className="h-5 w-5" />
                  Log out
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
