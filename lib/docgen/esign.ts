import { sql, str, isoOrNull } from "../platform/db";
import { getDocument } from "../dataroom/documents";
import { ensureSigning, createEnvelopeForSource } from "../signing/service";
import { ensureDocgen } from "./templates";
import type { DocgenEnvelopeRow } from "./schema";

/**
 * E-signature provider seam (Phase 10 framework, in-house build).
 *
 * Ethan's decision (Oct 22, 2026): signing is an IN-HOUSE module
 * built into the portal. The provider interface below stays
 * provider-agnostic, and the registered provider is the in-house
 * signing module (lib/signing/*): token-link signer flow, ESIGN/UETA
 * consent capture, typed/drawn signatures, a hash-chained event log,
 * a cryptographic seal and a certificate of completion for every
 * completed envelope (Workstreams A/B).
 *
 * requestEnvelope() validates the document and delegates the real
 * work to lib/signing/service.createEnvelopeForSource, which creates
 * the docgen envelope row (status "sent"), the signing.* rows and
 * the one-time signer links. Links are returned exactly once; while
 * Graph Mail.Send remains setup-gated (Ethan's Entra bundle), the
 * envelope's email_status is "manual_link" and the sender shares the
 * links — nothing is ever reported as emailed that was not sent.
 */

export interface EsignRecipient {
  name: string;
  email: string;
  /** Optional per-signer access code (stored bcrypt-hashed). */
  accessCode?: string;
}

export interface EsignProviderStatus {
  configured: boolean;
  setupRequired: boolean;
  detail: string;
}

export interface CertificateInfo {
  subject: string;
  fingerprint: string;
  notBefore: string;
  notAfter: string;
}

export interface EsignStatus extends EsignProviderStatus {
  provider: string;
  setupSteps: string[];
  certificate: CertificateInfo | null;
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
  "Signing is built into the portal itself — no external account, API keys, or environment variables are involved. Send from any library document or Communications report: pick recipients, an optional access code per signer, sequential or parallel order, and an expiry (default in Settings).",
  "Each signer gets a one-time secure link (/sign/<token> — only its SHA-256 hash is stored). While Microsoft Graph Mail.Send is still pending Ethan's Entra consent, links are delivered manually by the sender and the envelope records email_status 'manual_link'; once Mail.Send is verified, active signers are emailed automatically and the status flips to 'sent'.",
  "Signers open the link, pass their access code if one was set (5 attempts, then locked), record ESIGN/UETA consent, and sign with a typed or drawn signature. Every step lands in a hash-chained audit log; the sender is notified on first view, each signature, completion, and decline.",
  "On completion the executed PDF is sealed with the portal's self-signed signing certificate (Settings → Integrations shows its fingerprint and validity) and filed to the document library together with a certificate of completion. Note: the seal uses our own logs and a self-signed certificate — appropriate for NDAs, LOIs and consents, not a substitute for third-party evidence at a contested closing.",
];

/**
 * The in-house signing provider. status() is live once the signing
 * schema ensures cleanly. createEnvelope() is the legacy Phase 10
 * provider-interface shim (capability check + id mint only) — the
 * real envelope flow is requestEnvelope() → createEnvelopeForSource,
 * which also persists the docgen row, so createEnvelope never
 * double-writes one.
 */
export const inHouseProvider: EsignProvider = {
  name: "in-house",

  async status(): Promise<EsignProviderStatus> {
    try {
      await ensureSigning();
      return {
        configured: true,
        setupRequired: false,
        detail:
          "In-house signing is live: token-link signer flow with consent capture, hash-chained audit log, cryptographic seal and certificate of completion. Signer links are shared manually by the sender until Graph Mail.Send is consented.",
      };
    } catch (err) {
      return {
        configured: false,
        setupRequired: true,
        detail: `In-house signing schema could not be ensured: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  },

  async createEnvelope(input: {
    documentId: string;
  }): Promise<{ externalId: string; status: string }> {
    await ensureSigning();
    return { externalId: `in-house:${input.documentId}`, status: "sent" };
  },
};

export function getEsignProvider(): EsignProvider {
  return inHouseProvider;
}

export async function getEsignStatus(): Promise<EsignStatus> {
  const st = await inHouseProvider.status();
  let certificate: CertificateInfo | null = null;
  try {
    // Workstream B (lib/signing/cert.ts) — dynamic import with a
    // literal specifier so a not-yet-landed cert module degrades to
    // `certificate: null` instead of failing the status surface.
    const mod = (await import("../signing/cert")) as {
      getCertificateInfo?: () => Promise<CertificateInfo | null>;
    };
    if (typeof mod.getCertificateInfo === "function") {
      certificate = await mod.getCertificateInfo();
    }
  } catch {
    certificate = null;
  }
  return {
    provider: inHouseProvider.name,
    ...st,
    setupSteps: ESIGN_SETUP_STEPS,
    certificate,
  };
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
 * Request an envelope for a document. Validates the document (throws
 * Error("document_not_found")), then delegates to the signing
 * service, which persists the docgen envelope (status "sent"), the
 * signing rows and the signer tokens, and returns the one-time
 * signer links alongside the envelope.
 */
export async function requestEnvelope(input: {
  documentId: string;
  recipients: EsignRecipient[];
  actor: string;
  actorEmail?: string;
  signingOrder?: "sequential" | "parallel";
  message?: string;
  expiresAt?: string | null;
  templateBlocks?: unknown;
}): Promise<{
  envelope: DocgenEnvelopeRow;
  signing: import("../signing/schema").SigningEnvelopeRow;
  links: Array<{ signerId: string; name: string; email: string; url: string }>;
}> {
  await ensureDocgen();
  const doc = await getDocument(input.documentId);
  if (!doc) throw new Error("document_not_found");
  return createEnvelopeForSource(
    {
      documentId: doc.id,
      recipients: input.recipients,
      signingOrder: input.signingOrder ?? "sequential",
      message: input.message,
      expiresAt: input.expiresAt ?? null,
      templateBlocks: input.templateBlocks,
    },
    { name: input.actor, email: input.actorEmail ?? "" }
  );
}
