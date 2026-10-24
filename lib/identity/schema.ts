import { sql } from "../platform/db";

/**
 * Deal Identity schema (Oct 24, 2026) — additive only, idempotent.
 *
 * Identity columns ride on the central records themselves (PROJECT_
 * RULES: company is the central entity): core.companies, and — so
 * Directory organization entries can carry the same mark — core.
 * organizations. Logo BYTES never enter the database; the columns
 * hold only object-storage keys + metadata. core.recent_deals backs
 * the top-bar Recent deals dropdown (per user, last opened first).
 *
 * The DDL runs lazily from ensureIdentitySchema() (schemaReady
 * pattern, like lib/db-postgres) so this module never has to hook the
 * shared platform boot; a marker row ('deal-identity-v1') is stamped
 * into core.migration_state for the record.
 */

export const IDENTITY_MIGRATION_KEY = "deal-identity-v1";

let schemaReady: Promise<void> | null = null;

export function ensureIdentitySchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = sql();
      // core.migration_state is created by ensurePlatformSchema; the
      // identity routes run after ensurePlatform in practice, but
      // create it defensively so this module is self-sufficient.
      await db`
        CREATE TABLE IF NOT EXISTS core.migration_state (
          key TEXT PRIMARY KEY,
          done_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          detail TEXT
        )`;
      // --- identity columns: core.companies ---
      await db`ALTER TABLE core.companies ADD COLUMN IF NOT EXISTS website TEXT NOT NULL DEFAULT ''`;
      await db`ALTER TABLE core.companies ADD COLUMN IF NOT EXISTS logo_key TEXT NOT NULL DEFAULT ''`;
      await db`ALTER TABLE core.companies ADD COLUMN IF NOT EXISTS logo_renditions JSONB NOT NULL DEFAULT '{}'`;
      await db`ALTER TABLE core.companies ADD COLUMN IF NOT EXISTS logo_version INTEGER NOT NULL DEFAULT 0`;
      await db`ALTER TABLE core.companies ADD COLUMN IF NOT EXISTS logo_source TEXT NOT NULL DEFAULT ''`;
      await db`ALTER TABLE core.companies ADD COLUMN IF NOT EXISTS logo_mime TEXT NOT NULL DEFAULT ''`;
      await db`ALTER TABLE core.companies ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ`;
      await db`ALTER TABLE core.companies ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT ''`;
      await db`ALTER TABLE core.companies ADD COLUMN IF NOT EXISTS accent_suggested TEXT NOT NULL DEFAULT ''`;
      // --- identity columns: core.organizations ---
      await db`ALTER TABLE core.organizations ADD COLUMN IF NOT EXISTS logo_key TEXT NOT NULL DEFAULT ''`;
      await db`ALTER TABLE core.organizations ADD COLUMN IF NOT EXISTS logo_renditions JSONB NOT NULL DEFAULT '{}'`;
      await db`ALTER TABLE core.organizations ADD COLUMN IF NOT EXISTS logo_version INTEGER NOT NULL DEFAULT 0`;
      await db`ALTER TABLE core.organizations ADD COLUMN IF NOT EXISTS logo_source TEXT NOT NULL DEFAULT ''`;
      await db`ALTER TABLE core.organizations ADD COLUMN IF NOT EXISTS logo_mime TEXT NOT NULL DEFAULT ''`;
      await db`ALTER TABLE core.organizations ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ`;
      await db`ALTER TABLE core.organizations ADD COLUMN IF NOT EXISTS accent_color TEXT NOT NULL DEFAULT ''`;
      await db`ALTER TABLE core.organizations ADD COLUMN IF NOT EXISTS accent_suggested TEXT NOT NULL DEFAULT ''`;
      // --- recent deals (top-bar dropdown) ---
      await db`
        CREATE TABLE IF NOT EXISTS core.recent_deals (
          user_key TEXT NOT NULL,
          company_id TEXT NOT NULL,
          deal_id TEXT NOT NULL DEFAULT '',
          name_snapshot TEXT NOT NULL DEFAULT '',
          stage_snapshot TEXT NOT NULL DEFAULT '',
          opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (user_key, company_id)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_recent_deals_user_idx
        ON core.recent_deals (user_key, opened_at DESC)`;
      await db`
        INSERT INTO core.migration_state (key, detail)
        VALUES (${IDENTITY_MIGRATION_KEY},
          'identity columns on core.companies + core.organizations; core.recent_deals')
        ON CONFLICT (key) DO NOTHING`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
