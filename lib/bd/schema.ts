import { ensurePlatformSchema, sql } from "../platform/db";
import {
  DEFAULT_STAGES_BY_TYPE,
  INVESTMENT_TYPE_LABELS,
  type InvestmentTypeKey,
} from "../types";

/**
 * Business Development — Investment Types schema (Step 1, Oct 23, 2026).
 *
 * PROJECT_RULES.md module boundaries: the BD module owns these tables
 * in the `bd` Postgres schema. The ONE deals table stays the legacy
 * public.deals record (investment_type / parent_deal_id /
 * sourced_from_* columns added there); everything type- or
 * sector-specific beyond the core record lives in the structured
 * metrics pair below — never as sparse columns on deals.
 *
 * - bd.type_config: one row per investment type — label, enabled
 *   (Minority Growth ships disabled behind this flag, no code change
 *   needed to enable it later), and the type's stage list (Settings
 *   edits these; deals validate against them).
 * - bd.metric_definitions: the configurable field catalog. applies_to
 *   is 'type:<key>' or 'sector:<pack key>'; config carries the view
 *   group ('primary' | 'hold'), enum options, and an optional type
 *   restriction for sector-pack fields that only apply to one type.
 * - bd.deal_metrics: (deal, metric key, value, period, source) —
 *   value_num for numeric kinds, value_text for text/enum kinds.
 * - bd.sector_packs: industry packs (Aerospace & Defense seeded);
 *   a pack applies automatically when a deal's industry matches.
 * - bd.migration_reports: the persistent Step 1 migration report
 *   (item 10) — deals scanned, per-stage from→to counts, unmapped.
 */

export interface TypeConfigRow {
  key: InvestmentTypeKey;
  label: string;
  enabled: boolean;
  stages: string[];
  sort: number;
}

export interface MetricDefinitionRow {
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
    /** New investment form (Oct 24, 2026): which form section this
     * field renders in. Assigned by the bd-form-sections-v1 migration
     * for the Step 1 seeds and carried in the seed config for fields
     * added later; editable in Settings (config route merges it). */
    section?: string;
  };
}

export interface SectorPackRow {
  key: string;
  label: string;
  industryMatch: string;
  enabled: boolean;
  sort: number;
}

const TYPE_ORDER: InvestmentTypeKey[] = [
  "platform_lbo",
  "add_on",
  "early_stage",
  "minority_growth",
];

type DefSeed = [
  key: string,
  label: string,
  appliesTo: string,
  dataType: MetricDefinitionRow["dataType"],
  sort: number,
  config?: MetricDefinitionRow["config"],
  required?: boolean,
];

