import { createHash, randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { ensureNotificationsSchema } from "../platform/collab";
import { ensureDocgenSchema, type DocgenEnvelopeRow } from "../docgen/schema";
import {
  getDocument,
  readDocumentBytes,
  registerUploadedDocument,
  sha256Hex,
} from "../dataroom/documents";
import { hashToken } from "../dataroom/guests";
import { getStorageProvider } from "../storage";
import { getReportRow } from "../comms/service";
import { getStoredReportPdf } from "../comms/pdf";
import { getEmailTransportStatus, sendDeliveryEmail } from "../comms/mail";
import { prepareDocument, type PresetSignatureBlock } from "./pdf";
import {
  ensureSigningSchema,
  DEFAULT_CONSENT_TEXT,
  DEFAULT_EXPIRY_DAYS,
  rowToSigningEnvelope,
  rowToSignerPublic,
  rowToSignerFull,
  rowToSigningEvent,
  SIGNING_ENVELOPE_COLS,
  SIGNER_PUBLIC_COLS,
  SIGNER_FULL_COLS,
  SIGNING_EVENT_COLS,
  type SigningEnvelopeRow,
  type SigningEventRow,
  type SigningOrder,
  type SigningSettings,
  type SigningSignerFull,
  type SigningSignerPublic,
} from "./schema";
import { notifySender } from "./notify";

/**
 * In-house e-signature service (Workstream A — backend core).
 *
 * Owns the signing.* tables and the docgen.envelopes rows for
 * in-house envelopes. Cross-module access is service-only: documents
 * via lib/dataroom/documents, report PDFs via lib/comms/pdf getters
 * (+ getReportRow for metadata), email via lib/comms/mail, prepared
 * PDFs via Workstream B's lib/signing/pdf.prepareDocument. This
 * module deliberately does NOT import lib/docgen/esign.ts (esign.ts
 * delegates here — importing back would be a cycle); the small
 * docgen row mapper is therefore duplicated locally.
 *
 * Token law (Phase 3): signer tokens are randomBytes(32) base64url;
 * only hashToken(token) (SHA-256 hex) is stored. A raw token leaves
 * the server exactly once per issuance — in the create / resend
 * response links. Access codes are bcrypt hashes. No token hash,
 * access hash, or key material appears in any returned object: signer
 * selects use explicit public columns.
 */

export interface SigningActor {
  name: string;
  email: string;
}

export const MAX_ACCESS_ATTEMPTS = 5;

const SITE_BASE = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://portal.cannycapitalpartners.com"
).replace(/\/$/, "");

function actorName(actor: SigningActor | string): string {
  return typeof actor === "string" ? actor : actor.name || actor.email || "";
}
function actorEmail(actor: SigningActor | string): string {
  return typeof actor === "string" ? "" : actor.email || "";
}

export async function ensureSigning(): Promise<void> {
  await ensureSigningSchema();
  await ensureDocgenSchema();
  await ensureNotificationsSchema().catch(() => {
    /* notifications are best-effort; schema retries on notify */
  });
}

/* --------------------- docgen envelope (local) --------------------- */

const DOCGEN_COLS = `
  id, document_id, deal_id, provider, status, external_id, recipients,
  detail, created_by, created_at, updated_at`;

function parseRecipients(v: unknown): Array<{ name: string; email: string }> {
  const arr = Array.isArray(v)
    ? v
    : typeof v === "string" && v
      ? (() => {
          try {
            const p = JSON.parse(v) as unknown;
            return Array.isArray(p) ? p : [];
          } catch {
            return [];
          }
        })()
      : [];
  return arr
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const rec = r as Record<string, unknown>;
      return { name: str(rec.name), email: str(rec.email) };
    })
    .filter((r) => r.email);
}

function rowToDocgenEnvelope(r: Record<string, unknown>): DocgenEnvelopeRow {
  return {
    id: str(r.id),
    documentId: str(r.document_id),
    dealId: r.deal_id ? str(r.deal_id) : null,
    provider: str(r.provider) || "in-house",
    status: str(r.status),
    externalId: r.external_id ? str(r.external_id) : null,
    recipients: parseRecipients(r.recipients),
    detail: str(r.detail),
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

async function getDocgenEnvelope(
  envelopeId: string
): Promise<DocgenEnvelopeRow | null> {
  await ensureDocgenSchema();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(DOCGEN_COLS)} FROM docgen.envelopes
    WHERE id = ${envelopeId} LIMIT 1`;
  return rows.length
    ? rowToDocgenEnvelope(rows[0] as Record<string, unknown>)
    : null;
}

async function insertDocgenEnvelope(input: {
  documentId: string;
  dealId: string | null;
  status: string;
  recipients: Array<{ name: string; email: string }>;
  detail: string;
  actor: string;
}): Promise<DocgenEnvelopeRow> {
  await ensureDocgenSchema();
  const db = sql();
  const id = newId();
  const rows = await db`
    INSERT INTO docgen.envelopes
      (id, document_id, deal_id, provider, status, external_id,
        recipients, detail, created_by)
    VALUES (${id}, ${input.documentId}, ${input.dealId}, 'in-house',
      ${input.status}, ${null},
      ${JSON.stringify(input.recipients)}::jsonb, ${input.detail},
      ${input.actor})
    RETURNING ${db.unsafe(DOCGEN_COLS)}`;
  return rowToDocgenEnvelope(rows[0] as Record<string, unknown>);
}

async function updateDocgenStatus(
  envelopeId: string,
  status: string,
  detail?: string
): Promise<void> {
  const db = sql();
  if (detail !== undefined) {
    await db`
      UPDATE docgen.envelopes SET status = ${status}, detail = ${detail},
        updated_at = now()
      WHERE id = ${envelopeId}`;
  } else {
    await db`
      UPDATE docgen.envelopes SET status = ${status}, updated_at = now()
      WHERE id = ${envelopeId}`;
  }
}

/* ------------------------- signing row reads ------------------------ */

export async function getSigningEnvelope(
  envelopeId: string
): Promise<SigningEnvelopeRow | null> {
  await ensureSigning();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SIGNING_ENVELOPE_COLS)} FROM signing.envelopes
    WHERE envelope_id = ${envelopeId} LIMIT 1`;
  return rows.length
    ? rowToSigningEnvelope(rows[0] as Record<string, unknown>)
    : null;
}

async function listSignersPublic(
  envelopeId: string
): Promise<SigningSignerPublic[]> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SIGNER_PUBLIC_COLS)} FROM signing.signers
    WHERE envelope_id = ${envelopeId}
    ORDER BY order_index ASC, created_at ASC`;
  return rows.map((r) => rowToSignerPublic(r as Record<string, unknown>));
}

async function getSignerPublic(
  signerId: string
): Promise<SigningSignerPublic | null> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SIGNER_PUBLIC_COLS)} FROM signing.signers
    WHERE id = ${signerId} LIMIT 1`;
  return rows.length
    ? rowToSignerPublic(rows[0] as Record<string, unknown>)
    : null;
}

