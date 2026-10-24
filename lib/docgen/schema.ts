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

export type DocgenTemplateScope = "deal" | "investor" | "general";
export type DocgenTemplateStatus = "draft" | "approved";
export type DocgenTemplateSourceFormat = "text" | "docx";

export interface DocgenTemplateRow {
  id: string;
  key: string;
  name: string;
  description: string;
  body: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Contract generation (Oct 24, 2026): versioned, approval-gated
   * templates. `version` bumps on every content edit; an edit also
   * returns the template to draft (approval applies to a version). */
  version: number;
  status: DocgenTemplateStatus;
  approvedBy: string;
  approvedNote: string;
  approvedAt: string | null;
  scope: DocgenTemplateScope;
  sourceFormat: DocgenTemplateSourceFormat;
  /** Storage key of an uploaded .docx template file (sourceFormat
   * "docx"); placeholders are filled inside word/document.xml. */
  docxStorageKey: string | null;
  docxFilename: string;
}

/* --------------------- contracts (Oct 24, 2026) --------------------- */

export type ContractStatus =
  | "draft"
  | "in_review"
  | "out_for_signature"
  | "executed";

export interface ContractKeyDates {
  exclusivityExpiry: string | null;
  closing: string | null;
  renewal: string | null;
}

export interface ContractSigner {
  name: string;
  email: string;
  title: string;
  order: number;
  status: "pending" | "sent" | "viewed" | "signed" | "declined";
  signedAt: string | null;
  envelopeId: string | null;
}

export interface ContractRow {
  id: string;
  title: string;
  templateId: string | null;
  templateKey: string;
  templateName: string;
  templateVersion: number;
  scope: DocgenTemplateScope;
  companyId: string | null;
  companyName: string;
  dealId: string | null;
  investorPersonId: string | null;
  investorName: string;
  counterpartyPersonId: string | null;
  counterpartyName: string;
  counterpartyEmail: string;
  counterpartyTitle: string;
  counterpartyCompany: string;
  status: ContractStatus;
  currentVersion: number;
  roomId: string | null;
  keyDates: ContractKeyDates;
  signers: ContractSigner[];
  fieldValues: Record<string, string>;
  aiSummary: string;
  aiSummaryVersion: number | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface ContractVersionRow {
  id: string;
  contractId: string;
  version: number;
  kind: "generated" | "redline" | "executed";
  documentId: string;
  documentName: string;
  pdfDocumentId: string | null;
  pdfDocumentName: string;
  note: string;
  aiChangeSummary: string;
  createdBy: string;
  createdAt: string;
}

export interface ContractEventRow {
  id: string;
  contractId: string;
  actor: string;
  kind: string;
  detail: string;
  createdAt: string;
}

/** One preset signature field on a generated document (pdf-lib
 * bottom-up coordinates, absolute page index). Persisted on the
 * generation so the signing module can stamp + seal in template
 * mode without re-deriving geometry. */
export interface DocgenSignatureBlock {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  roleLabel: string;
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
  signatureBlocks: DocgenSignatureBlock[] | null;
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
      // Preset signature blocks for signable templates (in-house
      // e-signature build): JSONB array of DocgenSignatureBlock.
      await db`
        ALTER TABLE docgen.generations
        ADD COLUMN IF NOT EXISTS signature_blocks JSONB`;

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

