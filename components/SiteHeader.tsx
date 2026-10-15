"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";
import { IconAuditTrail, IconSettings } from "@/components/icons";

const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/pipeline", label: "Pipeline" },
  { href: "/activity", label: "Activity" },
  { href: "/market-intel", label: "Market Intel" },
  { href: "/directory", label: "Directory" },
  { href: "/calendar", label: "Calendar" },
];

// Ethan (Oct 14): Audit Trail and Settings live under an "Other" tab so
// the header never crowds. Calendar keeps its own tab.
const OTHER = [
  { href: "/audit-trail", label: "Audit Trail", Icon: IconAuditTrail },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

export default function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [userName, setUserName] = useState("");
  const [otherOpen, setOtherOpen] = useState(false);
  const otherRef = useRef<HTMLDivElement | null>(null);

  // The Other menu closes on navigation, outside click, and Escape.
  useEffect(() => {
    setOtherOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!otherOpen) return;
    const onDown = (e: MouseEvent) => {
      if (otherRef.current && !otherRef.current.contains(e.target as Node)) {
        setOtherOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOtherOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [otherOpen]);

  const otherActive = OTHER.some(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  );

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
          mobile ? "block px-4 py-3 text-base" : "whitespace-nowrap px-2 py-1.5 text-[13px] xl:px-3 xl:text-sm"
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
      <div className="mx-auto flex h-14 max-w-[1400px] items-center justify-between gap-2 px-4 py-3 sm:px-6 md:h-auto xl:gap-4">
        <div className="flex min-w-0 items-center gap-3 xl:gap-6">
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
              <span className="hidden whitespace-nowrap border-l border-[#b8975a]/50 pl-3 text-xs font-bold text-white sm:text-sm xl:block">
                Business Development Portal
              </span>
            </span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {NAV.map((item) => navLink(item.href, item.label))}
            <div className="relative" ref={otherRef}>
              <button
                type="button"
                onClick={() => setOtherOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={otherOpen}
                className={`flex items-center gap-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-[13px] font-semibold transition xl:px-3 xl:text-sm ${
                  otherActive
                    ? "bg-[#b8975a] text-[#0d1f3c]"
                    : "text-[#e8dfc8] hover:bg-white/10 hover:text-white"
                }`}
              >
                Other
                <svg
                  viewBox="0 0 20 20"
                  className={`h-3.5 w-3.5 transition-transform ${otherOpen ? "rotate-180" : ""}`}
                  fill="currentColor"
                  aria-hidden
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08Z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              {otherOpen && (
                <div
                  role="menu"
                  className="absolute left-0 top-full z-50 mt-2 min-w-48 overflow-hidden rounded-xl border border-[#b8975a]/30 bg-[#16305a] py-1.5 shadow-xl shadow-black/30"
                >
                  {OTHER.map((item) => {
                    const active =
                      pathname === item.href ||
                      pathname.startsWith(item.href + "/");
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        role="menuitem"
                        onClick={() => setOtherOpen(false)}
                        className={`flex items-center gap-2.5 px-3.5 py-2 text-sm font-medium transition ${
                          active
                            ? "text-[#d4b37a]"
                            : "text-[#e8dfc8] hover:bg-white/10 hover:text-white"
                        }`}
                      >
                        <item.Icon className="h-4.5 w-4.5 shrink-0" />
                        {item.label}
                        {active && (
                          <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#b8975a]" />
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          </nav>
        </div>
        <div className="hidden shrink-0 items-center gap-2 md:flex xl:gap-3">
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
