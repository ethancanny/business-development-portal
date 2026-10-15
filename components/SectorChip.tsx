import { sectorColor, sectorIcon, stageColor } from "@/lib/sector-colors";

/**
 * Sector chip (Ethan, Oct 14, 2026): colored dot + small sector icon +
 * label. The label text keeps the default foreground color in both modes
 * (contrast-safe); the sector color carries identity via the dot, icon,
 * tint, and border.
 */
export default function SectorChip({ sector, showIcon = true }: { sector: string; showIcon?: boolean }) {
  if (!sector) return <span>—</span>;
  const c = sectorColor(sector);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${c}1A`, border: `1px solid ${c}59` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
      {showIcon && <span aria-hidden>{sectorIcon(sector)}</span>}
      {sector}
    </span>
  );
}

/** Stage chip in the shared slate-blue progression. */
export function StageChip({ stage }: { stage: string }) {
  if (!stage) return <span>—</span>;
  const c = stageColor(stage);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${c}26`, border: `1px solid ${c}73` }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: c }} />
      {stage}
    </span>
  );
}

/** Legend for views showing more than one sector. */
export function SectorLegend({ sectors }: { sectors: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-white/50">
      <span className="font-semibold uppercase tracking-wider">Sectors</span>
      {sectors.map((s) => (
        <span key={s} className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sectorColor(s) }} />
          <span aria-hidden>{sectorIcon(s)}</span> {s}
        </span>
      ))}
    </div>
  );
}
