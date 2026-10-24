"use client";

/**
 * Investment Types — shared client bits (Step 1, Oct 23, 2026).
 * Payload shapes mirror lib/bd/service.ts (BdConfig / BdBootstrap);
 * the bootstrap endpoint is the single client read. TypeBadge,
 * metric formatting, and the applicable-fields rule (type fields +
 * sector packs matching the deal's industry) live here so the table,
 * cards, modal, and profile surfaces can never drift apart.
 */

import { INVESTMENT_TYPE_LABELS, type InvestmentTypeKey } from "@/lib/types";
import { fmtMoney } from "@/lib/format";

export interface BdTypeConfig {
  key: InvestmentTypeKey;
  label: string;
  enabled: boolean;
  stages: string[];
  sort: number;
}

export interface BdMetricDefinition {
  key: string;
  label: string;
  appliesTo: string;
  dataType: "money" | "multiple" | "pct" | "number" | "text" | "enum" | "bool" | "date";
  sort: number;
  required: boolean;
  enabled: boolean;
  config: {
    group?: "primary" | "hold";
    options?: string[];
    types?: string[];
    /** New investment form section key (Oct 24, 2026). */
    section?: string;
  };
}

export interface BdSectorPack {
  key: string;
  label: string;
  industryMatch: string;
  enabled: boolean;
  sort: number;
}

export interface BdConfig {
  types: BdTypeConfig[];
  definitions: BdMetricDefinition[];
  sectorPacks: BdSectorPack[];
}

export interface DealMetricValue {
  num: number | null;
  text: string | null;
  period: string | null;
  source: string;
  updatedAt: string;
}

export interface BdBootstrap {
  config: BdConfig;
  metricsByDeal: Record<string, Record<string, DealMetricValue>>;
  sourcedFromOptions: {
    portfolioCompanies: Array<{ id: string; label: string }>;
    marketInsights: Array<{ id: string; label: string }>;
  };
}

let bootstrapCache: Promise<BdBootstrap | null> | null = null;

export function fetchBdBootstrap(
  force = false
): Promise<BdBootstrap | null> {
  if (force || !bootstrapCache) {
    bootstrapCache = fetch("/api/platform/investment-types/bootstrap")
      .then((r) => (r.ok ? (r.json() as Promise<BdBootstrap>) : null))
      .catch(() => null);
  }
  return bootstrapCache;
}

export function typeLabel(key: string | undefined | null): string {
  return (
    INVESTMENT_TYPE_LABELS[(key ?? "platform_lbo") as InvestmentTypeKey] ??
    key ??
    "Platform LBO"
  );
}

const BADGE_CLS: Record<string, string> = {
  platform_lbo:
    "bg-[#0d1f3c] text-white dark:bg-[#b8975a] dark:text-[#0d1f3c]",
  add_on:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200",
  early_stage:
    "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
  minority_growth:
    "bg-slate-100 text-slate-600 dark:bg-white/10 dark:text-white/60",
};

export function TypeBadge({
  type,
  className = "",
}: {
  type: string | undefined | null;
  className?: string;
}) {
  const key = (type ?? "platform_lbo") as InvestmentTypeKey;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${BADGE_CLS[key] ?? BADGE_CLS.platform_lbo} ${className}`}
    >
      {typeLabel(key)}
    </span>
  );
}

export function stagesForType(
  cfg: BdConfig | null,
  typeKey: string
): string[] {
  const t = cfg?.types.find((x) => x.key === typeKey);
  return t?.stages ?? [];
}

/** Type fields + enabled sector packs whose industry matches. */
export function applicableDefs(
  cfg: BdConfig | null,
  typeKey: string,
  industry: string
): BdMetricDefinition[] {
  if (!cfg) return [];
  const ind = (industry ?? "").trim().toLowerCase();
  const packKeys = new Set(
    cfg.sectorPacks
      .filter(
        (p) =>
          p.enabled &&
          p.industryMatch.trim().toLowerCase() !== "" &&
          p.industryMatch.trim().toLowerCase() === ind
      )
      .map((p) => `sector:${p.key}`)
  );
  return cfg.definitions
    .filter((d) => d.enabled)
    .filter((d) => {
      if (d.appliesTo === `type:${typeKey}`) return true;
      if (packKeys.has(d.appliesTo)) {
        const only = d.config.types;
        return !only || only.includes(typeKey);
      }
      return false;
    })
    .sort((a, b) => a.sort - b.sort || a.key.localeCompare(b.key));
}

export function fmtMetricValue(
  def: BdMetricDefinition,
  v: DealMetricValue | undefined
): string {
  if (!v) return "—";
  if (v.num !== null && v.num !== undefined) {
    switch (def.dataType) {
      case "money":
        return fmtMoney(v.num);
      case "pct":
        return `${v.num}%`;
      case "multiple":
        return `${v.num}×`;
      default:
        return v.num.toLocaleString("en-US");
    }
  }
  return v.text ?? "—";
}

/** The metric's raw editable string (form fields). */
export function metricRawValue(
  def: BdMetricDefinition,
  v: DealMetricValue | undefined
): string {
  if (!v) return "";
  if (v.num !== null && v.num !== undefined) return String(v.num);
  return v.text ?? "";
}
