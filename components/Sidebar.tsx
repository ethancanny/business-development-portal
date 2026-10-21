"use client";

/**
 * Desktop sidebar navigation (Phase 1 platform restructure).
 *
 * Desktop-only (hidden below lg) — mobile keeps the floating bottom
 * tab bar (MobileNav) exactly as-is, plus a drawer (rendered by
 * AppShell) that reuses this file's NavList. The sidebar is navy
 * like the SiteHeader so the two blend at the top of the page; the
 * active section gets a lighter-navy pill, a gold icon, and a gold
 * left bar — the same active language as the mobile tab bar.
 *
 * Nav order is fixed by the platform spec: Overview, Calendar,
 * Business Development, Due Diligence, Value Creation, Data Rooms,
 * Investors & Capital, Portfolio Monitoring, Directory, Settings.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  IconAnalytics,
  IconCalendar,
  IconDirectory,
  IconOverview,
  IconPipeline,
  IconSettings,
} from "@/components/icons";

type IconFn = (p: { className?: string }) => React.ReactNode;

function lineIcon(children: React.ReactNode): IconFn {
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

const IconDueDiligence = lineIcon(
  <>
    <rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
    <path d="m9 14 2 2 4-4" />
  </>
);

const IconValueCreation = lineIcon(
  <>
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
    <polyline points="16 7 22 7 22 13" />
  </>
);

const IconDataRooms = lineIcon(
  <>
    <rect width="20" height="5" x="2" y="3" rx="1" />
    <path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8" />
    <path d="M10 12h4" />
  </>
);

const IconInvestors = lineIcon(
  <>
    <circle cx="12" cy="12" r="10" />
    <path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" />
    <path d="M12 6v2" />
    <path d="M12 16v2" />
  </>
);

const IconSearch = lineIcon(
  <>
    <circle cx="11" cy="11" r="8" />
    <path d="m21 21-4.3-4.3" />
  </>
);

const IconChevronLeft = lineIcon(<path d="m15 18-6-6 6-6" />);
const IconChevronRight = lineIcon(<path d="m9 18 6-6-6-6" />);

export interface NavItem {
  href: string;
  label: string;
  Icon: IconFn;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/overview", label: "Overview", Icon: IconOverview },
  { href: "/calendar", label: "Calendar", Icon: IconCalendar },
  { href: "/business-development", label: "Business Development", Icon: IconPipeline },
  { href: "/due-diligence", label: "Due Diligence", Icon: IconDueDiligence },
  { href: "/value-creation", label: "Value Creation", Icon: IconValueCreation },
  { href: "/data-rooms", label: "Data Rooms", Icon: IconDataRooms },
  { href: "/investors-capital", label: "Investors & Capital", Icon: IconInvestors },
  { href: "/portfolio-monitoring", label: "Portfolio Monitoring", Icon: IconAnalytics },
  { href: "/directory", label: "Directory", Icon: IconDirectory },
  { href: "/settings", label: "Settings", Icon: IconSettings },
];

/** Prefix match, with the legacy CRM routes folded into their new
 * module homes: pipeline/market-intel/activity/capture/deals are
 * Business Development; company records live under Overview. */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/overview") {
    return (
      pathname === "/overview" ||
      pathname.startsWith("/overview/") ||
      pathname.startsWith("/companies/")
    );
  }
  if (href === "/business-development") {
    return (
      pathname === href ||
      pathname.startsWith(href + "/") ||
      pathname === "/pipeline" ||
      pathname.startsWith("/pipeline/") ||
      pathname === "/market-intel" ||
      pathname.startsWith("/market-intel/") ||
      pathname === "/activity" ||
      pathname.startsWith("/activity/") ||
      pathname === "/capture" ||
      pathname.startsWith("/capture/") ||
      pathname.startsWith("/deals/")
    );
  }
  return pathname === href || pathname.startsWith(href + "/");
}

export function openGlobalSearch() {
  try {
    window.dispatchEvent(new CustomEvent("ccp:open-search"));
  } catch {
    /* search is an enhancement — never break navigation */
  }
}

