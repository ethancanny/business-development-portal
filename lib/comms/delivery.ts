import { createHash, randomBytes } from "crypto";
import { sql, newId, str } from "../platform/db";
import { createComment, ensureNotificationsSchema } from "../platform/collab";
import { ensureComms } from "./schema";
import {
  getReportContactSettings,
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
import { initialsFor, monogramColor } from "../identity/shared";
import {
  confidentialityLine,
  fmtDateLong,
  periodLabel,
} from "./present";
import type {
  AppendixFigure,
  ReportGuestMeta,
  ReportRender,
} from "./types";

/**
 * Report delivery (Part 12) — token grants, email attempts, access
 * tracking, revocation, and recipient replies.
 *
 * Token rules (mirroring lib/dataroom/guests.ts): a grant is a random
 * 32-byte hex token; ONLY its SHA-256 hash + last 4 chars are stored.
 * The raw token leaves the server exactly twice at creation: inside
 * the emailed link, and in the one-time deliver API response (so the
 * sender can share it manually while email transport is unavailable).
 * It is never returned by any list/read endpoint afterwards.
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

export type DeliveryWithLink = DeliveryRow & {
  /** One-time recipient link (raw token). Returned ONLY in the deliver
   * response so the sender can share it manually when the notification
   * email cannot be sent (transport setup-required) — mirroring the
   * Phase 3 data-room pattern. Never stored; never in list reads. */
  link: string;
};

