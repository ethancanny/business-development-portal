import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import { enqueueJob } from "../platform/jobs";
import { getDocument, getDocumentRooms } from "../dataroom/documents";
import { getDocumentText } from "../dataroom/extract";
import { getRoom } from "../dataroom/service";
import {
  createContract,
  getWorkspaceByDeal,
  type ContractInput,
  type ContractRow,
} from "../diligence/service";
import { ensureDocint } from "./schema";
import {
  AZURE_PROVIDER_NAME,
  FIELD_DEFS,
  providerForDocument,
} from "./provider";

/**
 * Document intelligence service (Part 5B) — per-deal settings,
 * extraction runs, provisional field review, and applying confirmed
 * fields into the diligence contract register.
 *
 * Cross-module data flows ONLY through service functions:
 * - documents / bytes / rooms via lib/dataroom/documents.ts
 *   (getDocument, getDocumentRooms) and text via
 *   lib/dataroom/extract.ts (getDocumentText),
 * - room → deal via lib/dataroom/service.ts (getRoom),
 * - contract register writes via lib/diligence/service.ts
 *   (createContract, getWorkspaceByDeal).
 * No cross-schema SQL against dataroom tables. File bytes never enter
 * Postgres and client financial figures never appear in logs.
 *
 * All extracted fields land 'provisional'. Only fields a partner has
 * confirmed or corrected can be applied to the contract register.
 */

/* ------------------------------ settings ------------------------------ */

export interface DocintSettings {
  dealId: string;
  enabled: boolean;
  updatedBy: string;
  updatedAt: string | null;
}

export async function getSettings(dealId: string): Promise<DocintSettings> {
  await ensureDocint();
  const db = sql();
  const rows = await db`
    SELECT deal_id, enabled, updated_by, updated_at
    FROM diligence.docint_settings WHERE deal_id = ${dealId} LIMIT 1`;
  if (!rows.length) {
    // Default: document intelligence is ON for a deal until a partner
    // turns it off.
    return { dealId, enabled: true, updatedBy: "", updatedAt: null };
  }
  const r = rows[0] as Record<string, unknown>;
  return {
    dealId: str(r.deal_id),
    enabled: Boolean(r.enabled),
    updatedBy: str(r.updated_by),
    updatedAt: isoOrNull(r.updated_at),
  };
}

export async function setEnabled(
  dealId: string,
  enabled: boolean,
  actor: string
): Promise<DocintSettings> {
  await ensureDocint();
  const db = sql();
  await db`
    INSERT INTO diligence.docint_settings (deal_id, enabled, updated_by, updated_at)
    VALUES (${dealId}, ${enabled}, ${actor}, now())
    ON CONFLICT (deal_id) DO UPDATE SET
      enabled = EXCLUDED.enabled,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()`;
  return getSettings(dealId);
}

/* -------------------------------- runs -------------------------------- */

export interface DocintRunRow {
  id: string;
  dealId: string;
  workspaceId: string | null;
  documentId: string;
  provider: string;
  status: string;
  pages: number | null;
  fieldsExtracted: number;
  error: string;
  actor: string;
  triggerSource: string;
  createdAt: string;
  finishedAt: string | null;
}

function rowToRun(r: Record<string, unknown>): DocintRunRow {
  return {
    id: str(r.id),
    dealId: str(r.deal_id),
    workspaceId: r.workspace_id ? str(r.workspace_id) : null,
    documentId: str(r.document_id),
    provider: str(r.provider),
    status: str(r.status) || "running",
    pages: numOrNull(r.pages),
    fieldsExtracted: num(r.fields_extracted),
    error: str(r.error),
    actor: str(r.actor),
    triggerSource: str(r.trigger_source) || "manual",
    createdAt: isoOrNull(r.created_at) ?? "",
    finishedAt: isoOrNull(r.finished_at),
  };
}

