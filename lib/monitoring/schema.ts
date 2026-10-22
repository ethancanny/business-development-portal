import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Portfolio Monitoring module schema (Phase 8) — owns its tables in
 * the `monitoring` Postgres schema (PROJECT_RULES.md module
 * boundaries). Pattern mirrors lib/capital/schema.ts: module-level
 * cached promise, reset on error, idempotent CREATEs, safe on every
 * request.
 *
 * Separability (PROJECT_RULES.md): this module is the longest-lived
 * and must be movable to its own database later. It receives data
 * from the platform ONLY through the deal_closed handoff (a copied
 * baseline in monitoring.portfolio_companies) and shared reference
 * data (core.companies / core.deals / core.deal_participants /
 * core.documents / core.notifications). Cross-module reads of figures
 * go through the owning module's service functions only.
 *
 * Every table carries created_at / updated_at / deleted_at (soft
 * delete). Text ids carry the house-style module prefix.
 */

export const PERIOD_CADENCES = ["monthly", "quarterly"] as const;
export const PERIOD_STATUSES = ["pending", "received", "late"] as const;

export const KPI_UNITS = ["usd", "pct", "count", "x"] as const;

export const COVENANT_KEYS = [
  "max_total_leverage",
  "min_ebitda",
  "min_cash",
  "min_current_ratio",
] as const;

export const COVENANT_OPERATORS = ["<=", ">="] as const;

export const ALERT_RULE_KEYS = [
  "kpi_miss",
  "late_reporting",
  "covenant_headroom",
] as const;

export const ALERT_STATUSES = ["open", "acked", "resolved"] as const;

export const AGING_KINDS = ["ar", "ap"] as const;

/** Global alert rules seeded by ensureMonitoring (company_id NULL). */
const GLOBAL_ALERT_RULES: Array<{
  id: string;
  ruleKey: string;
  params: Record<string, unknown>;
}> = [
  { id: "monrule_late_reporting", ruleKey: "late_reporting", params: { graceDays: 0 } },
  {
    id: "monrule_covenant_headroom",
    ruleKey: "covenant_headroom",
    params: { minHeadroomPct: 10 },
  },
  {
    id: "monrule_kpi_miss",
    ruleKey: "kpi_miss",
    params: { thresholdPct: 10, metrics: ["revenue", "ebitda"] },
  },
];

let schemaReady: Promise<void> | null = null;