async function listEvents(envelopeId: string): Promise<SigningEventRow[]> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SIGNING_EVENT_COLS)} FROM signing.events
    WHERE envelope_id = ${envelopeId}
    ORDER BY created_at ASC, id ASC`;
  return rows.map((r) => rowToSigningEvent(r as Record<string, unknown>));
}

/* ------------------------------ events ------------------------------ */

function sha256HexLocal(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Canonical JSON for the audit hash chain: JSON.stringify with
 * object keys sorted recursively (arrays keep order; primitives
 * as-is). Postgres JSONB does not preserve key order, so the plain
 * JSON.stringify(detail) used at write time could differ from a
 * read-back stringify of the same detail — canonicalising on BOTH
 * the write and verify sides removes that drift. This exact scheme
 * is duplicated in lib/signing/verify.ts; keep the two in sync.
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") {
    const s = JSON.stringify(v);
    return s === undefined ? "null" : s;
  }
  if (Array.isArray(v)) {
    return `[${v
      .map((item) => canonicalJson(item === undefined ? null : item))
      .join(",")}]`;
  }
  const rec = v as Record<string, unknown>;
  const keys = Object.keys(rec)
    .filter((k) => rec[k] !== undefined)
    .sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(rec[k])}`)
    .join(",")}}`;
}

/** Normalise a stored created_at to its canonical ISO form. */
function normalizedIso(value: string): string {
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toISOString();
}

/**
 * Append one hash-chained event. Chain rule:
 *   entry_hash = sha256(prev_hash + '|' + envelope_id + '|' + kind +
 *     '|' + actor + '|' + created_at_iso + '|' + canonicalJson(detail))
 * Genesis prev_hash = sha256(envelope_id). created_at_iso is the
 * .toISOString() form of the single JS Date generated here and
 * inserted as the row's created_at — generated ONCE, never re-read
 * for the hash.
 *
 * Serialization: sql() is the Neon HTTP driver — it has no
 * interactive transaction that could hold a row lock across the
 * read-last → insert sequence (its transaction() is batch-only and
 * cannot express a read-dependent append). Per the brief's fallback,
 * we take the lock hint first (UPDATE docgen.envelopes SET
 * updated_at = now()) and then read-last + insert sequentially; the
 * created_at is generated here and bumped monotonically past the
 * previous event so (created_at, id) verification order always
 * matches insertion order even within one millisecond.
 */
export async function appendEvent(
  envelopeId: string,
  input: {
    signerId?: string | null;
    kind: string;
    actor: string;
    ip?: string | null;
    userAgent?: string | null;
    detail?: Record<string, unknown>;
  }
): Promise<SigningEventRow> {
  await ensureSigning();
  const db = sql();
  try {
    await db`
      UPDATE docgen.envelopes SET updated_at = now() WHERE id = ${envelopeId}`;
  } catch {
    /* lock hint only — the append itself is what matters */
  }
  const lastRows = await db`
    SELECT entry_hash, created_at FROM signing.events
    WHERE envelope_id = ${envelopeId}
    ORDER BY created_at DESC, id DESC LIMIT 1`;
  let prevHash: string;
  let createdAt = new Date();
  if (lastRows.length) {
    const last = lastRows[0] as Record<string, unknown>;
    prevHash = str(last.entry_hash);
    const lastCreated = last.created_at
      ? new Date(String(last.created_at)).getTime()
      : 0;
    if (createdAt.getTime() <= lastCreated) {
      createdAt = new Date(lastCreated + 1);
    }
  } else {
    prevHash = sha256HexLocal(envelopeId);
  }
  const detail = input.detail ?? {};
  const createdIso = createdAt.toISOString();
  const entryHash = sha256HexLocal(
    [prevHash, envelopeId, input.kind, input.actor, createdIso, canonicalJson(detail)].join("|")
  );
  const id = newId();
  const rows = await db`
    INSERT INTO signing.events
      (id, envelope_id, signer_id, kind, actor, ip, user_agent, detail,
        prev_hash, entry_hash, created_at)
    VALUES (${id}, ${envelopeId}, ${input.signerId ?? null}, ${input.kind},
      ${input.actor}, ${input.ip ?? ""}, ${input.userAgent ?? ""},
      ${JSON.stringify(detail)}::jsonb, ${prevHash}, ${entryHash},
      ${createdIso})
    RETURNING ${db.unsafe(SIGNING_EVENT_COLS)}`;
  return rowToSigningEvent(rows[0] as Record<string, unknown>);
}

/** Recompute the chain in (created_at, id) order. */
export async function verifyEventChain(
  envelopeId: string
): Promise<{ ok: boolean; checked: number; brokenAt: string | null }> {
  await ensureSigning();
  const events = await listEvents(envelopeId);
  let prev = sha256HexLocal(envelopeId);
  for (const ev of events) {
    const expected = sha256HexLocal(
      [prev, envelopeId, ev.kind, ev.actor, normalizedIso(ev.createdAt), canonicalJson(ev.detail ?? {})].join("|")
    );
    if (ev.prevHash !== prev || ev.entryHash !== expected) {
      return { ok: false, checked: events.length, brokenAt: ev.id };
    }
    prev = ev.entryHash;
  }
  return { ok: true, checked: events.length, brokenAt: null };
}

/* ------------------------------ settings ---------------------------- */

export async function getSigningSettings(): Promise<SigningSettings> {
  await ensureSigning();
  const db = sql();
  const rows = await db`
    SELECT consent_text, default_expiry_days FROM signing.config
    WHERE id = 1 LIMIT 1`;
  if (!rows.length) {
    return { consentText: DEFAULT_CONSENT_TEXT, defaultExpiryDays: DEFAULT_EXPIRY_DAYS };
  }
  const rec = rows[0] as Record<string, unknown>;
  return {
    consentText: str(rec.consent_text),
    defaultExpiryDays: num(rec.default_expiry_days) || 14,
  };
}

export async function updateSigningSettings(
  patch: { consentText?: string; defaultExpiryDays?: number },
  actor: SigningActor | string
): Promise<SigningSettings> {
  await ensureSigning();
  void actor;
  const current = await getSigningSettings();
  const consentText =
    patch.consentText !== undefined
      ? patch.consentText.trim()
      : current.consentText;
  if (!consentText) throw new Error("consent_text_required");
  const days =
    patch.defaultExpiryDays !== undefined
      ? Math.min(90, Math.max(1, Math.floor(patch.defaultExpiryDays)))
      : current.defaultExpiryDays;
  const db = sql();
  await db`
    INSERT INTO signing.config (id, consent_text, default_expiry_days)
    VALUES (1, ${consentText}, ${days})
    ON CONFLICT (id) DO UPDATE SET
      consent_text = EXCLUDED.consent_text,
      default_expiry_days = EXCLUDED.default_expiry_days`;
  return { consentText, defaultExpiryDays: days };
}

/* --------------------------- email helper --------------------------- */

async function emailTransportAvailable(): Promise<boolean> {
  try {
    const st = await getEmailTransportStatus();
    return st.connected && st.mailSend === "available";
  } catch {
    return false;
  }
}

async function trySendSignerEmail(input: {
  to: string;
  name: string;
  documentName: string;
  token: string;
}): Promise<"sent" | "setup_required" | "failed"> {
  const result = await sendDeliveryEmail({
    to: input.to,
    name: input.name,
    reportTitle: input.documentName || "Document for signature",
    link: `${SITE_BASE}/sign/${input.token}`,
    pdf: null,
  });
  return result.status;
}

/* ------------------------- create envelope -------------------------- */

export interface SigningRecipientInput {
  name: string;
  email: string;
  accessCode?: string;
}

export interface CreateEnvelopeResult {
  envelope: DocgenEnvelopeRow;
  signing: SigningEnvelopeRow;
  links: Array<{ signerId: string; name: string; email: string; url: string }>;
}

function normalizeRecipients(
  raw: SigningRecipientInput[]
): SigningRecipientInput[] {
  const out: SigningRecipientInput[] = [];
  for (const r of raw ?? []) {
    const email = (r?.email ?? "").trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) continue;
    out.push({
      name: (r?.name ?? "").trim().slice(0, 200),
      email,
      accessCode: r?.accessCode ? String(r.accessCode).slice(0, 100) : undefined,
    });
  }
  return out;
}

async function registerPdfBytes(input: {
  bytes: Buffer;
  filename: string;
  actor: string;
  dealId?: string | null;
  companyId?: string | null;
  tags: string[];
  tempPrefix: string;
}): Promise<string> {
  const tempKey = `uploads/${input.tempPrefix}-${newId()}.pdf`;
  const provider = getStorageProvider();
  await provider.put(tempKey, input.bytes);
  const { document } = await registerUploadedDocument({
    storageKey: tempKey,
    filename: input.filename,
    mime: "application/pdf",
    sizeBytes: input.bytes.length,
    contentHash: sha256Hex(input.bytes),
    actor: input.actor,
    dealId: input.dealId ?? null,
    companyId: input.companyId ?? null,
    tags: input.tags,
  });
  return document.id;
}

export async function createEnvelopeForSource(
  input: {
    documentId?: string;
    reportId?: string;
    recipients: SigningRecipientInput[];
    signingOrder: SigningOrder;
    message?: string;
    expiresAt?: string | null;
    templateBlocks?: unknown;
  },
  actor: SigningActor
): Promise<CreateEnvelopeResult> {
  await ensureSigning();
  const recipients = normalizeRecipients(input.recipients ?? []);
  if (!recipients.length) throw new Error("recipients_required");
  if (recipients.length > 20) throw new Error("too_many_recipients");
  const signingOrder: SigningOrder =
    input.signingOrder === "parallel" ? "parallel" : "sequential";
  const hasDoc = Boolean(input.documentId);
  const hasReport = Boolean(input.reportId);
  if (hasDoc === hasReport) throw new Error("source_required");
  const senderName = (actor.name || actor.email || "").trim();
  const senderEmail = (actor.email || "").trim().toLowerCase();

  /* ---- resolve the source bytes ---- */
  let sourceBytes: Buffer;
  let sourceName: string;
  let dealId: string | null = null;
  let companyId: string | null = null;
  let effectiveDocumentId: string;

  if (hasDoc) {
    const doc = await getDocument(input.documentId as string);
    if (!doc) throw new Error("document_not_found");
    const read = await readDocumentBytes(doc);
    sourceBytes = read.bytes;
    sourceName = doc.name;
    dealId = doc.dealId;
    companyId = doc.companyId;
    effectiveDocumentId = doc.id;
  } else {
    const report = await getReportRow(input.reportId as string);
    if (!report || report.deletedAt) throw new Error("report_not_found");
    const pdf = await getStoredReportPdf(report.id, report.currentVersion);
    if (!pdf) throw new Error("report_pdf_not_found");
    sourceBytes = pdf;
    sourceName = `${(report.title || "Report").replace(/[^\w\- ]+/g, "").trim() || "Report"}.pdf`;
    dealId = report.dealId;
    companyId = report.companyId;
    // Snapshot the report PDF as a core document (generate.ts pattern):
    // signing works against documents, so the report bytes are filed
    // once and every artifact hangs off that document id.
    effectiveDocumentId = await registerPdfBytes({
      bytes: sourceBytes,
      filename: sourceName,
      actor: senderName,
      dealId,
      companyId,
      tags: ["signing-source", "report"],
      tempPrefix: "signing-src",
    });
  }
  const sourceSha256 = sha256Hex(sourceBytes);

  /* ---- prepare (Workstream B: preset blocks → 'template',
   * otherwise an appended signature page → 'append') ---- */
  let preparedBytes: Buffer = sourceBytes;
  let fieldMode: string = "append";
  try {
    let presetBlocks = Array.isArray(input.templateBlocks)
      ? (input.templateBlocks as PresetSignatureBlock[])
      : null;
    if ((!presetBlocks || presetBlocks.length === 0) && hasDoc) {
      // No explicit blocks: fall back to the docgen generation's
      // preset signature blocks for this document (generated
      // documents such as NDAs carry them). Dynamic import —
      // generate.ts imports lib/signing/pdf, and a static import
      // here would risk a cycle; its block shape
      // ({page,x,y,width,height,roleLabel}) matches
      // PresetSignatureBlock structurally. prepareDocument itself
      // falls back to append mode when the block count does not
      // match the signer count.
      try {
        const { getGenerationSignatureBlocks } = await import(
          "../docgen/generate"
        );
        const generated = await getGenerationSignatureBlocks(
          effectiveDocumentId
        );
        if (generated && generated.length) {
          presetBlocks = generated as PresetSignatureBlock[];
        }
      } catch (lookupErr) {
        console.error(
          "[signing] preset signature block lookup failed for document",
          effectiveDocumentId,
          lookupErr instanceof Error ? lookupErr.message : String(lookupErr)
        );
      }
    }
    const prepared = await prepareDocument({
      sourceBytes,
      signers: recipients.map((r) => ({ name: r.name, email: r.email })),
      presetBlocks,
    });
    if (prepared?.bytes) preparedBytes = prepared.bytes;
    if (prepared?.fieldMode) fieldMode = prepared.fieldMode;
  } catch (err) {
    // B's preparer requires a loadable PDF (pdf-lib). A non-PDF
    // source fails BEFORE any envelope row exists — nothing is
    // half-sent. A PDF source that still fails falls back to the
    // untouched bytes with fieldMode 'append' (B stamps onto the
    // source at finalize in that case).
    const isPdf = sourceBytes.subarray(0, 5).toString("latin1") === "%PDF-";
    if (!isPdf) throw err;
    console.error(
      "[signing] prepareDocument fell back to source bytes for document",
      effectiveDocumentId,
      err instanceof Error ? err.message : String(err)
    );
    preparedBytes = sourceBytes;
    fieldMode = "append";
  }
  const preparedSha256 = sha256Hex(preparedBytes);
  const baseName = sourceName.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  const preparedDocumentId = await registerPdfBytes({
    bytes: preparedBytes,
    filename: `${baseName} — signing copy.pdf`,
    actor: senderName,
    dealId,
    companyId,
    tags: ["signing-copy"],
    tempPrefix: "signing-prep",
  });

  /* ---- expiry ---- */
  const settings = await getSigningSettings();
  let expiresAt: string | null = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (isNaN(d.getTime())) throw new Error("expires_at_invalid");
    expiresAt = d.toISOString();
  } else if (settings.defaultExpiryDays > 0) {
    expiresAt = new Date(
      Date.now() + settings.defaultExpiryDays * 24 * 60 * 60 * 1000
    ).toISOString();
  }

  /* ---- docgen envelope + signing rows ---- */
  const envelope = await insertDocgenEnvelope({
    documentId: effectiveDocumentId,
    dealId,
    status: "sent",
    recipients: recipients.map((r) => ({ name: r.name, email: r.email })),
    detail: "Envelope sent via in-house signing.",
    actor: senderName,
  });
  const envelopeId = envelope.id;
  const db = sql();
  const signingRows = await db`
    INSERT INTO signing.envelopes
      (envelope_id, document_id, deal_id, company_id, report_id,
        sender_name, sender_email, signing_order, message, field_mode,
        source_sha256, prepared_sha256, prepared_document_id, expires_at,
        email_status)
    VALUES (${envelopeId}, ${effectiveDocumentId}, ${dealId}, ${companyId},
      ${input.reportId ?? null}, ${senderName}, ${senderEmail},
      ${signingOrder}, ${(input.message ?? "").slice(0, 2000)}, ${fieldMode},
      ${sourceSha256}, ${preparedSha256}, ${preparedDocumentId},
      ${expiresAt}, 'manual_link')
    RETURNING ${db.unsafe(SIGNING_ENVELOPE_COLS)}`;
  const signing = rowToSigningEnvelope(
    signingRows[0] as Record<string, unknown>
  );

  const links: Array<{ signerId: string; name: string; email: string; url: string }> = [];
  const activeTokens = new Map<string, string>();
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const signerId = newId();
    const token = randomBytes(32).toString("base64url");
    const status =
      signingOrder === "parallel" || i === 0 ? "active" : "pending";
    const accessHash = r.accessCode
      ? await bcrypt.hash(r.accessCode, 10)
      : null;
    await db`
      INSERT INTO signing.signers
        (id, envelope_id, name, email, order_index, status,
          access_code_hash, token_hash, token_issued_at)
      VALUES (${signerId}, ${envelopeId}, ${r.name}, ${r.email}, ${i},
        ${status}, ${accessHash}, ${hashToken(token)}, now())`;
    links.push({ signerId, name: r.name, email: r.email, url: `/sign/${token}` });
    if (status === "active") activeTokens.set(signerId, token);
  }

  await appendEvent(envelopeId, {
    kind: "created",
    actor: senderName,
    detail: {
      signingOrder,
      fieldMode,
      signerCount: recipients.length,
      source: input.reportId ? "report" : "document",
    },
  });
  for (const link of links) {
    const signer = await getSignerPublic(link.signerId);
    if (signer && signer.status === "active") {
      await appendEvent(envelopeId, {
        signerId: link.signerId,
        kind: "activated",
        actor: "system",
        detail: { via: "initial" },
      });
    }
  }

  /* ---- email ACTIVE signers only when transport is verified ---- */
  let emailStatus: "manual_link" | "sent" | "setup_required" = "manual_link";
  if (await emailTransportAvailable()) {
    let anySent = false;
    let anySetup = false;
    for (const link of links) {
      const token = activeTokens.get(link.signerId);
      if (!token) continue;
      const res = await trySendSignerEmail({
        to: link.email,
        name: link.name,
        documentName: sourceName,
        token,
      });
      if (res === "sent") anySent = true;
      if (res === "setup_required") anySetup = true;
    }
    emailStatus = anySent ? "sent" : anySetup ? "setup_required" : "manual_link";
    if (emailStatus !== "manual_link") {
      await db`
        UPDATE signing.envelopes SET email_status = ${emailStatus},
          updated_at = now()
        WHERE envelope_id = ${envelopeId}`;
      signing.emailStatus = emailStatus;
    }
  }

  return { envelope, signing, links };
}

/* --------------------------- detail / list -------------------------- */

export interface SigningEnvelopeDetail {
  envelope: DocgenEnvelopeRow;
  signing: SigningEnvelopeRow;
  signers: SigningSignerPublic[];
  events: SigningEventRow[];
  artifacts: {
    preparedDocumentId: string | null;
    executedDocumentId: string | null;
    certificateDocumentId: string | null;
    executedSha256: string;
  };
}

export async function getEnvelopeDetail(
  envelopeId: string
): Promise<SigningEnvelopeDetail | null> {
  await ensureSigning();
  const envelope = await getDocgenEnvelope(envelopeId);
  if (!envelope) return null;
  const signing = await getSigningEnvelope(envelopeId);
  if (!signing) return null;
  const [signers, events] = await Promise.all([
    listSignersPublic(envelopeId),
    listEvents(envelopeId),
  ]);
  return {
    envelope,
    signing,
    signers,
    events,
    artifacts: {
      preparedDocumentId: signing.preparedDocumentId,
      executedDocumentId: signing.executedDocumentId,
      certificateDocumentId: signing.certificateDocumentId,
      executedSha256: signing.executedSha256,
    },
  };
}

export interface SigningListItem {
  id: string;
  documentId: string;
  reportId: string | null;
  dealId: string | null;
  status: string;
  senderName: string;
  signingOrder: SigningOrder;
  emailStatus: string;
  signers: Array<{
    id: string;
    name: string;
    email: string;
    status: string;
    orderIndex: number;
  }>;
  signedCount: number;
  totalCount: number;
  expiresAt: string | null;
  createdAt: string;
  completedAt: string | null;
}

export async function listSigningEnvelopes(opts: {
  documentId?: string;
  reportId?: string;
  dealId?: string;
  limit?: number;
}): Promise<SigningListItem[]> {
  await ensureSigning();
  const db = sql();
  const documentId = (opts.documentId ?? "").trim();
  const reportId = (opts.reportId ?? "").trim();
  const dealId = (opts.dealId ?? "").trim();
  const limit = Math.min(50, Math.max(1, opts.limit || 25));
  const rows = await db`
    SELECT s.envelope_id, s.document_id, s.report_id, s.deal_id,
      s.sender_name, s.signing_order, s.email_status, s.expires_at,
      s.completed_at, s.created_at,
      coalesce(e.status, '') AS docgen_status
    FROM signing.envelopes s
    LEFT JOIN docgen.envelopes e ON e.id = s.envelope_id
    WHERE (${documentId} = '' OR s.document_id = ${documentId})
      AND (${reportId} = '' OR s.report_id = ${reportId})
      AND (${dealId} = '' OR s.deal_id = ${dealId})
    ORDER BY s.created_at DESC
    LIMIT ${limit}`;
  const items: SigningListItem[] = [];
  for (const r of rows) {
    const rec = r as Record<string, unknown>;
    const envelopeId = str(rec.envelope_id);
    const signers = await listSignersPublic(envelopeId);
    items.push({
      id: envelopeId,
      documentId: str(rec.document_id),
      reportId: rec.report_id ? str(rec.report_id) : null,
      dealId: rec.deal_id ? str(rec.deal_id) : null,
      status: str(rec.docgen_status),
      senderName: str(rec.sender_name),
      signingOrder:
        str(rec.signing_order) === "parallel" ? "parallel" : "sequential",
      emailStatus: str(rec.email_status),
      signers: signers.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        status: s.status,
        orderIndex: s.orderIndex,
      })),
      signedCount: signers.filter((s) => s.status === "signed").length,
      totalCount: signers.length,
      expiresAt: isoOrNull(rec.expires_at),
      createdAt: isoOrNull(rec.created_at) ?? "",
      completedAt: isoOrNull(rec.completed_at),
    });
  }
  return items;
}

/* ------------------------- void / resend / expiry ------------------- */

export async function voidEnvelope(
  envelopeId: string,
  reason: string,
  actor: SigningActor | string
): Promise<SigningEnvelopeDetail> {
  await ensureSigning();
  const envelope = await getDocgenEnvelope(envelopeId);
  if (!envelope) throw new Error("envelope_not_found");
  if (envelope.status === "completed") throw new Error("envelope_completed");
  if (envelope.status === "voided") {
    const detail = await getEnvelopeDetail(envelopeId);
    if (detail) return detail;
    throw new Error("envelope_not_found");
  }
  const cleanReason = (reason ?? "").trim().slice(0, 500);
  const db = sql();
  await updateDocgenStatus(
    envelopeId,
    "voided",
    cleanReason ? `Voided: ${cleanReason}` : "Voided."
  );
  await db`
    UPDATE signing.envelopes SET voided_reason = ${cleanReason},
      voided_by = ${actorName(actor)}, voided_at = now(), updated_at = now()
    WHERE envelope_id = ${envelopeId}`;
  await appendEvent(envelopeId, {
    kind: "voided",
    actor: actorName(actor),
    detail: { reason: cleanReason.slice(0, 300) },
  });
  const detail = await getEnvelopeDetail(envelopeId);
  if (!detail) throw new Error("envelope_not_found");
  return detail;
}

export async function resendSignerLink(
  envelopeId: string,
  signerId: string,
  actor: SigningActor | string
): Promise<{ url: string; signerId: string; envelopeId: string }> {
  await ensureSigning();
  const envelope = await getDocgenEnvelope(envelopeId);
  if (!envelope) throw new Error("envelope_not_found");
  if (
    envelope.status !== "sent" &&
    envelope.status !== "viewed" &&
    envelope.status !== "partially_signed"
  ) {
    throw new Error("envelope_not_live");
  }
  const signer = await getSignerPublic(signerId);
  if (!signer || signer.envelopeId !== envelopeId) {
    throw new Error("signer_not_found");
  }
  if (signer.status === "signed" || signer.status === "declined") {
    throw new Error("signer_finished");
  }
  const token = randomBytes(32).toString("base64url");
  const db = sql();
  // Sequential integrity: a still-pending signer keeps 'pending' (its
  // rotated link becomes usable when it is activated); an active /
  // viewed / consented signer returns to 'active'. The OLD hash is
  // replaced, so the old link dies immediately.
  const nextStatus = signer.status === "pending" ? "pending" : "active";
  await db`
    UPDATE signing.signers SET token_hash = ${hashToken(token)},
      token_issued_at = now(), access_attempts = 0, access_locked = false,
      status = ${nextStatus}, updated_at = now()
    WHERE id = ${signerId}`;
  await appendEvent(envelopeId, {
    signerId,
    kind: "link_resent",
    actor: actorName(actor),
    detail: {},
  });
  return { url: `/sign/${token}`, signerId, envelopeId };
}

export async function updateExpiry(
  envelopeId: string,
  expiresAt: string | null,
  actor: SigningActor | string
): Promise<SigningEnvelopeDetail> {
  await ensureSigning();
  const signing = await getSigningEnvelope(envelopeId);
  if (!signing) throw new Error("envelope_not_found");
  let iso: string | null = null;
  if (expiresAt) {
    const d = new Date(expiresAt);
    if (isNaN(d.getTime())) throw new Error("expires_at_invalid");
    iso = d.toISOString();
  }
  const db = sql();
  await db`
    UPDATE signing.envelopes SET expires_at = ${iso}, updated_at = now()
    WHERE envelope_id = ${envelopeId}`;
  const envelope = await getDocgenEnvelope(envelopeId);
  if (
    envelope &&
    envelope.status === "expired" &&
    (!iso || new Date(iso).getTime() > Date.now())
  ) {
    await updateDocgenStatus(envelopeId, "sent", "Envelope expiry extended.");
  }
  await appendEvent(envelopeId, {
    kind: "expiry_updated",
    actor: actorName(actor),
    detail: { expiresAt: iso },
  });
  const detail = await getEnvelopeDetail(envelopeId);
  if (!detail) throw new Error("envelope_not_found");
  return detail;
}

/* --------------------------- token resolve -------------------------- */

/** Resolve result. `envelope` is the signing row (pinned contract);
 * `signing` is its alias, `docgen` the docgen row, and `status` /
 * `docgenStatus` carry the docgen status string — additive aliases
 * the public signer surface (Workstream C) normalizes against.
 * `ok` discriminates success from the error variants. The returned
 * signer carries a derived `attemptsLeft` alongside the pinned
 * public fields. */
export type ResolveSignerTokenResult =
  | {
      ok: true;
      signer: SigningSignerPublic & { attemptsLeft: number };
      envelope: SigningEnvelopeRow;
      signing: SigningEnvelopeRow;
      docgen: DocgenEnvelopeRow | null;
      docgenStatus: string;
      status: string;
      documentName: string;
    }
  | { ok: false; error: "not_found" }
  | {
      ok: false;
      error: "expired" | "voided" | "declined";
      signer: SigningSignerPublic & { attemptsLeft: number };
      envelope: SigningEnvelopeRow;
      signing: SigningEnvelopeRow;
      docgen: DocgenEnvelopeRow | null;
      docgenStatus: string;
      status: string;
    };

export async function resolveSignerToken(
  token: string
): Promise<ResolveSignerTokenResult> {
  await ensureSigning();
  if (!token || token.length < 20) return { ok: false, error: "not_found" };
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SIGNER_PUBLIC_COLS)} FROM signing.signers
    WHERE token_hash = ${hashToken(token)} LIMIT 1`;
  if (!rows.length) return { ok: false, error: "not_found" };
  const baseSigner = rowToSignerPublic(rows[0] as Record<string, unknown>);
  const signer = {
    ...baseSigner,
    attemptsLeft: Math.max(0, MAX_ACCESS_ATTEMPTS - baseSigner.accessAttempts),
  };
  const signing = await getSigningEnvelope(signer.envelopeId);
  if (!signing) return { ok: false, error: "not_found" };
  const docgen = await getDocgenEnvelope(signer.envelopeId);
  const docgenStatus = docgen?.status ?? "";
  if (docgenStatus === "voided" || signing.voidedAt) {
    return {
      ok: false,
      error: "voided",
      signer,
      envelope: signing,
      signing,
      docgen,
      docgenStatus,
      status: docgenStatus,
    };
  }
  if (docgenStatus === "declined" || signer.status === "declined") {
    return {
      ok: false,
      error: "declined",
      signer,
      envelope: signing,
      signing,
      docgen,
      docgenStatus,
      status: docgenStatus,
    };
  }
  const expired =
    docgenStatus === "expired" ||
    (signing.expiresAt !== null &&
      new Date(signing.expiresAt).getTime() <= Date.now() &&
      docgenStatus !== "completed");
  if (expired) {
    if (docgenStatus !== "expired" && docgenStatus !== "completed") {
      await updateDocgenStatus(
        signer.envelopeId,
        "expired",
        "Envelope expired before all signatures were collected."
      );
      await appendEvent(signer.envelopeId, {
        kind: "expired",
        actor: "system",
        detail: { expiresAt: signing.expiresAt },
      });
    }
    return {
      ok: false,
      error: "expired",
      signer,
      envelope: signing,
      signing,
      docgen,
      docgenStatus: "expired",
      status: "expired",
    };
  }
  let documentName = "";
  try {
    const doc = await getDocument(signing.documentId);
    documentName = doc?.name ?? "";
  } catch {
    documentName = "";
  }
  return {
    ok: true,
    signer,
    envelope: signing,
    signing,
    docgen,
    docgenStatus,
    status: docgenStatus,
    documentName,
  };
}