async function getRunById(runId: string): Promise<DocintRunRow | null> {
  await ensureDocint();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.docint_runs WHERE id = ${runId} LIMIT 1`;
  return rows.length ? rowToRun(rows[0] as Record<string, unknown>) : null;
}

export async function listRuns(
  dealId: string,
  limit = 25
): Promise<DocintRunRow[]> {
  await ensureDocint();
  const db = sql();
  const lim = Math.min(100, Math.max(1, limit || 25));
  const rows = await db`
    SELECT * FROM diligence.docint_runs
    WHERE deal_id = ${dealId}
    ORDER BY created_at DESC
    LIMIT ${lim}`;
  return rows.map((r) => rowToRun(r as Record<string, unknown>));
}

/**
 * Cost visibility (Ethan, Oct 22, 2026): this month's Azure usage
 * from the processing log (docint_runs). Every Azure call is a run
 * row attributed to a document, so usage is auditable as
 * uploads-only.
 */
export async function getAzureUsageThisMonth(): Promise<{
  runs: number;
  pages: number;
}> {
  await ensureDocint();
  const db = sql();
  const rows = await db`
    SELECT count(*)::int AS runs, coalesce(sum(pages), 0)::int AS pages
    FROM diligence.docint_runs
    WHERE provider = ${AZURE_PROVIDER_NAME}
      AND created_at >= date_trunc('month', now())`;
  const r = (rows[0] ?? {}) as Record<string, unknown>;
  return { runs: num(r.runs), pages: num(r.pages) };
}

/* ------------------------------- fields ------------------------------- */

export interface DocintFieldRow {
  id: string;
  runId: string;
  dealId: string;
  workspaceId: string | null;
  documentId: string;
  fieldKey: string;
  label: string;
  valueText: string;
  confidence: number | null;
  page: number | null;
  passage: string;
  status: string;
  correctedValue: string | null;
  reviewedBy: string;
  reviewedAt: string | null;
  appliedContractId: string | null;
  createdAt: string;
  updatedAt: string;
}

function rowToField(r: Record<string, unknown>): DocintFieldRow {
  return {
    id: str(r.id),
    runId: str(r.run_id),
    dealId: str(r.deal_id),
    workspaceId: r.workspace_id ? str(r.workspace_id) : null,
    documentId: str(r.document_id),
    fieldKey: str(r.field_key),
    label: str(r.label),
    valueText: str(r.value_text),
    confidence: numOrNull(r.confidence),
    page: numOrNull(r.page),
    passage: str(r.passage),
    status: str(r.status) || "provisional",
    correctedValue:
      r.corrected_value == null ? null : str(r.corrected_value),
    reviewedBy: str(r.reviewed_by),
    reviewedAt: isoOrNull(r.reviewed_at),
    appliedContractId: r.applied_contract_id
      ? str(r.applied_contract_id)
      : null,
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

/** Effective (post-review) value of a field. */
function effectiveValue(f: DocintFieldRow): string {
  return (f.correctedValue ?? f.valueText).trim();
}

export async function listFields(opts: {
  dealId?: string;
  documentId?: string;
  status?: string;
  limit?: number;
}): Promise<DocintFieldRow[]> {
  await ensureDocint();
  const db = sql();
  const dealId = (opts.dealId ?? "").trim();
  const documentId = (opts.documentId ?? "").trim();
  const status = (opts.status ?? "").trim();
  const limit = Math.min(500, Math.max(1, opts.limit || 200));
  // FIELD_DEFS display order as a SQL CASE — keys are code constants
  // from provider.ts, never user input.
  const orderCase = FIELD_DEFS.map(
    (d, i) => `WHEN '${d.key}' THEN ${i}`
  ).join(" ");
  const rows = await db`
    SELECT * FROM diligence.docint_fields
    WHERE deleted_at IS NULL
      AND (${dealId} = '' OR deal_id = ${dealId})
      AND (${documentId} = '' OR document_id = ${documentId})
      AND (${status} = '' OR status = ${status})
    ORDER BY document_id ASC,
      CASE field_key ${db.unsafe(orderCase)} ELSE 99 END ASC,
      created_at ASC
    LIMIT ${limit}`;
  return rows.map((r) => rowToField(r as Record<string, unknown>));
}

async function getFieldById(id: string): Promise<DocintFieldRow | null> {
  await ensureDocint();
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.docint_fields
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToField(rows[0] as Record<string, unknown>) : null;
}

/* ----------------------------- extraction ----------------------------- */

export async function runExtraction(input: {
  dealId: string;
  documentId: string;
  actor: string;
  triggerSource?: string;
}): Promise<DocintRunRow> {
  await ensureDocint();
  const dealId = (input.dealId ?? "").trim();
  const documentId = (input.documentId ?? "").trim();
  if (!dealId) throw new Error("deal_id_required");
  if (!documentId) throw new Error("document_id_required");

  const settings = await getSettings(dealId);
  if (!settings.enabled) throw new Error("docint_disabled");

  const workspace = await getWorkspaceByDeal(dealId).catch(() => null);
  const workspaceId = workspace?.id ?? null;
  const doc = await getDocument(documentId).catch(() => null);
  // Per-document provider (Phase 7 Item 0): Azure for uploaded
  // documents whose media type it supports; local-patterns for the
  // types Azure rejects (text/plain, CSV, …) so they never 415.
  const provider = providerForDocument(doc?.mime ?? "", doc?.name ?? "");

  const db = sql();
  const runId = `dcr_${newId()}`;
  await db`
    INSERT INTO diligence.docint_runs
      (id, deal_id, workspace_id, document_id, provider, status, actor,
       trigger_source)
    VALUES (${runId}, ${dealId}, ${workspaceId}, ${documentId},
      ${provider.name}, 'running', ${input.actor},
      ${input.triggerSource ?? "manual"})`;

  try {
    const result = await provider.analyze({
      documentId,
      fileName: doc?.name ?? "",
      mime: doc?.mime ?? "",
    });

    // Distinguish "provider ran but the document has no extractable
    // text" from a clean run that simply found no fields.
    let status = "done";
    if (result.fields.length === 0 && provider.name === "local-patterns") {
      const dt = await getDocumentText(documentId).catch(() => null);
      if (!dt || !(dt.text ?? "").trim()) status = "no_text";
    }

    // A fresh run supersedes prior UNREVIEWED provisional fields for
    // the same document; reviewed history is preserved.
    await db`
      UPDATE diligence.docint_fields
      SET deleted_at = now(), updated_at = now()
      WHERE document_id = ${documentId}
        AND status = 'provisional'
        AND reviewed_at IS NULL
        AND deleted_at IS NULL`;

    for (const field of result.fields) {
      await db`
        INSERT INTO diligence.docint_fields
          (id, run_id, deal_id, workspace_id, document_id, field_key,
           label, value_text, confidence, page, passage, status)
        VALUES (${`dcf_${newId()}`}, ${runId}, ${dealId}, ${workspaceId},
          ${documentId}, ${field.fieldKey}, ${field.label},
          ${field.valueText}, ${field.confidence}, ${field.page},
          ${field.passage}, 'provisional')`;
    }

    await db`
      UPDATE diligence.docint_runs
      SET status = ${status}, pages = ${result.pages},
          fields_extracted = ${result.fields.length},
          finished_at = now()
      WHERE id = ${runId}`;
  } catch (err) {
    const message = (
      err instanceof Error ? err.message : String(err)
    ).slice(0, 500);
    await db`
      UPDATE diligence.docint_runs
      SET status = 'error', error = ${message}, finished_at = now()
      WHERE id = ${runId}`;
    throw err;
  }

  const run = await getRunById(runId);
  if (!run) throw new Error("run_create_failed");
  return run;
}

/* ------------------------------- review ------------------------------- */

export async function reviewField(
  id: string,
  input: { action: "confirm" | "correct" | "reject"; valueText?: string },
  actor: string
): Promise<DocintFieldRow> {
  await ensureDocint();
  const field = await getFieldById(id);
  if (!field) throw new Error("field_not_found");
  const action = input.action;
  if (action !== "confirm" && action !== "correct" && action !== "reject") {
    throw new Error("invalid_action");
  }
  let status: string;
  let correctedValue: string | null = field.correctedValue;
  if (action === "confirm") {
    status = "confirmed";
  } else if (action === "correct") {
    const value = (input.valueText ?? "").trim();
    if (!value) throw new Error("corrected_value_required");
    status = "corrected";
    correctedValue = value;
  } else {
    status = "rejected";
  }
  const db = sql();
  await db`
    UPDATE diligence.docint_fields
    SET status = ${status}, corrected_value = ${correctedValue},
        reviewed_by = ${actor}, reviewed_at = now(), updated_at = now()
    WHERE id = ${id}`;
  const updated = await getFieldById(id);
  if (!updated) throw new Error("field_not_found");
  return updated;
}

/* ------------------------- apply to register -------------------------- */

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Best-effort date extraction from a free-text field value, returned
 * as ISO yyyy-mm-dd (the contract register's date format) or null
 * when the text carries no parseable date. Regex LITERALS only
 * (Phase 5 Item 0 house rule).
 */
function parseDateToIso(text: string): string | null {
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (us) {
    const month = Number(us[1]);
    const day = Number(us[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${us[3]}-${pad2(month)}-${pad2(day)}`;
    }
  }
  const long =
    /(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(\d{4})/i.exec(
      text
    );
  if (long) {
    const month = MONTHS[long[1].toLowerCase()];
    const day = Number(long[2]);
    if (month && day >= 1 && day <= 31) {
      return `${long[3]}-${pad2(month)}-${pad2(day)}`;
    }
  }
  return null;
}