/**
 * The shared nav list: used by the desktop sidebar (expanded and
 * collapsed) and by the mobile drawer. `collapsed` renders icons
 * only, with the label carried by the title tooltip + sr-only text.
 */
export function NavList({
  collapsed = false,
  onNavigate,
}: {
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Platform" className="flex flex-col gap-1">
      <button
        type="button"
        onClick={openGlobalSearch}
        title={collapsed ? "Search (Ctrl+K)" : undefined}
        className={`mb-2 flex min-h-[44px] items-center gap-3 rounded-xl border border-white/15 px-3 text-sm font-medium text-[#c8bfa8] transition hover:border-[#b8975a]/60 hover:text-white ${
          collapsed ? "justify-center px-0" : ""
        }`}
      >
        <IconSearch className="h-5 w-5 shrink-0" />
        {!collapsed && (
          <>
            <span className="flex-1 text-left">Search</span>
            <kbd className="rounded border border-white/20 bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-[#c8bfa8]">
              Ctrl K
            </kbd>
          </>
        )}
        {collapsed && <span className="sr-only">Search</span>}
      </button>
      {NAV_ITEMS.map((item) => {
        const active = isNavActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            title={collapsed ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-[44px] items-center gap-3 rounded-xl py-2.5 text-sm transition ${
              collapsed ? "justify-center px-0" : "px-3"
            } ${
              active
                ? "bg-[#16305a] font-semibold text-white shadow-sm"
                : "font-medium text-[#c8bfa8] hover:bg-white/5 hover:text-white"
            }`}
          >
            {active && (
              <span
                aria-hidden
                className="absolute inset-y-2 left-0 w-1 rounded-full bg-[#b8975a]"
              />
            )}
            <item.Icon
              className={`h-5 w-5 shrink-0 ${
                active ? "text-[#d4b37a]" : "text-[#c8bfa8]/70"
              }`}
            />
            {!collapsed && <span className="truncate">{item.label}</span>}
            {collapsed && <span className="sr-only">{item.label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Wordmark block mirroring SiteHeader's logo treatment, sized to
 * line up with the header's 62px band (36px logo row + padding +
 * the 2px gold rule) so the two navy surfaces read as one. */
export function SidebarBrand({ collapsed = false }: { collapsed?: boolean }) {
  return (
    <div className="flex h-[62px] shrink-0 items-center border-b-2 border-[#b8975a] px-4">
      <Link
        href="/overview"
        className="flex min-w-0 items-center gap-2.5"
        aria-label="Canny Capital Partners — Overview"
      >
        {collapsed ? (
          <span className="flex flex-col items-center" aria-hidden>
            <span className="font-display text-[26px] font-semibold leading-none text-white">
              C
            </span>
            <span className="mt-1 h-0.5 w-4 bg-[#b8975a]" />
          </span>
        ) : (
          <>
            <img
              src="https://cannycapitalpartners.com/canny-logo-white.png"
              alt="Canny Capital Partners"
              className="h-8 w-auto shrink-0"
            />
            <span className="truncate border-l border-[#b8975a]/50 pl-2.5 text-[11px] font-bold leading-tight text-white">
              Platform
            </span>
          </>
        )}
      </Link>
    </div>
  );
}

export default function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <aside
      className={`fixed inset-y-0 left-0 z-40 hidden h-screen flex-col bg-[#0d1f3c] text-[#e8dfc8] transition-[width] duration-200 lg:flex ${
        collapsed ? "w-16" : "w-60"
      }`}
    >
      <SidebarBrand collapsed={collapsed} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <NavList collapsed={collapsed} />
      </div>
      <div className="shrink-0 border-t border-white/10 p-3">
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 text-sm font-medium text-[#c8bfa8] transition hover:bg-white/5 hover:text-white ${
            collapsed ? "justify-center px-0 w-full" : "w-full"
          }`}
        >
          {collapsed ? (
            <IconChevronRight className="h-5 w-5 shrink-0" />
          ) : (
            <>
              <IconChevronLeft className="h-5 w-5 shrink-0" />
              <span>Collapse</span>
            </>
          )}
          {collapsed && <span className="sr-only">Expand sidebar</span>}
        </button>
      </div>
    </aside>
  );
}
