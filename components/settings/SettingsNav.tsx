"use client";

/**
 * Settings sub-navigation (Navigation Restructure): rendered at the
 * top of every settings page, below the PageHero. General is the
 * /settings index; the rest are dedicated sub-pages.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string }[] = [
  { href: "/settings", label: "General" },
  { href: "/settings/integrations", label: "Integrations" },
  { href: "/settings/users-roles", label: "Users & Roles" },
  { href: "/settings/data-explorer", label: "Data Explorer" },
  { href: "/settings/audit-trail", label: "Audit Trail" },
];

export default function SettingsNav() {
  const pathname = usePathname() ?? "";
  return (
    <div className="mx-auto max-w-[900px] px-4 pt-6 sm:px-6">
      <nav aria-label="Settings" className="flex flex-wrap gap-2">
        {ITEMS.map((item) => {
          const active =
            item.href === "/settings"
              ? pathname === "/settings"
              : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`chip min-h-[44px] ${active ? "chip-active" : ""}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
