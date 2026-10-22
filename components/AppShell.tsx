"use client";

/**
 * App shell (Phase 1 platform restructure): owns the desktop
 * sidebar's collapsed state (remembered per device in localStorage),
 * the mobile nav drawer, and the content offset that makes room for
 * the fixed sidebar on lg+ screens.
 *
 * Mobile is untouched by design: below lg the sidebar is hidden,
 * content takes no left padding, MobileNav + Fab render as before,
 * and the TopBar carries the drawer button (<lg) that opens the
 * drawer with the same nav list (Settings pinned at its bottom).
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Sidebar, {
  NavList,
  SettingsLink,
  SidebarBrand,
} from "@/components/Sidebar";
import GlobalSearch from "@/components/GlobalSearch";
import TopBar from "@/components/TopBar";
import { IconClose } from "@/components/icons";

const COLLAPSED_KEY = "ccp-sidebar-collapsed";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Guest (management) users live in the scoped /my-company portal
  // (Phase 9). UX guard only — middleware + API gates enforce scope;
  // this just keeps a guest from ever seeing internal chrome/pages.
  // Inert for every non-guest role (partners' experience unchanged).
  useEffect(() => {
    if (
      pathname === "/login" ||
      pathname === "/offline" ||
      pathname.startsWith("/room/") ||
      pathname === "/my-company" ||
      pathname.startsWith("/my-company/")
    ) {
      return;
    }
    let live = true;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d) return;
        const role = (d as { role?: string }).role ?? (d as { user?: { role?: string } }).user?.role;
        if (role === "guest") router.replace("/my-company");
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pathname, router]);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      /* storage unavailable — default to expanded */
    }
  }, []);

  // The drawer always closes on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Escape closes the drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* non-fatal — the choice just won't persist */
      }
      return next;
    });
  };

  // Login / offline / the scoped company portal have their own
  // branding — no shell chrome there (matches MobileNav
  // behavior; /my-company mirrors the /room/* handling).
  if (
    pathname === "/login" ||
    pathname === "/offline" ||
    pathname.startsWith("/room/") ||
    pathname === "/my-company" ||
    pathname.startsWith("/my-company/")
  ) {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />

      {drawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-label="Navigation">
          <button
            aria-label="Close navigation menu"
            className="absolute inset-0 h-full w-full bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-[#0d1f3c] text-[#e8dfc8] shadow-2xl">
            <div className="flex items-start justify-between">
              <SidebarBrand />
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close navigation menu"
                className="mr-2 mt-2 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-[#c8bfa8] transition hover:bg-white/10 hover:text-white"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
              <NavList onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="shrink-0 border-t border-white/10 px-3 py-3">
              <SettingsLink onNavigate={() => setDrawerOpen(false)} />
            </div>
          </div>
        </div>
      )}

      <div
        className={`transition-[padding] duration-200 ${
          collapsed ? "lg:pl-16" : "lg:pl-60"
        }`}
      >
        <TopBar onMenu={() => setDrawerOpen(true)} />
        {children}
      </div>

      <GlobalSearch />
    </>
  );
}