/* --------------------- view / consent / access -------------------- */

export async function recordView(
  signerId: string,
  ip: string,
  ua: string
): Promise<{ signer: SigningSignerPublic; firstView: boolean }> {
  await ensureSigning();
  const signer = await getSignerPublic(signerId);
  if (!signer) throw new Error("signer_not_found");
  if (signer.viewedAt) return { signer, firstView: false };
  const db = sql();
  const prior = await db`
    SELECT count(*)::int AS n FROM signing.events
    WHERE envelope_id = ${signer.envelopeId} AND kind = 'viewed'`;
  const priorViews = prior.length ? num(prior[0].n) : 0;
  await db`
    UPDATE signing.signers SET viewed_at = now(),
      status = CASE WHEN status = 'active' THEN 'viewed' ELSE status END,
      updated_at = now()
    WHERE id = ${signerId}`;
  const docgen = await getDocgenEnvelope(signer.envelopeId);
  if (docgen && docgen.status === "sent") {
    await updateDocgenStatus(signer.envelopeId, "viewed");
  }
  await appendEvent(signer.envelopeId, {
    signerId,
    kind: "viewed",
    actor: signer.name || signer.email,
    ip,
    userAgent: ua,
    detail: {},
  });
  const firstView = priorViews === 0;
  if (firstView) {
    const signing = await getSigningEnvelope(signer.envelopeId);
    if (signing) {
      await notifySender(
        {
          envelopeId: signing.envelopeId,
          documentId: signing.documentId,
          senderEmail: signing.senderEmail,
        },
        "esign_viewed",
        `${signer.name || signer.email} opened the document for signing.`
      );
    }
  }
  const updated = await getSignerPublic(signerId);
  if (!updated) throw new Error("signer_not_found");
  return { signer: updated, firstView };
}