export function ensureMonitoring(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS monitoring`;

      // One row per closed deal's company — the deal_closed handoff
      // copy. company_id is UNIQUE: the handoff is idempotent on it.
      await db`
        CREATE TABLE IF NOT EXISTS monitoring.portfolio_companies (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          deal_id TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          closed_at TIMESTAMPTZ,
          closed_by TEXT NOT NULL DEFAULT '',
          baseline_company JSONB,
          baseline_financials JSONB,
          underwriting JSONB,
          vc_targets JSONB,
          vc_plan_id TEXT,
          participants JSONB,
          source TEXT NOT NULL DEFAULT 'deal_closed',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS mon_pc_company_uidx
        ON monitoring.portfolio_companies (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_pc_deal_idx
        ON monitoring.portfolio_companies (deal_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.reporting_periods (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          cadence TEXT NOT NULL DEFAULT 'monthly',
          period_start DATE,
          period_end DATE,
          due_date DATE,
          status TEXT NOT NULL DEFAULT 'pending',
          received_at TIMESTAMPTZ,
          document_id TEXT,
          statement_set_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          notes TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_periods_company_idx
        ON monitoring.reporting_periods (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_periods_company_period_idx
        ON monitoring.reporting_periods (company_id, period_end)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.kpi_values (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          period_end DATE,
          kpi_key TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT '',
          value NUMERIC,
          unit TEXT NOT NULL DEFAULT 'usd',
          source TEXT NOT NULL DEFAULT 'manual',
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS mon_kpi_live_uidx
        ON monitoring.kpi_values (company_id, period_end, kpi_key)
        WHERE deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_kpi_company_period_idx
        ON monitoring.kpi_values (company_id, period_end)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.budgets (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          fiscal_year INT NOT NULL,
          line_key TEXT NOT NULL DEFAULT '',
          amount NUMERIC,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS mon_budgets_live_uidx
        ON monitoring.budgets (company_id, fiscal_year, line_key)
        WHERE deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_budgets_company_idx
        ON monitoring.budgets (company_id)`;

      // Phase 9 — budget versioning. Budgets stop being a single
      // mutable truth: every budget line belongs to a version, and
      // only a version's APPROVED lines feed variance. The migration
      // below is idempotent: the versions table + version_id column
      // are created IF NOT EXISTS, the backfill only touches groups
      // that still have version-less live rows and have no v1 yet,
      // and the live unique index is swapped to include version_id.
      await db`
        CREATE TABLE IF NOT EXISTS monitoring.budget_versions (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          fiscal_year INT NOT NULL,
          version_no INT NOT NULL,
          kind TEXT NOT NULL DEFAULT 'annual',
          status TEXT NOT NULL DEFAULT 'draft',
          created_by TEXT NOT NULL DEFAULT '',
          approved_by TEXT NOT NULL DEFAULT '',
          approved_at TIMESTAMPTZ,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_budget_versions_company_idx
        ON monitoring.budget_versions (company_id, fiscal_year)`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS mon_budget_versions_live_uidx
        ON monitoring.budget_versions (company_id, fiscal_year, version_no)
        WHERE deleted_at IS NULL`;
      await db`
        ALTER TABLE monitoring.budgets
        ADD COLUMN IF NOT EXISTS version_id TEXT`;
      // Backfill: one approved v1 per (company, fiscal_year) that has
      // live budget rows with version_id NULL and no version yet.
      await db`
        INSERT INTO monitoring.budget_versions
          (id, company_id, fiscal_year, version_no, kind, status,
           created_by, approved_by, approved_at, notes)
        SELECT 'monbudv_' || substr(md5(b.company_id || ':' || b.fiscal_year::text), 1, 24),
               b.company_id, b.fiscal_year, 1, 'annual', 'approved',
               'migration', 'migration', now(),
               'Legacy budget lines migrated to version 1 (Phase 9).'
        FROM (SELECT DISTINCT company_id, fiscal_year
              FROM monitoring.budgets
              WHERE version_id IS NULL AND deleted_at IS NULL) b
        WHERE NOT EXISTS (
          SELECT 1 FROM monitoring.budget_versions v
          WHERE v.company_id = b.company_id
            AND v.fiscal_year = b.fiscal_year
            AND v.deleted_at IS NULL)
        ON CONFLICT (id) DO NOTHING`;
      await db`
        UPDATE monitoring.budgets b
        SET version_id = v.id
        FROM monitoring.budget_versions v
        WHERE b.version_id IS NULL
          AND v.company_id = b.company_id
          AND v.fiscal_year = b.fiscal_year
          AND v.version_no = 1
          AND v.deleted_at IS NULL`;
      // Swap the live unique index to the versioned key.
      await db`DROP INDEX IF EXISTS monitoring.mon_budgets_live_uidx`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS mon_budgets_live_uidx
        ON monitoring.budgets (company_id, version_id, line_key)
        WHERE deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.variance_notes (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          period_end DATE,
          metric_key TEXT NOT NULL DEFAULT '',
          commentary TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS mon_variance_live_uidx
        ON monitoring.variance_notes (company_id, period_end, metric_key)
        WHERE deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_variance_company_period_idx
        ON monitoring.variance_notes (company_id, period_end)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.vc_realized (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          initiative_id TEXT NOT NULL DEFAULT '',
          period_end DATE,
          realized_impact NUMERIC,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS mon_vc_realized_live_uidx
        ON monitoring.vc_realized (company_id, initiative_id, period_end)
        WHERE deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_vc_realized_company_period_idx
        ON monitoring.vc_realized (company_id, period_end)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.cash_positions (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          as_of DATE,
          cash_balance NUMERIC,
          revolver_limit NUMERIC,
          revolver_drawn NUMERIC,
          source TEXT NOT NULL DEFAULT 'manual',
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_cash_company_idx
        ON monitoring.cash_positions (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_cash_company_asof_idx
        ON monitoring.cash_positions (company_id, as_of)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.cashflow_weeks (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          week_start DATE,
          inflows NUMERIC,
          outflows NUMERIC,
          ending_balance NUMERIC,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS mon_cashflow_live_uidx
        ON monitoring.cashflow_weeks (company_id, week_start)
        WHERE deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_cashflow_company_idx
        ON monitoring.cashflow_weeks (company_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.aging_snapshots (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          as_of DATE,
          kind TEXT NOT NULL DEFAULT 'ar',
          current_amt NUMERIC,
          d31_60 NUMERIC,
          d61_90 NUMERIC,
          d90_plus NUMERIC,
          source TEXT NOT NULL DEFAULT 'manual',
          document_id TEXT,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_aging_company_idx
        ON monitoring.aging_snapshots (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_aging_company_asof_idx
        ON monitoring.aging_snapshots (company_id, as_of)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.debt_tranches (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          lender TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '',
          principal NUMERIC,
          current_balance NUMERIC,
          rate_pct NUMERIC,
          maturity DATE,
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_tranches_company_idx
        ON monitoring.debt_tranches (company_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.covenants (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          tranche_id TEXT,
          covenant_key TEXT NOT NULL DEFAULT '',
          label TEXT NOT NULL DEFAULT '',
          operator TEXT NOT NULL DEFAULT '>=',
          threshold NUMERIC,
          next_test_date DATE,
          active BOOLEAN NOT NULL DEFAULT true,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_covenants_company_idx
        ON monitoring.covenants (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_covenants_company_test_idx
        ON monitoring.covenants (company_id, next_test_date)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.covenant_tests (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          covenant_id TEXT NOT NULL,
          period_end DATE,
          computed_value NUMERIC,
          threshold NUMERIC,
          headroom_pct NUMERIC,
          status TEXT NOT NULL DEFAULT 'pass',
          detail JSONB,
          computed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_covenant_tests_company_idx
        ON monitoring.covenant_tests (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_covenant_tests_company_period_idx
        ON monitoring.covenant_tests (company_id, period_end)`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.alert_rules (
          id TEXT PRIMARY KEY,
          company_id TEXT,
          rule_key TEXT NOT NULL DEFAULT '',
          enabled BOOLEAN NOT NULL DEFAULT true,
          params JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_alert_rules_company_idx
        ON monitoring.alert_rules (company_id)`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS mon_alert_rules_global_uidx
        ON monitoring.alert_rules (rule_key)
        WHERE company_id IS NULL AND deleted_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS monitoring.alerts (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          rule_key TEXT NOT NULL DEFAULT '',
          severity TEXT NOT NULL DEFAULT 'medium',
          title TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          task_id TEXT,
          dedupe_key TEXT NOT NULL DEFAULT '',
          resolved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_alerts_company_idx
        ON monitoring.alerts (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS mon_alerts_dedupe_idx
        ON monitoring.alerts (company_id, dedupe_key, status)`;

      // Stored portfolio rollup read model (id = 'portfolio') —
      // refreshed on writes/events, never recomputed on page load.
      await db`
        CREATE TABLE IF NOT EXISTS monitoring.rollup_summary (
          id TEXT PRIMARY KEY,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      for (const rule of GLOBAL_ALERT_RULES) {
        await db`
          INSERT INTO monitoring.alert_rules (id, company_id, rule_key, params)
          VALUES (${rule.id}, NULL, ${rule.ruleKey},
            ${JSON.stringify(rule.params)}::jsonb)
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
