import { ensurePlatformSchema, sql } from "../platform/db";
import { ensureDiligenceSchema } from "./schema";

/**
 * Diligence automation schema (Part 5B) — public-record check
 * snapshots, assembled IC memos, and deal risk scores. These tables
 * extend the Phase 5 `diligence` schema owned by lib/diligence/schema.ts;
 * this guard follows the same cached-promise pattern and is kept
 * separate so the Phase 5 schema file stays untouched.
 *
 * Boundary rules:
 * - record_checks are SNAPSHOTS: every check run appends a row and
 *   links to the prior snapshot (prev_snapshot_id) with a computed
 *   changed flag — history is never overwritten.
 * - memos.payload is the assembled section list (deterministic, built
 *   from records by lib/diligence/memo.ts — never free-written), and
 *   memos.fingerprint stamps the source records it was built from so
 *   staleness is detectable without re-reading every source.
 * - risk_scores are append-only computations; the newest row per deal
 *   is the current score, older rows are the trend.
 * - Client financial figures NEVER appear in logs.
 */

export const RECORD_CHECK_ROUTES = ["automated", "manual"] as const;
export type RecordCheckRoute = (typeof RECORD_CHECK_ROUTES)[number];

export const RECORD_CHECK_STATUSES = ["clear", "finding", "unknown"] as const;
export type RecordCheckStatus = (typeof RECORD_CHECK_STATUSES)[number];

export const MEMO_STATUSES = ["draft", "approved"] as const;
export type MemoStatus = (typeof MEMO_STATUSES)[number];

let schemaReady: Promise<void> | null = null;

export function ensureAutomation(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      await ensureDiligenceSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS diligence`;

      // One row per check run (a snapshot). prev_snapshot_id chains to
      // the previous snapshot of the same (company, check_type);
      // changed / change_summary are computed at insert time by
      // lib/diligence/records.ts.
      await db`
        CREATE TABLE IF NOT EXISTS diligence.record_checks (
          id TEXT PRIMARY KEY,
          company_id TEXT NOT NULL,
          deal_id TEXT,
          workspace_id TEXT,
          check_type TEXT NOT NULL,
          source_name TEXT NOT NULL DEFAULT '',
          source_url TEXT NOT NULL DEFAULT '',
          route TEXT NOT NULL DEFAULT 'manual',
          result_status TEXT NOT NULL DEFAULT 'unknown',
          summary TEXT NOT NULL DEFAULT '',
          details JSONB NOT NULL DEFAULT '{}'::jsonb,
          checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          entered_by TEXT NOT NULL DEFAULT '',
          prev_snapshot_id TEXT,
          changed BOOLEAN NOT NULL DEFAULT false,
          change_summary TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS diligence_record_checks_company_idx
        ON diligence.record_checks (company_id, check_type, checked_at DESC)`;

      // Assembled investment-committee memos. One current memo per
      // deal (is_current); generating a new version retires the prior
      // current row. payload = { sections: MemoSection[] }.
      await db`
        CREATE TABLE IF NOT EXISTS diligence.memos (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL,
          company_id TEXT,
          workspace_id TEXT NOT NULL,
          version INT NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'draft',
          payload JSONB NOT NULL DEFAULT '{}'::jsonb,
          fingerprint TEXT NOT NULL DEFAULT '',
          is_current BOOLEAN NOT NULL DEFAULT true,
          generated_by TEXT NOT NULL DEFAULT '',
          generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          approved_by TEXT,
          approved_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS diligence_memos_deal_current_idx
        ON diligence.memos (deal_id, is_current)`;

      // Append-only risk computations. components / drivers / changes
      // are the full deterministic breakdown (see lib/diligence/risk.ts).
      await db`
        CREATE TABLE IF NOT EXISTS diligence.risk_scores (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL,
          company_id TEXT,
          workspace_id TEXT NOT NULL,
          score NUMERIC NOT NULL,
          band TEXT NOT NULL DEFAULT '',
          components JSONB NOT NULL DEFAULT '[]'::jsonb,
          drivers JSONB NOT NULL DEFAULT '[]'::jsonb,
          changes JSONB NOT NULL DEFAULT '{}'::jsonb,
          trigger_source TEXT NOT NULL DEFAULT '',
          computed_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS diligence_risk_scores_deal_idx
        ON diligence.risk_scores (deal_id, created_at DESC)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
