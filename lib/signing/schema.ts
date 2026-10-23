import { ensurePlatformSchema, sql, str, num, isoOrNull } from "../platform/db";

/**
 * In-house e-signature module schema — owns its tables in the
 * `signing` Postgres schema (PROJECT_RULES.md module boundaries).
 * Pattern mirrors lib/docgen/schema.ts: module-level cached promise,
 * reset on error, idempotent CREATEs, safe on every request
 * (ensure-on-request DDL).
 *
 * Tables:
 * - signing.envelopes — one row per docgen.envelopes envelope that
 *   runs through the in-house flow (envelope_id IS the docgen id).
 *   Holds the prepared/executed artifact document ids + hashes; the
 *   docgen row stays the provider-agnostic status record.
 * - signing.signers — one row per recipient. ONLY the SHA-256 hash of
 *   the signer's token is stored (Phase 3 token law, lib/dataroom/
 *   guests.ts); the raw token is returned exactly once at creation /
 *   resend. Access codes are bcrypt hashes, never plaintext.
 * - signing.events — append-only, hash-chained audit log per
 *   envelope: entry_hash = sha256(prev_hash | envelope_id | kind |
 *   actor | created_at_iso | JSON.stringify(detail)); the genesis
 *   prev_hash is sha256(envelope_id). No PII beyond signer name /
 *   email in `actor` for signer actions (needed for the certificate);
 *   ids only in system logs.
 * - signing.config — singleton (id=1): ESIGN/UETA consent text +
 *   default expiry.
 *
 * signing.key_store is Workstream B's (lib/signing/cert.ts) — NOT
 * created here.
 */

export type SigningOrder = "sequential" | "parallel";
export type SignerStatus =
  | "pending"
  | "active"
  | "viewed"
  | "consented"
  | "signed"
  | "declined";
export type SigningEmailStatus = "manual_link" | "sent" | "setup_required";

export interface SigningEnvelopeRow {
  envelopeId: string;
  documentId: string;
  dealId: string | null;
  companyId: string | null;
  reportId: string | null;
  senderName: string;
  senderEmail: string;
  signingOrder: SigningOrder;
  message: string;
  fieldMode: string;
  sourceSha256: string;
  preparedSha256: string;
  preparedDocumentId: string | null;
  expiresAt: string | null;
  completedAt: string | null;
  executedDocumentId: string | null;
  certificateDocumentId: string | null;
  executedSha256: string;
  voidedReason: string;
  voidedBy: string;
  voidedAt: string | null;
  emailStatus: string;
  createdAt: string;
  updatedAt: string;
}

/** Signer shape safe to return from APIs — NEVER carries token_hash
 * or access_code_hash. */
export interface SigningSignerPublic {
  id: string;
  envelopeId: string;
  name: string;
  email: string;
  orderIndex: number;
  status: SignerStatus;
  hasAccessCode: boolean;
  accessAttempts: number;
  accessLocked: boolean;
  tokenIssuedAt: string | null;
  viewedAt: string | null;
  consentAt: string | null;
  signedAt: string | null;
  declineReason: string;
  signatureKind: string;
  typedName: string;
  signatureObjectKey: string;
  createdAt: string;
}

/** Full signer for internal finalize use — signature data included,
 * token/access hashes STILL excluded (auth checks query them
 * directly; they never travel in a returned object). */
export interface SigningSignerFull extends SigningSignerPublic {
  ip: string;
  userAgent: string;
}

export interface SigningEventRow {
  id: string;
  envelopeId: string;
  signerId: string | null;
  kind: string;
  actor: string;
  ip: string;
  userAgent: string;
  detail: Record<string, unknown>;
  prevHash: string;
  entryHash: string;
  createdAt: string;
}

export interface SigningSettings {
  consentText: string;
  defaultExpiryDays: number;
}

export const DEFAULT_CONSENT_TEXT = `CONSENT TO ELECTRONIC RECORDS AND SIGNATURES

By selecting "I agree" and proceeding, you consent to conduct this transaction electronically and to the use of electronic records and electronic signatures in place of paper documents and handwritten signatures, as permitted by the federal ESIGN Act and the Uniform Electronic Transactions Act (UETA) as enacted in Arizona.

SCOPE OF CONSENT. Your consent applies to this transaction only: the document(s) presented to you in this signing session, the signature and initials you apply, the certificate of completion, and all notices and records related to this transaction that Canny Capital Partners provides electronically.

RIGHT TO WITHDRAW. You may withdraw your consent at any time before signing by closing this session and contacting the sender. Withdrawing consent does not affect the legal effectiveness of any record or signature provided before the withdrawal is processed. If you withdraw, the transaction will be completed on paper instead, which may delay it.

RIGHT TO PAPER COPIES. You may request a paper copy of any electronic record at no charge by contacting the sender at the email address shown in your invitation. Requesting a paper copy does not withdraw your consent unless you say so expressly.

HARDWARE AND SOFTWARE REQUIREMENTS. To access and retain electronic records you need: a device with internet access; a current web browser with cookies and JavaScript enabled; a valid email account; and software capable of opening and viewing PDF documents (for records provided as PDFs). To retain records, you must be able to download and store or print them.

CONTACT INFORMATION. You agree to keep your email address current. To update your contact information, to withdraw consent, or to request paper copies, contact the sender at the email address shown in your invitation.

ACKNOWLEDGMENT. By proceeding you acknowledge that you can access and read this disclosure, that you can download, store, and print electronic records, and that you consent to the use of electronic signatures as described above.`;

