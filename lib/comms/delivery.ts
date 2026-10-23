import { createHash, randomBytes } from "crypto";
import { sql, newId, str } from "../platform/db";
import { createComment, ensureNotificationsSchema } from "../platform/collab";
import { ensureComms } from "./schema";
import {
  getReportRow,
  rowToDelivery,
  writeAudit,
  type DeliveryRow,
  type ReportRow,
} from "./service";
import {
  filterRenderForAudience,
  runPreSendCheck,
  type PreSendCheckResult,
} from "./filter";
import { buildReportPdf, getStoredReportPdf, storeReportPdf } from "./pdf";
import { sendDeliveryEmail } from "./mail";
import type { ReportRender } from "./types";

/**
 * Report delivery (Part 12) — token grants, email attempts, access
 * tracking, revocation, and recipient replies.
 *
 * Token rules (mirroring lib/dataroom/guests.ts): a grant is a random
 * 32-byte hex token; ONLY its SHA-256 hash + last 4 chars are stored,
 * and the raw token is shown exactly once (inside the emailed link).
 * validateReportToken re-validates on EVERY call — hash lookup,
 * revocation, expiry, and the report not being soft-deleted.
 *
 * PDF rules: the delivered version's PDF is generated from the
 * AUDIENCE-FILTERED render and stored once. The PDF is attached to a
 * recipient's email ONLY when that recipient has allow_pdf. (PDF
 * download through the portal link itself is a tracked delivery
 * feature available to any valid delivery; allow_pdf governs the
 * email attachment only.)
 */

const SITE_BASE = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "https://portal.cannycapitalpartners.com"
).replace(/\/$/, "");

const ETHAN_EMAIL = "ethan@cannycapitalpartners.com";

export interface DeliveryRecipientInput {
  personId?: string | null;
  name: string;
  email: string;
  allowPdf?: boolean;
}

export interface DeliverReportInput {
  recipients: DeliveryRecipientInput[];
  override?: boolean;
  overrideReason?: string;
}

