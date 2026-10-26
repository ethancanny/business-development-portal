"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { loadDataset } from "@/lib/client/datasets";
import {
  AD_SECTOR_NAME,
  type FocusSettings,
  type FocusImpact,
} from "@/lib/platform/focus-shared";

/**
 * Client Focus context (Focus & Theme, Oct 26, 2026). Loads the
 * workspace focus settings through the perf-pass dataset cache
 * (dataset `focus_theme`, version-gated: an unchanged focus costs
 * one versions check and no payload). Consumers use it to:
 * - default/limit sector selectors to the A&D taxonomy in Focus mode,
 * - hide out-of-focus records behind each list's "Show out-of-focus"
 *   toggle (local state per list, default off = hidden),
 * - render the "Out of focus" flag chip,
 * - switch copy to the focused variants.
 * Renders children immediately with the spec defaults (Focus = A&D)
 * so first paint matches the server default; the fetch reconciles.
 */

export interface FocusContextValue {
  ready: boolean;
  focus: FocusSettings["focus"];
  taxonomy: FocusSettings["taxonomy"];
  naics: FocusSettings["naics"];
  matchingBoost: number;
  impact: FocusImpact | null;
  role: string;
  /** True when a sector string is set and is not A&D (Focus mode only). */
  isOutOfFocus: (sector: string | null | undefined) => boolean;
  refresh: () => void;
}

const DEFAULT_SETTINGS: FocusSettings = {
  focus: "ad",
  taxonomy: [],
  naics: [],
  matchingBoost: 10,
  updatedAt: "",
  updatedBy: "",
};

const FocusContext = createContext<FocusContextValue>({
  ready: false,
  focus: "ad",
  taxonomy: [],
  naics: [],
  matchingBoost: 10,
  impact: null,
  role: "",
  isOutOfFocus: () => false,
  refresh: () => {},
});

export function useFocus() {
  return useContext(FocusContext);
}

interface FocusResponse {
  settings: FocusSettings;
  impact: FocusImpact;
  role: string;
}

export default function FocusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [data, setData] = useState<FocusResponse | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadDataset<FocusResponse>("focus_theme", "/api/platform/settings/focus", {
      force: tick > 0,
    })
      .then((res) => {
        if (!cancelled && res.data) setData(res.data);
      })
      .catch(() => { /* defaults stand */ });
    return () => {
      cancelled = true;
    };
  }, [tick]);

  const value = useMemo<FocusContextValue>(() => {
    const settings = data?.settings ?? DEFAULT_SETTINGS;
    const focus = settings.focus;
    return {
      ready: data !== null,
      focus,
      taxonomy: settings.taxonomy,
      naics: settings.naics,
      matchingBoost: settings.matchingBoost,
      impact: data?.impact ?? null,
      role: data?.role ?? "",
      isOutOfFocus: (sector) => {
        if (focus !== "ad") return false;
        const s = (sector ?? "").trim();
        return s !== "" && s !== AD_SECTOR_NAME;
      },
      refresh: () => setTick((t) => t + 1),
    };
  }, [data]);

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

/** The "Out of focus" flag chip (spec §2) — render beside any record
 * whose sector is outside the active focus. */
export function OutOfFocusChip() {
  return (
    <span className="badge badge-warn" title="Outside the active Focus — shown because “Show out-of-focus” is on">
      Out of focus
    </span>
  );
}

/** Shared list toggle (spec §2): hidden by default in Focus mode. */
export function ShowOutOfFocusToggle({
  show,
  onChange,
  hiddenCount,
}: {
  show: boolean;
  onChange: (v: boolean) => void;
  hiddenCount?: number;
}) {
  const { focus } = useFocus();
  if (focus !== "ad") return null;
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-500 dark:text-white/55">
      <input
        type="checkbox"
        checked={show}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[#b8975a]"
      />
      Show out-of-focus
      {typeof hiddenCount === "number" && hiddenCount > 0 && !show
        ? ` (${hiddenCount} hidden)`
        : ""}
    </label>
  );
}