export async function applyRunToRegister(
  runId: string,
  actor: string
): Promise<ContractRow> {
  await ensureDocint();
  const run = await getRunById(runId);
  if (!run) throw new Error("run_not_found");
  const db = sql();
  const rows = await db`
    SELECT * FROM diligence.docint_fields
    WHERE run_id = ${runId} AND deleted_at IS NULL
      AND status IN ('confirmed', 'corrected')
      AND applied_contract_id IS NULL
    ORDER BY created_at ASC`;
  const fields = rows.map((r) => rowToField(r as Record<string, unknown>));
  if (!fields.length) throw new Error("no_confirmed_fields");

  let workspaceId =
    fields.find((f) => f.workspaceId)?.workspaceId ??
    run.workspaceId ??
    null;
  if (!workspaceId) {
    const workspace = await getWorkspaceByDeal(run.dealId).catch(
      () => null
    );
    workspaceId = workspace?.id ?? null;
  }
  if (!workspaceId) throw new Error("workspace_required");

  const byKey = new Map<string, DocintFieldRow>();
  for (const f of fields) {
    if (!byKey.has(f.fieldKey)) byKey.set(f.fieldKey, f);
  }
  const valueOf = (key: string): string => {
    const f = byKey.get(key);
    return f ? effectiveValue(f) : "";
  };

  const doc = await getDocument(run.documentId).catch(() => null);
  const fileName = doc?.name ?? "";
  const baseTitle = fileName.replace(/\.[^.]+$/, "").trim();
  const counterparty = valueOf("counterparty");
  const title = baseTitle || counterparty || "Extracted contract";

  const effectiveRaw = valueOf("effective_date");
  const expiryRaw = valueOf("expiry_date");
  // Composed key terms keep the RAW date text alongside the term
  // lines, so nothing the reviewer confirmed is lost when a date
  // does not parse into the register's date columns.
  const keyTermLines: Array<[string, string]> = [
    ["effective_date", effectiveRaw],
    ["expiry_date", expiryRaw],
    ["term", valueOf("term")],
    ["rent", valueOf("rent")],
    ["escalations", valueOf("escalations")],
    ["renewal_options", valueOf("renewal_options")],
    ["exclusivity", valueOf("exclusivity")],
    ["right_of_first_refusal", valueOf("right_of_first_refusal")],
  ];
  const labelOf = (key: string): string =>
    FIELD_DEFS.find((d) => d.key === key)?.label ?? key;
  const keyTerms = keyTermLines
    .filter(([, v]) => v)
    .map(([k, v]) => `${labelOf(k)}: ${v}`)
    .join("\n");

  const contractInput: ContractInput = {
    title,
    counterparty,
    contractType: valueOf("contract_type"),
    effectiveDate: effectiveRaw ? parseDateToIso(effectiveRaw) : null,
    expiryDate: expiryRaw ? parseDateToIso(expiryRaw) : null,
    changeOfControl: valueOf("change_of_control"),
    terminationTerms: valueOf("termination_options"),
    keyTerms,
    documentId: run.documentId,
    notes:
      `Created by document intelligence (run ${runId}, ` +
      `provider ${run.provider}); fields confirmed by ${actor}.`,
  };
  const contract = await createContract(workspaceId, contractInput);

  for (const f of fields) {
    await db`
      UPDATE diligence.docint_fields
      SET applied_contract_id = ${contract.id}, updated_at = now()
      WHERE id = ${f.id}`;
  }
  return contract;
}

