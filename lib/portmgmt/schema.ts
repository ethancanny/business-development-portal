import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Portfolio Management module schema (Phase 9) — owns its tables in
 * the `portmgmt` Postgres schema (PROJECT_RULES.md module boundaries).
 * Pattern mirrors lib/monitoring/schema.ts: module-level cached
 * promise, reset on error, idempotent CREATEs, safe on every request.
 *
 * Phase 9 scope (WS-A): the schema foundation for company-scoped
 * management logins and the portfolio-management surfaces WS-B/WS-C
 * build on — board meetings, lender certificates + borrowing base,
 * valuations, risk register + summary, cap table + distributions,
 * early-warning scores, exit plans, accounting connections + sync
 * runs, and reporting submissions.
 *
 * This module also extends core.user_roles with the columns the
 * company-scoped login store (lib/portmgmt/users.ts) needs:
 * display_name, password_hash (management users only — partners keep
 * authenticating through lib/auth.ts seed credentials), disabled_at.
 *
 * Every portmgmt table carries id / created_at / updated_at /
 * deleted_at (soft delete) unless its natural key replaces id:
 * risk_summary is a singleton keyed by id 'global' and
 * early_warning_scores is keyed by company_id (one current score
 * per company).
 */

let schemaReady: Promise<void> | null = null;

