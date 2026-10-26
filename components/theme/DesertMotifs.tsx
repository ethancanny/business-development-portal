/**
 * Aerospace Desert motifs (Focus & Theme, Oct 26, 2026).
 *
 * Small inline SVGs — topographic contours, a blueprint grid, a
 * flight-path contrail arc, and a star field — overlaid on hero
 * banners and the login page with restraint. Every motif renders
 * `display:none` unless the Desert theme is active (the `.motif` /
 * `.motif-dark` gates in globals.css), so the Classic theme is
 * byte-for-byte what it was. Decorative only: aria-hidden, no
 * pointer events, no layout impact (absolutely positioned by the
 * consumer's className).
 */

export function TopoContours({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`motif pointer-events-none absolute inset-0 h-full w-full ${className}`}
      preserveAspectRatio="none"
      viewBox="0 0 400 120"
    >
      <g fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.16">
        <path d="M-10 96 C 60 70, 120 108, 190 84 S 330 60, 410 82" />
        <path d="M-10 82 C 60 56, 120 94, 190 70 S 330 46, 410 68" />
        <path d="M-10 68 C 60 42, 120 80, 190 56 S 330 32, 410 54" />
        <path d="M-10 110 C 70 88, 130 120, 200 98 S 340 76, 410 96" />
        <path d="M-10 52 C 70 28, 140 62, 210 40 S 340 18, 410 38" />
      </g>
    </svg>
  );
}

export function BlueprintGrid({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`motif pointer-events-none absolute inset-0 h-full w-full ${className}`}
      preserveAspectRatio="none"
      viewBox="0 0 400 120"
    >
      <defs>
        <pattern id="bp-grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="currentColor" strokeWidth="0.5" />
        </pattern>
      </defs>
      <rect width="400" height="120" fill="url(#bp-grid)" opacity="0.10" />
    </svg>
  );
}

/** A single faint flight-path arc with a dashed contrail. */
export function ContrailArc({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`motif pointer-events-none absolute inset-0 h-full w-full ${className}`}
      preserveAspectRatio="none"
      viewBox="0 0 400 120"
    >
      <path
        d="M-6 104 C 110 84, 240 40, 406 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeDasharray="1 5"
        strokeLinecap="round"
        opacity="0.5"
      />
      <circle cx="382" cy="19" r="1.8" fill="currentColor" opacity="0.65" />
    </svg>
  );
}

/** Subtle star field — dark-mode Desert heroes only (.motif-dark). */
export function StarField({ className = "" }: { className?: string }) {
  const stars: [number, number, number][] = [
    [24, 18, 1.1], [66, 34, 0.8], [104, 12, 1.3], [142, 28, 0.7],
    [178, 16, 1.0], [214, 38, 0.8], [248, 10, 1.2], [286, 26, 0.7],
    [318, 14, 1.1], [352, 32, 0.9], [382, 18, 1.2], [46, 52, 0.7],
    [128, 48, 0.8], [232, 54, 0.7], [330, 50, 0.8], [368, 58, 0.6],
    [88, 66, 0.6], [196, 68, 0.6], [300, 70, 0.6],
  ];
  return (
    <svg
      aria-hidden
      className={`motif-dark pointer-events-none absolute inset-0 h-full w-full ${className}`}
      preserveAspectRatio="none"
      viewBox="0 0 400 120"
    >
      <g fill="currentColor">
        {stars.map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} opacity={0.35 + (i % 3) * 0.18} />
        ))}
      </g>
    </svg>
  );
}
