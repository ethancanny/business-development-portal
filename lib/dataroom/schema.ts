import { ensurePlatformSchema, sql } from "../platform/db";

/**
 * Data Rooms module schema (Phase 3) — owns its tables in the
 * `dataroom` Postgres schema (PROJECT_RULES.md module boundaries).
 * Canonical document records stay in core.documents; this schema holds
 * rooms, folders, checklist, guests, access log, Q&A, document
 * versions, extracted text, and upload sessions. Other modules reach
 * this data only through lib/dataroom/* service functions.
 */

export interface TemplateFolder {
  name: string;
  items: string[];
}

export interface RoomTemplateStructure {
  folders: TemplateFolder[];
}

/** Ethan's Phase 3 spec: the default folder template for a new room. */
export const DEFAULT_TEMPLATE_NAME = "Standard diligence room";

export const DEFAULT_TEMPLATE: RoomTemplateStructure = {
  folders: [
    {
      name: "Corporate",
      items: [
        "Certificate / articles of incorporation",
        "Operating agreement / bylaws",
        "Cap table & equity ledger",
        "Board minutes & written consents",
        "Certificate of good standing",
      ],
    },
    {
      name: "Financials",
      items: [
        "Financial statements — last 3 fiscal years",
        "Year-to-date financial statements",
        "Trailing twelve months (TTM) P&L",
        "Accounts receivable / payable aging",
        "Debt schedule",
      ],
    },
    {
      name: "Tax",
      items: [
        "Federal tax returns — last 3 years",
        "State tax returns — last 3 years",
        "Sales & use tax filings",
        "Payroll tax filings (941 / 940)",
      ],
    },
    {
      name: "Legal/Contracts",
      items: [
        "Material customer contracts",
        "Material vendor contracts",
        "Real estate / equipment leases",
        "Litigation & claims summary",
        "IP assignments, trademarks & licenses",
      ],
    },
    {
      name: "Operations",
      items: [
        "Organization chart",
        "SOPs / process documentation",
        "Equipment list",
        "Business licenses & permits",
      ],
    },
    {
      name: "HR",
      items: [
        "Employee roster & compensation schedule",
        "Employment / contractor agreements",
        "Benefits plan summaries",
        "Retirement plan documents",
        "Pending HR claims or disputes",
      ],
    },
    {
      name: "Insurance",
      items: [
        "Insurance policies (all lines)",
        "Claims history — last 3 years",
        "Certificates of insurance",
      ],
    },
    {
      name: "Environmental",
      items: [
        "Phase I / environmental reports",
        "Environmental permits & compliance records",
        "Hazardous materials inventory",
      ],
    },
    {
      name: "IT/Systems",
      items: [
        "Systems & software inventory",
        "Data security / IT policies",
        "Key SaaS & IT contracts",
      ],
    },
  ],
};

export const CHECKLIST_STATUSES = ["missing", "received", "waived", "na"] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const GUEST_ACCESS_LEVELS = ["view", "download"] as const;
export type GuestAccessLevel = (typeof GUEST_ACCESS_LEVELS)[number];

/** 200 MB cap per file (rules: cap upload size). */
export const MAX_FILE_BYTES = 200 * 1024 * 1024;
/** 2 MB chunks — safely under the serverless request-body ceiling. */
export const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;

let schemaReady: Promise<void> | null = null;

