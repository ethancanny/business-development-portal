import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Document Generation module schema (Phase 10) — owns its tables in
 * the `docgen` Postgres schema (PROJECT_RULES.md module boundaries).
 * Pattern mirrors lib/financials/schema.ts + lib/dataroom/schema.ts:
 * module-level cached promise, reset on error, idempotent CREATEs,
 * safe to call on every request (ensure-on-request DDL).
 *
 * Tables:
 * - docgen.templates   — reusable document templates with {{merge}}
 *   fields in `body`. `key` is the stable seed/custom identifier.
 * - docgen.generations — one row per generated document: which
 *   template produced which core.documents record, for which deal /
 *   company, by whom.
 * - docgen.envelopes   — e-signature envelope attempts against a
 *   generated (or any library) document. Phase 10 is a FRAMEWORK:
 *   rows record honest states (e.g. "setup_required") — a row is
 *   never written with a fake "sent" state.
 */

export interface DocgenTemplateRow {
  id: string;
  key: string;
  name: string;
  description: string;
  body: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface DocgenGenerationRow {
  id: string;
  templateId: string | null;
  templateKey: string;
  templateName: string;
  documentId: string;
  documentName: string;
  dealId: string | null;
  companyId: string | null;
  actor: string;
  createdAt: string;
}

export interface DocgenEnvelopeRow {
  id: string;
  documentId: string;
  dealId: string | null;
  provider: string;
  status: string;
  externalId: string | null;
  recipients: Array<{ name: string; email: string }>;
  detail: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

let schemaReady: Promise<void> | null = null;

export function ensureDocgenSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS docgen`;

      await db`
        CREATE TABLE IF NOT EXISTS docgen.templates (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS docgen_templates_key_uidx
        ON docgen.templates (key) WHERE deleted_at IS NULL AND key <> ''`;

      await db`
        CREATE TABLE IF NOT EXISTS docgen.generations (
          id TEXT PRIMARY KEY,
          template_id TEXT,
          template_key TEXT NOT NULL DEFAULT '',
          document_id TEXT NOT NULL DEFAULT '',
          deal_id TEXT,
          company_id TEXT,
          actor TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS docgen_generations_deal_idx
        ON docgen.generations (deal_id, created_at DESC)`;
      await db`
        CREATE INDEX IF NOT EXISTS docgen_generations_company_idx
        ON docgen.generations (company_id, created_at DESC)`;
      await db`
        CREATE INDEX IF NOT EXISTS docgen_generations_document_idx
        ON docgen.generations (document_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS docgen.envelopes (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL DEFAULT '',
          deal_id TEXT,
          provider TEXT NOT NULL DEFAULT 'in-house',
          status TEXT NOT NULL DEFAULT '',
          external_id TEXT,
          recipients JSONB NOT NULL DEFAULT '[]',
          detail TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS docgen_envelopes_document_idx
        ON docgen.envelopes (document_id, created_at DESC)`;
      // Provider is the in-house signing module (Ethan's Oct 22
      // decision) — keep the column default provider-agnostic even if
      // the table was created by the first Phase 10 deploy.
      await db`
        ALTER TABLE docgen.envelopes
        ALTER COLUMN provider SET DEFAULT 'in-house'`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