const DEFINITION_SEEDS: DefSeed[] = [
  /* ---- Platform LBO — long-hold primaries ---- */
  ["leverage_x", "Leverage (Debt / EBITDA)", "type:platform_lbo", "multiple", 10],
  ["equity_check", "Equity check", "type:platform_lbo", "money", 20],
  ["fcf_yield_pct", "Free cash flow yield %", "type:platform_lbo", "pct", 30],
  ["roic_pct", "ROIC %", "type:platform_lbo", "pct", 40],
  ["dscr", "DSCR", "type:platform_lbo", "multiple", 50],
  /* LBO optional hold-period analysis (never the headline) */
  ["target_irr_pct", "Target IRR %", "type:platform_lbo", "pct", 110, { group: "hold" }],
  ["target_moic", "Target MOIC", "type:platform_lbo", "multiple", 120, { group: "hold" }],
  ["hold_years", "Hold period (years)", "type:platform_lbo", "number", 130, { group: "hold" }],

  /* ---- Add-on ---- */
  ["purchase_multiple", "Purchase multiple", "type:add_on", "multiple", 10],
  ["synergies_annual", "Synergies (annual)", "type:add_on", "money", 20],
  ["integration_cost", "Integration cost", "type:add_on", "money", 30],
  ["fit_score", "Fit score", "type:add_on", "number", 40],
  /* Add-on synergy split (New investment form, Oct 24, 2026) — the
   * form's Add-on metrics ask for cost and revenue synergies
   * separately; synergies_annual above stays as the combined figure. */
  ["synergies_cost", "Cost synergies (annual)", "type:add_on", "money", 25, { section: "addon_metrics" }],
  ["synergies_revenue", "Revenue synergies (annual)", "type:add_on", "money", 27, { section: "addon_metrics" }],

  /* ---- Early Stage ---- */
  ["arr", "ARR", "type:early_stage", "money", 10],
  ["mrr", "MRR", "type:early_stage", "money", 15],
  ["contract_revenue", "Contract revenue", "type:early_stage", "money", 20],
  ["burn_monthly", "Monthly burn", "type:early_stage", "money", 30],
  ["runway_months", "Runway (months)", "type:early_stage", "number", 40],
  ["gross_margin_pct", "Gross margin %", "type:early_stage", "pct", 50],
  ["round_size", "Round size", "type:early_stage", "money", 60],
  ["instrument", "Instrument", "type:early_stage", "enum", 70, { options: ["SAFE", "Convertible note", "Priced equity", "Other"] }],
  ["valuation_cap", "Valuation cap", "type:early_stage", "money", 80],
  ["ownership_pct", "Ownership %", "type:early_stage", "pct", 90],
  ["follow_on_reserves", "Follow-on reserves", "type:early_stage", "money", 100],
  /* Early Stage form fields (New investment form, Oct 24, 2026):
   * the Round / Traction / Team & market / Investors sections render
   * from these definitions (section carried in the seed config). */
  ["founders", "Founders", "type:early_stage", "text", 5, { section: "es_basics" }],
  ["round_stage", "Round stage", "type:early_stage", "enum", 55, { section: "round", options: ["Pre-seed", "Seed", "Series A", "Series B"] }],
  ["pre_money", "Pre-money valuation", "type:early_stage", "money", 65, { section: "round" }],
  ["discount_pct", "Discount %", "type:early_stage", "pct", 75, { section: "round" }],
  ["check_size", "Our check size", "type:early_stage", "money", 85, { section: "round" }],
  ["traction_growth_pct", "Growth % (YoY)", "type:early_stage", "pct", 25, { section: "traction" }],
  ["customers", "Customers", "type:early_stage", "number", 35, { section: "traction" }],
  ["team_notes", "Team notes", "type:early_stage", "text", 10, { section: "team_market" }],
  ["market_notes", "Market notes", "type:early_stage", "text", 20, { section: "team_market" }],
  ["lead_investor", "Lead investor", "type:early_stage", "text", 10, { section: "investors_es" }],
  ["co_investors", "Co-investors", "type:early_stage", "text", 20, { section: "investors_es" }],

  /* ---- Aerospace & Defense sector pack (additive, any type) ---- */
  ["backlog", "Backlog", "sector:aerospace_defense", "money", 10],
  ["book_to_bill", "Book-to-bill", "sector:aerospace_defense", "multiple", 20],
  ["contract_mix", "Contract mix", "sector:aerospace_defense", "enum", 30, { options: ["Mostly fixed-price", "Mixed", "Mostly cost-plus"] }],
  ["customer_concentration", "Top customer % of revenue", "sector:aerospace_defense", "pct", 40],
  ["certifications", "Certifications (AS9100 / ITAR / NADCAP / CMMC)", "sector:aerospace_defense", "text", 50],
  ["facility_clearance", "Facility clearance", "sector:aerospace_defense", "enum", 60, { options: ["None", "Secret", "Top Secret"] }],
  ["sole_source_status", "Qualified / sole-source status", "sector:aerospace_defense", "enum", 70, { options: ["Competitive", "Qualified", "Sole-source"] }],
  ["machine_utilization_pct", "Machine utilization %", "sector:aerospace_defense", "pct", 80],
  ["equipment_age_years", "Avg equipment age (years)", "sector:aerospace_defense", "number", 90],
  ["machinist_headcount", "Skilled machinist headcount", "sector:aerospace_defense", "number", 100],
  ["gov_budget_exposure", "Government budget exposure", "sector:aerospace_defense", "text", 110],
  /* Early-stage A&D additions */
  ["trl", "Technology readiness level (TRL 1–9)", "sector:aerospace_defense", "number", 210, { types: ["early_stage"] }],
  ["sbir_phase", "SBIR/STTR phase", "sector:aerospace_defense", "enum", 220, { types: ["early_stage"], options: ["None", "Phase I", "Phase II", "Phase III"] }],
  ["sbir_awards_total", "SBIR/STTR awards (total $)", "sector:aerospace_defense", "money", 230, { types: ["early_stage"] }],
  ["ip_data_rights", "IP & data rights", "sector:aerospace_defense", "text", 240, { types: ["early_stage"] }],
  ["export_control_status", "Export control status", "sector:aerospace_defense", "enum", 250, { types: ["early_stage"], options: ["None", "EAR", "ITAR", "ITAR + CUI"] }],
  ["path_to_production", "Path to production", "sector:aerospace_defense", "text", 260, { types: ["early_stage"] }],
];

