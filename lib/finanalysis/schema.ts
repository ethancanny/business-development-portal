import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Finanalysis module schema (Part 4B) — owns its tables in the
 * `finanalysis` Postgres schema (PROJECT_RULES.md module boundaries).
 * Pattern mirrors lib/financials/schema.ts: module-level cached promise,
 * reset on error, idempotent CREATEs, safe to call on every request.
 *
 * This module reads Phase 4 financials data ONLY through
 * lib/financials/service.ts functions — never direct SQL against the
 * `financials` schema. SQL here touches only `finanalysis` tables (and,
 * in the service, `core.jobs` / platform infra).
 *
 * analyses.data holds the pre-aggregated AnalysisPayload — charts and
 * pages read that payload, never recompute from raw lines on page load.
 * Analyses are DRAFTS until approved; only approved payloads are served
 * as published. Client financial figures NEVER appear in logs.
 */

export const ANALYSIS_STATUSES = ["draft", "approved"] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

export const ADJUSTMENT_KINDS = [
  "owner_comp",
  "one_time_fees",
  "nonrecurring",
  "related_party_rent",
  "anomaly_addback",
  "other",
] as const;
export type AdjustmentKind = (typeof ADJUSTMENT_KINDS)[number];

export const ADJUSTMENT_STATUSES = [
  "proposed",
  "accepted",
  "rejected",
] as const;
export type AdjustmentStatus = (typeof ADJUSTMENT_STATUSES)[number];

export const ADJUSTMENT_DIRECTIONS = ["add", "subtract"] as const;
export type AdjustmentDirection = (typeof ADJUSTMENT_DIRECTIONS)[number];

export const BENCHMARK_SOURCES = ["manual", "csv"] as const;
export type BenchmarkSource = (typeof BENCHMARK_SOURCES)[number];

let schemaReady: Promise<void> | null = null;

export function ensureFinanalysisSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS finanalysis`;

      // One row per analysis run for a company. is_current marks the
      // latest run; status stays 'draft' until a partner approves it
      // for publication (reviewed_*/approved_* render the sign-off
      // line). input_fingerprint is the sha256 of the sorted
      // [{id, version, updatedAt}] of the input statement sets.
      await db`
        CREATE TABLE IF NOT EXISTS finanalysis.analyses (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          deal_id TEXT,
          status TEXT NOT NULL DEFAULT 'draft',
          is_current BOOLEAN NOT NULL DEFAULT false,
          input_fingerprint TEXT NOT NULL DEFAULT '',
          inputs JSONB NOT NULL DEFAULT '{}',
          data JSONB NOT NULL DEFAULT '{}',
          reviewed_by TEXT,
          reviewed_at TIMESTAMPTZ,
          approved_by TEXT,
          approved_at TIMESTAMPTZ,
          created_by TEXT NOT NULL DEFAULT '',
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS finanalysis_analyses_company_status_idx
        ON finanalysis.analyses (company_id, status)`;
      await db`
        CREATE INDEX IF NOT EXISTS finanalysis_analyses_company_current_idx
        ON finanalysis.analyses (company_id, is_current)`;

      // Suggested QoE adjustments seeded by an analysis run. Still-
      // 'proposed' rows are replaced on the next run; decided rows
      // (accepted/rejected) are history and are preserved. amount is
      // NULL when user input is required at accept time
      // (requires_input: 'market_rent' | 'market_owner_comp'); the
      // stated amount then lives in source.statedAmount and the applied
      // amount is stated - inputValue, stored in decided_amount.
      // adjusted_set_id links an accept to the adjusted-layer draft it
      // was applied to (via the financials service only).
      await db`
        CREATE TABLE IF NOT EXISTS finanalysis.adjustments (
          id TEXT PRIMARY KEY,
          analysis_id TEXT NOT NULL,
          company_id TEXT NOT NULL,
          reported_set_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          label TEXT NOT NULL,
          amount DOUBLE PRECISION,
          direction TEXT NOT NULL DEFAULT 'add',
          rationale TEXT NOT NULL DEFAULT '',
          source JSONB NOT NULL DEFAULT '{}',
          requires_input TEXT,
          status TEXT NOT NULL DEFAULT 'proposed',
          decided_by TEXT,
          decided_at TIMESTAMPTZ,
          decided_amount DOUBLE PRECISION,
          adjusted_set_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS finanalysis_adjustments_company_status_idx
        ON finanalysis.adjustments (company_id, status)`;
      await db`
        CREATE INDEX IF NOT EXISTS finanalysis_adjustments_analysis_idx
        ON finanalysis.adjustments (analysis_id)`;

      // Industry benchmark bands (median / p25 / p75) matched to
      // metrics by metric_key + industry ('general' is the fallback
      // row). Seeded manually or via CSV import; sample_size < 10 (or
      // null) renders as thin/preliminary.
      await db`
        CREATE TABLE IF NOT EXISTS finanalysis.benchmarks (
          id TEXT PRIMARY KEY,
          industry TEXT NOT NULL DEFAULT 'general',
          metric_key TEXT NOT NULL,
          median DOUBLE PRECISION,
          p25 DOUBLE PRECISION,
          p75 DOUBLE PRECISION,
          sample_size INT,
          source TEXT NOT NULL DEFAULT 'manual',
          note TEXT NOT NULL DEFAULT '',
          updated_by TEXT NOT NULL DEFAULT '',
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS finanalysis_benchmarks_industry_metric_idx
        ON finanalysis.benchmarks (industry, metric_key)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/** Schema guard export used by routes/services. Cheap per request. */
export async function ensureFinanalysis(): Promise<void> {
  await ensureFinanalysisSchema();
}
