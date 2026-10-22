import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

/**
 * Platform data layer (Phase 1 restructure) — core schema.
 *
 * All platform tables live in the `core` schema so module schemas added
 * in later phases stay separate (PROJECT_RULES.md module boundaries).
 * The legacy public-schema tables (deals, executives, investors, …) are
 * NOT modified here; the backfill in migrate.ts projects them into core.
 *
 * The Neon DB is reached only server-side. ensurePlatformSchema() is
 * idempotent and safe to call on every cold start.
 */

export type Sql = NeonQueryFunction<false, false>;

let cached: Sql | null = null;
export function sql(): Sql {
  if (!cached) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    cached = neon(url);
  }
  return cached;
}

/** Same id shape as lib/db-json.ts / lib/db-postgres.ts. */
export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const NAME_SUFFIXES = new Set([
  "inc",
  "llc",
  "corp",
  "corporation",
  "co",
  "company",
  "ltd",
  "lp",
  "llp",
  "pllc",
  "pc",
]);

/**
 * Normalize a company/person/org name for dedupe + search matching:
 * lowercase, "&" → "and", punctuation stripped, trailing legal suffixes
 * (Inc/LLC/Corp/…) removed. Mirrors core.normalize_name() in SQL.
 */
export function normalizeName(name: string): string {
  const cleaned = (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ");
  const parts = cleaned.split(/\s+/).filter(Boolean);
  while (parts.length > 1 && NAME_SUFFIXES.has(parts[parts.length - 1])) {
    parts.pop();
  }
  return parts.join(" ");
}

/* ---------- row coercion helpers (shared by platform modules) ---------- */

export const str = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v);

export const num = (v: unknown): number => {
  const n = Number(v ?? 0);
  return isFinite(n) ? n : 0;
};

export const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return isFinite(n) ? n : null;
};

