/**
 * Focus & Theme — client-safe shared types and constants.
 *
 * This module must NEVER import server code (no ./db, no ./versions):
 * client components import the FocusMode/NamedTheme types and the
 * A&D sector name from here, while lib/platform/focus.ts (the server
 * service) re-exports them so server consumers have one home too.
 * Keeping the value-level constant here stops the Neon driver module
 * graph from leaking into the client bundle.
 */

export type FocusMode = "ad" | "all";
export type NamedTheme = "desert" | "classic";

export const AD_SECTOR_NAME = "Aerospace & Defense";

export interface TaxonomySegment {
  slug: string;
  label: string;
}

export interface NaicsEntry {
  code: string;
  title: string;
}

export interface FocusSettings {
  focus: FocusMode;
  taxonomy: TaxonomySegment[];
  naics: NaicsEntry[];
  /** Extra sector-criterion points in investor matching while Focus = A&D. */
  matchingBoost: number;
  updatedAt: string;
  updatedBy: string;
}

export interface FocusImpact {
  /** Records that a switch TO "ad" would hide behind the toggle. */
  dealsOutOfFocus: number;
  companiesOutOfFocus: number;
  fitTargetsOutOfFocus: number;
  pausedSources: { source: string; label: string }[];
  /** Plain-language lines for the confirmation dialog. */
  willHide: string[];
  willPause: string[];
  willRestore: string[];
}