export async function recordConsent(
  signerId: string,
  ip: string,
  ua: string
): Promise<{ signer: SigningSignerPublic }> {
  await ensureSigning();
  const signer = await getSignerPublic(signerId);
  if (!signer) throw new Error("signer_not_found");
  if (signer.consentAt) return { signer };
  if (
    signer.status !== "active" &&
    signer.status !== "viewed" &&
    signer.status !== "consented"
  ) {
    throw new Error("signer_not_active");
  }
  const db = sql();
  await db`
    UPDATE signing.signers SET consent_at = now(), status = 'consented',
      updated_at = now()
    WHERE id = ${signerId}`;
  await appendEvent(signer.envelopeId, {
    signerId,
    kind: "consented",
    actor: signer.name || signer.email,
    ip,
    userAgent: ua,
    detail: {},
  });
  const updated = await getSignerPublic(signerId);
  if (!updated) throw new Error("signer_not_found");
  return { signer: updated };
}

export async function checkAccessCode(
  signerId: string,
  code: string,
  countAttempt: boolean
): Promise<{
  ok: boolean;
  required: boolean;
  locked: boolean;
  attemptsLeft: number;
}> {
  await ensureSigning();
  const db = sql();
  const rows = await db`
    SELECT access_code_hash, access_attempts, access_locked, envelope_id,
      name, email
    FROM signing.signers WHERE id = ${signerId} LIMIT 1`;
  if (!rows.length) throw new Error("signer_not_found");
  const rec = rows[0] as Record<string, unknown>;
  const hash = rec.access_code_hash ? str(rec.access_code_hash) : "";
  if (!hash) {
    return { ok: true, required: false, locked: false, attemptsLeft: MAX_ACCESS_ATTEMPTS };
  }
  const attempts = num(rec.access_attempts);
  const locked = Boolean(rec.access_locked);
  if (locked) {
    return { ok: false, required: true, locked: true, attemptsLeft: 0 };
  }
  const ok = code ? await bcrypt.compare(code, hash) : false;
  if (ok) {
    return {
      ok: true,
      required: true,
      locked: false,
      attemptsLeft: MAX_ACCESS_ATTEMPTS - attempts,
    };
  }
  if (!countAttempt) {
    return {
      ok: false,
      required: true,
      locked: false,
      attemptsLeft: Math.max(0, MAX_ACCESS_ATTEMPTS - attempts),
    };
  }
  const nextAttempts = attempts + 1;
  const nowLocked = nextAttempts >= MAX_ACCESS_ATTEMPTS;
  await db`
    UPDATE signing.signers SET access_attempts = ${nextAttempts},
      access_locked = ${nowLocked}, updated_at = now()
    WHERE id = ${signerId}`;
  await appendEvent(str(rec.envelope_id), {
    signerId,
    kind: "access_code_failed",
    actor: str(rec.name) || str(rec.email),
    detail: { attempts: nextAttempts },
  });
  if (nowLocked) {
    await appendEvent(str(rec.envelope_id), {
      signerId,
      kind: "access_locked",
      actor: str(rec.name) || str(rec.email),
      detail: { attempts: nextAttempts },
    });
  }
  return {
    ok: false,
    required: true,
    locked: nowLocked,
    attemptsLeft: Math.max(0, MAX_ACCESS_ATTEMPTS - nextAttempts),
  };
}