export function ensureDataRoomSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS dataroom`;

      await db`
        CREATE TABLE IF NOT EXISTS dataroom.templates (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL DEFAULT '',
          structure JSONB NOT NULL DEFAULT '{"folders":[]}',
          is_default BOOLEAN NOT NULL DEFAULT false,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS dataroom.rooms (
          id TEXT PRIMARY KEY,
          deal_id TEXT NOT NULL DEFAULT '',
          company_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT 'local',
          provider_ref TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          domain_allowlist JSONB NOT NULL DEFAULT '[]',
          created_by TEXT NOT NULL DEFAULT '',
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      // One ACTIVE room per deal (spec: one room per deal).
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS dataroom_rooms_deal_uidx
        ON dataroom.rooms (deal_id)
        WHERE deleted_at IS NULL AND deal_id <> ''`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_rooms_company_idx
        ON dataroom.rooms (company_id)`;
      // Export-control safeguards (Investment Types Step 1, Oct 23,
      // 2026): U.S.-persons-only flag + restricted access (guest
      // invites limited to approved parties) on every room.
      await db`
        ALTER TABLE dataroom.rooms
        ADD COLUMN IF NOT EXISTS us_persons_only BOOLEAN NOT NULL DEFAULT false`;
      await db`
        ALTER TABLE dataroom.rooms
        ADD COLUMN IF NOT EXISTS restricted_access BOOLEAN NOT NULL DEFAULT false`;

      await db`
        CREATE TABLE IF NOT EXISTS dataroom.folders (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          parent_id TEXT,
          name TEXT NOT NULL DEFAULT '',
          sort INT NOT NULL DEFAULT 0,
          is_template BOOLEAN NOT NULL DEFAULT false,
          deleted_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_folders_room_idx
        ON dataroom.folders (room_id, sort)`;

      // Placement of a canonical document (core.documents) in a room.
      await db`
        CREATE TABLE IF NOT EXISTS dataroom.room_documents (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          folder_id TEXT,
          document_id TEXT NOT NULL,
          added_by TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (room_id, document_id)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_room_docs_doc_idx
        ON dataroom.room_documents (document_id)`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_room_docs_folder_idx
        ON dataroom.room_documents (room_id, folder_id)`;

      // The room checklist — Phase 5 (Due Diligence) consumes this via
      // the service functions in lib/dataroom/service.ts.
      await db`
        CREATE TABLE IF NOT EXISTS dataroom.checklist_items (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          folder_id TEXT,
          label TEXT NOT NULL DEFAULT '',
          required BOOLEAN NOT NULL DEFAULT true,
          status TEXT NOT NULL DEFAULT 'missing',
          document_id TEXT,
          sort INT NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_checklist_room_idx
        ON dataroom.checklist_items (room_id, sort)`;

      // Guest grants: the raw token is shown once at creation; only its
      // SHA-256 hash is stored. Expiry + revocation enforced at read.
      await db`
        CREATE TABLE IF NOT EXISTS dataroom.guests (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          email TEXT NOT NULL DEFAULT '',
          name TEXT NOT NULL DEFAULT '',
          token_hash TEXT NOT NULL,
          access_level TEXT NOT NULL DEFAULT 'view',
          expires_at TIMESTAMPTZ NOT NULL,
          revoked_at TIMESTAMPTZ,
          created_by TEXT NOT NULL DEFAULT '',
          last_accessed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE UNIQUE INDEX IF NOT EXISTS dataroom_guests_token_uidx
        ON dataroom.guests (token_hash)`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_guests_room_idx
        ON dataroom.guests (room_id, created_at DESC)`;

      // Who viewed/downloaded what. For the interim local provider this
      // is written by our own file/read paths (complete). SharePoint
      // rooms will fetch the equivalent from Graph on demand (cached
      // 15 min) once the Files/Sites scopes exist.
      await db`
        CREATE TABLE IF NOT EXISTS dataroom.access_log (
          id BIGSERIAL PRIMARY KEY,
          room_id TEXT,
          document_id TEXT,
          actor TEXT NOT NULL DEFAULT '',
          actor_kind TEXT NOT NULL DEFAULT 'internal',
          action TEXT NOT NULL DEFAULT '',
          detail TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_access_room_idx
        ON dataroom.access_log (room_id, created_at DESC)`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_access_doc_idx
        ON dataroom.access_log (document_id, created_at DESC)`;

      await db`
        CREATE TABLE IF NOT EXISTS dataroom.qa_threads (
          id TEXT PRIMARY KEY,
          room_id TEXT NOT NULL,
          document_id TEXT,
          title TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'open',
          created_by TEXT NOT NULL DEFAULT '',
          created_by_kind TEXT NOT NULL DEFAULT 'guest',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_qa_room_idx
        ON dataroom.qa_threads (room_id, updated_at DESC)`;
      await db`
        CREATE TABLE IF NOT EXISTS dataroom.qa_messages (
          id TEXT PRIMARY KEY,
          thread_id TEXT NOT NULL,
          author TEXT NOT NULL DEFAULT '',
          author_kind TEXT NOT NULL DEFAULT 'guest',
          body TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_qa_msg_thread_idx
        ON dataroom.qa_messages (thread_id, created_at ASC)`;

      // One row per stored version of a document. core.documents points
      // at the current version; restore creates a NEW version copying
      // an older one's bytes (history is never rewritten).
      await db`
        CREATE TABLE IF NOT EXISTS dataroom.document_versions (
          id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL,
          version INT NOT NULL,
          storage_key TEXT NOT NULL DEFAULT '',
          provider TEXT NOT NULL DEFAULT 'local',
          size_bytes BIGINT NOT NULL DEFAULT 0,
          mime TEXT NOT NULL DEFAULT '',
          content_hash TEXT NOT NULL DEFAULT '',
          uploaded_by TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          UNIQUE (document_id, version)
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_doc_versions_doc_idx
        ON dataroom.document_versions (document_id, version DESC)`;

      // Extracted text — kept OUT of list payloads (query rules);
      // the extraction job also folds it into core.documents'
      // search_vector so content is findable via global search.
      await db`
        CREATE TABLE IF NOT EXISTS dataroom.document_text (
          document_id TEXT PRIMARY KEY,
          text TEXT NOT NULL DEFAULT '',
          extractor TEXT NOT NULL DEFAULT '',
          extracted_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;

      await db`
        CREATE TABLE IF NOT EXISTS dataroom.upload_sessions (
          id TEXT PRIMARY KEY,
          room_id TEXT,
          folder_id TEXT,
          document_id TEXT,
          deal_id TEXT,
          company_id TEXT,
          filename TEXT NOT NULL DEFAULT '',
          mime TEXT NOT NULL DEFAULT '',
          tags JSONB NOT NULL DEFAULT '[]',
          total_size BIGINT NOT NULL DEFAULT 0,
          chunk_size INT NOT NULL DEFAULT 2097152,
          received_bytes BIGINT NOT NULL DEFAULT 0,
          temp_key TEXT NOT NULL DEFAULT '',
          uploaded_by TEXT NOT NULL DEFAULT '',
          note TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL DEFAULT 'active',
          expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '24 hours'),
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS dataroom_uploads_status_idx
        ON dataroom.upload_sessions (status, expires_at)`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/** Schema + default-template seed. Cheap to call per request. */
export async function ensureDataRoom(): Promise<void> {
  await ensureDataRoomSchema();
  const db = sql();
  const rows = await db`
    SELECT id FROM dataroom.templates WHERE is_default LIMIT 1`;
  if (!rows.length) {
    const { newId } = await import("../platform/db");
    await db`
      INSERT INTO dataroom.templates (id, name, structure, is_default)
      VALUES (${newId()}, ${DEFAULT_TEMPLATE_NAME},
        ${JSON.stringify(DEFAULT_TEMPLATE)}::jsonb, true)
      ON CONFLICT DO NOTHING`;
  }
}
