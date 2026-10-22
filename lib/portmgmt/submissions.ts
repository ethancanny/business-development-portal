import * as XLSX from "xlsx";
import { sql, newId, str, isoOrNull } from "../platform/db";
import { ensurePortmgmt } from "./schema";
import { PortmgmtError, storeBytesAsDocument } from "./service";
import {
  beginUploadSession,
  appendUploadChunk,
  completeUploadSession,
  abortUploadSession,
  getUploadSession,
  type UploadSessionRow,
} from "../dataroom/uploads";
import { receiveReport, getPeriod } from "../monitoring/service";
import { upsertManualKpi } from "../monitoring/analytics";
import {
  TEMPLATE_LINES_BY_KEY,
  type StatementKind,
} from "../financials/template";

/**
 * Portal submissions (Phase 9, WS-B) — the portfolio-company-facing
 * write path into Portfolio Monitoring.
 *
 * Uploads are thin wrappers over lib/dataroom/uploads.ts chunked
 * sessions; the companyId is FORCED by the caller (the gated route),
 * never trusted from the request body beyond that. Submissions
 * themselves land in monitoring through its own services
 * (receiveReport for statement packages, upsertManualKpi for KPIs)
 * and every submission is recorded in portmgmt.submissions.
 */

export interface SubmissionRow {
  id: string;
  companyId: string;
  periodId: string | null;
  kind: string;
  documentId: string | null;
  detail: Record<string, unknown>;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

function rowToSubmission(r: Record<string, unknown>): SubmissionRow {
  let detail: Record<string, unknown> = {};
  const raw = r.detail;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    detail = raw as Record<string, unknown>;
  } else if (typeof raw === "string" && raw.trim()) {
    try {
      const p = JSON.parse(raw);
      if (p && typeof p === "object") detail = p as Record<string, unknown>;
    } catch {
      detail = {};
    }
  }
  return {
    id: str(r.id),
    companyId: str(r.company_id),
    periodId: r.period_id ? str(r.period_id) : null,
    kind: str(r.kind),
    documentId: r.document_id ? str(r.document_id) : null,
    detail,
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

async function recordSubmission(input: {
  companyId: string;
  periodId?: string | null;
  kind: string;
  documentId?: string | null;
  detail?: Record<string, unknown>;
  actor: string;
}): Promise<SubmissionRow> {
  await ensurePortmgmt();
  const db = sql();
  const id = `pmsub_${newId()}`;
  await db`
    INSERT INTO portmgmt.submissions
      (id, company_id, period_id, kind, document_id, detail, created_by)
    VALUES (${id}, ${input.companyId}, ${input.periodId ?? null},
      ${input.kind}, ${input.documentId ?? null},
      ${JSON.stringify(input.detail ?? {})}::jsonb, ${input.actor})`;
  const rows = await db`
    SELECT * FROM portmgmt.submissions WHERE id = ${id} LIMIT 1`;
  return rowToSubmission(rows[0] as Record<string, unknown>);
}

export async function listSubmissions(
  companyId: string
): Promise<SubmissionRow[]> {
  await ensurePortmgmt();
  const db = sql();
  const rows = await db`
    SELECT * FROM portmgmt.submissions
    WHERE company_id = ${companyId} AND deleted_at IS NULL
    ORDER BY created_at DESC
    LIMIT 100`;
  return rows.map((r) => rowToSubmission(r as Record<string, unknown>));
}

/* ------------------------------- uploads ----------------------------- */

/** Begin a chunked upload session with the company forced by the
 * (gated) caller. */
export async function beginPortalUpload(
  input: {
    filename: string;
    mime?: string;
    totalSize: number;
    companyId: string;
    tags?: string[];
    note?: string;
  },
  actor: string
): Promise<UploadSessionRow> {
  return beginUploadSession(
    {
      filename: input.filename,
      mime: input.mime,
      totalSize: input.totalSize,
      companyId: input.companyId,
      tags: input.tags,
      note: input.note,
    },
    actor
  );
}

export async function appendPortalChunk(
  sessionId: string,
  offset: number,
  data: Buffer,
  actor: string
): Promise<{ receivedBytes: number }> {
  return appendUploadChunk(sessionId, offset, data, actor);
}

export async function completePortalUpload(sessionId: string, actor: string) {
  return completeUploadSession(sessionId, actor);
}

export async function abortPortalUpload(
  sessionId: string,
  actor: string
): Promise<boolean> {
  return abortUploadSession(sessionId, actor);
}

export { getUploadSession };

/* ----------------------------- statements ---------------------------- */

/** Submit a statement package for a reporting period: monitoring's
 * receiveReport extracts + posts the document's statement sets and
 * marks the period received; the submission is recorded here. */
export async function submitStatements(
  companyId: string,
  periodId: string,
  documentId: string,
  actor: string
): Promise<{ submission: SubmissionRow; setIds: string[] }> {
  const { period, setIds } = await receiveReport(
    companyId,
    periodId,
    { documentId },
    actor
  );
  const submission = await recordSubmission({
    companyId,
    periodId,
    kind: "statements",
    documentId,
    detail: { setIds, periodEnd: period.periodEnd },
    actor,
  });
  return { submission, setIds };
}

export interface EntryLineInput {
  lineKey: string;
  value: number;
}

/**
 * Submit manually entered statement lines: build an XLSX workbook
 * from the entered lines (one sheet per statement kind, labels from
 * the Phase 4 template constants so the financials parser maps every
 * row), store it as a library document, then run the standard
 * statements submission over it.
 */
export async function submitEntry(
  companyId: string,
  periodId: string,
  input: {
    lines: EntryLineInput[];
    periodEnd: string;
    basis?: string;
  },
  actor: string
): Promise<{ submission: SubmissionRow; setIds: string[]; documentId: string }> {
  if (!Array.isArray(input.lines) || !input.lines.length) {
    throw new PortmgmtError("invalid_entry_lines");
  }
  const wb = XLSX.utils.book_new();
  const byKind = new Map<StatementKind, string[][]>();
  for (const line of input.lines) {
    const def = TEMPLATE_LINES_BY_KEY[line.lineKey];
    if (!def) throw new PortmgmtError("invalid_line_key");
    if (typeof line.value !== "number" || !isFinite(line.value)) {
      throw new PortmgmtError("invalid_amount");
    }
    const rows = byKind.get(def.kind) ?? [["Line", "Amount"]];
    rows.push([def.label, String(line.value)]);
    byKind.set(def.kind, rows);
  }
  const sheetNames: Record<StatementKind, string> = {
    is: "Income Statement",
    bs: "Balance Sheet",
    cf: "Cash Flow",
  };
  let appended = false;
  for (const [kind, rows] of Array.from(byKind.entries())) {
    // Period header row so the parser dates the set correctly.
    const withHeader = [[`Period ending ${input.periodEnd}`], [], ...rows];
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(withHeader),
      sheetNames[kind]
    );
    appended = true;
  }
  if (!appended) throw new PortmgmtError("invalid_entry_lines");
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
  const { documentId } = await storeBytesAsDocument({
    bytes,
    filename: `portal-entry-${input.periodEnd}.xlsx`,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    companyId,
    tags: ["portal_entry"],
    actor,
  });
  const { submission, setIds } = await submitStatements(
    companyId,
    periodId,
    documentId,
    actor
  );
  // Re-tag the submission kind/detail to reflect the entry origin.
  const db = sql();
  await db`
    UPDATE portmgmt.submissions
    SET kind = 'entry',
        detail = ${JSON.stringify({
          setIds,
          documentId,
          basis: input.basis ?? null,
          lineCount: input.lines.length,
        })}::jsonb,
        updated_at = now()
    WHERE id = ${submission.id}`;
  return { submission: { ...submission, kind: "entry" }, setIds, documentId };
}

/* -------------------------------- KPIs ------------------------------- */

/**
 * Submit KPI values for a period: headcount / customer_count /
 * custom keys all land through monitoring analytics upsertManualKpi
 * (manual source). The period end is the reporting period's own.
 */
export async function submitKpis(
  companyId: string,
  periodId: string,
  input: {
    headcount?: number;
    customerCount?: number;
    custom?: Array<{ key: string; value: number; periodEnd: string }>;
  },
  actor: string
): Promise<{ submission: SubmissionRow; written: string[] }> {
  const period = await getPeriod(periodId);
  if (!period || period.companyId !== companyId) {
    throw new PortmgmtError("period_not_found");
  }
  if (!period.periodEnd) throw new PortmgmtError("period_end_required");
  const written: string[] = [];
  if (input.headcount !== undefined) {
    await upsertManualKpi(
      companyId,
      { periodEnd: period.periodEnd, kpiKey: "headcount", value: input.headcount },
      actor
    );
    written.push("headcount");
  }
  if (input.customerCount !== undefined) {
    await upsertManualKpi(
      companyId,
      {
        periodEnd: period.periodEnd,
        kpiKey: "customer_count",
        value: input.customerCount,
      },
      actor
    );
    written.push("customer_count");
  }
  for (const c of input.custom ?? []) {
    await upsertManualKpi(
      companyId,
      {
        // Custom entries may omit the period end (the portal KPI grid
        // sends bare key/value pairs) — default to the period's end.
        periodEnd: c.periodEnd || period.periodEnd,
        kpiKey: c.key,
        value: c.value,
      },
      actor
    );
    written.push(c.key);
  }
  if (!written.length) throw new PortmgmtError("no_kpis_submitted");
  const submission = await recordSubmission({
    companyId,
    periodId,
    kind: "kpis",
    detail: { written, periodEnd: period.periodEnd },
    actor,
  });
  return { submission, written };
}

/* ------------------------------ documents ---------------------------- */

/** Record a document submission: the document was already uploaded
 * (with this companyId + tag) through the uploads flow; this writes
 * the submissions ledger row that ties it to the portal. */
export async function submitDocument(
  companyId: string,
  input: { documentId: string; kind?: string },
  actor: string
): Promise<SubmissionRow> {
  const documentId = (input.documentId ?? "").trim();
  if (!documentId) throw new PortmgmtError("document_required");
  return recordSubmission({
    companyId,
    kind: (input.kind ?? "document").trim() || "document",
    documentId,
    actor,
  });
}