export async function deliverReport(
  reportId: string,
  input: DeliverReportInput,
  actor: string
): Promise<{ deliveries: DeliveryWithLink[]; check: PreSendCheckResult }> {
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
  const deliveries: DeliveryWithLink[] = [];
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
    // along ONLY for allow_pdf recipients. The attached PDF is built
    // per recipient (watermark + "Prepared for") — the stored copy
    // above remains the shared internal snapshot of the version.
    const link = `${SITE_BASE}/report/${token}`;
    let attachBytes: Buffer | null = null;
    if (recipient.allowPdf) {
      try {
        attachBytes = await buildPersonalPdf(report, filtered, {
          name: delivery.recipientName,
          email: delivery.recipientEmail,
          personId: delivery.recipientPersonId,
          audience: report.audience,
          version: report.currentVersion,
        });
      } catch {
        attachBytes = stored.buffer;
      }
    }
    const result = await sendDeliveryEmail({
      to: delivery.recipientEmail,
      name: delivery.recipientName,
      reportTitle: report.title,
      link,
      pdf: attachBytes ? { filename: pdfFilename, bytes: attachBytes } : null,
    });
    await db`
      UPDATE comms.deliveries
      SET email_status = ${result.status}, email_detail = ${result.detail}
      WHERE id = ${id}`;
    delivery.emailStatus = result.status;
    delivery.emailDetail = result.detail;
    deliveries.push({ ...delivery, link });
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

/** Figures of an (already audience-filtered) render, deduped by key
 * in first-use order — the recipient-visible appendix. Deriving it
 * from the filtered render guarantees internal-only figures can
 * never leak through a separately stored appendix. */
export function dedupeFigures(render: ReportRender): AppendixFigure[] {
  const seen = new Set<string>();
  const out: AppendixFigure[] = [];
  for (const b of render.blocks ?? []) {
    for (const f of b.figures ?? []) {
      if (!f.key || seen.has(f.key)) continue;
      seen.add(f.key);
      out.push(f);
    }
  }
  return out;
}

interface ResolvedSubject {
  displayName: string;
  secondaryName: string | null;
  codenameActive: boolean;
  companyId: string | null;
  accentColor: string;
  hasLogo: boolean;
}

/** Subject identity for a report surface, resolved ONLY through the
 * identity module (deal identity system, Oct 24, 2026): codename
 * rules applied for the surface's audience; logo + accent come from
 * the company's identity record. Best-effort — any failure degrades
 * to the stored render's subject label with no mark. */
async function resolveReportSubject(
  report: ReportRow,
  audience: string
): Promise<ResolvedSubject> {
  const fallback: ResolvedSubject = {
    displayName: report.render?.subjectLabel ?? "",
    secondaryName: null,
    codenameActive: false,
    companyId: report.companyId ?? null,
    accentColor: "",
    hasLogo: false,
  };
  try {
    const { getIdentity, dealIdentityForDeal, dealIdentityForCompany } =
      await import("../identity/service");
    const { resolveDisplayIdentity } = await import("../identity/shared");
    const context = audience === "internal" ? "internal" : "external";
    let companyId = report.companyId ?? null;
    let input: { name: string; codename?: string | null; codenameExternal?: boolean | null } | null =
      null;
    if (report.dealId) {
      const deal = await dealIdentityForDeal(report.dealId).catch(() => null);
      if (deal) {
        input = {
          name: deal.companyName || deal.name,
          codename: deal.codename,
          codenameExternal: deal.codenameExternal,
        };
        companyId = deal.companyId || companyId;
      }
    }
    if (!input && companyId) {
      const viaCompany = await dealIdentityForCompany(companyId).catch(
        () => null
      );
      if (viaCompany) {
        input = {
          name: viaCompany.name,
          codename: viaCompany.codename,
          codenameExternal: viaCompany.codenameExternal,
        };
      }
    }
    let identity: Awaited<ReturnType<typeof getIdentity>> = null;
    if (companyId) {
      identity = await getIdentity(companyId).catch(() => null);
    }
    if (!input) {
      if (identity?.name) input = { name: identity.name };
      else if (fallback.displayName) input = { name: fallback.displayName };
    }
    if (!input) return fallback;
    const resolved = resolveDisplayIdentity(input, context);
    return {
      displayName: resolved.displayName,
      secondaryName: resolved.secondaryName,
      codenameActive: resolved.codenameActive,
      companyId,
      // The company accent never ships under an active codename.
      accentColor: resolved.codenameActive
        ? ""
        : (identity?.accentColor ?? ""),
      hasLogo: Boolean(
        resolved.showLogo && identity && identity.logoVersion > 0
      ),
    };
  } catch {
    return fallback;
  }
}

async function recipientOrganization(
  personId: string | null
): Promise<string> {
  if (!personId) return "";
  try {
    const { getDirectoryDetail } = await import("../directory/service");
    const detail = await getDirectoryDetail("person", personId);
    const rec = (detail?.record ?? {}) as Record<string, unknown>;
    const org = rec.organizationName;
    return typeof org === "string" ? org : "";
  } catch {
    return "";
  }
}

interface MetaDeliveryLike {
  audience: string;
  recipientName: string;
  recipientEmail: string;
  recipientPersonId: string | null;
  version: number;
  expiresAt: string;
}

/** The full recipient meta block for the redesigned document. */
async function buildGuestMeta(
  report: ReportRow,
  delivery: MetaDeliveryLike,
  token: string,
  checkNewer = true
): Promise<ReportGuestMeta> {
  const [subject, organization, contact] = await Promise.all([
    resolveReportSubject(report, delivery.audience),
    recipientOrganization(delivery.recipientPersonId),
    getReportContactSettings(),
  ]);
  let maxVersion = 0;
  if (checkNewer && delivery.recipientEmail) {
    const db = sql();
    const newerRows = await db`
      SELECT max(version)::int AS v FROM comms.deliveries
      WHERE report_id = ${report.id}
        AND recipient_email = ${delivery.recipientEmail}
        AND status <> 'revoked'`;
    maxVersion = newerRows.length
      ? Number((newerRows[0] as Record<string, unknown>).v ?? 0)
      : 0;
  }
  const expiresAt = delivery.expiresAt ?? "";
  const mark: ReportGuestMeta["mark"] = subject.codenameActive
    ? { kind: "none" }
    : subject.hasLogo && subject.companyId
      ? {
          kind: "logo",
          logoPath: `/api/report-guest/${encodeURIComponent(token)}/logo`,
          accentColor: subject.accentColor || undefined,
        }
      : subject.displayName
        ? {
            kind: "monogram",
            initials: initialsFor(subject.displayName),
            color: monogramColor(subject.companyId ?? subject.displayName),
            accentColor: subject.accentColor || undefined,
          }
        : { kind: "none", accentColor: subject.accentColor || undefined };
  return {
    reportId: report.id,
    reportType: report.templateName || report.title,
    purpose: report.purpose,
    version: delivery.version,
    subjectName: subject.displayName,
    subjectSecondary: subject.secondaryName,
    codenameActive: subject.codenameActive,
    mark,
    preparedFor: {
      name: delivery.recipientName,
      email: delivery.recipientEmail,
      organization,
    },
    preparedBy: "Canny Capital Partners",
    sender: {
      name: contact.senderName,
      email: contact.senderEmail,
      phone: contact.senderPhone,
    },
    asOf: report.render?.asOf ?? "",
    periodLabel: periodLabel(report.purpose, report.render?.asOf),
    expiresAt,
    expiresLabel: expiresAt
      ? `Available until ${fmtDateLong(expiresAt)}`
      : "",
    hasNewerVersion: maxVersion > delivery.version,
    schedulingUrl: contact.schedulingUrl || null,
    audience: delivery.audience,
    confidentiality: confidentialityLine(
      delivery.audience,
      delivery.recipientName
    ),
  };
}

/** Sender-preview meta: the same block a recipient gets, built for
 * a hypothetical recipient of the report's current version (no
 * delivery, no expiry, no newer-version check). The logo path points
 * at the session-gated platform rendition — preview is internal. */
export async function buildPreviewMeta(
  report: ReportRow,
  opts: {
    audience: string;
    personId?: string | null;
    recipientName?: string;
    recipientEmail?: string;
  }
): Promise<ReportGuestMeta> {
  const meta = await buildGuestMeta(
    report,
    {
      audience: opts.audience,
      recipientName: opts.recipientName ?? "",
      recipientEmail: opts.recipientEmail ?? "",
      recipientPersonId: opts.personId ?? null,
      version: report.currentVersion,
      expiresAt: "",
    },
    "",
    false
  );
  if (meta.mark.kind === "logo") {
    let companyId = report.companyId;
    if (!companyId && report.dealId) {
      try {
        const { dealIdentityForDeal } = await import("../identity/service");
        const deal = await dealIdentityForDeal(report.dealId);
        companyId = deal?.companyId ?? null;
      } catch {
        companyId = null;
      }
    }
    if (companyId) {
      meta.mark = {
        ...meta.mark,
        logoPath: `/api/platform/companies/${encodeURIComponent(companyId)}/logo/256`,
      };
    }
  }
  return meta;
}

/** Subject logo bytes for the guest logo route: token-validated,
 * codename-aware (no logo under an active external codename). */
export async function getRecipientLogo(
  token: string
): Promise<{ data: Buffer; mime: string } | { error: string }> {
  const v = await validateReportToken(token);
  if ("error" in v) return { error: v.error };
  const subject = await resolveReportSubject(v.report, v.delivery.audience);
  if (!subject.hasLogo || !subject.companyId) return { error: "not_found" };
  const { getLogoObject } = await import("../identity/service");
  const logo = await getLogoObject(subject.companyId, 256).catch(() => null);
  if (!logo) return { error: "not_found" };
  return logo;
}

/** Build the personalized PDF for one recipient (watermark +
 * "Prepared for" + subject logo bytes when the codename rules allow
 * a logo). Used for email attachments and recipient downloads. */
export async function buildPersonalPdf(
  report: ReportRow,
  filtered: ReportRender,
  recipient: {
    name: string;
    email: string;
    personId?: string | null;
    audience: string;
    version: number;
  }
): Promise<Buffer> {
  const [subject, organization, contact] = await Promise.all([
    resolveReportSubject(report, recipient.audience),
    recipientOrganization(recipient.personId ?? null),
    getReportContactSettings(),
  ]);
  let subjectLogoPng: Buffer | null = null;
  if (subject.hasLogo && subject.companyId) {
    try {
      const { getLogoObject } = await import("../identity/service");
      const logo = await getLogoObject(subject.companyId, 256);
      if (logo) {
        const sharp = (await import("sharp")).default;
        subjectLogoPng = await sharp(logo.data).png().toBuffer();
      }
    } catch {
      subjectLogoPng = null;
    }
  }
  return buildReportPdf(
    {
      id: report.id,
      title: report.title,
      currentVersion: recipient.version,
      isSample: report.isSample,
    },
    filtered,
    dedupeFigures(filtered),
    {
      recipientName: recipient.name,
      recipientEmail: recipient.email,
      preparedForOrg: organization,
      reportType: report.templateName || report.title,
      purpose: report.purpose,
      version: recipient.version,
      subjectName: subject.displayName,
      subjectSecondary: subject.secondaryName,
      codenameActive: subject.codenameActive,
      subjectLogoPng,
      subjectMonogram:
        !subject.codenameActive && subject.displayName
          ? {
              initials: initialsFor(subject.displayName),
              seed: subject.companyId ?? subject.displayName,
            }
          : null,
      accentColor: subject.accentColor || undefined,
      senderName: contact.senderName,
      senderEmail: contact.senderEmail,
      senderPhone: contact.senderPhone,
      confidentiality: confidentialityLine(recipient.audience, recipient.name),
    }
  );
}

/**
 * The recipient-facing render: validate → track opened+viewed → the
 * STORED render passed through the same audience filter the preview
 * endpoint uses, plus the recipient meta (identity, prepared-for,
 * expiry, contact) the redesigned document renders. Only the
 * filtered render leaves this function.
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
        purpose: string;
        templateName: string;
      };
      render: ReportRender;
      appendix: AppendixFigure[];
      meta: ReportGuestMeta;
    }
  | { error: string }
> {
  const v = await validateReportToken(token);
  if ("error" in v) return { error: v.error };
  if (!v.report.render) return { error: "not_found" };
  await trackAccess(v.delivery.id, "opened");
  await trackAccess(v.delivery.id, "viewed");
  const render = filterRenderForAudience(v.report.render, v.delivery.audience);
  const meta = await buildGuestMeta(v.report, v.delivery, token);
  return {
    report: {
      id: v.report.id,
      title: v.report.title,
      audience: v.report.audience,
      version: v.delivery.version,
      isSample: v.report.isSample,
      purpose: v.report.purpose,
      templateName: v.report.templateName,
    },
    render,
    appendix: dedupeFigures(render),
    meta,
  };
}

/** The PDF for the version a delivery points at — rebuilt per
 * recipient at download time so the watermark and "Prepared for"
 * are personal; the stored shared copy is only a fallback. */
export async function getRecipientPdf(
  token: string
): Promise<{ buffer: Buffer; filename: string } | { error: string }> {
  const v = await validateReportToken(token);
  if ("error" in v) return { error: v.error };
  if (!v.report.render) return { error: "not_found" };
  await trackAccess(v.delivery.id, "downloaded");
  const filename = `${(v.report.title || "report").replace(/[^a-z0-9-_]+/gi, "-").slice(0, 80)}.pdf`;
  const filtered = filterRenderForAudience(v.report.render, v.delivery.audience);
  try {
    const buffer = await buildPersonalPdf(v.report, filtered, {
      name: v.delivery.recipientName,
      email: v.delivery.recipientEmail,
      personId: v.delivery.recipientPersonId,
      audience: v.delivery.audience,
      version: v.delivery.version,
    });
    return { buffer, filename };
  } catch {
    // The stored copy is the internal snapshot (it may contain
    // internal-only blocks) — it is a safe fallback ONLY for
    // internal-audience deliveries.
    if (v.delivery.audience === "internal") {
      const stored = await getStoredReportPdf(v.report.id, v.delivery.version);
      if (stored) return { buffer: stored, filename };
    }
    throw new Error("pdf_unavailable");
  }
}

/* --------------------------- recipient replies -------------------------- */

export async function postRecipientReply(
  token: string,
  input: { name?: string; body: string; sectionKey?: string }
): Promise<{ ok: true } | { error: string }> {
  const v = await validateReportToken(token);
  if ("error" in v) return { error: v.error };
  const body = (input.body ?? "").trim();
  if (!body) return { error: "reply_required" };
  const author =
    (input.name ?? "").trim() || v.delivery.recipientName || "Report recipient";
  // Contextual replies (spec §8): a section key is accepted only when
  // it names a section of THIS report's render; the section context
  // rides the report audit trail + the notification, and the reply
  // itself joins the report thread unchanged.
  let sectionHeading = "";
  if (input.sectionKey && v.report.render) {
    const block = (v.report.render.blocks ?? []).find(
      (b) => b.key === input.sectionKey
    );
    if (block) sectionHeading = block.heading || block.type;
  }
  await createComment({
    entityKind: "comms_report",
    entityId: v.report.id,
    body,
    author,
    actorEmail: "",
  });
  await writeAudit(v.report.id, author, "recipient_reply", {
    deliveryId: v.delivery.id,
    ...(sectionHeading
      ? { sectionKey: input.sectionKey, sectionHeading }
      : {}),
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
        ${`A recipient replied to: ${v.report.title}${sectionHeading ? ` (section: ${sectionHeading})` : ""}`.slice(0, 300)},
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