export function ensurePortmgmt(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();

      /* ---------------- core.user_roles extensions ---------------- */
      // Management (portfolio-company) logins live in the same
      // user_roles table as partner roles/scopes: role stays 'guest'
      // and scope carries { companyIds: [...] }. password_hash is set
      // ONLY for management users created via lib/portmgmt/users.ts.
      await db`
        ALTER TABLE core.user_roles
          ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT ''`;
      await db`
        ALTER TABLE core.user_roles
          ADD COLUMN IF NOT EXISTS password_hash TEXT`;
      await db`
        ALTER TABLE core.user_roles
          ADD COLUMN IF NOT EXISTS disabled_at TIMESTAMPTZ`;

      await db`CREATE SCHEMA IF NOT EXISTS portmgmt`;

      /* ------------------------- board ---------------------------- */
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.board_meetings (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          deal_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          starts_at TIMESTAMPTZ,
          ends_at TIMESTAMPTZ,
          location TEXT NOT NULL DEFAULT '',
          agenda TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'scheduled',
          pack_document_id TEXT,
          minutes TEXT NOT NULL DEFAULT '',
          decisions TEXT NOT NULL DEFAULT '',
          attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_board_company_idx
        ON portmgmt.board_meetings (company_id)`;
      // decisions is free text in the service + UI. An early ensure
      // run created it as JSONB, which rejects plain-text inserts
      // (22P02) — convert in place; no-op when already TEXT.
      await db`
        ALTER TABLE portmgmt.board_meetings
        ALTER COLUMN decisions TYPE TEXT USING decisions::text`;

      /* ------------------ lender / borrowing base ----------------- */
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.lender_certificates (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          as_of DATE,
          period_end DATE,
          document_id TEXT,
          tests_snapshot JSONB NOT NULL DEFAULT '[]'::jsonb,
          status TEXT NOT NULL DEFAULT 'generated',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_lender_cert_company_idx
        ON portmgmt.lender_certificates (company_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.borrowing_base_snapshots (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          as_of DATE,
          aging_snapshot_id TEXT,
          total_ar NUMERIC,
          over90_amount NUMERIC,
          eligible_ar NUMERIC,
          advance_rate NUMERIC,
          borrowing_base NUMERIC,
          revolver_limit NUMERIC,
          revolver_drawn NUMERIC,
          availability NUMERIC,
          not_applicable_reason TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_bb_company_idx
        ON portmgmt.borrowing_base_snapshots (company_id)`;

      /* ------------------------ valuations ------------------------ */
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.valuations (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          valued_as_of DATE,
          value NUMERIC,
          method TEXT NOT NULL DEFAULT 'other',
          notes TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_valuations_company_idx
        ON portmgmt.valuations (company_id)`;

      /* --------------------------- risks -------------------------- */
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.risks (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          category TEXT NOT NULL DEFAULT 'operational',
          title TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          severity TEXT NOT NULL DEFAULT 'medium',
          likelihood INT,
          owner_name TEXT NOT NULL DEFAULT '',
          mitigation TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          due_date DATE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_risks_company_idx
        ON portmgmt.risks (company_id)`;
      // Severity is a string enum (low/medium/high/critical) in the
      // service + UI. If an early ensure run created the column as INT,
      // convert it in place; both statements are no-ops when the column
      // is already TEXT with the right default.
      await db`
        ALTER TABLE portmgmt.risks
        ALTER COLUMN severity TYPE TEXT USING severity::text`;
      await db`
        ALTER TABLE portmgmt.risks
        ALTER COLUMN severity SET DEFAULT 'medium'`;

      // Singleton portfolio-wide risk summary (id 'global'), refreshed
      // by the risk service — a summary row, never recomputed on read.
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.risk_summary (
          id TEXT PRIMARY KEY,
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        INSERT INTO portmgmt.risk_summary (id, payload)
        VALUES ('global', '{}'::jsonb)
        ON CONFLICT (id) DO NOTHING`;

      /* ------------------------- cap table ------------------------ */
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.cap_holders (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          holder_kind TEXT NOT NULL DEFAULT 'entity',
          person_id TEXT,
          organization_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          units NUMERIC,
          share_class TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_cap_holders_company_idx
        ON portmgmt.cap_holders (company_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.cap_distributions (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          holder_id TEXT,
          person_id TEXT,
          amount NUMERIC,
          paid_on DATE,
          capital_entry_id TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_cap_dist_company_idx
        ON portmgmt.cap_distributions (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_cap_dist_holder_idx
        ON portmgmt.cap_distributions (holder_id)`;

      /* --------------------- early warning ------------------------ */
      // One CURRENT score per company — company_id is the primary key
      // (recompute upserts in place; components carry the breakdown).
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.early_warning_scores (
          company_id TEXT PRIMARY KEY,
          score NUMERIC,
          band TEXT NOT NULL DEFAULT 'unknown',
          components JSONB NOT NULL DEFAULT '{}'::jsonb,
          computed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;

      /* ------------------------- exit plans ----------------------- */
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.exit_plans (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          likely_buyer_types JSONB NOT NULL DEFAULT '[]'::jsonb,
          target_timing TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS portmgmt_exit_plans_live_uidx
        ON portmgmt.exit_plans (company_id) WHERE deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_exit_plans_company_idx
        ON portmgmt.exit_plans (company_id)`;

      /* -------------------- accounting sync ----------------------- */
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.acct_connections (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'not_connected',
          label TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          external_id TEXT NOT NULL DEFAULT '',
          config JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by TEXT NOT NULL DEFAULT '',
          last_sync_at TIMESTAMPTZ,
          updated_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS portmgmt_acct_conn_live_uidx
        ON portmgmt.acct_connections (company_id, provider)
        WHERE deleted_at IS NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_acct_conn_company_idx
        ON portmgmt.acct_connections (company_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.acct_sync_runs (
          id TEXT PRIMARY KEY,
          connection_id TEXT,
          company_id TEXT,
          provider TEXT,
          mode TEXT NOT NULL DEFAULT 'dry_run',
          status TEXT NOT NULL DEFAULT 'started',
          records_read INT NOT NULL DEFAULT 0,
          mapped_count INT NOT NULL DEFAULT 0,
          unmapped_count INT NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          finished_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_acct_runs_company_idx
        ON portmgmt.acct_sync_runs (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_acct_runs_conn_idx
        ON portmgmt.acct_sync_runs (connection_id)`;

      /* ----------------------- submissions ------------------------ */
      await db`
        CREATE TABLE IF NOT EXISTS portmgmt.submissions (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          period_id TEXT,
          kind TEXT NOT NULL DEFAULT 'statements',
          document_id TEXT,
          status TEXT NOT NULL DEFAULT 'recorded',
          submitted_by TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_submissions_company_idx
        ON portmgmt.submissions (company_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS portmgmt_submissions_period_idx
        ON portmgmt.submissions (period_id)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
