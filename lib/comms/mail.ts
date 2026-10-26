import { sql } from "../platform/db";
import { graph, msStatus } from "../microsoft";
import { ensureComms } from "./schema";

/**
 * Report-delivery email transport (Part 12) — Microsoft Graph sendMail.
 *
 * Honesty rules:
 * - The portal's Microsoft connection was consented for calendar
 *   scopes only; Mail.Send is NOT yet granted. Until a real send
 *   succeeds, mailSend stays 'unknown' (from the stored probe) — a
 *   send is never faked.
 * - Email bodies carry a notification + the recipient's LOGIN LINK
 *   ONLY. Report content never travels in email. A PDF is attached
 *   only when the caller passes pdf bytes, which delivery.ts does
 *   solely for recipients flagged allow_pdf.
 * - sendDeliveryEmail never throws; outcomes are returned as data and
 *   the probe in comms.settings is updated from real attempts.
 */

export type MailSendState = "unknown" | "available" | "setup_required";

export interface EmailTransportStatus {
  provider: "microsoft_graph";
  connected: boolean;
  mailSend: MailSendState;
  detail: string;
  setupSteps: string[];
  /** ISO time of the last successful delivery send — the stored
   * probe is written by sendDeliveryEmail on success, so an
   * 'available' probe's timestamp IS the last success. Null until
   * a send has actually succeeded (never inferred). */
  lastSuccessAt: string | null;
}

const SETUP_STEPS = [
  "In Microsoft Entra, grant the Mail.Send application/delegated permission to the portal's app registration (admin consent).",
  "Add Mail.Send to the app's requested scopes in lib/microsoft.ts (the SCOPES constant) so the consent flow asks for it.",
  "Reconnect Microsoft in Settings → Integrations so a fresh token carrying Mail.Send is stored.",
];

interface EmailProbe {
  mailSend: MailSendState;
  detail?: string;
  at?: string;
}

