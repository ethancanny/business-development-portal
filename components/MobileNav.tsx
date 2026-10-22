"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import {
  IconActivity,
  IconActivityFilled,
  IconAuditTrail,
  IconCalendar,
  IconClose,
  IconDirectory,
  IconDirectoryFilled,
  IconLogOut,
  IconMarketIntel,
  IconMarketIntelFilled,
  IconMoon,
  IconMore,
  IconMoreFilled,
  IconOverview,
  IconOverviewFilled,
  IconPipeline,
  IconPipelineFilled,
  IconSettings,
  IconSun,
} from "@/components/icons";

/**
 * Mobile bottom tab bar + "More" sheet (CRM Phase 2; polished Oct 14,
 * 2026 per Ethan's mobile spec §3–§4; visual polish Oct 17, 2026 —
 * Ethan's premium spec §1). Phones only (md:hidden).
 *
 * Tab bar: a FLOATING rounded container (24px radius) inset 12px
 * from the screen edges and 12px above the home-bar safe area —
 * translucent surface with backdrop blur and the token nav shadow
 * (shadow-nav), never a flat full-width strip. The active tab sits
 * on a navy pill that SLIDES between tabs (250ms ease-out, measured
 * from the tab's own box) with a filled icon variant in gold and a
 * white label; the old thin gold bar above the tab is gone. Inactive
 * tabs are muted slate, labels 11px medium, every tab a ≥44px
 * target. Tab changes fire a light haptic (guarded). Attention
 * badges ride the SAME server computation as the app-icon badge
 * (GET /api/push/badge → lib/badge): due/overdue follow-ups count
 * on Overview, unread Activity items on Activity — never a local
 * count. "Market Intel" is labeled "Intel" (label text only; the
 * route is unchanged). The bar slides away while the keyboard is
 * open (`kb-open` on <html>, styled in globals.css).
 *
 * More sheet: sits above the floating bar (the bar stays visible
 * and its More tab reads active via the slid pill), backdrop dims
 * only the area above the bar, and it closes on X, backdrop tap,
 * swipe-down, More-tab toggle, browser back (a pushed history
 * state), and choosing an item. Bottom page clearance is handled
 * by layout's `.page-pad`.
 */

type IconFn = (p: { className?: string }) => React.ReactNode;

const TABS: {
  href: string;
  label: string;
  Icon: IconFn;
  IconFilled: IconFn;
  badgeKey?: "dueFollowups" | "unreadNotifications";
}[] = [
  { href: "/overview", label: "Overview", Icon: IconOverview, IconFilled: IconOverviewFilled, badgeKey: "dueFollowups" },
  { href: "/pipeline", label: "Pipeline", Icon: IconPipeline, IconFilled: IconPipelineFilled },
  { href: "/activity", label: "Activity", Icon: IconActivity, IconFilled: IconActivityFilled, badgeKey: "unreadNotifications" },
  { href: "/market-intel", label: "Intel", Icon: IconMarketIntel, IconFilled: IconMarketIntelFilled },
  { href: "/directory", label: "Directory", Icon: IconDirectory, IconFilled: IconDirectoryFilled },
];