/* ------------------------- signature / decline ---------------------- */

export async function recordSignature(
  signerId: string,
  input: {
    kind: string;
    typedName?: string;
    signatureObjectKey?: string;
    ip: string;
    ua: string;
  }
): Promise<{
  signer: SigningSignerPublic;
  envelopeStatus: string;
  allSigned: boolean;
}> {
  await ensureSigning();
  const kind = input.kind === "drawn" ? "drawn" : input.kind === "typed" ? "typed" : "";
  if (!kind) throw new Error("signature_kind_required");
  const typedName = (input.typedName ?? "").trim().slice(0, 200);
  const signatureObjectKey = (input.signatureObjectKey ?? "").trim().slice(0, 300);
  if (kind === "typed" && !typedName) throw new Error("typed_name_required");
  if (kind === "drawn" && !signatureObjectKey) {
    throw new Error("signature_image_required");
  }
  const signer = await getSignerPublic(signerId);
  if (!signer) throw new Error("signer_not_found");
  if (signer.status === "signed") throw new Error("already_signed");
  if (signer.status === "declined") throw new Error("signer_declined");
  if (!signer.consentAt) throw new Error("consent_required");
  if (signer.status !== "consented") throw new Error("signer_not_active");
  const signing = await getSigningEnvelope(signer.envelopeId);
  if (!signing) throw new Error("envelope_not_found");
  const docgen = await getDocgenEnvelope(signer.envelopeId);
  if (
    !docgen ||
    (docgen.status !== "sent" &&
      docgen.status !== "viewed" &&
      docgen.status !== "partially_signed")
  ) {
    throw new Error("envelope_not_live");
  }
  const db = sql();
  await db`
    UPDATE signing.signers SET status = 'signed', signed_at = now(),
      signature_kind = ${kind},
      typed_name = ${kind === "typed" ? typedName : ""},
      signature_object_key = ${kind === "drawn" ? signatureObjectKey : ""},
      ip = ${(input.ip ?? "").slice(0, 100)},
      user_agent = ${(input.ua ?? "").slice(0, 400)},
      updated_at = now()
    WHERE id = ${signerId}`;
  await appendEvent(signer.envelopeId, {
    signerId,
    kind: "signed",
    actor: signer.name || signer.email,
    ip: input.ip,
    userAgent: input.ua,
    detail: { signatureKind: kind },
  });
  await notifySender(
    {
      envelopeId: signing.envelopeId,
      documentId: signing.documentId,
      senderEmail: signing.senderEmail,
    },
    "esign_signed",
    `${signer.name || signer.email} signed the document.`
  );

  // Sequential advance: the next pending signer becomes active. Its
  // link was issued at creation and is held by the sender; when (and
  // only when) email transport is verified we rotate its token and
  // email the fresh link, since the original raw token cannot be
  // recovered from its hash.
  if (signing.signingOrder === "sequential") {
    const signers = await listSignersPublic(signer.envelopeId);
    const next = signers.find((s) => s.status === "pending");
    if (next) {
      await db`
        UPDATE signing.signers SET status = 'active', updated_at = now()
        WHERE id = ${next.id}`;
      await appendEvent(signer.envelopeId, {
        signerId: next.id,
        kind: "activated",
        actor: "system",
        detail: { via: "sequential_advance" },
      });
      if (await emailTransportAvailable()) {
        const token = randomBytes(32).toString("base64url");
        await db`
          UPDATE signing.signers SET token_hash = ${hashToken(token)},
            token_issued_at = now(), updated_at = now()
          WHERE id = ${next.id}`;
        const doc = await getDocument(signing.documentId).catch(() => null);
        await trySendSignerEmail({
          to: next.email,
          name: next.name,
          documentName: doc?.name ?? "Document for signature",
          token,
        });
      }
    }
  }

  const signers = await listSignersPublic(signer.envelopeId);
  const allSigned =
    signers.length > 0 && signers.every((s) => s.status === "signed");
  const someSigned = signers.some((s) => s.status === "signed");
  const updated = await getSignerPublic(signerId);
  if (!updated) throw new Error("signer_not_found");
  // Partial state: at least one signer has signed and others remain
  // — the docgen status must say so (it previously stayed 'viewed').
  // 'completed' is NOT set here: markCompleted owns it. When all
  // have signed, still return 'partially_signed' and let the
  // caller's finalize/markCompleted flip it to 'completed'.
  let envelopeStatus: string;
  if (someSigned && !allSigned) {
    const envelopeNow = await getDocgenEnvelope(signer.envelopeId);
    if (envelopeNow && envelopeNow.status !== "completed") {
      await updateDocgenStatus(signer.envelopeId, "partially_signed");
    }
    envelopeStatus = "partially_signed";
  } else if (allSigned) {
    envelopeStatus = "partially_signed";
  } else {
    const envelopeNow = await getDocgenEnvelope(signer.envelopeId);
    envelopeStatus = envelopeNow?.status ?? docgen.status;
  }
  return {
    signer: updated,
    envelopeStatus,
    allSigned,
  };
}

