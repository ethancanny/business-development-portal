import { sql, newId, str, isoOrNull } from "../platform/db";
import { getDocument } from "../dataroom/documents";
import { ensureDocgen } from "./templates";
import type { DocgenEnvelopeRow } from "./schema";

/**
 * E-signature FRAMEWORK (Phase 10) — provider-agnostic, no live
 * provider yet.
 *
 * Ethan's decision (Oct 22, 2026): signing will be an IN-HOUSE module
 * built into the portal — the follow-on build right after Phase 10
 * (DocuSign, Dropbox Sign, SharePoint eSignature and DocuSeal were all
 * evaluated and rejected). This file therefore bakes in NO external
 * API assumptions: the provider interface, envelope persistence, and
 * status reporting are generic, and the registered provider is the
 * in-house module's placeholder.
 *
 * Until the in-house build ships, the provider reports
 * setup_required and createEnvelope throws EsignSetupRequiredError:
 * the route records an envelope row with status "setup_required" and
 * returns 409. Nothing is ever reported as sent. When the in-house
 * module lands it implements this same interface (token-link signer
 * flow, seal, certificate) and these records/actions work unchanged.
 */

export interface EsignRecipient {
  name: string;
  email: string;
}

export interface EsignProviderStatus {
  configured: boolean;
  setupRequired: boolean;
  detail: string;
}

export interface EsignStatus extends EsignProviderStatus {
  provider: string;
  setupSteps: string[];
}

export class EsignSetupRequiredError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "EsignSetupRequiredError";
  }
}

export interface EsignProvider {
  name: string;
  status(): Promise<EsignProviderStatus>;
  createEnvelope(input: {
    documentId: string;
    documentName: string;
    dealId: string | null;
    recipients: EsignRecipient[];
    actor: string;
  }): Promise<{ externalId: string; status: string }>;
}

export const ESIGN_SETUP_STEPS: string[] = [
  "Signing is built into the portal itself — no external account, API keys, or environment variables are involved.",
  "The in-house signing build is queued as the follow-on right after Phase 10. Its scope: a token-link signer flow (recipients sign through a secure link, reusing the platform's hashed-token machinery), drawn/typed signatures with consent capture, a tamper-evident seal (document hash + signing event log), and a downloadable signing certificate for every completed envelope.",
  "Envelope requests made before that build ships are recorded here with status setup_required — they are never reported as sent, and they carry over unchanged when the module activates.",
];

/**
 * The in-house signing provider. Phase 10 ships the framework only —
 * the signer flow itself is the next build (deliberately NOT built
 * here), so every action honestly reports setup_required.
 */
export const inHouseProvider: EsignProvider = {
  name: "in-house",

  async status(): Promise<EsignProviderStatus> {
    return {
      configured: false,
      setupRequired: true,
      detail:
        "In-house signing — build queued after Phase 10. Envelope actions report setup_required until the signing module ships; nothing is sent.",
    };
  },

  async createEnvelope(): Promise<{ externalId: string; status: string }> {
    throw new EsignSetupRequiredError(
      "In-house signing is not available yet — the signing module build is queued after Phase 10. No envelope was sent."
    );
  },
};

export function getEsignProvider(): EsignProvider {
  return inHouseProvider;
}

export async function getEsignStatus(): Promise<EsignStatus> {
  const st = await inHouseProvider.status();
  return { provider: inHouseProvider.name, ...st, setupSteps: ESIGN_SETUP_STEPS };
}

/* ---------------------------- persistence ---------------------------- */

function parseRecipients(v: unknown): EsignRecipient[] {
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

function rowToEnvelope(r: Record<string, unknown>): DocgenEnvelopeRow {
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

const ENV_COLS = `
  id, document_id, deal_id, provider, status, external_id, recipients,
  detail, created_by, created_at, updated_at`;

async function insertEnvelope(input: {
  documentId: string;
  dealId: string | null;
  provider: string;
  status: string;
  externalId: string | null;
  recipients: EsignRecipient[];
  detail: string;
  actor: string;
}): Promise<DocgenEnvelopeRow> {
  await ensureDocgen();
  const db = sql();
  const id = newId();
  const rows = await db`
    INSERT INTO docgen.envelopes
      (id, document_id, deal_id, provider, status, external_id,
        recipients, detail, created_by)
    VALUES (${id}, ${input.documentId}, ${input.dealId}, ${input.provider},
      ${input.status}, ${input.externalId},
      ${JSON.stringify(input.recipients)}::jsonb, ${input.detail},
      ${input.actor})
    RETURNING ${db.unsafe(ENV_COLS)}`;
  return rowToEnvelope(rows[0] as Record<string, unknown>);
}

export async function getLatestEnvelope(
  documentId: string
): Promise<DocgenEnvelopeRow | null> {
  await ensureDocgen();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(ENV_COLS)} FROM docgen.envelopes
    WHERE document_id = ${documentId}
    ORDER BY created_at DESC LIMIT 1`;
  return rows.length
    ? rowToEnvelope(rows[0] as Record<string, unknown>)
    : null;
}

export async function listEnvelopes(
  documentId: string
): Promise<DocgenEnvelopeRow[]> {
  await ensureDocgen();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(ENV_COLS)} FROM docgen.envelopes
    WHERE document_id = ${documentId}
    ORDER BY created_at DESC LIMIT 25`;
  return rows.map((r) => rowToEnvelope(r as Record<string, unknown>));
}

/**
 * Request an envelope for a document. Resolves the document (throws
 * Error("document_not_found")), then calls the provider. While the
 * provider reports setup_required, the envelope row is persisted with
 * status "setup_required" and the EsignSetupRequiredError is
 * re-thrown carrying { envelope }. NEVER returns a fake sent state.
 */
export async function requestEnvelope(input: {
  documentId: string;
  recipients: EsignRecipient[];
  actor: string;
}): Promise<{ envelope: DocgenEnvelopeRow }> {
  await ensureDocgen();
  const doc = await getDocument(input.documentId);
  if (!doc) throw new Error("document_not_found");
  const provider = getEsignProvider();
  try {
    const result = await provider.createEnvelope({
      documentId: doc.id,
      documentName: doc.name,
      dealId: doc.dealId,
      recipients: input.recipients,
      actor: input.actor,
    });
    // Unreachable in Phase 10 (the provider always throws), kept so a
    // future live implementation slots in without route changes.
    const envelope = await insertEnvelope({
      documentId: doc.id,
      dealId: doc.dealId,
      provider: provider.name,
      status: result.status || "sent",
      externalId: result.externalId || null,
      recipients: input.recipients,
      detail: "Envelope created with provider.",
      actor: input.actor,
    });
    return { envelope };
  } catch (err) {
    if (err instanceof EsignSetupRequiredError) {
      const envelope = await insertEnvelope({
        documentId: doc.id,
        dealId: doc.dealId,
        provider: provider.name,
        status: "setup_required",
        externalId: null,
        recipients: input.recipients,
        detail: err.message,
        actor: input.actor,
      });
      (err as EsignSetupRequiredError & { envelope?: DocgenEnvelopeRow }).envelope =
        envelope;
      throw err;
    }
    throw err;
  }
}
