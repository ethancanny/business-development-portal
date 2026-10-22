import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Investors & Capital module schema (Phase 7) — owns its tables in the
 * `capital` Postgres schema (PROJECT_RULES.md module boundaries).
 * Pattern mirrors lib/valuecreation/schema.ts: module-level cached
 * promise, reset on error, idempotent CREATEs, safe on every request.
 *
 * Boundary rules honored here:
 * - Investor identity lives in the Directory (core.people /
 *   core.organizations via lib/directory/service.ts). This module
 *   stores ONLY the capital-specific profile extension, keyed by the
 *   Directory person id — never a second copy of name/firm/contact.
 * - Deal/company context resolves through lib/diligence/service.ts
 *   (getDealContext); financial figures come ONLY through
 *   lib/finanalysis/service.ts (getPublishedAnalysis /
 *   getWorkingCapital) — adjusted EBITDA and the WC peg are never
 *   re-entered or recomputed here.
 * - Data-room sharing reuses lib/dataroom services (guest grants +
 *   access log); this module stores no document data.
 * - Every record carries created_at / updated_at / deleted_at (soft
 *   delete) and a source column where sensible.
 */

export const INVESTOR_TYPES = [
  { key: "lp", label: "LP" },
  { key: "family_office", label: "Family office" },
  { key: "co_invest", label: "Co-invest" },
  { key: "hnw_advisor", label: "HNW / advisor" },
  { key: "other", label: "Other" },
] as const;

export const INVESTOR_STATUSES = [
  "exploring",
  "active",
  "committed",
  "passed",
] as const;

export const COMMITMENT_KINDS = ["soft", "hard"] as const;
export const COMMITMENT_STAGES = [
  "indicated",
  "committed",
  "funded",
  "passed",
] as const;

export const IC_AREAS = [
  { key: "market", label: "Market" },
  { key: "business_quality", label: "Business quality" },
  { key: "management", label: "Management" },
  { key: "deal_terms", label: "Deal terms" },
  { key: "risks", label: "Risks" },
] as const;

export const IC_DECISIONS = [
  "approved",
  "declined",
  "approved_with_conditions",
] as const;

export const REPORT_ENTRY_TYPES = [
  "capital_call",
  "distribution",
  "nav",
] as const;

/** Rendered wherever a report section depends on Portfolio
 * Monitoring data that only exists after Phase 8 — an honest empty
 * state, never a fabricated figure. */
export const MONITORING_PENDING_MARKER =
  "Portfolio KPI detail: available after Phase 8 (Portfolio Monitoring).";

const SYSTEM_TEMPLATES: Array<{
  id: string;
  name: string;
  kind: string;
  body: string;
}> = [
  {
    id: "tpl_investor_update",
    name: "Investor update",
    kind: "investor_update",
    body: [
      "Dear {{investor_name}},",
      "",
      "Update on {{company_name}} ({{deal_name}}) as of {{as_of}}.",
      "",
      "Capital committed: {{committed}}",
      "Capital called: {{capital_called}}",
      "Distributions: {{distributions}}",
      "Net asset value: {{nav}}",
      "",
      "{{monitoring_section}}",
      "",
      "— Canny Capital Partners",
    ].join("\n"),
  },
  {
    id: "tpl_capital_statement",
    name: "Capital account statement",
    kind: "capital_statement",
    body: [
      "Capital account statement — {{investor_name}}",
      "Deal: {{deal_name}} ({{company_name}}) · As of {{as_of}}",
      "",
      "Commitment: {{committed}}",
      "Capital called: {{capital_called}}",
      "Distributions: {{distributions}}",
      "Net asset value: {{nav}}",
      "",
      "{{monitoring_section}}",
    ].join("\n"),
  },
];

let schemaReady: Promise<void> | null = null;

