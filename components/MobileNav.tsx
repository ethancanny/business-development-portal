"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";

/**
 * Mobile bottom tab bar (CRM Phase 2) — phones only (md:hidden).
 * Five primary tabs plus a "More" bottom sheet carrying Calendar,
 * Audit Trail, Analytics, Settings, the theme toggle, and Log out
 * (mirrors SiteHeader's logout flow). Respects the home-bar safe area;
 * every target is ≥44px. A spacer keeps page content clear of the bar.
 */

const TABS: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/overview",
    label: "Overview",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.8 10.8 12 3.6l8.2 7.2M5.5 9.5V20a.8.8 0 0 0 .8.8h4v-6h3.4v6h4a.8.8 0 0 0 .8-.8V9.5" />
      </svg>
    ),
  },
  {
    href: "/pipeline",
    label: "Pipeline",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" d="M5 4v16M12 4v16M19 4v16M2.5 7.5h5M9.5 7.5h5M16.5 7.5h5" />
      </svg>
    ),
  },
  {
    href: "/activity",
    label: "Activity",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 2.5 4.8 13.5h5L9.5 21.5l8.2-11h-5l.3-8Z" />
      </svg>
    ),
  },
  {
    href: "/market-intel",
    label: "Market Intel",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" d="M4 4v15.2A.8.8 0 0 0 4.8 20H20M8 16v-5m4.5 5V7.5M17 16v-8" />
      </svg>
    ),
  },
  {
    href: "/directory",
    label: "Directory",
    icon: (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 1a3 3 0 1 0-1.2-5.5M3 20c.6-3 2.8-4.5 5.5-4.5S13.4 17 14 20m2.5.1c-.2-2.4-1.2-3.9-2.9-4.6 2.9-.3 5.3 1.2 5.9 4.1" />
      </svg>
    ),
  },
];

const MORE_LINKS = [
  { href: "/calendar", label: "Calendar" },
  { href: "/audit-trail", label: "Audit Trail" },
  { href: "/analytics", label: "Analytics" },
  { href: "/settings", label: "Settings" },
];

export default function MobileNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  if (pathname === "/login" || pathname === "/offline") return null;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  const sheetRow =
    "flex min-h-[48px] w-full items-center rounded-lg px-4 py-3 text-left text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-[#e8dfc8] dark:hover:bg-white/10";

  return (
    <>
      {/* Spacer so page content clears the fixed bar. */}
      <div
        aria-hidden
        className="md:hidden"
        style={{ height: "calc(57px + env(safe-area-inset-bottom))" }}
      />

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-[#b8975a]/40 bg-[#0d1f3c] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex">
          {TABS.map((t) => (
            <Link
              key={t.href}
              href={t.href}
              aria-current={isActive(t.href) ? "page" : undefined}
              className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 ${
                isActive(t.href) ? "text-[#b8975a]" : "text-[#e8dfc8]/70"
              }`}
            >
              {t.icon}
              <span className="text-[10px] font-semibold leading-none">{t.label}</span>
            </Link>
          ))}
          <button
            onClick={() => setMoreOpen(true)}
            aria-label="More"
            className={`flex min-h-[56px] flex-1 flex-col items-center justify-center gap-0.5 py-1.5 ${
              moreOpen ? "text-[#b8975a]" : "text-[#e8dfc8]/70"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor">
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
            <span className="text-[10px] font-semibold leading-none">More</span>
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="More">
          <button
            aria-label="Close menu"
            className="absolute inset-0 h-full w-full bg-black/50"
            onClick={() => setMoreOpen(false)}
          />
          <div
            className="absolute inset-x-0 bottom-0 rounded-t-2xl bg-white px-3 pt-2 shadow-2xl dark:bg-[#132847]"
            style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
          >
            <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-slate-300 dark:bg-white/25" />
            {MORE_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className={sheetRow}>
                {l.label}
                {isActive(l.href) && <span className="ml-auto text-[#b8975a]">●</span>}
              </Link>
            ))}
            <button onClick={toggle} className={sheetRow}>
              {theme === "dark" ? "☀️ Day mode" : "🌙 Night mode"}
            </button>
            <div className="my-1 border-t border-slate-100 dark:border-white/10" />
            <button
              onClick={logout}
              className="flex min-h-[48px] w-full items-center rounded-lg px-4 py-3 text-left text-sm font-semibold text-red-600 transition hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-500/10"
            >
              Log out
            </button>
          </div>
        </div>
      )}
    </>
  );
}
