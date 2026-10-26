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

/** Raise-workspace Kanban stages (Redesign Step 1): the pipeline a
 * commitment moves through on a raise. Stored per commitment in
 * capital.commitments.pipeline_stage; the legacy stage/kind pair is
 * kept in sync by the service so older readers stay correct. */
export const PIPELINE_STAGES = [
  { key: "prospect", label: "Prospect" },
  { key: "intro", label: "Intro" },
  { key: "meeting", label: "Meeting" },
  { key: "interested", label: "Interested" },
  { key: "soft_circled", label: "Soft-circled" },
  { key: "committed", label: "Committed" },
  { key: "funded", label: "Funded" },
  { key: "passed", label: "Passed" },
] as const;

export const DOC_STATUSES = [
  "none",
  "draft",
  "sent",
  "signed",
  "countersigned",
  "filed",
] as const;

/** Default investor↔raise matching weights (points, sum 100) —
 * seeded into capital.matching_weights and editable in Settings. */
export const DEFAULT_MATCHING_WEIGHTS = {
  type: 30,
  checkSize: 20,
  sector: 20,
  structure: 10,
  geography: 10,
  activity: 10,
} as const;

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

/**
 * Type-flavored report templates (Redesign Step 1, Part B §3):
 * a teaser, an investment memo, and an investor update per investment
 * type. capital.report_templates.kind has no teaser/memo kind, so all
 * three reuse kind 'investor_update' with type-flavored names/bodies.
 * These are Canny communications only — never contract language.
 */
const REPORT_TEMPLATE_TYPES: Array<{ key: string; label: string }> = [
  { key: "platform_lbo", label: "Platform LBO" },
  { key: "add_on", label: "Add-on" },
  { key: "early_stage", label: "Early Stage" },
  { key: "minority_growth", label: "Minority Growth" },
];

const TYPE_FLAVORED_TEMPLATES: Array<{
  id: string;
  name: string;
  kind: string;
  body: string;
}> = REPORT_TEMPLATE_TYPES.flatMap((t) => [
  {
    id: `tpl_teaser_${t.key}`,
    name: `Teaser — ${t.label}`,
    kind: "investor_update",
    body: [
      `Teaser — {{deal_name}} ({{company_name}})`,
      "",
      `A ${t.label} opportunity presented by Canny Capital Partners.`,
      "",
      "Capital committed so far: {{committed}}",
      "",
      "Full details are available in the investment memo and data room.",
      "",
      "— Canny Capital Partners",
    ].join("\n"),
  },
  {
    id: `tpl_memo_${t.key}`,
    name: `Investment memo — ${t.label}`,
    kind: "investor_update",
    body: [
      `Investment memo — {{deal_name}} ({{company_name}})`,
      `Type: ${t.label} · As of {{as_of}}`,
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
    id: `tpl_update_${t.key}`,
    name: `Investor update — ${t.label}`,
    kind: "investor_update",
    body: [
      "Dear {{investor_name}},",
      "",
      `Update on {{company_name}} ({{deal_name}}), a ${t.label} investment, as of {{as_of}}.`,
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
]);

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
      // Redesign Step 1: Directory capital-profile tab fields —
      // geography / accredited status / relationship owner, plus the
      // type-aware matching inputs (invests-in types + per-type
      // check ranges). Additive only.
      await db`
        ALTER TABLE capital.investor_profiles
          ADD COLUMN IF NOT EXISTS geography TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE capital.investor_profiles
          ADD COLUMN IF NOT EXISTS accredited_status TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE capital.investor_profiles
          ADD COLUMN IF NOT EXISTS relationship_owner TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE capital.investor_profiles
          ADD COLUMN IF NOT EXISTS invests_in_types JSONB NOT NULL DEFAULT '[]'::jsonb`;
      await db`
        ALTER TABLE capital.investor_profiles
          ADD COLUMN IF NOT EXISTS check_by_type JSONB NOT NULL DEFAULT '{}'::jsonb`;

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
      // Redesign Step 1: SPV/entity name + next milestone for raise
      // cards, the timeline view, and the Action Center.
      await db`
        ALTER TABLE capital.raises
          ADD COLUMN IF NOT EXISTS entity_name TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE capital.raises
          ADD COLUMN IF NOT EXISTS next_milestone TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE capital.raises
          ADD COLUMN IF NOT EXISTS next_milestone_date DATE`;

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
      // Redesign Step 1: a commitment IS the investor↔raise
      // participation link record — Kanban pipeline stage, the four
      // money buckets (indicated / soft / hard / funded), owner,
      // document + wire status, expected funding date, and the
      // per-stage date stamps. Legacy amount/kind/stage stay and are
      // kept in sync by the service (see bucketAmounts there).
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS pipeline_stage TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS indicated_amount NUMERIC`;
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS soft_amount NUMERIC`;
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS hard_amount NUMERIC`;
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS funded_amount NUMERIC`;
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS owner TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS doc_status TEXT NOT NULL DEFAULT 'none'`;
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS wire_status TEXT NOT NULL DEFAULT 'pending'`;
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS expected_funding_date DATE`;
      await db`
        ALTER TABLE capital.commitments
          ADD COLUMN IF NOT EXISTS stage_dates JSONB NOT NULL DEFAULT '{}'::jsonb`;

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
        ALTER TABLE capital.deal_summary
          ADD COLUMN IF NOT EXISTS indicated_total NUMERIC NOT NULL DEFAULT 0`;

      // Redesign Step 1: editable investor↔raise matching weights
      // (Settings → MatchingWeightsCard). One global row.
      await db`
        CREATE TABLE IF NOT EXISTS capital.matching_weights (
          id TEXT PRIMARY KEY,
          weights JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        INSERT INTO capital.matching_weights (id, weights)
        VALUES ('global', ${JSON.stringify(DEFAULT_MATCHING_WEIGHTS)}::jsonb)
        ON CONFLICT (id) DO NOTHING`;

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
      for (const tpl of [...SYSTEM_TEMPLATES, ...TYPE_FLAVORED_TEMPLATES]) {
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