/* --------------------------- upload hook ------------------------------ */

/**
 * Best-effort enqueue after a document lands in a data room: resolve
 * document → rooms → deals and queue an extraction per deal whose
 * docint setting is enabled. NEVER throws — an upload must not fail
 * because document intelligence could not be queued.
 */
export async function maybeEnqueueForDocument(
  documentId: string,
  actor: string
): Promise<void> {
  try {
    await ensureDocint();
    const rooms = await getDocumentRooms(documentId);
    for (const placement of rooms) {
      try {
        const room = await getRoom(placement.roomId);
        if (!room?.dealId) continue;
        const settings = await getSettings(room.dealId);
        if (!settings.enabled) continue;
        await enqueueJob("extract_document_terms", {
          dealId: room.dealId,
          documentId,
          actor,
          triggerSource: "upload",
        });
      } catch {
        // Per-room failures stay isolated; the hook is best-effort.
      }
    }
  } catch {
    // Best-effort by contract — swallow everything.
  }
}

/* ------------------------------ job entry ----------------------------- */

/**
 * Background job entry (core.jobs kind "extract_document_terms"),
 * exported for the coordinator's jobs.ts wiring.
 */
export async function runDocintJob(
  payload: Record<string, unknown>
): Promise<{
  runId: string;
  status: string;
  fieldsExtracted: number;
  provider: string;
}> {
  const dealId = str(payload.dealId);
  const documentId = str(payload.documentId);
  const actor = str(payload.actor) || "system";
  if (!dealId) throw new Error("deal_id_required");
  if (!documentId) throw new Error("document_id_required");
  const run = await runExtraction({
    dealId,
    documentId,
    actor,
    triggerSource: "job",
  });
  return {
    runId: run.id,
    status: run.status,
    fieldsExtracted: run.fieldsExtracted,
    provider: run.provider,
  };
}
