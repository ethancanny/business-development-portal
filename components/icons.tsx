/**
 * One consistent line-icon set for the mobile shell (CRM mobile polish,
 * Oct 14 2026). lucide-react is not a dependency, so these are inline
 * SVGs in the Lucide style: 24×24 viewBox, stroke = currentColor,
 * strokeWidth 1.8, round caps/joins, no fill. Path data follows the
 * Lucide icon set (ISC licensed).
 */

interface IconProps {
  className?: string;
}

function base(className: string | undefined, children: React.ReactNode) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className ?? "h-6 w-6"}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function IconOverview({ className }: IconProps) {
  // Lucide "layout-grid"
  return base(
    className,
    <>
      <rect width="7" height="7" x="3" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <rect width="7" height="7" x="14" y="14" rx="1" />
      <rect width="7" height="7" x="3" y="14" rx="1" />
    </>
  );
}

export function IconPipeline({ className }: IconProps) {
  // Lucide "filter" (funnel) — spec: Pipeline gets a funnel, not columns.
  return base(
    className,
    <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
  );
}

export function IconActivity({ className }: IconProps) {
  // Lucide "activity" (pulse)
  return base(
    className,
    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
  );
}

export function IconMarketIntel({ className }: IconProps) {
  // Lucide "line-chart"
  return base(
    className,
    <>
      <path d="M3 3v18h18" />
      <path d="m19 9-5 5-4-4-3 3" />
    </>
  );
}

export function IconDirectory({ className }: IconProps) {
  // Lucide "users"
  return base(
    className,
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  );
}

export function IconMore({ className }: IconProps) {
  // Lucide "more-horizontal" (dots as small stroked circles for the line style)
  return base(
    className,
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  );
}

export function IconCalendar({ className }: IconProps) {
  // Lucide "calendar"
  return base(
    className,
    <>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </>
  );
}

export function IconAnalytics({ className }: IconProps) {
  // Lucide "bar-chart-3"
  return base(
    className,
    <>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>
  );
}

export function IconAuditTrail({ className }: IconProps) {
  // Lucide "scroll-text"
  return base(
    className,
    <>
      <path d="M19 17V5a2 2 0 0 0-2-2H4" />
      <path d="M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" />
      <path d="M19 8H9" />
      <path d="M15 12h-5" />
    </>
  );
}

export function IconSettings({ className }: IconProps) {
  // Lucide "settings" (gear)
  return base(
    className,
    <>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </>
  );
}

export function IconClose({ className }: IconProps) {
  // Lucide "x"
  return base(
    className,
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  );
}

export function IconSun({ className }: IconProps) {
  // Lucide "sun"
  return base(
    className,
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </>
  );
}

export function IconMoon({ className }: IconProps) {
  // Lucide "moon"
  return base(
    className,
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  );
}

export function IconLogOut({ className }: IconProps) {
  // Lucide "log-out"
  return base(
    className,
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" x2="9" y1="12" y2="12" />
    </>
  );
}

export function IconPlus({ className }: IconProps) {
  // Lucide "plus"
  return base(
    className,
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  );
}

export function IconLogTouch({ className }: IconProps) {
  // Lucide "phone-call"
  return base(
    className,
    <>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
      <path d="M15 3a6 6 0 0 1 6 6" />
      <path d="M15 7a2 2 0 0 1 2 2" />
    </>
  );
}

export function IconAddContact({ className }: IconProps) {
  // Lucide "user-plus"
  return base(
    className,
    <>
      <path d="M2 21a8 8 0 0 1 13.292-6" />
      <circle cx="10" cy="8" r="5" />
      <path d="M16 19h6" />
      <path d="M19 16v6" />
    </>
  );
}

export function IconAddDeal({ className }: IconProps) {
  // Lucide "briefcase"
  return base(
    className,
    <>
      <path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
      <rect width="20" height="14" x="2" y="6" rx="2" />
    </>
  );
}

export function IconFollowUp({ className }: IconProps) {
  // Lucide "check-square" (square-check)
  return base(
    className,
    <>
      <polyline points="9 11 12 14 22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </>
  );
}
