"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";

const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/activity", label: "Activity" },
  { href: "/market-intel", label: "Market Intel" },
  { href: "/directory", label: "Directory" },
];

const CALENDAR = { href: "/calendar", label: "Calendar" };
const AUDIT = { href: "/audit-trail", label: "Audit Trail" };
const SETTINGS = { href: "/settings", label: "Settings" };

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [userName, setUserName] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.user) setUserName(d.user.name);
      })
      .catch(() => {});
  }, [pathname]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  const navLink = (href: string, label: string, mobile = false) => {
    const active = pathname === href || pathname.startsWith(href + "/");
    return (
      <Link
        key={href}
        href={href}
        className={`rounded-lg font-semibold transition ${
          mobile ? "block px-4 py-3 text-base" : "whitespace-nowrap px-3 py-1.5 text-sm"
        } ${
          active
            ? "bg-[#b8975a] text-[#0d1f3c]"
            : "text-[#e8dfc8] hover:bg-white/10 hover:text-white"
        }`}
      >
        {label}
      </Link>
    );
  };

  // The login page has its own branding; keep the chrome out of the way there.
  if (pathname === "/login") return null;

  return (
    <header className="bg-[#0d1f3c] pt-safe">
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6 md:h-auto">
        <div className="flex items-center gap-6">
          <Link href="/overview" className="flex shrink-0 items-center gap-3">
            {/* Mobile brand (spec §2): a 32px gold-ringed "C" mark +
                "Canny Capital" on one line. The hosted wordmark's
                letter widths aren't fixed, so a cropped <img> would
                show a sliver of the second letter — a serif C glyph
                in a ring is the deliberate-looking mark. */}
            <span className="flex items-center gap-2 md:hidden">
              <span
                aria-hidden
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#b8975a] font-serif text-lg font-bold leading-none text-white"
              >
                C
              </span>
              <span className="whitespace-nowrap text-sm font-bold text-white">
                Canny Capital
              </span>
            </span>
            {/* Desktop brand: full wordmark + portal title (unchanged). */}
            <span className="hidden items-center gap-3 md:flex">
              <img
                src="https://cannycapitalpartners.com/canny-logo-white.png"
                alt="Canny Capital Partners"
                className="h-9 w-auto"
              />
              <span className="whitespace-nowrap border-l border-[#b8975a]/50 pl-3 text-xs font-bold text-white sm:text-sm">
                Business Development Portal
              </span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => navLink(item.href, item.label))}
          </nav>
        </div>
        <div className="hidden items-center gap-3 md:flex">
          {navLink(CALENDAR.href, CALENDAR.label)}
          {navLink(AUDIT.href, AUDIT.label)}
          {navLink(SETTINGS.href, SETTINGS.label)}
          <span className="hidden h-5 w-px bg-[#b8975a]/40 sm:block" />
          {userName && (
            <span className="hidden text-xs text-[#c8bfa8] sm:block">
              {userName}
            </span>
          )}
          <button
            onClick={toggle}
            aria-label={
              theme === "dark" ? "Switch to day mode" : "Switch to night mode"
            }
            title={
              theme === "dark" ? "Switch to day mode" : "Switch to night mode"
            }
            className="rounded-lg border border-[#b8975a]/60 px-2.5 py-1.5 text-sm text-[#e8dfc8] transition hover:bg-[#b8975a] hover:text-[#0d1f3c]"
          >
            {theme === "dark" ? (
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path
                  fillRule="evenodd"
                  d="M10 2a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0V3a1 1 0 0 1 1-1Zm0 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7-5a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2H4a1 1 0 0 1-1-1Zm12 0a1 1 0 0 1 1-1h1a1 1 0 1 1 0 2h-1a1 1 0 0 1-1-1ZM4.2 4.2a1 1 0 0 1 1.4 0l.7.7a1 1 0 1 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4Zm11.3 11.3a1 1 0 0 1 1.4 0l.7.7a1 1 0 1 1-1.4 1.4l-.7-.7a1 1 0 0 1 0-1.4ZM4.2 15.8a1 1 0 0 1 0-1.4l.7-.7a1 1 0 1 1 1.4 1.4l-.7.7a1 1 0 0 1-1.4 0Zm11.3-11.3a1 1 0 0 1 0-1.4l.7-.7a1 1 0 1 1 1.4 1.4l-.7.7a1 1 0 0 1-1.4 0Z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 20 20" className="h-4 w-4" fill="currentColor">
                <path d="M17.3 13.3A8 8 0 1 1 6.7 2.7a.75.75 0 0 1 1 .98A6.5 6.5 0 0 0 16.3 12.3a.75.75 0 0 1 .98 1Z" />
              </svg>
            )}
          </button>
          <button
            onClick={logout}
            className="rounded-lg border border-[#b8975a]/60 px-3 py-1.5 text-sm font-semibold text-[#e8dfc8] transition hover:bg-[#b8975a] hover:text-[#0d1f3c]"
          >
            Log out
          </button>
        </div>
        {/* Mobile: nothing on the right (spec §2) — Calendar, Audit
            Trail, Settings, theme, and Log out live in the bottom
            tab bar's More sheet. */}
      </div>
      <div className="h-0.5 bg-[#b8975a]" />
    </header>
  );
}