export function ensureCapital(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS capital`;

      await db`
        CREATE TABLE IF NOT EXISTS capital.investor_profiles (
          id TEXT PRIMARY KEY,
          person_id TEXT NOT NULL,
          investor_type TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'exploring',
          intro_source TEXT NOT NULL DEFAULT '',
          last_touch_at TIMESTAMPTZ,
          thesis_sectors JSONB NOT NULL DEFAULT '[]'::jsonb,
          deal_size_min NUMERIC,
          deal_size_max NUMERIC,
          check_size_min NUMERIC,
          check_size_max NUMERIC,
          structure_prefs TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS cap_profiles_person_live_uidx
        ON capital.investor_profiles (person_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS capital.raises (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL,
          company_id TEXT,
          target_raise NUMERIC NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open',
          notes TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS cap_raises_deal_open_uidx
        ON capital.raises (deal_id)
        WHERE status = 'open' AND deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS cap_raises_deal_idx
        ON capital.raises (deal_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS capital.commitments (
          id TEXT PRIMARY KEY,
          raise_id TEXT NOT NULL,
          deal_id TEXT NOT NULL,
          investor_person_id TEXT NOT NULL,
          amount NUMERIC NOT NULL DEFAULT 0,
          kind TEXT NOT NULL DEFAULT 'soft',
          stage TEXT NOT NULL DEFAULT 'indicated',
          notes TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS cap_commitments_raise_idx
        ON capital.commitments (raise_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS cap_commitments_deal_idx
        ON capital.commitments (deal_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS cap_commitments_investor_idx
        ON capital.commitments (investor_person_id)`;

      // Stored read model: refreshed on every raise/commitment/report
      // write (and on investor_commitment_changed) — rollups are
      // never recomputed on page load.
      await db`
        CREATE TABLE IF NOT EXISTS capital.deal_summary (
          deal_id TEXT PRIMARY KEY,
          target_raise NUMERIC NOT NULL DEFAULT 0,
          soft_total NUMERIC NOT NULL DEFAULT 0,
          hard_total NUMERIC NOT NULL DEFAULT 0,
          funded_total NUMERIC NOT NULL DEFAULT 0,
          by_stage JSONB NOT NULL DEFAULT '{}'::jsonb,
          investor_count INT NOT NULL DEFAULT 0,
          called_total NUMERIC NOT NULL DEFAULT 0,
          distributed_total NUMERIC NOT NULL DEFAULT 0,
          nav_total NUMERIC NOT NULL DEFAULT 0,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS capital.economics_inputs (
          deal_id TEXT PRIMARY KEY,
          ebitda_override NUMERIC,
          entry_multiple NUMERIC,
          leverage_multiple NUMERIC,
          exit_multiple NUMERIC,
          growth_pct NUMERIC,
          hold_years NUMERIC,
          advisory_fee_pct NUMERIC,
          financing_fee_pct NUMERIC,
          mgmt_fee_pct NUMERIC,
          pref_pct NUMERIC,
          carry_pct NUMERIC,
          rollover_equity NUMERIC,
          debt_paydown_pct NUMERIC,
          snapshot JSONB,
          snapshot_at TIMESTAMPTZ,
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS capital.valuation_params (
          id TEXT PRIMARY KEY,
          entry_multiple_low NUMERIC NOT NULL DEFAULT 4,
          entry_multiple_high NUMERIC NOT NULL DEFAULT 8,
          target_irr NUMERIC NOT NULL DEFAULT 0.20,
          leverage_low NUMERIC NOT NULL DEFAULT 2,
          leverage_high NUMERIC NOT NULL DEFAULT 4,
          entry_multiple NUMERIC NOT NULL DEFAULT 5,
          leverage_multiple NUMERIC NOT NULL DEFAULT 3,
          exit_multiple NUMERIC NOT NULL DEFAULT 5,
          growth_pct NUMERIC NOT NULL DEFAULT 0.05,
          hold_years NUMERIC NOT NULL DEFAULT 5,
          advisory_fee_pct NUMERIC NOT NULL DEFAULT 0.02,
          financing_fee_pct NUMERIC NOT NULL DEFAULT 0.01,
          mgmt_fee_pct NUMERIC NOT NULL DEFAULT 0,
          pref_pct NUMERIC NOT NULL DEFAULT 0.08,
          carry_pct NUMERIC NOT NULL DEFAULT 0.20,
          debt_paydown_pct NUMERIC NOT NULL DEFAULT 0.20,
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        INSERT INTO capital.valuation_params (id) VALUES ('global')
        ON CONFLICT (id) DO NOTHING`;

      await db`
        CREATE TABLE IF NOT EXISTS capital.ic_scorecards (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL,
          scores JSONB NOT NULL DEFAULT '{}'::jsonb,
          notes JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS cap_ic_scorecards_deal_live_uidx
        ON capital.ic_scorecards (deal_id) WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS capital.ic_decisions (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL,
          decision TEXT NOT NULL,
          conditions TEXT NOT NULL DEFAULT '',
          votes JSONB NOT NULL DEFAULT '[]'::jsonb,
          notes TEXT NOT NULL DEFAULT '',
          decided_by TEXT NOT NULL DEFAULT '',
          decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS cap_ic_decisions_deal_idx
        ON capital.ic_decisions (deal_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS capital.report_entries (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL,
          investor_person_id TEXT,
          entry_type TEXT NOT NULL,
          amount NUMERIC NOT NULL DEFAULT 0,
          as_of DATE NOT NULL DEFAULT CURRENT_DATE,
          notes TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS cap_report_entries_deal_idx
        ON capital.report_entries (deal_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS cap_report_entries_investor_idx
        ON capital.report_entries (investor_person_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS capital.report_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'investor_update',
          body TEXT NOT NULL DEFAULT '',
          is_system BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      for (const tpl of SYSTEM_TEMPLATES) {
        await db`
          INSERT INTO capital.report_templates (id, name, kind, body, is_system)
          VALUES (${tpl.id}, ${tpl.name}, ${tpl.kind}, ${tpl.body}, true)
          ON CONFLICT (id) DO NOTHING`;
      }
    })().catch((err) => {
      // Reset on error so the next request retries (house pattern).
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
