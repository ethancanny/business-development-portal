"use client";

/**
 * Top bar (Navigation Restructure): rendered by AppShell at the top
 * of the padded content column — so it inherits the sidebar offset
 * and can never crowd or overlap the brand (the structural fix for
 * the old header crowding). Sticky, slim (~52px), surface background
 * with a bottom border.
 *
 * Left: the mobile drawer button (<lg only; AppShell owns the drawer
 * state) + pathname-derived breadcrumbs. Right: Search (opens the
 * global search), the notification bell, Quick-add (the Fab's four
 * actions), and the user menu (name, theme toggle, log out).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Breadcrumbs } from "@/components/EntityBits";
import NotificationCenter from "@/components/NotificationCenter";
import { openGlobalSearch } from "@/components/Sidebar";
import { useTheme } from "@/components/ThemeProvider";
import {
  IconAddContact,
  IconAddDeal,
  IconFollowUp,
  IconLogTouch,
  IconLogOut,
  IconMoon,
  IconPlus,
  IconSun,
} from "@/components/icons";

function lineIcon(children: React.ReactNode) {
  return function LineIcon({ className }: { className?: string }) {
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
        {children}
      </svg>
    );
  };
}

const IconMenu = lineIcon(
  <>
    <path d="M4 6h16" />
    <path d="M4 12h16" />
    <path d="M4 18h16" />
  </>
);

const IconSearch = lineIcon(
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>
);

const IconChevronDown = lineIcon(<path d="m6 9 6 6 6-6" />);

/* ------------------------------ breadcrumbs ------------------------------ */

interface Crumb {
  label: string;
  href?: string;
}

const SETTINGS_SUB_LABELS: Record<string, string> = {
  integrations: "Integrations",
  "users-roles": "Users & Roles",
  "data-dictionary": "Data Dictionary",
  "data-explorer": "Data Explorer",
  "audit-trail": "Audit Trail",
};