const MORE_LINKS: {
  href: string;
  label: string;
  Icon: IconFn;
}[] = [
  { href: "/calendar", label: "Calendar", Icon: IconCalendar },
  { href: "/audit-trail", label: "Audit Trail", Icon: IconAuditTrail },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

const MORE_INDEX = TABS.length; // the More button is the 6th slot

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [badge, setBadge] = useState<{ dueFollowups: number; unreadNotifications: number }>({
    dueFollowups: 0,
    unreadNotifications: 0,
  });
  const pushedRef = useRef(false);
  const touchYRef = useRef<number | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<(HTMLElement | null)[]>([]);
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const moreRouteActive = MORE_LINKS.some((l) => isActive(l.href));
  const activeIndex = moreOpen
    ? MORE_INDEX
    : (() => {
        const i = TABS.findIndex((t) => isActive(t.href));
        if (i >= 0) return i;
        return moreRouteActive ? MORE_INDEX : -1;
      })();

  /* --- attention badge: the app badge's own server numbers --- */
  const fetchBadge = useCallback(async () => {
    try {
      const r = await fetch("/api/push/badge");
      if (!r.ok) return;
      const d = await r.json().catch(() => null);
      if (d && typeof d.dueFollowups === "number" && typeof d.unreadNotifications === "number") {
        setBadge({
          dueFollowups: d.dueFollowups,
          unreadNotifications: d.unreadNotifications,
        });
      }
    } catch {
      /* badge is best-effort */
    }
  }, []);

  useEffect(() => {
    fetchBadge();
    const onForeground = () => fetchBadge();
    const onVisible = () => {
      if (document.visibilityState === "visible") fetchBadge();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onForeground);
    window.addEventListener("ccp:badge-refresh", onForeground);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onForeground);
      window.removeEventListener("ccp:badge-refresh", onForeground);
    };
  }, [fetchBadge, pathname]);

  /* --- sliding pill: measure the active tab's box --- */
  const measurePill = useCallback(() => {
    const el = activeIndex >= 0 ? tabRefs.current[activeIndex] : null;
    if (!el) {
      setPill(null);
      return;
    }
    setPill({ x: el.offsetLeft, w: el.offsetWidth });
  }, [activeIndex]);

  useLayoutEffect(() => {
    measurePill();
  }, [measurePill, pathname, moreOpen]);

  useEffect(() => {
    window.addEventListener("resize", measurePill);
    const t = window.setTimeout(measurePill, 350); // after font swap settles
    return () => {
      window.removeEventListener("resize", measurePill);
      window.clearTimeout(t);
    };
  }, [measurePill]);

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

  if (pathname === "/login" || pathname === "/offline" || pathname.startsWith("/room/") || pathname === "/my-company" || pathname.startsWith("/my-company/")) return null;

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

  const haptic = () => {
    try {
      window.navigator.vibrate?.(10);
    } catch {
      /* haptics are best-effort */
    }
  };

  const rowCls = (active: boolean) =>
    `relative flex h-14 w-full items-center gap-3 px-4 text-left text-sm transition hover:bg-black/5 dark:hover:bg-white/10 ${
      active
        ? "font-semibold text-[#0d1f3c] dark:text-white"
        : "font-medium text-slate-700 dark:text-[#e8dfc8]"
    }`;

  const tabInner = (
    active: boolean,
    Icon: IconFn,
    IconFilled: IconFn,
    label: string,
    badgeCount: number
  ) => {
    const Shown = active ? IconFilled : Icon;
    return (
      <>
        <span className="relative">
          <Shown
            className={`h-6 w-6 transition-colors duration-200 ${
              active
                ? "text-gold-400"
                : "text-slate-500 dark:text-[#c3cede]"
            }`}
          />
          {badgeCount > 0 && (
            <span className="absolute -right-2.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white ring-2 ring-white dark:ring-navy-700">
              {badgeCount > 9 ? "9+" : badgeCount}
            </span>
          )}
        </span>
        <span
          className={`text-[11px] leading-none transition-colors duration-200 ${
            active
              ? "font-semibold text-white"
              : "font-medium text-slate-600 dark:text-[#c3cede]"
          }`}
        >
          {label}
        </span>
      </>
    );
  };

  return (
    <>
      <nav
        aria-label="Primary"
        className="mobile-tabbar fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 rounded-nav border border-navy-900/[0.07] bg-white/85 shadow-nav backdrop-blur-xl dark:border-white/10 dark:bg-navy-700/85 md:hidden"
      >
        <div ref={barRef} className="relative flex h-16 px-1.5">
          {pill && activeIndex >= 0 && (
            <span
              aria-hidden
              className="absolute left-0 top-1/2 h-12 rounded-full bg-navy-900 shadow-card transition-all duration-pill ease-out-expo dark:bg-navy-950 dark:ring-1 dark:ring-white/15"
              style={{
                width: pill.w,
                transform: `translate(${pill.x}px, -50%)`,
              }}
            />
          )}
          {TABS.map((t, i) => {
            const active = activeIndex === i;
            const badgeCount = t.badgeKey ? badge[t.badgeKey] : 0;
            return (
              <Link
                key={t.href}
                href={t.href}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                onClick={haptic}
                aria-current={active ? "page" : undefined}
                className="relative z-10 flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-full"
              >
                {tabInner(active, t.Icon, t.IconFilled, t.label, badgeCount)}
              </Link>
            );
          })}
          <button
            ref={(el) => {
              tabRefs.current[MORE_INDEX] = el;
            }}
            onClick={() => {
              haptic();
              if (moreOpen) closeSheet();
              else openSheet();
            }}
            aria-label="More"
            aria-expanded={moreOpen}
            className="relative z-10 flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 rounded-full"
          >
            {tabInner(activeIndex === MORE_INDEX, IconMore, IconMoreFilled, "More", 0)}
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div
          className="fixed inset-x-0 top-0 z-50 md:hidden"
          style={{ bottom: "calc(92px + env(safe-area-inset-bottom))" }}
          role="dialog"
          aria-label="More"
        >
          <button
            aria-label="Close menu"
            className="absolute inset-0 h-full w-full bg-black/60"
            onClick={closeSheet}
          />
          <div
            className="toast-in absolute inset-x-3 bottom-0 rounded-3xl border border-black/10 bg-[#f7f4ec] shadow-pop dark:border-white/10 dark:bg-[#1d3a66]"
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
          >
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-slate-400/60 dark:bg-white/25" />
            <div className="flex items-center justify-between pl-4 pr-2">
              <p className="font-display text-lg font-semibold text-[#0d1f3c] dark:text-white">More</p>
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
