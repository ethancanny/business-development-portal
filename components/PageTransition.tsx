"use client";

import { usePathname } from "next/navigation";

/**
 * Page transition wrapper (visual polish, Oct 17, 2026 — spec §7):
 * each route mounts its content with a short fade + slight slide
 * (.page-enter in globals.css, 200ms ease-out, disabled wholesale
 * under prefers-reduced-motion). Keyed by pathname so a navigation
 * replays the animation; same-route renders keep the same key.
 */
export default function PageTransition({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div key={pathname} className="page-enter">
      {children}
    </div>
  );
}