export function hashReportToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function writeActivity(
  entityKind: string,
  entityId: string,
  actor: string,
  kind: string,
  message: string
): Promise<void> {
  try {
    const db = sql();
    await db`
      INSERT INTO core.activity_log
        (id, entity_kind, entity_id, actor, kind, message, source)
      VALUES (${newId()}, ${entityKind}, ${entityId}, ${actor}, ${kind},
        ${message}, 'comms')`;
  } catch (err) {
    console.error(
      "[comms:delivery] activity_log write failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}

export async function deliverReport(
  reportId: string,
  input: DeliverReportInput,
  actor: string
): Promise<{ deliveries: DeliveryRow[]; check: PreSendCheckResult }> {
  await ensureComms();
  const report = await getReportRow(reportId);
  if (!report) throw new Error("report_not_found");
  if (report.status !== "approved") throw new Error("report_not_approved");
  if (!report.render) throw new Error("report_not_generated");
  const recipients = (input.recipients ?? []).filter(
    (r) => r && r.email && r.email.includes("@")
  );
  if (!recipients.length) throw new Error("no_recipients");

  const check = await runPreSendCheck(
    report,
    recipients.map((r) => ({ ...r, audience: report.audience }))
  );
  if (check.blocked.length && !input.override) {
    const err = new Error("send_blocked") as Error & {
      check?: typeof check;
    };
    err.check = check;
    throw err;
  }
  if (check.blocked.length && input.override) {
    await writeAudit(reportId, actor, "send_override", {
      reason: (input.overrideReason ?? "").slice(0, 300),
      blocked: check.blocked.map((i) => i.code),
    });
  }

  // One report audience → one filtered render + one stored PDF for the
  // delivered version, shared by every recipient of this delivery.
  const filtered = filterRenderForAudience(report.render, report.audience);
  const stored = await storeReportPdf(
    { id: report.id, currentVersion: report.currentVersion, isSample: report.isSample },
    filtered
  );
  const pdfFilename = `${(report.title || "report").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 80)}.pdf`;

  const db = sql();
  const deliveries: DeliveryRow[] = [];
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  for (const recipient of recipients) {
    const token = randomBytes(32).toString("hex");
    const id = newId();
    const rows = await db`
      INSERT INTO comms.deliveries
        (id, report_id, version, recipient_person_id, recipient_name,
         recipient_email, audience, allow_pdf, token_hash, token_last4,
         status, email_status, delivered_by, expires_at)
      VALUES (${id}, ${report.id}, ${report.currentVersion},
        ${recipient.personId ?? null}, ${(recipient.name ?? "").slice(0, 200)},
        ${recipient.email.trim().toLowerCase()}, ${report.audience},
        ${Boolean(recipient.allowPdf)}, ${hashReportToken(token)},
        ${token.slice(-4)}, 'delivered', 'pending', ${actor},
        ${expiresAt.toISOString()})
      RETURNING id, report_id, version, recipient_person_id, recipient_name,
        recipient_email, audience, allow_pdf, token_last4, status,
        email_status, email_detail, delivered_by, delivered_at, opened_at,
        viewed_at, downloaded_at, revoked_at, revoked_by, expires_at`;
    const delivery = rowToDelivery(rows[0] as Record<string, unknown>);

    // Email attempt: notification + login link only; the PDF rides
    // along ONLY for allow_pdf recipients.
    const link = `${SITE_BASE}/report/${token}`;
    const result = await sendDeliveryEmail({
      to: delivery.recipientEmail,
      name: delivery.recipientName,
      reportTitle: report.title,
      link,
      pdf: recipient.allowPdf
        ? { filename: pdfFilename, bytes: stored.buffer }
        : null,
    });
    await db`
      UPDATE comms.deliveries
      SET email_status = ${result.status}, email_detail = ${result.detail}
      WHERE id = ${id}`;
    delivery.emailStatus = result.status;
    delivery.emailDetail = result.detail;
    deliveries.push(delivery);
  }

  await db`
    UPDATE comms.reports
    SET status = 'sent', updated_by = ${actor}, updated_at = now()
    WHERE id = ${report.id}`;
  await writeAudit(reportId, actor, "deliver", {
    version: report.currentVersion,
    recipients: deliveries.length,
    emailed: deliveries.filter((d) => d.emailStatus === "sent").length,
  });
  await writeActivity(
    "comms_report",
    report.id,
    actor,
    "report_delivered",
    `Report delivered to ${deliveries.length} recipient(s): ${report.title}`
  );
  return { deliveries, check };
}

/* --------------------------- token validation --------------------------- */

export type ReportTokenValidation =
  | { delivery: DeliveryRow; report: ReportRow }
  | { error: "not_found" | "expired" | "revoked" };

/** Re-validated on EVERY call — nothing about a grant is cached. */
export async function validateReportToken(
  token: string
): Promise<ReportTokenValidation> {
  await ensureComms();
  if (!token || token.length < 20) return { error: "not_found" };
  const db = sql();
  const rows = await db`
    SELECT id, report_id, version, recipient_person_id, recipient_name,
      recipient_email, audience, allow_pdf, token_last4, status,
      email_status, email_detail, delivered_by, delivered_at, opened_at,
      viewed_at, downloaded_at, revoked_at, revoked_by, expires_at
    FROM comms.deliveries
    WHERE token_hash = ${hashReportToken(token)} LIMIT 1`;
  if (!rows.length) return { error: "not_found" };
  const delivery = rowToDelivery(rows[0] as Record<string, unknown>);
  if (delivery.status === "revoked") return { error: "revoked" };
  if (
    delivery.expiresAt &&
    new Date(delivery.expiresAt).getTime() <= Date.now()
  ) {
    return { error: "expired" };
  }
  const report = await getReportRow(delivery.reportId);
  if (!report || report.deletedAt) return { error: "not_found" };
  return { delivery, report };
}

/* ----------------------------- access log ------------------------------ */

export async function trackAccess(
  deliveryId: string,
  action: "opened" | "viewed" | "downloaded"
): Promise<void> {
  await ensureComms();
  const db = sql();
  const rows = await db`
    SELECT report_id FROM comms.deliveries WHERE id = ${deliveryId} LIMIT 1`;
  if (!rows.length) return;
  const reportId = str((rows[0] as Record<string, unknown>).report_id);
  if (action === "opened") {
    await db`
      UPDATE comms.deliveries SET opened_at = COALESCE(opened_at, now())
      WHERE id = ${deliveryId}`;
  } else if (action === "viewed") {
    await db`
      UPDATE comms.deliveries SET viewed_at = COALESCE(viewed_at, now())
      WHERE id = ${deliveryId}`;
  } else {
    // downloaded_at carries the latest download (first stamp included).
    await db`
      UPDATE comms.deliveries SET downloaded_at = now()
      WHERE id = ${deliveryId}`;
  }
  await db`
    INSERT INTO comms.access_log (id, delivery_id, report_id, action)
    VALUES (${newId()}, ${deliveryId}, ${reportId}, ${action})`;
}

export async function revokeDelivery(
  deliveryId: string,
  actor: string
): Promise<boolean> {
  await ensureComms();
  const db = sql();
  const rows = await db`
    UPDATE comms.deliveries
    SET status = 'revoked', revoked_at = now(), revoked_by = ${actor}
    WHERE id = ${deliveryId} AND status <> 'revoked'
    RETURNING report_id`;
  if (!rows.length) return false;
  const reportId = str((rows[0] as Record<string, unknown>).report_id);
  await writeAudit(reportId, actor, "delivery_revoked", { deliveryId });
  return true;
}

/* --------------------------- recipient views ---------------------------- */

/**
 * The recipient-facing render: validate → track opened+viewed → the
 * STORED render passed through the same audience filter the preview
 * endpoint uses. Only the filtered render leaves this function.
 */
export async function getRecipientRender(
  token: string
): Promise<
  | {
      report: {
        id: string;
        title: string;
        audience: string;
        version: number;
        isSample: boolean;
      };
      render: ReportRender;
    }
  | { error: string }
> {
  const v = await validateReportToken(token);
  if ("error" in v) return { error: v.error };
  if (!v.report.render) return { error: "not_found" };
  await trackAccess(v.delivery.id, "opened");
  await trackAccess(v.delivery.id, "viewed");
  const render = filterRenderForAudience(v.report.render, v.delivery.audience);
  return {
    report: {
      id: v.report.id,
      title: v.report.title,
      audience: v.report.audience,
      version: v.delivery.version,
      isSample: v.report.isSample,
    },
    render,
  };
}

/** Build the PDF bytes for the version a delivery points at. */
export async function getRecipientPdf(
  token: string
): Promise<{ buffer: Buffer; filename: string } | { error: string }> {
  const v = await validateReportToken(token);
  if ("error" in v) return { error: v.error };
  if (!v.report.render) return { error: "not_found" };
  await trackAccess(v.delivery.id, "downloaded");
  const filename = `${(v.report.title || "report").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 80)}.pdf`;
  const stored = await getStoredReportPdf(v.report.id, v.delivery.version);
  if (stored) return { buffer: stored, filename };
  const filtered = filterRenderForAudience(v.report.render, v.delivery.audience);
  const buffer = await buildReportPdf(
    {
      id: v.report.id,
      title: v.report.title,
      currentVersion: v.delivery.version,
      isSample: v.report.isSample,
    },
    filtered
  );
  return { buffer, filename };
}

/* --------------------------- recipient replies -------------------------- */

export async function postRecipientReply(
  token: string,
  input: { name?: string; body: string }
): Promise<{ ok: true } | { error: string }> {
  const v = await validateReportToken(token);
  if ("error" in v) return { error: v.error };
  const body = (input.body ?? "").trim();
  if (!body) return { error: "reply_required" };
  const author =
    (input.name ?? "").trim() || v.delivery.recipientName || "Report recipient";
  await createComment({
    entityKind: "comms_report",
    entityId: v.report.id,
    body,
    author,
    actorEmail: "",
  });
  if (v.report.companyId) {
    await writeActivity(
      "company",
      v.report.companyId,
      author,
      "report_reply",
      `Reply received on report: ${v.report.title}`
    );
  }
  // Notification to Ethan (mirrors the monitoring alert INSERT pattern;
  // addressed to Ethan specifically — no figures, title only).
  try {
    await ensureNotificationsSchema();
    const db = sql();
    await db`
      INSERT INTO core.notifications
        (id, user_email, kind, title, body, href, entity_kind, entity_id)
      VALUES (${newId()}, ${ETHAN_EMAIL}, 'comms_report_reply',
        'Report reply received',
        ${`A recipient replied to: ${v.report.title}`.slice(0, 300)},
        ${`/communications/reports/${v.report.id}`},
        'comms_report', ${v.report.id})`;
  } catch (err) {
    console.error(
      "[comms:delivery] reply notification write failed",
      err instanceof Error ? err.message : String(err)
    );
  }
  return { ok: true };
}
