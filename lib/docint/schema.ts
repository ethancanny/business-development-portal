import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Document intelligence schema (Part 5B) — its tables live in the
 * `diligence` Postgres schema alongside the diligence module it feeds
 * (the contract register lives in diligence.contracts).
 * Pattern mirrors lib/diligence/schema.ts: module-level cached
 * promise, reset on error, idempotent CREATEs, safe on every request.
 *
 * Boundary rules honored here:
 * - File bytes NEVER enter Postgres — runs/fields store extracted
 *   text snippets (values + short passages) only, keyed by the
 *   core.documents id.
 * - Client financial figures NEVER appear in logs.
 * - Azure configuration comes ONLY from process.env
 *   (AZURE_DOCINT_ENDPOINT / AZURE_DOCINT_KEY) — see provider.ts.
 */

export const DOCINT_RUN_STATUSES = [
  "running",
  "done",
  "error",
  "skipped_disabled",
  "no_text",
] as const;
export type DocintRunStatus = (typeof DOCINT_RUN_STATUSES)[number];

export const DOCINT_FIELD_STATUSES = [
  "provisional",
  "confirmed",
  "corrected",
  "rejected",
] as const;
export type DocintFieldStatus = (typeof DOCINT_FIELD_STATUSES)[number];

let schemaReady: Promise<void> | null = null;

export function ensureDocint(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS diligence`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.docint_settings (
          deal_id TEXT PRIMARY KEY,
          enabled BOOLEAN NOT NULL DEFAULT true,
          updated_by TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.docint_runs (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL,
          workspace_id TEXT,
          document_id TEXT NOT NULL,
          provider TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'running',
          pages INT,
          fields_extracted INT NOT NULL DEFAULT 0,
          error TEXT NOT NULL DEFAULT '',
          actor TEXT NOT NULL DEFAULT '',
          trigger_source TEXT NOT NULL DEFAULT 'manual',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          finished_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS docint_runs_deal_created_idx
        ON diligence.docint_runs (deal_id, created_at DESC)`;

      await db`
        CREATE TABLE IF NOT EXISTS diligence.docint_fields (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          deal_id TEXT NOT NULL,
          workspace_id TEXT,
          document_id TEXT NOT NULL,
          field_key TEXT NOT NULL,
          label TEXT NOT NULL DEFAULT '',
          value_text TEXT NOT NULL DEFAULT '',
          confidence NUMERIC,
          page INT,
          passage TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'provisional',
          corrected_value TEXT,
          reviewed_by TEXT NOT NULL DEFAULT '',
          reviewed_at TIMESTAMPTZ,
          applied_contract_id TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS docint_fields_document_idx
        ON diligence.docint_fields (document_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS docint_fields_deal_status_idx
        ON diligence.docint_fields (deal_id, status)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

export const ensureDocintSchema = ensureDocint;
