import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Directory module schema (Phase 2) — owns its tables in the `directory`
 * Postgres schema (PROJECT_RULES.md module boundaries). It reads/writes
 * the shared reference data in `core` (people / organizations) only
 * through the directory service, and stores directory-specific state
 * (type tags, email templates, email links) here.
 */

export const TYPE_TAXONOMY = [
  "operator",
  "investor",
  "lp",
  "lender",
  "broker",
  "attorney",
  "accountant",
  "advisor",
  "seller",
  "portfolio_contact",
  "contact",
] as const;

export type DirectoryType = (typeof TYPE_TAXONOMY)[number];

/** Alias kept for callers that prefer the longer name. */
export const DIRECTORY_TYPES = TYPE_TAXONOMY;

export function isDirectoryType(v: string): v is DirectoryType {
  return (TYPE_TAXONOMY as readonly string[]).includes(v);
}

export const DIRECTORY_BACKFILL_KEY = "phase2-directory-v1";
export const DIRECTORY_TOPUP_KEY = "phase2-directory-topup";

let schemaReady: Promise<void> | null = null;

export function ensureDirectorySchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS directory`;

      await db`
        CREATE TABLE IF NOT EXISTS directory.type_tags (
          entity_kind TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          type TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          PRIMARY KEY (entity_kind, entity_id, type)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_type_tags_type_idx
        ON directory.type_tags (type, entity_kind)`;

      await db`
        CREATE TABLE IF NOT EXISTS directory.email_templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS directory.email_links (
          id TEXT PRIMARY KEY,
          email_ref TEXT NOT NULL DEFAULT '',
          subject TEXT NOT NULL DEFAULT '',
          from_addr TEXT NOT NULL DEFAULT '',
          email_date TEXT NOT NULL DEFAULT '',
          person_id TEXT,
          organization_id TEXT,
          company_id TEXT,
          note TEXT NOT NULL DEFAULT '',
          created_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_email_links_person_idx
        ON directory.email_links (person_id, created_at DESC)`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_email_links_org_idx
        ON directory.email_links (organization_id, created_at DESC)`;
      await db`
        CREATE INDEX IF NOT EXISTS directory_email_links_company_idx
        ON directory.email_links (company_id, created_at DESC)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/**
 * Idempotent backfill of directory.type_tags from the Phase 1 core
 * projection: core.people.kind and core.organizations.kind, where the
 * kind is a taxonomy type. INSERT … ON CONFLICT DO NOTHING, so it can
 * be re-run as a top-up for rows backfilled into core after Phase 2
 * first ran.
 */
export async function runDirectoryBackfill(): Promise<void> {
  const db = sql();
  await db`
    INSERT INTO directory.type_tags (entity_kind, entity_id, type)
    SELECT 'person', p.id, p.kind
    FROM core.people p
    WHERE p.deleted_at IS NULL
      AND p.kind IN ('operator', 'investor', 'lp', 'lender', 'broker',
        'attorney', 'accountant', 'advisor', 'seller',
        'portfolio_contact', 'contact')
    ON CONFLICT (entity_kind, entity_id, type) DO NOTHING`;
  await db`
    INSERT INTO directory.type_tags (entity_kind, entity_id, type)
    SELECT 'organization', o.id, o.kind
    FROM core.organizations o
    WHERE o.deleted_at IS NULL
      AND o.kind IN ('operator', 'investor', 'lp', 'lender', 'broker',
        'attorney', 'accountant', 'advisor', 'seller',
        'portfolio_contact', 'contact')
    ON CONFLICT (entity_kind, entity_id, type) DO NOTHING`;
}

let directoryReady: Promise<void> | null = null;
let lastBackfillCheckAt = 0;
const TOPUP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Schema + backfill, cheap to call per request: the schema promise is
 * module-cached, and after the first successful backfill the marker
 * checks run at most once per hour per process (mirroring Phase 1's
 * 'phase1-backfill-topup' pattern in lib/platform/migrate.ts). The
 * 'phase2-directory-v1' marker records the first full backfill; the
 * 'phase2-directory-topup' marker gates re-runs across processes.
 * Never throws for backfill failures — reads must not break because a
 * tag top-up failed; schema failures still throw.
 */
export async function ensureDirectory(): Promise<void> {
  if (!directoryReady) {
    directoryReady = (async () => {
      await ensureDirectorySchema();
    })().catch((err) => {
      directoryReady = null;
      throw err;
    });
  }
  await directoryReady;

  if (Date.now() - lastBackfillCheckAt < TOPUP_INTERVAL_MS) return;
  try {
    const db = sql();
    const marker = await db`
      SELECT key, done_at FROM core.migration_state
      WHERE key IN (${DIRECTORY_BACKFILL_KEY}, ${DIRECTORY_TOPUP_KEY})`;
    const byKey = new Map<string, unknown>();
    for (const r of marker) {
      const rec = r as Record<string, unknown>;
      byKey.set(String(rec.key ?? ""), rec.done_at);
    }
    if (byKey.has(DIRECTORY_BACKFILL_KEY)) {
      const topupAt = byKey.get(DIRECTORY_TOPUP_KEY);
      const t = topupAt ? new Date(String(topupAt)).getTime() : 0;
      if (t && Date.now() - t < TOPUP_INTERVAL_MS) {
        lastBackfillCheckAt = Date.now();
        return;
      }
      await runDirectoryBackfill();
      await db`
        INSERT INTO core.migration_state (key, done_at, detail)
        VALUES (${DIRECTORY_TOPUP_KEY}, now(), 'hourly idempotent top-up')
        ON CONFLICT (key) DO UPDATE SET done_at = now(),
          detail = 'hourly idempotent top-up'`;
    } else {
      await runDirectoryBackfill();
      await db`
        INSERT INTO core.migration_state (key, done_at, detail)
        VALUES (${DIRECTORY_BACKFILL_KEY}, now(), 'initial type_tags backfill')
        ON CONFLICT (key) DO NOTHING`;
    }
    lastBackfillCheckAt = Date.now();
  } catch (err) {
    console.error("[directory] backfill/top-up failed (will retry)", err);
  }
}
