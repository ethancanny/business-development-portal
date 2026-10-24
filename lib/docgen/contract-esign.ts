import { requestEnvelope } from "./esign";
import type { ContractSigner } from "./schema";

/**
 * Contract e-signature provider seam (Oct 24, 2026 — spec §4).
 *
 * The framework is provider-agnostic: signer fields + the status
 * flow live on the contract; SENDING goes through this interface.
 * The provider is chosen by the CONTRACT_ESIGN_PROVIDER environment
 * variable. The default (and only registered) implementation routes
 * to the portal's EXISTING in-house e-signature system
 * (lib/docgen/esign.ts → lib/signing/*) — token-link signing,
 * consent capture, hash-chained audit log, sealed executed PDF +
 * certificate. A future external provider (DocuSign etc.) drops in
 * by implementing this interface + one env change; no contract code
 * changes.
 */

export interface ContractSendResult {
  provider: string;
  envelopeId: string;
  status: string;
  /** One-time signer links (in-house flow returns them exactly
   * once; the sender shares them while email sending is gated). */
  links: Array<{ signerId: string; name: string; email: string; url: string }>;
}

export interface ContractEsignProvider {
  name: string;
  sendForSignature(input: {
    documentId: string;
    documentName: string;
    dealId: string | null;
    signers: ContractSigner[];
    actor: string;
    actorEmail?: string;
  }): Promise<ContractSendResult>;
}

const inHouseContractProvider: ContractEsignProvider = {
  name: "in-house",
  async sendForSignature(input) {
    const recipients = input.signers
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ name: s.name, email: s.email }));
    const { envelope, links } = await requestEnvelope({
      documentId: input.documentId,
      recipients,
      actor: input.actor,
      actorEmail: input.actorEmail,
      signingOrder: recipients.length > 1 ? "sequential" : "parallel",
    });
    return {
      provider: "in-house",
      envelopeId: envelope.id,
      status: envelope.status,
      links,
    };
  },
};

const PROVIDERS: Record<string, ContractEsignProvider> = {
  "in-house": inHouseContractProvider,
};

/** Provider selected by CONTRACT_ESIGN_PROVIDER (default in-house). */
export function getContractEsignProvider(): ContractEsignProvider {
  const name = (process.env.CONTRACT_ESIGN_PROVIDER ?? "").trim();
  if (!name) return inHouseContractProvider;
  const provider = PROVIDERS[name];
  if (!provider) {
    throw new Error(
      `esign_provider_not_registered: CONTRACT_ESIGN_PROVIDER="${name}" has no registered implementation (registered: ${Object.keys(PROVIDERS).join(", ")}).`
    );
  }
  return provider;
}

export function contractEsignProviderName(): string {
  const name = (process.env.CONTRACT_ESIGN_PROVIDER ?? "").trim();
  return name || "in-house";
}