export const DEFAULT_EXPIRY_DAYS = 14;

/* ------------------------------ ensure ------------------------------ */

let schemaReady: Promise<void> | null = null;

export function ensureSigningSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      await ensurePlatformSchema();
      const db = sql();
      await db`CREATE SCHEMA IF NOT EXISTS signing`;

      await db`
        CREATE TABLE IF NOT EXISTS signing.envelopes (
          envelope_id TEXT PRIMARY KEY,
          document_id TEXT NOT NULL DEFAULT '',
          deal_id TEXT,
          company_id TEXT,
          report_id TEXT,
          sender_name TEXT NOT NULL DEFAULT '',
          sender_email TEXT NOT NULL DEFAULT '',
          signing_order TEXT NOT NULL DEFAULT 'sequential',
          message TEXT NOT NULL DEFAULT '',
          field_mode TEXT NOT NULL DEFAULT 'append',
          source_sha256 TEXT NOT NULL DEFAULT '',
          prepared_sha256 TEXT NOT NULL DEFAULT '',
          prepared_document_id TEXT,
          expires_at TIMESTAMPTZ,
          completed_at TIMESTAMPTZ,
          executed_document_id TEXT,
          certificate_document_id TEXT,
          executed_sha256 TEXT NOT NULL DEFAULT '',
          voided_reason TEXT NOT NULL DEFAULT '',
          voided_by TEXT NOT NULL DEFAULT '',
          voided_at TIMESTAMPTZ,
          email_status TEXT NOT NULL DEFAULT 'manual_link',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS signing_envelopes_document_idx
        ON signing.envelopes (document_id, created_at DESC)`;
      await db`
        CREATE INDEX IF NOT EXISTS signing_envelopes_report_idx
        ON signing.envelopes (report_id, created_at DESC)
        WHERE report_id IS NOT NULL`;
      await db`
        CREATE INDEX IF NOT EXISTS signing_envelopes_deal_idx
        ON signing.envelopes (deal_id, created_at DESC)
        WHERE deal_id IS NOT NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS signing.signers (
          id TEXT PRIMARY KEY,
          envelope_id TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          email TEXT NOT NULL DEFAULT '',
          order_index INT NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'pending',
          access_code_hash TEXT,
          access_attempts INT NOT NULL DEFAULT 0,
          access_locked BOOLEAN NOT NULL DEFAULT false,
          token_hash TEXT UNIQUE,
          token_issued_at TIMESTAMPTZ,
          viewed_at TIMESTAMPTZ,
          consent_at TIMESTAMPTZ,
          signed_at TIMESTAMPTZ,
          decline_reason TEXT NOT NULL DEFAULT '',
          signature_kind TEXT NOT NULL DEFAULT '',
          typed_name TEXT NOT NULL DEFAULT '',
          signature_object_key TEXT NOT NULL DEFAULT '',
          ip TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS signing_signers_envelope_idx
        ON signing.signers (envelope_id, order_index ASC)`;
      await db`
        CREATE INDEX IF NOT EXISTS signing_signers_token_idx
        ON signing.signers (token_hash) WHERE token_hash IS NOT NULL`;

      await db`
        CREATE TABLE IF NOT EXISTS signing.events (
          id TEXT PRIMARY KEY,
          envelope_id TEXT NOT NULL,
          signer_id TEXT,
          kind TEXT NOT NULL DEFAULT '',
          actor TEXT NOT NULL DEFAULT '',
          ip TEXT NOT NULL DEFAULT '',
          user_agent TEXT NOT NULL DEFAULT '',
          detail JSONB NOT NULL DEFAULT '{}'::jsonb,
          prev_hash TEXT NOT NULL DEFAULT '',
          entry_hash TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await db`
        CREATE INDEX IF NOT EXISTS signing_events_envelope_idx
        ON signing.events (envelope_id, created_at ASC, id ASC)`;

      await db`
        CREATE TABLE IF NOT EXISTS signing.config (
          id INT PRIMARY KEY CHECK (id = 1),
          consent_text TEXT NOT NULL DEFAULT '',
          default_expiry_days INT NOT NULL DEFAULT 14
        )`;
      await db`
        INSERT INTO signing.config (id, consent_text, default_expiry_days)
        VALUES (1, ${DEFAULT_CONSENT_TEXT}, ${DEFAULT_EXPIRY_DAYS})
        ON CONFLICT (id) DO NOTHING`;
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

/* ---------------------------- row mappers ---------------------------- */

export const SIGNING_ENVELOPE_COLS = `
  envelope_id, document_id, deal_id, company_id, report_id,
  sender_name, sender_email, signing_order, message, field_mode,
  source_sha256, prepared_sha256, prepared_document_id, expires_at,
  completed_at, executed_document_id, certificate_document_id,
  executed_sha256, voided_reason, voided_by, voided_at, email_status,
  created_at, updated_at`;

export function rowToSigningEnvelope(
  r: Record<string, unknown>
): SigningEnvelopeRow {
  return {
    envelopeId: str(r.envelope_id),
    documentId: str(r.document_id),
    dealId: r.deal_id ? str(r.deal_id) : null,
    companyId: r.company_id ? str(r.company_id) : null,
    reportId: r.report_id ? str(r.report_id) : null,
    senderName: str(r.sender_name),
    senderEmail: str(r.sender_email),
    signingOrder: str(r.signing_order) === "parallel" ? "parallel" : "sequential",
    message: str(r.message),
    fieldMode: str(r.field_mode) || "append",
    sourceSha256: str(r.source_sha256),
    preparedSha256: str(r.prepared_sha256),
    preparedDocumentId: r.prepared_document_id
      ? str(r.prepared_document_id)
      : null,
    expiresAt: isoOrNull(r.expires_at),
    completedAt: isoOrNull(r.completed_at),
    executedDocumentId: r.executed_document_id
      ? str(r.executed_document_id)
      : null,
    certificateDocumentId: r.certificate_document_id
      ? str(r.certificate_document_id)
      : null,
    executedSha256: str(r.executed_sha256),
    voidedReason: str(r.voided_reason),
    voidedBy: str(r.voided_by),
    voidedAt: isoOrNull(r.voided_at),
    emailStatus: str(r.email_status) || "manual_link",
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/** Explicit public columns — token_hash / access_code_hash are never
 * selected into a returned signer object. has_access_code is a
 * boolean derived in SQL. */
export const SIGNER_PUBLIC_COLS = `
  id, envelope_id, name, email, order_index, status,
  (access_code_hash IS NOT NULL AND access_code_hash <> '') AS has_access_code,
  access_attempts, access_locked, token_issued_at, viewed_at, consent_at,
  signed_at, decline_reason, signature_kind, typed_name,
  signature_object_key, created_at`;

export function rowToSignerPublic(
  r: Record<string, unknown>
): SigningSignerPublic {
  const status = str(r.status);
  return {
    id: str(r.id),
    envelopeId: str(r.envelope_id),
    name: str(r.name),
    email: str(r.email),
    orderIndex: num(r.order_index),
    status: (
      ["pending", "active", "viewed", "consented", "signed", "declined"].includes(
        status
      )
        ? status
        : "pending"
    ) as SignerStatus,
    hasAccessCode: Boolean(r.has_access_code),
    accessAttempts: num(r.access_attempts),
    accessLocked: Boolean(r.access_locked),
    tokenIssuedAt: isoOrNull(r.token_issued_at),
    viewedAt: isoOrNull(r.viewed_at),
    consentAt: isoOrNull(r.consent_at),
    signedAt: isoOrNull(r.signed_at),
    declineReason: str(r.decline_reason),
    signatureKind: str(r.signature_kind),
    typedName: str(r.typed_name),
    signatureObjectKey: str(r.signature_object_key),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}

export const SIGNER_FULL_COLS = `${SIGNER_PUBLIC_COLS}, ip, user_agent`;

export function rowToSignerFull(r: Record<string, unknown>): SigningSignerFull {
  return {
    ...rowToSignerPublic(r),
    ip: str(r.ip),
    userAgent: str(r.user_agent),
  };
}

export const SIGNING_EVENT_COLS = `
  id, envelope_id, signer_id, kind, actor, ip, user_agent, detail,
  prev_hash, entry_hash, created_at`;

function parseDetail(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === "string" && v) {
    try {
      const p = JSON.parse(v) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}

export function rowToSigningEvent(r: Record<string, unknown>): SigningEventRow {
  return {
    id: str(r.id),
    envelopeId: str(r.envelope_id),
    signerId: r.signer_id ? str(r.signer_id) : null,
    kind: str(r.kind),
    actor: str(r.actor),
    ip: str(r.ip),
    userAgent: str(r.user_agent),
    detail: parseDetail(r.detail),
    prevHash: str(r.prev_hash),
    entryHash: str(r.entry_hash),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}