function titleCase(seg: string): string {
  return seg
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function crumbsForPath(pathname: string): Crumb[] {
  const seg = pathname.split("/").filter(Boolean);
  if (seg.length === 0) return [{ label: "Overview", href: "/overview" }];

  const bd: Crumb = { label: "Business Development", href: "/business-development" };
  const dd: Crumb = { label: "Due Diligence", href: "/due-diligence" };
  const overview: Crumb = { label: "Overview", href: "/overview" };
  const settings: Crumb = { label: "Settings", href: "/settings" };

  switch (seg[0]) {
    case "overview":
      return seg.length > 1
        ? [overview, { label: titleCase(seg[1]) }]
        : [{ label: "Overview" }];
    case "calendar":
      return [{ label: "Calendar" }];
    case "business-development":
      return [{ label: "Business Development" }];
    case "due-diligence":
      return seg.length > 1
        ? [dd, { label: "Workspace" }]
        : [{ label: "Due Diligence" }];
    case "investors-capital":
      return seg.length > 1
        ? [
            { label: "Investors & Capital", href: "/investors-capital" },
            { label: titleCase(seg[1]) },
          ]
        : [{ label: "Investors & Capital" }];
    case "portfolio-monitoring":
      return seg.length > 1
        ? [
            { label: "Portfolio Monitoring", href: "/portfolio-monitoring" },
            { label: titleCase(seg[1]) },
          ]
        : [{ label: "Portfolio Monitoring" }];
    case "communications":
      return [{ label: "Communications" }];
    case "directory":
      return [{ label: "Directory" }];
    case "companies":
      return seg.length > 1
        ? [overview, { label: "Company" }]
        : [overview, { label: "Company profile" }];
    case "pipeline":
      return [bd, { label: "Pipeline" }];
    case "market-intel":
      return [bd, { label: "Market Intel" }];
    case "activity":
      return [bd, { label: "Activity" }];
    case "capture":
      return [bd, { label: "Capture" }];
    case "deals":
      return seg.length > 1 ? [bd, { label: "Deal" }] : [bd, { label: "Deals" }];
    case "value-creation": {
      const vc: Crumb = {
        label: "Value Creation Plans",
        href: "/value-creation",
      };
      return seg.length > 1 ? [dd, vc, { label: "Plan" }] : [dd, { label: "Value Creation Plans" }];
    }
    case "data-rooms": {
      const dr: Crumb = { label: "Data Rooms", href: "/data-rooms" };
      return seg.length > 1 ? [dd, dr, { label: "Room" }] : [dd, { label: "Data Rooms" }];
    }
    case "settings":
      return seg.length > 1
        ? [
            settings,
            { label: SETTINGS_SUB_LABELS[seg[1]] ?? titleCase(seg[1]) },
          ]
        : [{ label: "Settings" }];
    default:
      return [
        {
          label: titleCase(seg[seg.length - 1]),
        },
      ];
  }
}

/* ------------------------------ quick add ------------------------------ */

const QUICK_ADD: {
  label: string;
  href: string;
  Icon: (p: { className?: string }) => React.ReactNode;
}[] = [
  { label: "Add follow-up", href: "/overview?newtask=1", Icon: IconFollowUp },
  { label: "Log touch", href: "/directory?touch=1", Icon: IconLogTouch },
  { label: "Add deal", href: "/pipeline?new=deal", Icon: IconAddDeal },
  { label: "Add contact", href: "/directory?new=contact", Icon: IconAddContact },
];

/* ------------------------------ top bar ------------------------------ */

export default function TopBar({ onMenu }: { onMenu: () => void }) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const [userName, setUserName] = useState("");
  const [quickOpen, setQuickOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const quickRef = useRef<HTMLDivElement | null>(null);
  const userRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setQuickOpen(false);
    setUserOpen(false);
  }, [pathname]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const name =
          (d as { user?: { name?: string } } | null)?.user?.name ??
          (d as { name?: string } | null)?.name;
        if (name) setUserName(name);
      })
      .catch(() => {});
  }, [pathname]);

  // Outside click + Escape close the menus.
  useEffect(() => {
    if (!quickOpen && !userOpen) return;
    const onDown = (e: MouseEvent) => {
      if (quickRef.current && !quickRef.current.contains(e.target as Node)) {
        setQuickOpen(false);
      }
      if (userRef.current && !userRef.current.contains(e.target as Node)) {
        setUserOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setQuickOpen(false);
        setUserOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [quickOpen, userOpen]);

  const logout = async () => {
    setUserOpen(false);
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
  };

  const crumbs = crumbsForPath(pathname);
  const initials = userName
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0))
    .slice(0, 2)
    .join("");

  const iconBtnCls =
    "flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-[#0d1f3c] dark:text-[#c8bfa8] dark:hover:bg-white/10 dark:hover:text-white";

  return (
    <header className="sticky top-0 z-30 flex h-[52px] items-center gap-1.5 border-b border-slate-200 bg-white px-2 sm:gap-2 sm:px-4 dark:border-white/10 dark:bg-[#0d1f3c]">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open navigation menu"
        className={`${iconBtnCls} shrink-0 lg:hidden`}
      >
        <IconMenu className="h-5 w-5" />
      </button>

      <div className="min-w-0 flex-1 overflow-hidden">
        <Breadcrumbs
          items={crumbs}
          className="[&_ol]:flex-nowrap [&_li]:min-w-0 [&_span]:truncate"
        />
      </div>

      <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
        <button
          type="button"
          onClick={openGlobalSearch}
          aria-label="Search"
          title="Search (Ctrl+K)"
          className={iconBtnCls}
        >
          <IconSearch className="h-5 w-5" />
        </button>

        <NotificationCenter />

        <div className="relative" ref={quickRef}>
          <button
            type="button"
            onClick={() => {
              setQuickOpen((v) => !v);
              setUserOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={quickOpen}
            className="flex min-h-[44px] items-center gap-1.5 rounded-full bg-[#0d1f3c] px-3.5 text-sm font-semibold text-white transition hover:bg-[#16305a] dark:bg-[#b8975a] dark:text-[#0d1f3c] dark:hover:bg-[#d4b37a]"
          >
            <IconPlus className="h-4 w-4" />
            <span className="hidden sm:inline">Quick add</span>
          </button>
          {quickOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-40 mt-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl dark:border-white/10 dark:bg-[#12294d]"
            >
              {QUICK_ADD.map((a) => (
                <Link
                  key={a.label}
                  href={a.href}
                  role="menuitem"
                  onClick={() => setQuickOpen(false)}
                  className="flex min-h-[44px] items-center gap-2.5 px-3.5 text-sm font-medium text-slate-700 transition hover:bg-[#f0f4fa] dark:text-[#e8dfc8] dark:hover:bg-white/5"
                >
                  <span className="text-[#b8975a]">
                    <a.Icon className="h-5 w-5" />
                  </span>
                  {a.label}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="relative" ref={userRef}>
          <button
            type="button"
            onClick={() => {
              setUserOpen((v) => !v);
              setQuickOpen(false);
            }}
            aria-haspopup="menu"
            aria-expanded={userOpen}
            aria-label={userName ? `Account — ${userName}` : "Account"}
            className="flex min-h-[44px] items-center gap-2 rounded-full py-1 pl-1 pr-2 transition hover:bg-slate-100 dark:hover:bg-white/10"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#0d1f3c] text-xs font-bold text-[#d4b37a] ring-1 ring-[#b8975a]/60 dark:bg-[#b8975a] dark:text-[#0d1f3c]">
              {initials || "CC"}
            </span>
            {userName && (
              <span className="hidden max-w-[140px] truncate text-sm font-medium text-slate-700 xl:block dark:text-[#e8dfc8]">
                {userName}
              </span>
            )}
            <IconChevronDown className="hidden h-4 w-4 text-slate-500 sm:block dark:text-white/60" />
          </button>
          {userOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-40 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-xl dark:border-white/10 dark:bg-[#12294d]"
            >
              {userName && (
                <p className="truncate px-3.5 pb-1.5 pt-2 text-sm font-semibold text-[#0d1f3c] dark:text-white">
                  {userName}
                </p>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={toggle}
                aria-label={
                  theme === "dark" ? "Switch to day mode" : "Switch to night mode"
                }
                className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left text-sm font-medium text-slate-700 transition hover:bg-[#f0f4fa] dark:text-[#e8dfc8] dark:hover:bg-white/5"
              >
                <span className="text-[#b8975a]">
                  {theme === "dark" ? (
                    <IconSun className="h-5 w-5" />
                  ) : (
                    <IconMoon className="h-5 w-5" />
                  )}
                </span>
                {theme === "dark" ? "Day mode" : "Night mode"}
              </button>
              <div className="mx-3 my-1.5 border-t border-slate-100 dark:border-white/10" />
              <button
                type="button"
                role="menuitem"
                onClick={logout}
                className="flex min-h-[44px] w-full items-center gap-2.5 px-3.5 text-left text-sm font-medium text-red-600 transition hover:bg-red-500/10 dark:text-red-300"
              >
                <IconLogOut className="h-5 w-5" />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
