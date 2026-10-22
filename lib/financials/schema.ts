import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Financials module schema (Phase 4) — owns its tables in the
 * `financials` Postgres schema (PROJECT_RULES.md module boundaries).
 * Pattern mirrors lib/dataroom/schema.ts: module-level cached promise,
 * reset on error, idempotent CREATEs, safe to call on every request.
 *
 * A statement set is one extracted/reviewed statement package for one
 * period of one company (a "series" groups versions + the reported /
 * adjusted layers of the same underlying statements). Lines carry the
 * normalized (dollar) value AND the raw value as printed, plus source
 * provenance back to the originating document. company_summary is the
 * pre-aggregated read model charts/KPIs read — never recomputed from
 * lines on page load.
 *
 * Client financial figures NEVER appear in logs — callers log ids and
 * statuses only.
 */

export const STATEMENT_LAYERS = ["reported", "adjusted"] as const;
export type StatementLayer = (typeof STATEMENT_LAYERS)[number];

export const STATEMENT_SET_STATUSES = ["draft", "posted"] as const;
export type StatementSetStatus = (typeof STATEMENT_SET_STATUSES)[number];

export const EXTRACTION_STATUSES = [
  "pending",
  "done",
  "unsupported",
  "failed",
] as const;
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number];

export const PERIOD_TYPES = [
  "annual",
  "quarterly",
  "monthly",
  "ytd",
  "ttm",
] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

/** Basis enum — spelling is exactly 'COMPILED' (contract). */
export const STATEMENT_BASES = [
  "AUDITED",
  "REVIEWED",
  "COMPILED",
  "COMPANY-PREPARED",
  "TAX-BASIS",
] as const;
export type StatementBasis = (typeof STATEMENT_BASES)[number];

export const DEFAULT_BASIS: StatementBasis = "COMPANY-PREPARED";

let schemaReady: Promise<void> | null = null;

export function ensureFinancialsSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS financials`;

      await db`
        CREATE TABLE IF NOT EXISTS financials.statement_sets (
          id TEXT PRIMARY KEY,
          series_id TEXT NOT NULL,
          company_id TEXT NOT NULL,
          deal_id TEXT,
          document_id TEXT,
          layer TEXT NOT NULL DEFAULT 'reported',
          based_on_set_id TEXT,
          version INT NOT NULL DEFAULT 1,
          supersedes_id TEXT,
          restate_reason TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'draft',
          is_current BOOLEAN NOT NULL DEFAULT false,
          extraction_status TEXT NOT NULL DEFAULT 'pending',
          statement_kinds JSONB NOT NULL DEFAULT '[]',
          period_type TEXT NOT NULL DEFAULT 'annual',
          period_start DATE,
          period_end DATE,
          fiscal_year_end TEXT NOT NULL DEFAULT '',
          basis TEXT NOT NULL DEFAULT 'COMPANY-PREPARED',
          currency TEXT NOT NULL DEFAULT 'USD',
          unit_multiplier INT NOT NULL DEFAULT 1,
          units_label TEXT NOT NULL DEFAULT '',
          checks JSONB NOT NULL DEFAULT '{}',
          ebitda_override_note TEXT NOT NULL DEFAULT '',
          extraction JSONB NOT NULL DEFAULT '{}',
          created_by TEXT NOT NULL DEFAULT '',
          posted_by TEXT,
          posted_at TIMESTAMPTZ,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS financials_sets_company_status_idx
        ON financials.statement_sets (company_id, status)`;
      await db`
        CREATE INDEX IF NOT EXISTS financials_sets_series_layer_version_idx
        ON financials.statement_sets (series_id, layer, version)`;

      await db`
        CREATE TABLE IF NOT EXISTS financials.lines (
          id TEXT PRIMARY KEY,
          set_id TEXT NOT NULL,
          statement_kind TEXT NOT NULL,
          line_key TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          value DOUBLE PRECISION,
          raw_value DOUBLE PRECISION,
          is_derived BOOLEAN NOT NULL DEFAULT false,
          is_subtotal BOOLEAN NOT NULL DEFAULT false,
          confidence DOUBLE PRECISION,
          source JSONB NOT NULL DEFAULT '{}',
          sort INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS financials_lines_set_kind_sort_idx
        ON financials.lines (set_id, statement_kind, sort)`;

      // Pre-aggregated per-company read model (see the Phase 4 contract
      // for the `data` shape: periods / kpis / chartSeries / ttm / yoy /
      // latest / flags). Refreshed by the financials service on post,
      // never recomputed on page load.
      await db`
        CREATE TABLE IF NOT EXISTS financials.company_summary (
          company_id TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/** Schema guard export used by routes/services. Cheap per request. */
export async function ensureFinancials(): Promise<void> {
  await ensureFinancialsSchema();
}