export async function recordDecline(
  signerId: string,
  reason: string,
  ip: string,
  ua: string
): Promise<{ signer: SigningSignerPublic }> {
  await ensureSigning();
  const signer = await getSignerPublic(signerId);
  if (!signer) throw new Error("signer_not_found");
  if (signer.status === "signed") throw new Error("already_signed");
  if (signer.status === "declined") return { signer };
  const cleanReason = (reason ?? "").trim().slice(0, 500);
  const db = sql();
  await db`
    UPDATE signing.signers SET status = 'declined',
      decline_reason = ${cleanReason}, updated_at = now()
    WHERE id = ${signerId}`;
  await updateDocgenStatus(
    signer.envelopeId,
    "declined",
    cleanReason ? `Declined: ${cleanReason}` : "Declined by a signer."
  );
  await appendEvent(signer.envelopeId, {
    signerId,
    kind: "declined",
    actor: signer.name || signer.email,
    ip,
    userAgent: ua,
    detail: { reason: cleanReason.slice(0, 300) },
  });
  const signing = await getSigningEnvelope(signer.envelopeId);
  if (signing) {
    await notifySender(
      {
        envelopeId: signing.envelopeId,
        documentId: signing.documentId,
        senderEmail: signing.senderEmail,
      },
      "esign_declined",
      `${signer.name || signer.email} declined to sign.`
    );
  }
  const updated = await getSignerPublic(signerId);
  if (!updated) throw new Error("signer_not_found");
  return { signer: updated };
}

