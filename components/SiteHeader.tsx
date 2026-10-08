"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "@/components/ThemeProvider";

const NAV = [
  { href: "/overview", label: "Overview" },
  { href: "/", label: "Pipeline" },
  { href: "/market-intel", label: "Market Intel" },
  { href: "/activity", label: "Activity" },
];

const AUDIT = { href: "/audit-trail", label: "Audit Trail" };

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

  // The login page has its own branding; keep the chrome out of the way there.
  if (pathname === "/login") return null;

  return (
    <header className="bg-[#0d1f3c]">
      <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-6">
          <Link href="/overview" className="flex items-center gap-3">
            <img
              src="https://cannycapitalpartners.com/canny-logo-white.png"
              alt="Canny Capital Partners"
              className="h-9 w-auto"
            />
            <span className="hidden border-l border-[#b8975a]/50 pl-3 text-sm font-bold text-white md:block">
              Business Development Portal
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((item) => {
              const active =
                item.href === "/"
                  ? pathname === "/"
                  : pathname === item.href ||
                    pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                    active
                      ? "bg-[#b8975a] text-[#0d1f3c]"
                      : "text-[#e8dfc8] hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={AUDIT.href}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
              pathname === AUDIT.href || pathname.startsWith(AUDIT.href + "/")
                ? "bg-[#b8975a] text-[#0d1f3c]"
                : "text-[#e8dfc8] hover:bg-white/10 hover:text-white"
            }`}
          >
            {AUDIT.label}
          </Link>
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
      </div>
      <div className="h-0.5 bg-[#b8975a]" />
    </header>
  );
}
