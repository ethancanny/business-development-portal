import type { NamedTheme } from "@/lib/platform/focus-shared";

/**
 * Chart palettes (Focus & Theme, Oct 26, 2026). Classic keeps the
 * exact series colors the charts shipped with. Aerospace Desert uses
 * the spec's sequential ramp — midnight/deep navy → dusk blue →
 * copper → gold → desert sand — so multi-series charts read as one
 * dusk gradient instead of unrelated hues. Status colors are NOT in
 * these palettes: they stay muted and consistent across themes.
 */
export interface ChartPalette {
  /** Primary bar/series color (navy). */
  primary: string;
  /** Accent bar/series color (gold family). */
  accent: string;
  /** First line color. */
  line1: string;
  /** Second line color. */
  line2: string;
  /** Ordered multi-series ramp. */
  series: string[];
}

export const CHART_PALETTES: Record<NamedTheme, ChartPalette> = {
  classic: {
    primary: "#0d1f3c",
    accent: "#b8975a",
    line1: "#54708f",
    line2: "#8a6f3c",
    series: ["#b8975a", "#0d1f3c", "#54708f", "#8a6f3c", "#7d94b5", "#d4b37a", "#33507c", "#a9b8cc"],
  },
  desert: {
    primary: "#0a1a2f",
    accent: "#b8975a",
    line1: "#3b5b84",
    line2: "#b8643a",
    series: ["#b8975a", "#12284a", "#3b5b84", "#b8643a", "#8fa3bc", "#d9c7a3", "#a05228", "#5d7ea6"],
  },
};

export function chartPalette(named: NamedTheme): ChartPalette {
  return CHART_PALETTES[named] ?? CHART_PALETTES.classic;
}