      /* ------- Contract generation (Oct 24, 2026) -------
       * Marker-guarded migration `docgen-contracts-v1`: templates gain
       * version / approval state / scope / source format (existing
       * seeds land as status='draft' via the column default, so the
       * approved-only generation rule holds from the first boot), and
       * the contracts tables are created. The guarded statements are
       * themselves idempotent (IF NOT EXISTS), so a lost marker can
       * never corrupt data — it would simply re-run no-ops. */
      await db`
        CREATE TABLE IF NOT EXISTS docgen.schema_migrations (
          marker TEXT PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      const markerRows = await db`
        SELECT marker FROM docgen.schema_migrations
        WHERE marker = 'docgen-contracts-v1'`;
      if (!markerRows.length) {
        await db`
          ALTER TABLE docgen.templates
          ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1`;
        await db`
          ALTER TABLE docgen.templates
          ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'`;
        await db`
          ALTER TABLE docgen.templates
          ADD COLUMN IF NOT EXISTS approved_by TEXT NOT NULL DEFAULT ''`;
        await db`
          ALTER TABLE docgen.templates
          ADD COLUMN IF NOT EXISTS approved_note TEXT NOT NULL DEFAULT ''`;
        await db`
          ALTER TABLE docgen.templates
          ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`;
        await db`
          ALTER TABLE docgen.templates
          ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'deal'`;
        await db`
          ALTER TABLE docgen.templates
          ADD COLUMN IF NOT EXISTS source_format TEXT NOT NULL DEFAULT 'text'`;
        await db`
          ALTER TABLE docgen.templates
          ADD COLUMN IF NOT EXISTS docx_storage_key TEXT`;
        await db`
          ALTER TABLE docgen.templates
          ADD COLUMN IF NOT EXISTS docx_filename TEXT NOT NULL DEFAULT ''`;
        // Generations link back to the contract they belong to (null
        // for plain Phase 10 generations) + the reviewed field values.
        await db`
          ALTER TABLE docgen.generations
          ADD COLUMN IF NOT EXISTS contract_id TEXT`;
        await db`
          ALTER TABLE docgen.generations
          ADD COLUMN IF NOT EXISTS field_values JSONB`;

        await db`
          CREATE TABLE IF NOT EXISTS docgen.contracts (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            template_id TEXT,
            template_key TEXT NOT NULL DEFAULT '',
            template_name TEXT NOT NULL DEFAULT '',
            template_version INT NOT NULL DEFAULT 1,
            scope TEXT NOT NULL DEFAULT 'deal',
            company_id TEXT,
            deal_id TEXT,
            investor_person_id TEXT,
            counterparty_person_id TEXT,
            counterparty_name TEXT NOT NULL DEFAULT '',
            counterparty_email TEXT NOT NULL DEFAULT '',
            counterparty_title TEXT NOT NULL DEFAULT '',
            counterparty_company TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'draft',
            current_version INT NOT NULL DEFAULT 1,
            room_id TEXT,
            key_dates JSONB NOT NULL DEFAULT '{}',
            signers JSONB NOT NULL DEFAULT '[]',
            field_values JSONB NOT NULL DEFAULT '{}',
            ai_summary TEXT NOT NULL DEFAULT '',
            ai_summary_version INT,
            created_by TEXT NOT NULL DEFAULT '',
            deleted_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`;
        await db`
          CREATE INDEX IF NOT EXISTS docgen_contracts_company_idx
          ON docgen.contracts (company_id, created_at DESC)
          WHERE deleted_at IS NULL`;
        await db`
          CREATE INDEX IF NOT EXISTS docgen_contracts_deal_idx
          ON docgen.contracts (deal_id, created_at DESC)
          WHERE deleted_at IS NULL`;
        await db`
          CREATE INDEX IF NOT EXISTS docgen_contracts_investor_idx
          ON docgen.contracts (investor_person_id, created_at DESC)
          WHERE deleted_at IS NULL`;

        await db`
          CREATE TABLE IF NOT EXISTS docgen.contract_versions (
            id TEXT PRIMARY KEY,
            contract_id TEXT NOT NULL,
            version INT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'generated',
            document_id TEXT NOT NULL DEFAULT '',
            pdf_document_id TEXT,
            note TEXT NOT NULL DEFAULT '',
            text TEXT NOT NULL DEFAULT '',
            ai_change_summary TEXT NOT NULL DEFAULT '',
            created_by TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            UNIQUE (contract_id, version)
          )`;

        await db`
          CREATE TABLE IF NOT EXISTS docgen.contract_events (
            id TEXT PRIMARY KEY,
            contract_id TEXT NOT NULL,
            actor TEXT NOT NULL DEFAULT '',
            kind TEXT NOT NULL DEFAULT '',
            detail TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )`;
        await db`
          CREATE INDEX IF NOT EXISTS docgen_contract_events_contract_idx
          ON docgen.contract_events (contract_id, created_at DESC)`;

        await db`
          INSERT INTO docgen.schema_migrations (marker)
          VALUES ('docgen-contracts-v1')
          ON CONFLICT (marker) DO NOTHING`;
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}
