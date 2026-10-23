import { sql, newId, str, isoOrNull } from "../platform/db";
import { getDocument } from "../dataroom/documents";
import { ensureDocgen } from "./templates";
import type { DocgenEnvelopeRow } from "./schema";

/**
 * E-signature FRAMEWORK (Phase 10) — no live provider.
 *
 * The provider interface, the DocuSign implementation's configuration
 * gate, envelope persistence, and status reporting are all real; the
 * live send is deliberately NOT implemented in this phase:
 * - When the four DocuSign env vars are not all set, createEnvelope
 *   throws EsignSetupRequiredError (carrying `missing`) and the route
 *   records an envelope row with status "setup_required" and returns
 *   409. Nothing is ever reported as sent.
 * - When they ARE all set, createEnvelope still throws the honest
 *   "live_send_not_implemented" error — Phase 10 makes no live calls.
 */

export interface EsignRecipient {
  name: string;
  email: string;
}

export interface EsignProviderStatus {
  configured: boolean;
  setupRequired: boolean;
  missing: string[];
  detail: string;
}

export interface EsignStatus extends EsignProviderStatus {
  provider: string;
  setupSteps: string[];
}

export class EsignSetupRequiredError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(
      `E-signature is not configured: missing env vars ${missing.join(", ")}`
    );
    this.name = "EsignSetupRequiredError";
    this.missing = missing;
  }
}

export class EsignNotImplementedError extends Error {
  code = "live_send_not_implemented";
  constructor() {
    super(
      "live_send_not_implemented: DocuSign credentials are present, but live envelope sending is not implemented in this phase (framework only — no live calls are made)."
    );
    this.name = "EsignNotImplementedError";
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

export const DOCUSIGN_ENV_VARS = [
  "DOCUSIGN_INTEGRATION_KEY",
  "DOCUSIGN_USER_ID",
  "DOCUSIGN_ACCOUNT_ID",
  "DOCUSIGN_PRIVATE_KEY",
] as const;

export const ESIGN_SETUP_STEPS: string[] = [
  "Create a DocuSign developer account (developer.docusign.com) and confirm the demo environment works.",
  "In the DocuSign developer console, create an app and note its Integration Key; add the portal's redirect URI when prompted.",
  "Create an RSA keypair for the app and keep the private key — it becomes DOCUSIGN_PRIVATE_KEY.",
  "Set all four env vars in Vercel (DOCUSIGN_INTEGRATION_KEY, DOCUSIGN_USER_ID, DOCUSIGN_ACCOUNT_ID, DOCUSIGN_PRIVATE_KEY) for the portal project.",
  "Redeploy the portal, then re-check this card — it will report the provider as configured (live sending itself ships in a later phase).",
];

function missingDocuSignEnv(): string[] {
  return DOCUSIGN_ENV_VARS.filter(
    (k) => !(process.env[k] ?? "").trim()
  ) as string[];
}

export const docuSignProvider: EsignProvider = {
  name: "docusign",

  async status(): Promise<EsignProviderStatus> {
    const missing = missingDocuSignEnv();
    if (missing.length) {
      return {
        configured: false,
        setupRequired: true,
        missing,
        detail: `DocuSign is not configured — missing env vars: ${missing.join(", ")}. Envelopes cannot be sent until setup is complete.`,
      };
    }
    return {
      configured: true,
      setupRequired: false,
      missing: [],
      detail:
        "DocuSign credentials are present (all four env vars set). Live envelope sending is not implemented in this phase — the framework records requests but makes no live calls.",
    };
  },

  async createEnvelope(): Promise<{ externalId: string; status: string }> {
    const missing = missingDocuSignEnv();
    if (missing.length) throw new EsignSetupRequiredError(missing);
    throw new EsignNotImplementedError();
  },
};

export function getEsignProvider(): EsignProvider {
  return docuSignProvider;
}

export async function getEsignStatus(): Promise<EsignStatus> {
  const st = await docuSignProvider.status();
  return { provider: docuSignProvider.name, ...st, setupSteps: ESIGN_SETUP_STEPS };
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
    provider: str(r.provider) || "docusign",
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
 * Error("document_not_found")), then calls the provider. Outcomes:
 * - setup required → envelope row persisted with status
 *   "setup_required" (detail names the missing env vars) and the
 *   EsignSetupRequiredError is re-thrown carrying { envelope }.
 * - configured but framework phase → row persisted with status
 *   "not_implemented" and EsignNotImplementedError re-thrown.
 * NEVER returns a fake sent state.
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
        detail: `Setup required — missing env vars: ${err.missing.join(", ")}. No envelope was sent.`,
        actor: input.actor,
      });
      (err as EsignSetupRequiredError & { envelope?: DocgenEnvelopeRow }).envelope =
        envelope;
      throw err;
    }
    if (err instanceof EsignNotImplementedError) {
      const envelope = await insertEnvelope({
        documentId: doc.id,
        dealId: doc.dealId,
        provider: provider.name,
        status: "not_implemented",
        externalId: null,
        recipients: input.recipients,
        detail: err.message,
        actor: input.actor,
      });
      (err as EsignNotImplementedError & { envelope?: DocgenEnvelopeRow }).envelope =
        envelope;
      throw err;
    }
    throw err;
  }
}
