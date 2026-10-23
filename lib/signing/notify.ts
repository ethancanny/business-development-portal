import { sql, newId } from "../platform/db";
import { ensureNotificationsSchema } from "../platform/collab";

/**
 * Sender notifications for the in-house signing module — ONE write
 * path: a core.notifications row addressed to the envelope's sender
 * (the collab.ts / comms delivery.ts row shape: user_email, kind,
 * title, body, href). No email is sent from here (Graph Mail.Send is
 * setup-gated; the notification center is the live channel), and no
 * document content ever appears in a notification — title + a short
 * status line only. Failures are logged with ids only, never thrown:
 * a notification must not fail a signing action.
 */

export type SigningNotifyKind =
  | "esign_viewed"
  | "esign_signed"
  | "esign_completed"
  | "esign_declined";

export interface SigningNotifyEnvelope {
  envelopeId: string;
  documentId: string;
  senderEmail: string;
}

const TITLES: Record<SigningNotifyKind, string> = {
  esign_viewed: "Document opened for signing",
  esign_signed: "Document signed",
  esign_completed: "Signing completed",
  esign_declined: "Signing declined",
};

export async function notifySender(
  envelope: SigningNotifyEnvelope,
  kind: SigningNotifyKind,
  text: string
): Promise<void> {
  const email = (envelope.senderEmail ?? "").trim().toLowerCase();
  if (!email) return;
  try {
    await ensureNotificationsSchema();
    const db = sql();
    await db`
      INSERT INTO core.notifications
        (id, user_email, kind, title, body, href, entity_kind, entity_id)
      VALUES (${newId()}, ${email}, ${kind}, ${TITLES[kind]},
        ${(text ?? "").slice(0, 300)},
        ${`/documents?doc=${envelope.documentId}`},
        'signing_envelope', ${envelope.envelopeId})`;
  } catch (err) {
    console.error(
      "[signing] sender notification write failed for envelope",
      envelope.envelopeId,
      err instanceof Error ? err.message : String(err)
    );
  }
}
