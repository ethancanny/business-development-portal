"use client";

/**
 * App shell (Phase 1 platform restructure): owns the desktop
 * sidebar's collapsed state (remembered per device in localStorage),
 * the mobile nav drawer, and the content offset that makes room for
 * the fixed sidebar on lg+ screens.
 *
 * Mobile is untouched by design: below lg the sidebar is hidden,
 * content takes no left padding, MobileNav + Fab render as before,
 * and the only addition is a small floating hamburger (top-left,
 * below the header) that opens the drawer with the same nav list.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar, { NavList, SidebarBrand } from "@/components/Sidebar";
import GlobalSearch from "@/components/GlobalSearch";
import NotificationCenter from "@/components/NotificationCenter";
import { IconClose } from "@/components/icons";

const COLLAPSED_KEY = "ccp-sidebar-collapsed";

function IconMenu({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-6 w-6"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6h16" />
      <path d="M4 12h16" />
      <path d="M4 18h16" />
    </svg>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

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

  // Login / offline have their own branding — no shell chrome there
  // (matches SiteHeader / MobileNav behavior).
  if (pathname === "/login" || pathname === "/offline") {
    return <>{children}</>;
  }

  return (
    <>
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} />

      {/* Mobile drawer trigger: floating navy circle, gold icon,
          below the header band so it never covers the wordmark. */}
      <button
        type="button"
        onClick={() => setDrawerOpen(true)}
        aria-label="Open navigation menu"
        aria-expanded={drawerOpen}
        className="fixed left-3 z-40 flex h-11 w-11 items-center justify-center rounded-full bg-[#0d1f3c] text-[#d4b37a] shadow-lg ring-1 ring-[#b8975a]/50 transition hover:bg-[#16305a] lg:hidden"
        style={{ top: "calc(64px + env(safe-area-inset-top))" }}
      >
        <IconMenu className="h-5 w-5" />
      </button>

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
          </div>
        </div>
      )}

      <div
        className={`transition-[padding] duration-200 ${
          collapsed ? "lg:pl-16" : "lg:pl-60"
        }`}
      >
        {children}
      </div>

      <NotificationCenter />

      <GlobalSearch />
    </>
  );
}