/* --------------------- full read + completion (B) ------------------- */

export interface SigningEnvelopeFull {
  /** The signing.envelopes row (also exposed as `signing`). */
  envelope: SigningEnvelopeRow;
  signing: SigningEnvelopeRow;
  docgen: DocgenEnvelopeRow;
  docgenStatus: string;
  /** Full signers incl. signature data + ip/ua; token/access hashes
   * are never included. */
  signers: SigningSignerFull[];
  events: SigningEventRow[];
}

export async function getEnvelopeFull(
  envelopeId: string
): Promise<SigningEnvelopeFull | null> {
  await ensureSigning();
  const signing = await getSigningEnvelope(envelopeId);
  if (!signing) return null;
  const docgen = await getDocgenEnvelope(envelopeId);
  if (!docgen) return null;
  const db = sql();
  const signerRows = await db`
    SELECT ${db.unsafe(SIGNER_FULL_COLS)} FROM signing.signers
    WHERE envelope_id = ${envelopeId}
    ORDER BY order_index ASC, created_at ASC`;
  const signers = signerRows.map((r) =>
    rowToSignerFull(r as Record<string, unknown>)
  );
  const events = await listEvents(envelopeId);
  return {
    envelope: signing,
    signing,
    docgen,
    docgenStatus: docgen.status,
    signers,
    events,
  };
}