async function readProbe(): Promise<EmailProbe | null> {
  try {
    await ensureComms();
    const db = sql();
    const rows = await db`
      SELECT value FROM comms.settings WHERE key = 'email_probe' LIMIT 1`;
    if (!rows.length) return null;
    const v = (rows[0] as Record<string, unknown>).value;
    const parsed =
      typeof v === "string" ? (JSON.parse(v) as EmailProbe) : (v as EmailProbe);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function writeProbe(probe: EmailProbe): Promise<void> {
  try {
    await ensureComms();
    const db = sql();
    const value = { ...probe, at: new Date().toISOString() };
    await db`
      INSERT INTO comms.settings (key, value, updated_at)
      VALUES ('email_probe', ${JSON.stringify(value)}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value, updated_at = now()`;
  } catch (err) {
    console.error(
      "[comms:mail] probe write failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export async function getEmailTransportStatus(): Promise<EmailTransportStatus> {
  let connected = false;
  try {
    const status = await msStatus();
    connected = status.connected;
  } catch {
    connected = false;
  }
  const probe = await readProbe();
  const mailSend: MailSendState = probe?.mailSend ?? "unknown";
  let detail: string;
  if (!connected) {
    detail =
      "Microsoft account is not connected, so report email cannot be sent yet.";
  } else if (mailSend === "available") {
    detail = "Mail.Send verified by a successful delivery email.";
  } else if (mailSend === "setup_required") {
    detail =
      probe?.detail ||
      "Mail.Send is not available on the current Microsoft connection.";
  } else {
    detail =
      "Microsoft is connected, but Mail.Send has not been verified yet — it is confirmed by the first real delivery attempt.";
  }
  return {
    provider: "microsoft_graph",
    connected,
    mailSend,
    detail,
    setupSteps: mailSend === "available" ? [] : SETUP_STEPS,
    lastSuccessAt:
      probe?.mailSend === "available" ? (probe.at ?? null) : null,
  };
}

export interface SendDeliveryEmailInput {
  to: string;
  name: string;
  reportTitle: string;
  link: string;
  /** PDF attachment — provided ONLY for allow_pdf recipients. */
  pdf?: { filename: string; bytes: Buffer } | null;
  /** Open-pixel URL (Send anywhere, Oct 25, 2026): when set, the body
   * is sent as HTML carrying a 1×1 <img> for this delivery's token.
   * The pixel records that the EMAIL was opened (email_opened_at) —
   * it never touches the portal-access stamps. */
  trackUrl?: string | null;
}

export interface SendDeliveryEmailResult {
  status: "sent" | "setup_required" | "failed";
  detail: string;
}

function isScopeStyleError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("403") ||
    m.includes("401") ||
    m.includes("accessdenied") ||
    m.includes("access denied") ||
    m.includes("scope") ||
    m.includes("not connected") ||
    m.includes("invalid_grant") ||
    m.includes("consent")
  );
}

/**
 * Attempt one delivery email via Graph POST /me/sendMail. The body is
 * a short notification plus the recipient's personal login link —
 * never report content. Returns the outcome; never throws.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function sendDeliveryEmail(
  input: SendDeliveryEmailInput
): Promise<SendDeliveryEmailResult> {
  try {
    const greeting = input.name ? `Hello ${input.name},` : "Hello,";
    const text = [
      greeting,
      "",
      `A report is available for you from Canny Capital Partners: ${input.reportTitle}`,
      "",
      `View it securely here: ${input.link}`,
      "",
      "This link is personal to you and expires in 30 days. Please do not forward it.",
      "",
      "— Canny Capital Partners",
    ].join("\n");
    // With a tracking URL the body goes out as HTML: the same words,
    // the link as an anchor, and the 1×1 open pixel for this delivery.
    const body = input.trackUrl
      ? {
          contentType: "html",
          content: [
            `<p>${escapeHtml(greeting)}</p>`,
            `<p>A report is available for you from Canny Capital Partners: ${escapeHtml(input.reportTitle)}</p>`,
            `<p>View it securely here: <a href="${escapeHtml(input.link)}">${escapeHtml(input.link)}</a></p>`,
            `<p>This link is personal to you and expires in 30 days. Please do not forward it.</p>`,
            `<p>— Canny Capital Partners</p>`,
            `<img src="${escapeHtml(input.trackUrl)}" width="1" height="1" alt="" style="display:none" />`,
          ].join("\n"),
        }
      : { contentType: "text", content: text };
    const message: Record<string, unknown> = {
      subject: `Report available: ${input.reportTitle}`,
      body,
      toRecipients: [
        {
          emailAddress: {
            address: input.to,
            ...(input.name ? { name: input.name } : {}),
          },
        },
      ],
    };
    if (input.pdf) {
      message.attachments = [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: input.pdf.filename,
          contentType: "application/pdf",
          contentBytes: input.pdf.bytes.toString("base64"),
        },
      ];
    }
    await graph("/me/sendMail", undefined, {
      method: "POST",
      body: JSON.stringify({ message, saveToSentItems: false }),
    });
    await writeProbe({ mailSend: "available" });
    return { status: "sent", detail: "" };
  } catch (err) {
    const detail =
      err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    if (isScopeStyleError(detail)) {
      await writeProbe({ mailSend: "setup_required", detail });
      return { status: "setup_required", detail };
    }
    return { status: "failed", detail };
  }
}

export interface SendAttachmentEmailInput {
  to: string;
  name: string;
  subject: string;
  /** Plain-text body — for contract sends the attachment IS the
   * content; the body only introduces it. */
  text: string;
  attachment: { filename: string; bytes: Buffer; contentType?: string };
}

/**
 * Generic Graph sendMail with one file attachment (Send anywhere,
 * Oct 25, 2026) — the transport for the docgen "email the document"
 * channel. Same honesty rules as sendDeliveryEmail: never throws, the
 * outcome is returned as data and the probe is updated from the real
 * attempt; a send is never reported as sent unless Graph accepted it.
 */
export async function sendAttachmentEmail(
  input: SendAttachmentEmailInput
): Promise<SendDeliveryEmailResult> {
  try {
    const message: Record<string, unknown> = {
      subject: input.subject,
      body: { contentType: "text", content: input.text },
      toRecipients: [
        {
          emailAddress: {
            address: input.to,
            ...(input.name ? { name: input.name } : {}),
          },
        },
      ],
      attachments: [
        {
          "@odata.type": "#microsoft.graph.fileAttachment",
          name: input.attachment.filename,
          contentType: input.attachment.contentType || "application/pdf",
          contentBytes: input.attachment.bytes.toString("base64"),
        },
      ],
    };
    await graph("/me/sendMail", undefined, {
      method: "POST",
      body: JSON.stringify({ message, saveToSentItems: false }),
    });
    await writeProbe({ mailSend: "available" });
    return { status: "sent", detail: "" };
  } catch (err) {
    const detail =
      err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
    if (isScopeStyleError(detail)) {
      await writeProbe({ mailSend: "setup_required", detail });
      return { status: "setup_required", detail };
    }
    return { status: "failed", detail };
  }
}