let bdReady: Promise<void> | null = null;

export function ensureBd(): Promise<void> {
  if (!bdReady) {
    bdReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS bd`;
      await db`
        CREATE TABLE IF NOT EXISTS bd.type_config (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL DEFAULT '',
          enabled BOOLEAN NOT NULL DEFAULT true,
          stages JSONB NOT NULL DEFAULT '[]',
          sort INT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by TEXT NOT NULL DEFAULT ''
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS bd.metric_definitions (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL DEFAULT '',
          applies_to TEXT NOT NULL DEFAULT '',
          data_type TEXT NOT NULL DEFAULT 'number',
          sort INT NOT NULL DEFAULT 0,
          required BOOLEAN NOT NULL DEFAULT false,
          enabled BOOLEAN NOT NULL DEFAULT true,
          config JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS bd.deal_metrics (
          deal_id TEXT NOT NULL,
          metric_key TEXT NOT NULL,
          value_num NUMERIC,
          value_text TEXT,
          period TEXT,
          source TEXT NOT NULL DEFAULT 'manual',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_by TEXT NOT NULL DEFAULT '',
          PRIMARY KEY (deal_id, metric_key)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS bd_deal_metrics_key_idx
        ON bd.deal_metrics (metric_key)`;
      await db`
        CREATE TABLE IF NOT EXISTS bd.sector_packs (
          key TEXT PRIMARY KEY,
          label TEXT NOT NULL DEFAULT '',
          industry_match TEXT NOT NULL DEFAULT '',
          enabled BOOLEAN NOT NULL DEFAULT true,
          sort INT NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS bd.migration_reports (
          id TEXT PRIMARY KEY,
          migration_key TEXT NOT NULL,
          ran_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          actor TEXT NOT NULL DEFAULT '',
          report JSONB NOT NULL DEFAULT '{}'
        )`;

      /* Seeds — idempotent; existing rows (Settings edits) win. */
      for (let i = 0; i < TYPE_ORDER.length; i++) {
        const key = TYPE_ORDER[i];
        await db`
          INSERT INTO bd.type_config (key, label, enabled, stages, sort)
          VALUES (${key}, ${INVESTMENT_TYPE_LABELS[key]},
            ${key !== "minority_growth"},
            ${JSON.stringify(DEFAULT_STAGES_BY_TYPE[key])}::jsonb, ${i * 10})
          ON CONFLICT (key) DO NOTHING`;
      }
      for (const [key, label, appliesTo, dataType, sort, config, required] of DEFINITION_SEEDS) {
        await db`
          INSERT INTO bd.metric_definitions
            (key, label, applies_to, data_type, sort, required, config)
          VALUES (${key}, ${label}, ${appliesTo}, ${dataType}, ${sort},
            ${Boolean(required)}, ${JSON.stringify(config ?? {})}::jsonb)
          ON CONFLICT (key) DO NOTHING`;
      }
      await db`
        INSERT INTO bd.sector_packs (key, label, industry_match, enabled, sort)
        VALUES ('aerospace_defense', 'Aerospace & Defense',
          'Aerospace & Defense', true, 10)
        ON CONFLICT (key) DO NOTHING`;
    })().catch((err) => {
      bdReady = null;
      throw err;
    });
  }
  return bdReady;
}
