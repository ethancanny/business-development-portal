import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { enqueueJob } from "../platform/jobs";
import { onEvent, type EventType } from "../platform/events";
import { ensureComms } from "./schema";
import {
  routineAllowed,
  type AppendixFigure,
  type ReportRender,
  type TemplateBlock,
} from "./types";
import { assembleReport } from "./assemble";
import { getEmailTransportStatus, type EmailTransportStatus } from "./mail";
import type { AiStatus } from "./ai";

/**
 * Communications & Reports service (Part 12) — templates, reports
 * (versioned renders + appendix), the approval state machine, deal
 * settings, stale marking, and the module status rollup.
 *
 * Rules honored:
 * - Own schema only (comms.*) plus core.activity_log writes; every
 *   other module's data arrives through its service functions (via
 *   ./assemble). No figures in logs, audit detail, or activity text.
 * - Report state machine: generating → draft → in_review → approved
 *   → sent, with draft/in_review → discarded. Anything else throws
 *   'invalid_transition'.
 * - Templates with routine=true must satisfy routineAllowed()
 *   (purpose is never investment_memo/ic_memo and no narrative block).
 */

export interface NarrativeStatement {
  text: string;
  figureKeys: string[];
}

/* ------------------------------ row types ----------------------------- */

export interface TemplateRow {
  id: string;
  name: string;
  purpose: string;
  audience: string;
  subjectKinds: string[];
  blocks: TemplateBlock[];
  tone: string;
  disclaimers: string[];
  routine: boolean;
  isSystem: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReportRow {
  id: string;
  templateId: string;
  templateName: string;
  purpose: string;
  audience: string;
  subjectKind: string;
  companyId: string | null;
  dealId: string | null;
  personId: string | null;
  title: string;
  status: string;
  isSample: boolean;
  currentVersion: number;
  render: ReportRender | null;
  appendix: AppendixFigure[];
  hasUnreviewed: boolean;
  stale: boolean;
  staleReason: string;
  sourceFingerprint: string;
  narrativeStatus: string;
  scheduleId: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ReportVersionMeta {
  version: number;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface DeliveryRow {
  id: string;
  reportId: string;
  version: number;
  recipientPersonId: string | null;
  recipientName: string;
  recipientEmail: string;
  audience: string;
  allowPdf: boolean;
  tokenLast4: string;
  status: string;
  emailStatus: string;
  emailDetail: string;
  deliveredBy: string;
  deliveredAt: string;
  openedAt: string | null;
  viewedAt: string | null;
  downloadedAt: string | null;
  revokedAt: string | null;
  revokedBy: string;
  expiresAt: string;
}

export interface ReportAuditRow {
  id: string;
  reportId: string;
  actor: string;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface ReportDetail extends ReportRow {
  versions: ReportVersionMeta[];
  deliveries: DeliveryRow[];
  audit: ReportAuditRow[];
}

/* --------------------------- jsonb helpers ---------------------------- */

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function parseStrArr(v: unknown): string[] {
  const p = parseJson<unknown>(v, []);
  return Array.isArray(p) ? p.map((x) => String(x)).filter(Boolean) : [];
}

/* ----------------------------- row mappers ---------------------------- */

const TEMPLATE_COLS = `
  id, name, purpose, audience, subject_kinds, blocks, tone, disclaimers,
  routine, is_system, created_by, updated_by, created_at, updated_at, deleted_at`;

export function rowToTemplate(r: Record<string, unknown>): TemplateRow {
  return {
    id: str(r.id),
    name: str(r.name),
    purpose: str(r.purpose),
    audience: str(r.audience),
    subjectKinds: parseStrArr(r.subject_kinds),
    blocks: parseJson<TemplateBlock[]>(r.blocks, []),
    tone: str(r.tone),
    disclaimers: parseStrArr(r.disclaimers),
    routine: Boolean(r.routine),
    isSystem: Boolean(r.is_system),
    createdBy: str(r.created_by),
    updatedBy: str(r.updated_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
    deletedAt: isoOrNull(r.deleted_at),
  };
}

const REPORT_COLS = `
  id, template_id, template_name, purpose, audience, subject_kind,
  company_id, deal_id, person_id, title, status, is_sample,
  current_version, render, appendix, has_unreviewed, stale, stale_reason,
  source_fingerprint, narrative_status, schedule_id, created_by,
  updated_by, created_at, updated_at, deleted_at`;

export function rowToReport(r: Record<string, unknown>): ReportRow {
  const render = parseJson<ReportRender | null>(r.render, null);
  return {
    id: str(r.id),
    templateId: str(r.template_id),
    templateName: str(r.template_name),
    purpose: str(r.purpose),
    audience: str(r.audience),
    subjectKind: str(r.subject_kind),
    companyId: r.company_id ? str(r.company_id) : null,
    dealId: r.deal_id ? str(r.deal_id) : null,
    personId: r.person_id ? str(r.person_id) : null,
    title: str(r.title),
    status: str(r.status),
    isSample: Boolean(r.is_sample),
    currentVersion: num(r.current_version),
    render,
    appendix: parseJson<AppendixFigure[]>(r.appendix, []),
    hasUnreviewed: Boolean(r.has_unreviewed),
    stale: Boolean(r.stale),
    staleReason: str(r.stale_reason),
    sourceFingerprint: str(r.source_fingerprint),
    narrativeStatus: str(r.narrative_status) || "none",
    scheduleId: r.schedule_id ? str(r.schedule_id) : null,
    createdBy: str(r.created_by),
    updatedBy: str(r.updated_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
    deletedAt: isoOrNull(r.deleted_at),
  };
}

const DELIVERY_COLS = `
  id, report_id, version, recipient_person_id, recipient_name,
  recipient_email, audience, allow_pdf, token_last4, status, email_status,
  email_detail, delivered_by, delivered_at, opened_at, viewed_at,
  downloaded_at, revoked_at, revoked_by, expires_at`;

export function rowToDelivery(r: Record<string, unknown>): DeliveryRow {
  return {
    id: str(r.id),
    reportId: str(r.report_id),
    version: num(r.version),
    recipientPersonId: r.recipient_person_id
      ? str(r.recipient_person_id)
      : null,
    recipientName: str(r.recipient_name),
    recipientEmail: str(r.recipient_email),
    audience: str(r.audience),
    allowPdf: Boolean(r.allow_pdf),
    tokenLast4: str(r.token_last4),
    status: str(r.status),
    emailStatus: str(r.email_status),
    emailDetail: str(r.email_detail),
    deliveredBy: str(r.delivered_by),
    deliveredAt: isoOrNull(r.delivered_at) ?? "",
    openedAt: isoOrNull(r.opened_at),
    viewedAt: isoOrNull(r.viewed_at),
    downloadedAt: isoOrNull(r.downloaded_at),
    revokedAt: isoOrNull(r.revoked_at),
    revokedBy: str(r.revoked_by),
    expiresAt: isoOrNull(r.expires_at) ?? "",
  };
}

/* ------------------------- audit + activity --------------------------- */

/** Figure-free audit trail for one report (ids/counts/statuses only). */
export async function writeAudit(
  reportId: string,
  actor: string,
  action: string,
  detail: Record<string, unknown> = {}
): Promise<void> {
  await ensureComms();
  const db = sql();
  await db`
    INSERT INTO comms.report_audit (id, report_id, actor, action, detail)
    VALUES (${newId()}, ${reportId}, ${actor}, ${action},
      ${JSON.stringify(detail)}::jsonb)`;
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
      "[comms] activity_log write failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/* ------------------------- stale event handlers ------------------------ */

let staleHandlersRegistered = false;

/**
 * Guarded singleton: source-data events mark matching reports stale
 * (draft/in_review/approved only — sent/discarded history is frozen).
 * Matching is by direct id: reports whose company_id or deal_id equals
 * the event's entityId. Reasons carry the event type only, no figures.
 */
export function registerStaleHandlers(): void {
  if (staleHandlersRegistered) return;
  staleHandlersRegistered = true;
  const types: EventType[] = [
    "financials_posted",
    "reporting_received",
    "investor_commitment_changed",
    "covenant_breached",
    "deal_closed",
    "contact_updated",
  ];
  for (const type of types) {
    onEvent(type, async (evt) => {
      const entityId = evt.entityId ?? "";
      if (!entityId) return;
      try {
        await ensureComms();
        const db = sql();
        const rows = await db`
          UPDATE comms.reports
          SET stale = true, stale_reason = ${type}, updated_at = now()
          WHERE deleted_at IS NULL
            AND status IN ('draft', 'in_review', 'approved')
            AND (company_id = ${entityId} OR deal_id = ${entityId})
          RETURNING id`;
        if (rows.length) {
          console.log(
            `[comms] ${type} marked ${rows.length} report(s) stale`
          );
        }
      } catch (err) {
        console.error(
          "[comms] stale marking failed",
          err instanceof Error ? err.message : String(err)
        );
      }
    });
  }
}

/** ensureComms + stale-handler registration, used by every entry point. */
async function ready(): Promise<void> {
  await ensureComms();
  registerStaleHandlers();
}

/* ------------------------------ templates ------------------------------ */

export interface TemplateInput {
  name?: string;
  purpose?: string;
  audience?: string;
  subjectKinds?: string[];
  blocks?: TemplateBlock[];
  tone?: string;
  disclaimers?: string[];
  routine?: boolean;
}

function assertRoutineAllowed(candidate: {
  purpose: string;
  blocks: TemplateBlock[];
  routine: boolean;
}): void {
  if (candidate.routine && !routineAllowed(candidate)) {
    throw new Error("routine_not_allowed");
  }
}

export async function listTemplates(): Promise<TemplateRow[]> {
  await ready();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TEMPLATE_COLS)} FROM comms.templates
    WHERE deleted_at IS NULL
    ORDER BY is_system DESC, name ASC
    LIMIT 200`;
  return rows.map((r) => rowToTemplate(r as Record<string, unknown>));
}

export async function getTemplate(id: string): Promise<TemplateRow | null> {
  await ready();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TEMPLATE_COLS)} FROM comms.templates
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  return rows.length
    ? rowToTemplate(rows[0] as Record<string, unknown>)
    : null;
}

/** Includes soft-deleted rows — generation must survive template edits. */
async function getTemplateAny(id: string): Promise<TemplateRow | null> {
  await ready();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(TEMPLATE_COLS)} FROM comms.templates
    WHERE id = ${id} LIMIT 1`;
  return rows.length
    ? rowToTemplate(rows[0] as Record<string, unknown>)
    : null;
}

export async function createTemplate(
  input: TemplateInput,
  actor: string
): Promise<TemplateRow> {
  await ready();
  const candidate = {
    name: (input.name ?? "").trim(),
    purpose: (input.purpose ?? "").trim(),
    audience: (input.audience ?? "internal").trim() || "internal",
    subjectKinds: input.subjectKinds ?? [],
    blocks: input.blocks ?? [],
    tone: input.tone ?? "",
    disclaimers: input.disclaimers ?? [],
    routine: Boolean(input.routine),
  };
  if (!candidate.name) throw new Error("template_name_required");
  if (!candidate.purpose) throw new Error("template_purpose_required");
  assertRoutineAllowed(candidate);
  const id = newId();
  const db = sql();
  const rows = await db`
    INSERT INTO comms.templates
      (id, name, purpose, audience, subject_kinds, blocks, tone,
       disclaimers, routine, is_system, created_by, updated_by)
    VALUES (${id}, ${candidate.name}, ${candidate.purpose},
      ${candidate.audience}, ${JSON.stringify(candidate.subjectKinds)}::jsonb,
      ${JSON.stringify(candidate.blocks)}::jsonb, ${candidate.tone},
      ${JSON.stringify(candidate.disclaimers)}::jsonb, ${candidate.routine},
      false, ${actor}, ${actor})
    RETURNING ${db.unsafe(TEMPLATE_COLS)}`;
  return rowToTemplate(rows[0] as Record<string, unknown>);
}

export async function updateTemplate(
  id: string,
  input: TemplateInput,
  actor: string
): Promise<TemplateRow> {
  await ready();
  const existing = await getTemplate(id);
  if (!existing) throw new Error("template_not_found");
  const candidate = {
    name: input.name !== undefined ? input.name.trim() : existing.name,
    purpose:
      input.purpose !== undefined ? input.purpose.trim() : existing.purpose,
    audience:
      input.audience !== undefined ? input.audience.trim() : existing.audience,
    subjectKinds: input.subjectKinds ?? existing.subjectKinds,
    blocks: input.blocks ?? existing.blocks,
    tone: input.tone ?? existing.tone,
    disclaimers: input.disclaimers ?? existing.disclaimers,
    routine: input.routine !== undefined ? Boolean(input.routine) : existing.routine,
  };
  if (!candidate.name) throw new Error("template_name_required");
  assertRoutineAllowed(candidate);
  const db = sql();
  const rows = await db`
    UPDATE comms.templates SET
      name = ${candidate.name}, purpose = ${candidate.purpose},
      audience = ${candidate.audience},
      subject_kinds = ${JSON.stringify(candidate.subjectKinds)}::jsonb,
      blocks = ${JSON.stringify(candidate.blocks)}::jsonb,
      tone = ${candidate.tone},
      disclaimers = ${JSON.stringify(candidate.disclaimers)}::jsonb,
      routine = ${candidate.routine}, updated_by = ${actor},
      updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING ${db.unsafe(TEMPLATE_COLS)}`;
  if (!rows.length) throw new Error("template_not_found");
  return rowToTemplate(rows[0] as Record<string, unknown>);
}

export async function deleteTemplate(
  id: string,
  actor = ""
): Promise<boolean> {
  await ready();
  const db = sql();
  const rows = await db`
    UPDATE comms.templates
    SET deleted_at = now(), updated_by = ${actor}, updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  return rows.length > 0;
}

/* ------------------------------- reports ------------------------------- */

export interface CreateReportInput {
  templateId: string;
  subjectKind?: string;
  companyId?: string | null;
  dealId?: string | null;
  personId?: string | null;
  title?: string;
  isSample?: boolean;
  scheduleId?: string | null;
}

export async function getReportRow(id: string): Promise<ReportRow | null> {
  await ready();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(REPORT_COLS)} FROM comms.reports
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToReport(rows[0] as Record<string, unknown>) : null;
}

async function requireReport(id: string): Promise<ReportRow> {
  const report = await getReportRow(id);
  if (!report) throw new Error("report_not_found");
  return report;
}

export async function createReport(
  input: CreateReportInput,
  actor: string
): Promise<ReportRow> {
  await ready();
  const template = await getTemplate(input.templateId);
  if (!template) throw new Error("template_not_found");
  const subjectKind =
    (input.subjectKind ?? "").trim() || template.subjectKinds[0] || "company";
  const title =
    (input.title ?? "").trim() ||
    `${template.name} — ${new Date().toISOString().slice(0, 10)}`;
  const id = newId();
  const db = sql();
  const rows = await db`
    INSERT INTO comms.reports
      (id, template_id, template_name, purpose, audience, subject_kind,
       company_id, deal_id, person_id, title, status, is_sample,
       current_version, appendix, narrative_status, schedule_id,
       created_by, updated_by)
    VALUES (${id}, ${template.id}, ${template.name}, ${template.purpose},
      ${template.audience}, ${subjectKind},
      ${input.companyId ?? null}, ${input.dealId ?? null},
      ${input.personId ?? null}, ${title}, 'generating',
      ${Boolean(input.isSample)}, 0, '[]'::jsonb, 'none',
      ${input.scheduleId ?? null}, ${actor}, ${actor})
    RETURNING ${db.unsafe(REPORT_COLS)}`;
  const report = rowToReport(rows[0] as Record<string, unknown>);
  await writeAudit(id, actor, "create", {
    templateId: template.id,
    subjectKind,
    isSample: report.isSample,
  });
  await enqueueJob("comms_generate_report", { reportId: id });
  return report;
}

export async function getReport(id: string): Promise<ReportDetail | null> {
  await ready();
  const report = await getReportRow(id);
  if (!report) return null;
  const db = sql();
  const [versionRows, deliveryRows, auditRows] = await Promise.all([
    db`
      SELECT version, note, created_by, created_at
      FROM comms.report_versions WHERE report_id = ${id}
      ORDER BY version DESC LIMIT 100`,
    db`
      SELECT ${db.unsafe(DELIVERY_COLS)} FROM comms.deliveries
      WHERE report_id = ${id}
      ORDER BY delivered_at DESC LIMIT 100`,
    db`
      SELECT id, report_id, actor, action, detail, created_at
      FROM comms.report_audit WHERE report_id = ${id}
      ORDER BY created_at DESC LIMIT 100`,
  ]);
  return {
    ...report,
    versions: versionRows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        version: num(rec.version),
        note: str(rec.note),
        createdBy: str(rec.created_by),
        createdAt: isoOrNull(rec.created_at) ?? "",
      };
    }),
    deliveries: deliveryRows.map((r) =>
      rowToDelivery(r as Record<string, unknown>)
    ),
    audit: auditRows.map((r) => {
      const rec = r as Record<string, unknown>;
      return {
        id: str(rec.id),
        reportId: str(rec.report_id),
        actor: str(rec.actor),
        action: str(rec.action),
        detail: parseJson<Record<string, unknown>>(rec.detail, {}),
        createdAt: isoOrNull(rec.created_at) ?? "",
      };
    }),
  };
}

export async function listReports(filters: {
  status?: string;
  companyId?: string;
  dealId?: string;
}): Promise<ReportRow[]> {
  await ready();
  const db = sql();
  const status = (filters.status ?? "").trim();
  const companyId = (filters.companyId ?? "").trim();
  const dealId = (filters.dealId ?? "").trim();
  const rows = await db`
    SELECT ${db.unsafe(REPORT_COLS)} FROM comms.reports
    WHERE deleted_at IS NULL
      AND (${status} = '' OR status = ${status})
      AND (${companyId} = '' OR company_id = ${companyId})
      AND (${dealId} = '' OR deal_id = ${dealId})
    ORDER BY updated_at DESC
    LIMIT 100`;
  return rows.map((r) => rowToReport(r as Record<string, unknown>));
}

/** Insert a report_versions row + point the report at it. */
async function writeVersion(
  report: ReportRow,
  render: ReportRender,
  appendix: AppendixFigure[],
  actor: string,
  note: string,
  extra: { narrativeStatus?: string; status?: string; fingerprint?: string }
): Promise<ReportRow> {
  const db = sql();
  const version = report.currentVersion + 1;
  const hasUnreviewed = appendix.some((f) => f.verification === "unreviewed");
  await db`
    INSERT INTO comms.report_versions
      (id, report_id, version, render, appendix, note, created_by)
    VALUES (${newId()}, ${report.id}, ${version},
      ${JSON.stringify(render)}::jsonb, ${JSON.stringify(appendix)}::jsonb,
      ${note}, ${actor})`;
  const rows = await db`
    UPDATE comms.reports SET
      current_version = ${version},
      render = ${JSON.stringify(render)}::jsonb,
      appendix = ${JSON.stringify(appendix)}::jsonb,
      has_unreviewed = ${hasUnreviewed},
      narrative_status = ${extra.narrativeStatus ?? report.narrativeStatus},
      status = ${extra.status ?? report.status},
      source_fingerprint = ${extra.fingerprint ?? report.sourceFingerprint},
      stale = false, stale_reason = '',
      updated_by = ${actor}, updated_at = now()
    WHERE id = ${report.id}
    RETURNING ${db.unsafe(REPORT_COLS)}`;
  return rowToReport(rows[0] as Record<string, unknown>);
}

/**
 * Generation core (the comms_generate_report job handler calls this).
 * Fingerprint cache rule: when the assembled fingerprint matches the
 * stored one AND a render already exists AND the report was already a
 * draft, keep the existing render and audit 'generate_cached' — no
 * new version. Otherwise write the assembly as a new version and land
 * the report in 'draft'.
 */
export async function generateReportNow(
  reportId: string,
  actor: string
): Promise<ReportRow> {
  await ready();
  const report = await requireReport(reportId);
  const template = await getTemplateAny(report.templateId);
  if (!template) throw new Error("template_not_found");
  const assembled = await assembleReport({
    template,
    subject: {
      subjectKind: report.subjectKind,
      companyId: report.companyId,
      dealId: report.dealId,
      personId: report.personId,
      subjectLabel: await resolveSubjectLabel(report),
    },
    sample: report.isSample,
    actor,
  });
  if (
    report.sourceFingerprint &&
    report.sourceFingerprint === assembled.fingerprint &&
    report.render &&
    report.status === "draft"
  ) {
    await writeAudit(reportId, actor, "generate_cached", {
      version: report.currentVersion,
    });
    return report;
  }
  const narrativeBlocks = assembled.narrativeBlocks ?? [];
  let narrativeStatus = report.narrativeStatus;
  if (narrativeBlocks.length) {
    if (narrativeStatus === "none" || narrativeStatus === "pending") {
      narrativeStatus = "pending";
    }
  } else {
    narrativeStatus = "none";
  }
  const updated = await writeVersion(
    report,
    assembled.render,
    assembled.appendix,
    actor,
    report.currentVersion === 0 ? "Initial generation" : "Regenerated",
    { narrativeStatus, status: "draft", fingerprint: assembled.fingerprint }
  );
  await writeAudit(reportId, actor, "generate", {
    version: updated.currentVersion,
    figures: assembled.appendix.length,
    narrativeStatus,
  });
  return updated;
}

/**
 * Best-effort display label for a report's subject, resolved ONLY via
 * other modules' service functions (directory / diligence). Falls back
 * to "" — assemble substitutes its own default label.
 */
async function resolveSubjectLabel(report: ReportRow): Promise<string> {
  try {
    if (report.dealId) {
      const { getDealContext } = await import("../diligence/service");
      const ctx = await getDealContext(report.dealId);
      if (ctx) return ctx.companyName || ctx.dealName || "";
    }
    if (report.companyId) {
      const { getDirectoryDetail } = await import("../directory/service");
      const detail = await getDirectoryDetail("company", report.companyId);
      const name = detail?.record?.name;
      if (typeof name === "string" && name) return name;
    }
    if (report.personId) {
      const { getDirectoryDetail } = await import("../directory/service");
      const detail = await getDirectoryDetail("person", report.personId);
      const name = detail?.record?.name;
      if (typeof name === "string" && name) return name;
    }
  } catch {
    /* label resolution is cosmetic — assembly proceeds without it */
  }
  return "";
}

export interface UpdateReportInput {
  title?: string;
  narrative?: Record<string, NarrativeStatement[]>;
  note?: string;
}

/**
 * Title / narrative edits create a NEW version (history is immutable).
 * Only draft/in_review reports are editable — approved/sent reports
 * are locked ('report_locked'). Manual narrative edits set the
 * narrative blocks' status and the report's narrative_status to
 * 'manual'.
 */
export async function updateReport(
  id: string,
  input: UpdateReportInput,
  actor: string
): Promise<ReportRow> {
  await ready();
  const report = await requireReport(id);
  if (report.status !== "draft" && report.status !== "in_review") {
    throw new Error("report_locked");
  }
  if (!report.render) throw new Error("report_not_generated");
  const render: ReportRender = JSON.parse(JSON.stringify(report.render));
  if (input.title !== undefined && input.title.trim()) {
    render.title = input.title.trim();
  }
  let narrativeStatus = report.narrativeStatus;
  if (input.narrative) {
    for (const [blockKey, statements] of Object.entries(input.narrative)) {
      const block = render.blocks.find((b) => b.key === blockKey);
      if (!block || block.type !== "narrative") continue;
      block.narrative = {
        status: "manual",
        statements: statements.map((s) => ({
          text: String(s.text ?? ""),
          figureKeys: Array.isArray(s.figureKeys) ? s.figureKeys : [],
        })),
      };
    }
    narrativeStatus = "manual";
  }
  const updated = await writeVersion(
    report,
    render,
    report.appendix,
    actor,
    input.note ?? "Edited",
    { narrativeStatus }
  );
  if (input.title !== undefined && input.title.trim()) {
    const db = sql();
    await db`
      UPDATE comms.reports SET title = ${input.title.trim()}
      WHERE id = ${id}`;
    updated.title = input.title.trim();
  }
  await writeAudit(id, actor, "update", {
    version: updated.currentVersion,
    narrativeBlocks: input.narrative
      ? Object.keys(input.narrative).length
      : 0,
  });
  return updated;
}

/**
 * Narrative writer used by lib/comms/ai.ts: stores validated AI
 * statements into the report's narrative blocks as a NEW version and
 * sets narrative_status (normally 'ready'). Statements arrive already
 * validated against the appendix by the caller.
 */
export async function updateReportNarrative(
  reportId: string,
  narrativeByBlock: Record<string, NarrativeStatement[]>,
  actor: string,
  status = "ready"
): Promise<ReportRow> {
  await ready();
  const report = await requireReport(reportId);
  if (!report.render) throw new Error("report_not_generated");
  const render: ReportRender = JSON.parse(JSON.stringify(report.render));
  for (const [blockKey, statements] of Object.entries(narrativeByBlock)) {
    const block = render.blocks.find((b) => b.key === blockKey);
    if (!block || block.type !== "narrative") continue;
    block.narrative = { status, statements };
  }
  const updated = await writeVersion(report, render, report.appendix, actor, "AI narrative", {
    narrativeStatus: status,
  });
  await writeAudit(reportId, actor, "narrative_generated", {
    version: updated.currentVersion,
    blocks: Object.keys(narrativeByBlock).length,
  });
  return updated;
}

/** Status-only narrative update (setup_required / blocked / error paths). */
export async function setNarrativeStatus(
  reportId: string,
  status: string,
  actor: string
): Promise<void> {
  await ready();
  const db = sql();
  await db`
    UPDATE comms.reports
    SET narrative_status = ${status}, updated_by = ${actor}, updated_at = now()
    WHERE id = ${reportId} AND deleted_at IS NULL`;
  await writeAudit(reportId, actor, "narrative_status", { status });
}

/* --------------------------- state machine ----------------------------- */

export type ReportTransition = "submit" | "approve" | "discard";

const TRANSITIONS: Record<ReportTransition, { from: string[]; to: string }> = {
  submit: { from: ["draft"], to: "in_review" },
  approve: { from: ["in_review"], to: "approved" },
  discard: { from: ["draft", "in_review"], to: "discarded" },
};

export async function transitionReport(
  id: string,
  action: ReportTransition,
  actor: string
): Promise<ReportRow> {
  await ready();
  const report = await requireReport(id);
  const rule = TRANSITIONS[action];
  if (!rule || !rule.from.includes(report.status)) {
    throw new Error("invalid_transition");
  }
  const db = sql();
  const rows = await db`
    UPDATE comms.reports
    SET status = ${rule.to}, updated_by = ${actor}, updated_at = now()
    WHERE id = ${id}
    RETURNING ${db.unsafe(REPORT_COLS)}`;
  const updated = rowToReport(rows[0] as Record<string, unknown>);
  await writeAudit(id, actor, action, { from: report.status, to: rule.to });
  if (action === "approve") {
    await writeActivity(
      "comms_report",
      id,
      actor,
      "report_approved",
      `Report approved: ${report.title}`
    );
  }
  return updated;
}

export async function deleteReport(id: string, actor = ""): Promise<boolean> {
  await ready();
  const db = sql();
  const rows = await db`
    UPDATE comms.reports
    SET deleted_at = now(), updated_by = ${actor}, updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  if (rows.length) {
    await writeAudit(id, actor, "delete", {});
  }
  return rows.length > 0;
}

/* ------------------------------ diff ----------------------------------- */

export interface VersionChange {
  kind:
    | "block_added"
    | "block_removed"
    | "figure_changed"
    | "narrative_changed"
    | "block_status_changed";
  blockKey?: string;
  label?: string;
  from?: unknown;
  to?: unknown;
}

async function getVersionRender(
  reportId: string,
  version: number
): Promise<{ render: ReportRender | null; appendix: AppendixFigure[] } | null> {
  const db = sql();
  const rows = await db`
    SELECT render, appendix FROM comms.report_versions
    WHERE report_id = ${reportId} AND version = ${version} LIMIT 1`;
  if (!rows.length) return null;
  const rec = rows[0] as Record<string, unknown>;
  return {
    render: parseJson<ReportRender | null>(rec.render, null),
    appendix: parseJson<AppendixFigure[]>(rec.appendix, []),
  };
}

export async function diffVersions(
  reportOrId: ReportRow | string,
  fromVersion: number,
  toVersion: number
): Promise<{ changes: VersionChange[] }> {
  await ready();
  // Accepts either a report id or the report row itself (the
  // contract's diffVersions(report, a, b) call shape).
  const reportId = typeof reportOrId === "string" ? reportOrId : reportOrId.id;
  await requireReport(reportId);
  const a = await getVersionRender(reportId, fromVersion);
  const b = await getVersionRender(reportId, toVersion);
  if (!a || !b) throw new Error("version_not_found");
  const changes: VersionChange[] = [];
  const aBlocks = new Map(
    (a.render?.blocks ?? []).map((x) => [x.key, x] as const)
  );
  const bBlocks = new Map(
    (b.render?.blocks ?? []).map((x) => [x.key, x] as const)
  );
  bBlocks.forEach((block, key) => {
    if (!aBlocks.has(key)) {
      changes.push({ kind: "block_added", blockKey: key, label: block.heading });
    }
  });
  aBlocks.forEach((block, key) => {
    if (!bBlocks.has(key)) {
      changes.push({ kind: "block_removed", blockKey: key, label: block.heading });
    }
  });
  aBlocks.forEach((aBlock, key) => {
    const bBlock = bBlocks.get(key);
    if (!bBlock) return;
    if (aBlock.dataStatus !== bBlock.dataStatus) {
      changes.push({
        kind: "block_status_changed",
        blockKey: key,
        label: bBlock.heading,
        from: aBlock.dataStatus,
        to: bBlock.dataStatus,
      });
    }
    const aFigs = new Map(
      (aBlock.figures ?? []).map((f) => [f.key, f] as const)
    );
    for (const fig of bBlock.figures ?? []) {
      const prev = aFigs.get(fig.key);
      if (prev && JSON.stringify(prev.value) !== JSON.stringify(fig.value)) {
        changes.push({
          kind: "figure_changed",
          blockKey: key,
          label: fig.label,
          from: prev.value,
          to: fig.value,
        });
      }
    }
    const aText = JSON.stringify(aBlock.narrative?.statements ?? []);
    const bText = JSON.stringify(bBlock.narrative?.statements ?? []);
    if (aText !== bText) {
      changes.push({
        kind: "narrative_changed",
        blockKey: key,
        label: bBlock.heading,
      });
    }
  });
  return { changes };
}

/* ---------------------------- deal settings ----------------------------- */

export interface DealSettingsRow {
  dealId: string;
  ndaRestricted: boolean;
  ndaNote: string;
  updatedBy: string;
  updatedAt: string | null;
}

export async function getDealSettings(
  dealId: string
): Promise<DealSettingsRow> {
  await ready();
  const db = sql();
  const rows = await db`
    SELECT deal_id, nda_restricted, nda_note, updated_by, updated_at
    FROM comms.deal_settings WHERE deal_id = ${dealId} LIMIT 1`;
  if (!rows.length) {
    return {
      dealId,
      ndaRestricted: false,
      ndaNote: "",
      updatedBy: "",
      updatedAt: null,
    };
  }
  const r = rows[0] as Record<string, unknown>;
  return {
    dealId: str(r.deal_id),
    ndaRestricted: Boolean(r.nda_restricted),
    ndaNote: str(r.nda_note),
    updatedBy: str(r.updated_by),
    updatedAt: isoOrNull(r.updated_at),
  };
}

export async function setDealSettings(
  dealId: string,
  input: { ndaRestricted?: boolean; ndaNote?: string },
  actor: string
): Promise<DealSettingsRow> {
  await ready();
  const current = await getDealSettings(dealId);
  const ndaRestricted =
    input.ndaRestricted !== undefined
      ? Boolean(input.ndaRestricted)
      : current.ndaRestricted;
  const ndaNote =
    input.ndaNote !== undefined ? input.ndaNote : current.ndaNote;
  const db = sql();
  await db`
    INSERT INTO comms.deal_settings (deal_id, nda_restricted, nda_note, updated_by, updated_at)
    VALUES (${dealId}, ${ndaRestricted}, ${ndaNote}, ${actor}, now())
    ON CONFLICT (deal_id) DO UPDATE SET
      nda_restricted = EXCLUDED.nda_restricted,
      nda_note = EXCLUDED.nda_note,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()`;
  return getDealSettings(dealId);
}

/* ------------------------------- status -------------------------------- */

export async function getCommsStatus(): Promise<{
  ai: AiStatus;
  email: EmailTransportStatus;
  counts: {
    templates: number;
    reports: number;
    schedulesActive: number;
    deliveries: number;
  };
}> {
  await ready();
  // Lazy import breaks the service <-> ai cycle (ai.ts writes narrative
  // versions through this module); the specifier is a literal.
  const { aiStatus } = await import("./ai");
  const email = await getEmailTransportStatus();
  const db = sql();
  const count = async (query: ReturnType<typeof db>): Promise<number> => {
    const rows = await query;
    return rows.length ? num((rows[0] as Record<string, unknown>).n) : 0;
  };
  const [templates, reports, schedulesActive, deliveries] = await Promise.all([
    count(db`SELECT count(*)::int AS n FROM comms.templates WHERE deleted_at IS NULL`),
    count(db`SELECT count(*)::int AS n FROM comms.reports WHERE deleted_at IS NULL`),
    count(db`SELECT count(*)::int AS n FROM comms.schedules WHERE deleted_at IS NULL AND status = 'active'`),
    count(db`SELECT count(*)::int AS n FROM comms.deliveries`),
  ]);
  return {
    ai: aiStatus(),
    email,
    counts: { templates, reports, schedulesActive, deliveries },
  };
}