export function isoOrNull(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString();
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function iso(v: unknown): string {
  return isoOrNull(v) ?? new Date(0).toISOString();
}

/* ------------------------------ schema ------------------------------ */

let schemaReady: Promise<void> | null = null;

export function ensurePlatformSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS core`;

      // SQL twin of normalizeName() so backfills can normalize in-place.
      // NOTE: no backslash escapes in these patterns — inside a JS
      // template literal '\s' cooks to 's', which is how the original
      // version of this function shipped with an 's+' whitespace
      // collapse that corrupted stored normalized names (runs of the
      // letter "s" became spaces). This version mirrors the TS
      // normalizeName(): lowercase, & -> and, punctuation to spaces,
      // collapse, then strip trailing legal-suffix words.
      await db`
        CREATE OR REPLACE FUNCTION core.normalize_name(p_name TEXT)
        RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
          SELECT trim(regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    replace(lower(coalesce(p_name, '')), '&', ' and '),
                    '[^a-z0-9]+', ' ', 'g'),
                  ' +', ' ', 'g'),
                ' (inc|llc|corp|corporation|co|company|ltd|lp|llp|pllc|pc)$', '', 'g'),
              ' (inc|llc|corp|corporation|co|company|ltd|lp|llp|pllc|pc)$', '', 'g'),
            ' (inc|llc|corp|corporation|co|company|ltd|lp|llp|pllc|pc)$', '', 'g'))
        $$`;

      await db`
        CREATE TABLE IF NOT EXISTS core.migration_state (
          key TEXT PRIMARY KEY,
          done_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          detail TEXT
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS core.companies (
          id TEXT PRIMARY KEY,
          legacy_deal_id TEXT,
          legacy_mi_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          normalized_name TEXT NOT NULL DEFAULT '',
          vertical TEXT NOT NULL DEFAULT '',
          stage TEXT NOT NULL DEFAULT 'pipeline',
          deal_stage TEXT NOT NULL DEFAULT '',
          city TEXT NOT NULL DEFAULT '',
          state TEXT NOT NULL DEFAULT 'AZ',
          lat DOUBLE PRECISION,
          lng DOUBLE PRECISION,
          thesis_fit TEXT NOT NULL DEFAULT '',
          owner_context TEXT NOT NULL DEFAULT '',
          next_action TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          logo_url TEXT NOT NULL DEFAULT '',
          hero_url TEXT NOT NULL DEFAULT '',
          gallery JSONB NOT NULL DEFAULT '[]',
          rag TEXT,
          notes TEXT NOT NULL DEFAULT '',
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          search_vector TSVECTOR
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_companies_search_idx
        ON core.companies USING GIN (search_vector)`;
      await db`
        CREATE INDEX IF NOT EXISTS core_companies_stage_vertical_idx
        ON core.companies (stage, vertical)`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS core_companies_legacy_deal_uidx
        ON core.companies (legacy_deal_id) WHERE legacy_deal_id IS NOT NULL`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS core_companies_legacy_mi_uidx
        ON core.companies (legacy_mi_id) WHERE legacy_mi_id IS NOT NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS core.organizations (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          normalized_name TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '',
          website TEXT NOT NULL DEFAULT '',
          notes TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS core_organizations_normalized_uidx
        ON core.organizations (normalized_name)`;

      await db`
        CREATE TABLE IF NOT EXISTS core.people (
          id TEXT PRIMARY KEY,
          legacy_exec_id TEXT,
          legacy_investor_id TEXT,
          legacy_contact_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          normalized_name TEXT NOT NULL DEFAULT '',
          title TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          phone TEXT NOT NULL DEFAULT '',
          organization_id TEXT,
          organization_name TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT 'contact',
          notes TEXT NOT NULL DEFAULT '',
          photo_url TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          search_vector TSVECTOR
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_people_search_idx
        ON core.people USING GIN (search_vector)`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS core_people_legacy_exec_uidx
        ON core.people (legacy_exec_id) WHERE legacy_exec_id IS NOT NULL`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS core_people_legacy_investor_uidx
        ON core.people (legacy_investor_id) WHERE legacy_investor_id IS NOT NULL`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS core_people_legacy_contact_uidx
        ON core.people (legacy_contact_id) WHERE legacy_contact_id IS NOT NULL`;

      // Link/projection of the legacy deals table — the deal pipeline
      // itself stays in public.deals this phase; core.deals only carries
      // the company link and current stage for cross-module joins.
      await db`
        CREATE TABLE IF NOT EXISTS core.deals (
          id TEXT PRIMARY KEY,
          company_id TEXT,
          stage TEXT NOT NULL DEFAULT '',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_deals_company_idx
        ON core.deals (company_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS core.deal_participants (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL DEFAULT '',
          entity_kind TEXT NOT NULL DEFAULT '',
          entity_id TEXT NOT NULL DEFAULT '',
          entity_name TEXT NOT NULL DEFAULT '',
          role TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'identified',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (deal_id, entity_kind, entity_id, role)
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS core.comments (
          id TEXT PRIMARY KEY,
          entity_kind TEXT NOT NULL DEFAULT '',
          entity_id TEXT NOT NULL DEFAULT '',
          author TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          mentions JSONB NOT NULL DEFAULT '[]',
          source TEXT NOT NULL DEFAULT 'manual',
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_comments_entity_idx
        ON core.comments (entity_kind, entity_id, created_at DESC)`;

      await db`
        CREATE TABLE IF NOT EXISTS core.documents (
          id TEXT PRIMARY KEY,
          legacy_attachment_id TEXT,
          company_id TEXT,
          deal_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          mime TEXT NOT NULL DEFAULT '',
          size_bytes BIGINT NOT NULL DEFAULT 0,
          storage_url TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'manual',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          search_vector TSVECTOR
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_documents_search_idx
        ON core.documents USING GIN (search_vector)`;
      await db`
        CREATE INDEX IF NOT EXISTS core_documents_company_idx
        ON core.documents (company_id)`;

      // Phase 3 (Documents library): library fields on the canonical
      // document record. Version bytes/keys live in
      // dataroom.document_versions; extracted text in
      // dataroom.document_text — this row stays metadata-only.
      await db`
        ALTER TABLE core.documents
          ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
          ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]',
          ADD COLUMN IF NOT EXISTS content_hash TEXT NOT NULL DEFAULT '',
          ADD COLUMN IF NOT EXISTS extraction_status TEXT NOT NULL DEFAULT 'pending',
          ADD COLUMN IF NOT EXISTS current_version INT NOT NULL DEFAULT 1,
          ADD COLUMN IF NOT EXISTS person_id TEXT`;
      await db`
        CREATE INDEX IF NOT EXISTS core_documents_hash_idx
        ON core.documents (content_hash) WHERE content_hash <> ''`;
      await db`
        CREATE INDEX IF NOT EXISTS core_documents_deal_idx
        ON core.documents (deal_id)`;

      await db`
        CREATE TABLE IF NOT EXISTS core.activity_log (
          id TEXT PRIMARY KEY,
          entity_kind TEXT NOT NULL DEFAULT '',
          entity_id TEXT NOT NULL DEFAULT '',
          actor TEXT NOT NULL DEFAULT '',
          kind TEXT NOT NULL DEFAULT '',
          message TEXT NOT NULL DEFAULT '',
          source TEXT NOT NULL DEFAULT 'sync',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_activity_log_entity_idx
        ON core.activity_log (entity_id, created_at DESC)`;

      await db`
        CREATE TABLE IF NOT EXISTS core.events (
          id BIGSERIAL PRIMARY KEY,
          type TEXT NOT NULL DEFAULT '',
          entity_kind TEXT NOT NULL DEFAULT '',
          entity_id TEXT NOT NULL DEFAULT '',
          payload JSONB NOT NULL DEFAULT '{}',
          actor TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          processed_at TIMESTAMPTZ
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_events_unprocessed_idx
        ON core.events (created_at) WHERE processed_at IS NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS core.jobs (
          id TEXT PRIMARY KEY,
          kind TEXT NOT NULL DEFAULT '',
          payload JSONB NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'queued',
          attempts INT NOT NULL DEFAULT 0,
          last_error TEXT NOT NULL DEFAULT '',
          run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS core_jobs_status_run_after_idx
        ON core.jobs (status, run_after)`;

      // Summary tables — the ONLY source Overview reads (rules: never
      // recompute from raw data on page load).
      await db`
        CREATE TABLE IF NOT EXISTS core.overview_summary (
          id TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE TABLE IF NOT EXISTS core.company_cards (
          company_id TEXT PRIMARY KEY,
          data JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS core.usage_log (
          id BIGSERIAL PRIMARY KEY,
          query_name TEXT NOT NULL DEFAULT '',
          rows_returned INT NOT NULL DEFAULT 0,
          approx_bytes BIGINT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS core.audit_log (
          id BIGSERIAL PRIMARY KEY,
          entity_kind TEXT NOT NULL DEFAULT '',
          entity_id TEXT NOT NULL DEFAULT '',
          actor TEXT NOT NULL DEFAULT '',
          action TEXT NOT NULL DEFAULT '',
          changes JSONB NOT NULL DEFAULT '{}',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS core.user_roles (
          email TEXT PRIMARY KEY,
          role TEXT NOT NULL DEFAULT 'internal',
          scope JSONB NOT NULL DEFAULT '{}',
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      // Seed: Ethan is admin by default (also the code-level fallback in
      // permissions.ts, so access works even before this row exists).
      await db`
        INSERT INTO core.user_roles (email, role)
        VALUES ('ethan@cannycapitalpartners.com', 'admin')
        ON CONFLICT (email) DO NOTHING`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