export async function markCompleted(
  envelopeId: string,
  artifacts: {
    executedDocumentId: string;
    certificateDocumentId: string;
    executedSha256: string;
  }
): Promise<{ signing: SigningEnvelopeRow; envelope: DocgenEnvelopeRow }> {
  await ensureSigning();
  const signing = await getSigningEnvelope(envelopeId);
  if (!signing) throw new Error("envelope_not_found");
  const db = sql();
  await db`
    UPDATE signing.envelopes SET
      executed_document_id = ${artifacts.executedDocumentId},
      certificate_document_id = ${artifacts.certificateDocumentId},
      executed_sha256 = ${artifacts.executedSha256},
      completed_at = now(), updated_at = now()
    WHERE envelope_id = ${envelopeId}`;
  await updateDocgenStatus(
    envelopeId,
    "completed",
    "Signing completed — executed copy and certificate filed."
  );
  await appendEvent(envelopeId, {
    kind: "completed",
    actor: "system",
    detail: {
      executedDocumentId: artifacts.executedDocumentId,
      certificateDocumentId: artifacts.certificateDocumentId,
      executedSha256: artifacts.executedSha256,
    },
  });
  const updated = await getSigningEnvelope(envelopeId);
  const docgen = await getDocgenEnvelope(envelopeId);
  if (!updated || !docgen) throw new Error("envelope_not_found");
  await notifySender(
    {
      envelopeId: updated.envelopeId,
      documentId: updated.documentId,
      senderEmail: updated.senderEmail,
    },
    "esign_completed",
    "All signers completed — the executed copy and certificate of completion are filed in the document library."
  );
  return { signing: updated, envelope: docgen };
}

export { notifySender } from "./notify";
export type { SigningNotifyKind } from "./notify";
