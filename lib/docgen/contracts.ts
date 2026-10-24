import { sql, newId, str, num, isoOrNull } from "../platform/db";
import { logUsage } from "../platform/usage";
import { getStorageProvider } from "../storage";
import { buildSimplePdf } from "../financials/pdf";
import {
  registerUploadedDocument,
  updateDocument,
  getDocument,
  readDocumentBytes,
  sha256Hex,
  softDeleteDocument,
} from "../dataroom/documents";
import {
  getRoomResolutionByDeal,
  getRoom,
  writeActivity,
  writeAudit,
} from "../dataroom/service";
import { extractText } from "../dataroom/extract";
import { getDirectoryDetail, listDirectory } from "../directory/service";
import { getInvestorDetail } from "../capital/service";
import {
  ensureDocgen,
  getTemplateById,
  getTemplateSignerRoles,
  extractTemplateFields,
  FIELD_CATALOG,
} from "./templates";
import {
  buildContext,
  renderBody,
  bodyToPdfInput,
  stampDraftBanner,
  moneyOrNull,
  textOrNull,
  DocGenError,
  FIRM_LEGAL_NAME,
  FIRM_ADDRESS,
} from "./generate";
import { buildDocxFromText, fillDocxTemplate } from "./docx";
import { diffTexts, type TextDiff } from "./diff";
import {
  summarizeContractText,
  summarizeVersionChanges,
  contractAiConfigured,
  AI_DRAFT_LABEL,
} from "./ai";
import {
  getContractEsignProvider,
  contractEsignProviderName,
} from "./contract-esign";
import { getLatestEnvelope } from "./esign";
import { getEnvelopeDetail } from "../signing/service";
import {
  buildSignatureSections,
  signatureFieldRects,
  SIG_DOCGEN_HEADER_LINES,
} from "../signing/pdf";
import { PDFDocument } from "pdf-lib";
import type {
  ContractRow,
  ContractVersionRow,
  ContractEventRow,
  ContractSigner,
  ContractKeyDates,
  ContractStatus,
  DocgenTemplateRow,
} from "./schema";

/**
 * Contract generation service (Oct 24, 2026).
 *
 * Owns docgen.contracts / contract_versions / contract_events. Files
 * are ordinary core.documents registered through the dataroom
 * documents service (SharePoint-backed data rooms, U.S.-persons /
 * controlled-data room rules inherited from room placement), so a
 * contract's file behaves exactly like every other portal document.
 *
 * Guardrails: generation requires an APPROVED template version; AI
 * is summaries-only (lib/docgen/ai.ts); every generated file carries
 * the "Draft for attorney review." banner (PDF stamp + DOCX header).
 */

export { AI_DRAFT_LABEL };

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_VERSION_TEXT = 200_000;

/* ------------------------------ parsing ------------------------------ */

function parseJson<T>(v: unknown, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  if (typeof v === "object") return v as T;
  if (typeof v === "string" && v) {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

function parseKeyDates(v: unknown): ContractKeyDates {
  const raw = parseJson<Record<string, unknown>>(v, {});
  const d = (x: unknown) =>
    typeof x === "string" && x.trim() ? x.trim().slice(0, 10) : null;
  return {
    exclusivityExpiry: d(raw.exclusivityExpiry),
    closing: d(raw.closing),
    renewal: d(raw.renewal),
  };
}

function parseSigners(v: unknown): ContractSigner[] {
  const arr = parseJson<unknown[]>(v, []);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((s) => s && typeof s === "object")
    .map((s, i) => {
      const r = s as Record<string, unknown>;
      const st = str(r.status);
      return {
        name: str(r.name),
        email: str(r.email),
        title: str(r.title),
        order: Number(r.order ?? i + 1) || i + 1,
        status: (["pending", "sent", "viewed", "signed", "declined"].includes(
          st
        )
          ? st
          : "pending") as ContractSigner["status"],
        signedAt: r.signedAt ? str(r.signedAt) : null,
        envelopeId: r.envelopeId ? str(r.envelopeId) : null,
      };
    })
    .sort((a, b) => a.order - b.order);
}

function rowToContract(r: Record<string, unknown>): ContractRow {
  const statusRaw = str(r.status);
  const scopeRaw = str(r.scope);
  return {
    id: str(r.id),
    title: str(r.title),
    templateId: r.template_id ? str(r.template_id) : null,
    templateKey: str(r.template_key),
    templateName: str(r.template_name),
    templateVersion: num(r.template_version) || 1,
    scope:
      scopeRaw === "investor" || scopeRaw === "general" ? scopeRaw : "deal",
    companyId: r.company_id ? str(r.company_id) : null,
    companyName: str(r.company_name),
    dealId: r.deal_id ? str(r.deal_id) : null,
    investorPersonId: r.investor_person_id ? str(r.investor_person_id) : null,
    investorName: str(r.investor_name),
    counterpartyPersonId: r.counterparty_person_id
      ? str(r.counterparty_person_id)
      : null,
    counterpartyName: str(r.counterparty_name),
    counterpartyEmail: str(r.counterparty_email),
    counterpartyTitle: str(r.counterparty_title),
    counterpartyCompany: str(r.counterparty_company),
    status: (["draft", "in_review", "out_for_signature", "executed"].includes(
      statusRaw
    )
      ? statusRaw
      : "draft") as ContractStatus,
    currentVersion: num(r.current_version) || 1,
    currentDocumentId: r.current_document_id ? str(r.current_document_id) : null,
    currentPdfDocumentId: r.current_pdf_document_id
      ? str(r.current_pdf_document_id)
      : null,
    roomId: r.room_id ? str(r.room_id) : null,
    keyDates: parseKeyDates(r.key_dates),
    signers: parseSigners(r.signers),
    fieldValues: parseJson<Record<string, string>>(r.field_values, {}),
    aiSummary: str(r.ai_summary),
    aiSummaryVersion:
      r.ai_summary_version === null || r.ai_summary_version === undefined
        ? null
        : num(r.ai_summary_version),
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToVersion(r: Record<string, unknown>): ContractVersionRow {
  const kindRaw = str(r.kind);
  return {
    id: str(r.id),
    contractId: str(r.contract_id),
    version: num(r.version),
    kind:
      kindRaw === "redline" || kindRaw === "executed" ? kindRaw : "generated",
    documentId: str(r.document_id),
    documentName: str(r.document_name),
    pdfDocumentId: r.pdf_document_id ? str(r.pdf_document_id) : null,
    pdfDocumentName: str(r.pdf_document_name),
    note: str(r.note),
    aiChangeSummary: str(r.ai_change_summary),
    createdBy: str(r.created_by),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}

function rowToEvent(r: Record<string, unknown>): ContractEventRow {
  return {
    id: str(r.id),
    contractId: str(r.contract_id),
    actor: str(r.actor),
    kind: str(r.kind),
    detail: str(r.detail),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}

const CONTRACT_COLS = `
  c.id, c.title, c.template_id, c.template_key, c.template_name,
  c.template_version, c.scope, c.company_id, c.deal_id,
  c.investor_person_id, c.counterparty_person_id, c.counterparty_name,
  c.counterparty_email, c.counterparty_title, c.counterparty_company,
  c.status, c.current_version, c.room_id, c.key_dates, c.signers,
  c.field_values, c.ai_summary, c.ai_summary_version, c.created_by,
  c.created_at, c.updated_at,
  (SELECT v.document_id FROM docgen.contract_versions v
    WHERE v.contract_id = c.id AND v.version = c.current_version
    LIMIT 1) AS current_document_id,
  (SELECT v.pdf_document_id FROM docgen.contract_versions v
    WHERE v.contract_id = c.id AND v.version = c.current_version
    LIMIT 1) AS current_pdf_document_id,
  coalesce(co.name, '') AS company_name,
  coalesce(p.name, '') AS investor_name`;

const CONTRACT_FROM = `
  FROM docgen.contracts c
  LEFT JOIN core.companies co ON co.id = c.company_id
  LEFT JOIN core.people p ON p.id = c.investor_person_id`;

/* ------------------------------ events ------------------------------ */

export async function addContractEvent(
  contractId: string,
  actor: string,
  kind: string,
  detail: string
): Promise<void> {
  const db = sql();
  await db`
    INSERT INTO docgen.contract_events (id, contract_id, actor, kind, detail)
    VALUES (${newId()}, ${contractId}, ${actor}, ${kind},
      ${detail.slice(0, 1000)})`;
}

/* ------------------------- generation context ------------------------- */

export interface ReviewField {
  field: string;
  label: string;
  group: string;
  value: string;
  source: string;
}

export interface GenerationContext {
  context: Record<string, string | null>;
  companyId: string | null;
  companyName: string;
  dealId: string | null;
  investorPersonId: string | null;
  investorName: string;
  counterpartyPersonId: string | null;
  counterparty: {
    name: string;
    email: string;
    title: string;
    company: string;
  } | null;
  roomId: string | null;
  commitments: Array<{
    id: string;
    dealId: string;
    dealName: string;
    companyName: string;
    amount: number;
    stage: string;
  }>;
}

function sourceOfField(field: string): string {
  if (field.startsWith("counterparty.")) return "Directory";
  if (field.startsWith("investor.")) return "Investor record";
  if (field.startsWith("firm.")) return "Firm";
  if (field.startsWith("date.")) return "Today";
  if (field.startsWith("fin.")) return "Financials";
  if (field.startsWith("company.")) return "Company record";
  return "Deal record";
}

function todayContext(): Record<string, string> {
  const now = new Date();
  const todayLong = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const year = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Phoenix",
    year: "numeric",
  }).format(now);
  return {
    "firm.name": "Canny Capital Partners",
    "firm.legalName": FIRM_LEGAL_NAME,
    "firm.address": FIRM_ADDRESS,
    "date.today": todayLong,
    "date.year": year,
  };
}

/**
 * Resolve the merge context for a drafting session: deal fields from
 * the deal record (lib/docgen/generate buildContext — services only),
 * counterparty fields from the Directory, investor fields from the
 * capital module's investor detail (Directory person + profile +
 * commitments). No cross-module SQL: each module is read through its
 * own service.
 */
export async function buildGenerationContext(input: {
  dealId?: string | null;
  investorPersonId?: string | null;
  commitmentId?: string | null;
  counterpartyPersonId?: string | null;
}): Promise<GenerationContext> {
  await ensureDocgen();
  const context: Record<string, string | null> = { ...todayContext() };
  let companyId: string | null = null;
  let companyName = "";
  let dealId: string | null = null;
  let roomId: string | null = null;
  let counterparty: GenerationContext["counterparty"] = null;
  let counterpartyPersonId: string | null = null;
  let investorName = "";
  const commitments: GenerationContext["commitments"] = [];

  const applyDeal = async (id: string) => {
    const built = await buildContext(id);
    for (const [k, v] of Object.entries(built.context)) {
      if (v !== null && v !== undefined && v !== "") context[k] = v;
      else if (!(k in context)) context[k] = v;
    }
    dealId = id;
    companyId = built.companyId ?? companyId;
    companyName = built.companyName || companyName;
    try {
      const resolution = await getRoomResolutionByDeal(id);
      if (resolution.roomId) roomId = resolution.roomId;
    } catch (err) {
      console.error(
        "[contracts] room resolution failed for deal",
        id,
        err instanceof Error ? err.message : String(err)
      );
    }
  };

  if (input.dealId) await applyDeal(input.dealId);

  if (input.investorPersonId) {
    const detail = await getInvestorDetail(input.investorPersonId);
    const rec = detail.record;
    investorName = str(rec.name);
    const entity =
      str(rec.organizationName) || detail.legacyInvestor?.firm || "";
    context["investor.name"] = textOrNull(investorName);
    context["investor.entity"] = textOrNull(entity);
    context["investor.contactName"] = textOrNull(investorName);
    context["investor.title"] = textOrNull(str(rec.title));
    context["investor.email"] = textOrNull(str(rec.email));
    context["investor.address"] = null;
    for (const c of detail.commitments) {
      commitments.push({
        id: c.id,
        dealId: c.dealId,
        dealName: c.dealName,
        companyName: c.companyName,
        amount: c.amount,
        stage: c.stage,
      });
    }
    const chosen =
      commitments.find((c) => c.id === input.commitmentId) ?? commitments[0];
    if (chosen) {
      context["investor.commitment"] = moneyOrNull(chosen.amount);
      if (!dealId && chosen.dealId) {
        await applyDeal(chosen.dealId);
        // Investor fields win over the deal-context defaults.
        context["investor.commitment"] = moneyOrNull(chosen.amount);
      }
    }
    // The investor is the counterparty for investor documents.
    counterpartyPersonId = input.investorPersonId;
    counterparty = {
      name: investorName,
      email: str(rec.email),
      title: str(rec.title),
      company: entity,
    };
    context["counterparty.name"] = textOrNull(investorName);
    context["counterparty.title"] = textOrNull(str(rec.title));
    context["counterparty.company"] = textOrNull(entity);
    context["counterparty.email"] = textOrNull(str(rec.email));
  }

  if (input.counterpartyPersonId) {
    const detail = await getDirectoryDetail("person", input.counterpartyPersonId);
    if (detail) {
      const rec = detail.record;
      counterpartyPersonId = input.counterpartyPersonId;
      counterparty = {
        name: str(rec.name),
        email: str(rec.email),
        title: str(rec.title),
        company: str(rec.organizationName),
      };
      context["counterparty.name"] = textOrNull(str(rec.name));
      context["counterparty.title"] = textOrNull(str(rec.title));
      context["counterparty.company"] =
        textOrNull(str(rec.organizationName)) ?? context["counterparty.company"];
      context["counterparty.email"] = textOrNull(str(rec.email));
      context["counterparty.phone"] = textOrNull(str(rec.phone));
    }
  }

  if (!counterparty && context["counterparty.name"]) {
    counterparty = {
      name: context["counterparty.name"] ?? "",
      email: context["counterparty.email"] ?? "",
      title: context["counterparty.title"] ?? "",
      company: context["counterparty.company"] ?? "",
    };
  }

  return {
    context,
    companyId,
    companyName,
    dealId,
    investorPersonId: input.investorPersonId ?? null,
    investorName,
    counterpartyPersonId,
    counterparty,
    roomId,
    commitments,
  };
}

/** Template fields (in body order) resolved against a context — the
 * drafting review screen's rows. */
export function reviewFieldsFor(
  template: DocgenTemplateRow,
  templateText: string,
  context: Record<string, string | null>
): ReviewField[] {
  return extractTemplateFields(templateText || template.body).map((field) => {
    const cat = FIELD_CATALOG[field];
    return {
      field,
      label: cat?.label ?? field,
      group: cat?.group ?? "Other",
      value: context[field] ?? "",
      source: sourceOfField(field),
    };
  });
}

/** Plain text of a template (for field extraction): the body for
 * text templates; extracted text for uploaded .docx templates. */
export async function templatePlainText(
  template: DocgenTemplateRow
): Promise<string> {
  if (template.sourceFormat !== "docx" || !template.docxStorageKey) {
    return template.body;
  }
  const bytes = await getStorageProvider().get(template.docxStorageKey);
  return extractText(bytes, DOCX_MIME, template.docxFilename || "template.docx")
    .text;
}

/* ----------------------------- generation ----------------------------- */

export interface GenerateContractResult {
  contract: ContractRow;
  version: number;
  docxDocumentId: string;
  pdfDocumentId: string;
  roomId: string | null;
  unresolvedFields: string[];
}

export async function generateContract(input: {
  templateId: string;
  dealId?: string | null;
  investorPersonId?: string | null;
  commitmentId?: string | null;
  counterpartyPersonId?: string | null;
  fieldValues?: Record<string, string>;
  keyDates?: Partial<ContractKeyDates>;
  actor: string;
  actorEmail?: string;
}): Promise<GenerateContractResult> {
  await ensureDocgen();
  const template = await getTemplateById(input.templateId);
  if (!template) throw new DocGenError("template_not_found");
  if (template.status !== "approved") {
    throw new DocGenError("template_not_approved");
  }
  if (template.scope === "deal" && !input.dealId) {
    throw new DocGenError("deal_required");
  }
  if (template.scope === "investor" && !input.investorPersonId) {
    throw new DocGenError("investor_required");
  }

  const gen = await buildGenerationContext({
    dealId: input.dealId ?? null,
    investorPersonId: input.investorPersonId ?? null,
    commitmentId: input.commitmentId ?? null,
    counterpartyPersonId: input.counterpartyPersonId ?? null,
  });

  // Reviewed values win over every prefill; empty string means the
  // reviewer cleared the field (renders as "—", reported unresolved).
  const context: Record<string, string | null> = { ...gen.context };
  const overrides = input.fieldValues ?? {};
  for (const [k, v] of Object.entries(overrides)) {
    context[k] = typeof v === "string" ? v : String(v ?? "");
  }

  const provider = getStorageProvider();
  const stamp = newId();
  let filledText = "";
  let unresolvedFields: string[] = [];
  let docxBuffer: Buffer;

  if (template.sourceFormat === "docx" && template.docxStorageKey) {
    const templateBytes = await provider.get(template.docxStorageKey);
    const filled = fillDocxTemplate(templateBytes, context, (bytes) =>
      extractText(bytes, DOCX_MIME, template.docxFilename || "template.docx")
        .text
    );
    docxBuffer = filled.buffer;
    unresolvedFields = filled.unresolvedFields;
    filledText = extractText(
      docxBuffer,
      DOCX_MIME,
      template.docxFilename || "template.docx"
    ).text;
  } else {
    const rendered = renderBody(template.body, context);
    filledText = rendered.text;
    unresolvedFields = rendered.unresolvedFields;
    docxBuffer = buildDocxFromText(filledText);
  }

  // PDF from the same filled text (existing pipeline) + the template's
  // preset signature page when signable + the banner stamp.
  const subjectName =
    gen.companyName || gen.investorName || template.name;
  const pdfInput = bodyToPdfInput(
    template,
    filledText,
    subjectName,
    context["date.today"] ?? ""
  );
  const signerRoles = getTemplateSignerRoles(template.key);
  if (signerRoles && signerRoles.length) {
    pdfInput.sections.push(
      ...buildSignatureSections(
        signerRoles.map((r) => ({ caption: r.label, title: r.title })),
        { withHeader: true, pageBreakFirst: true }
      )
    );
  }
  const pdfBuffer = await stampDraftBanner(buildSimplePdf(pdfInput));
  let signatureBlocks: unknown = null;
  if (signerRoles && signerRoles.length) {
    const pageCount = (await PDFDocument.load(pdfBuffer)).getPageCount();
    const rects = signatureFieldRects(signerRoles.length, {
      headerLines: SIG_DOCGEN_HEADER_LINES,
      titles: signerRoles.map((r) => r.title),
    });
    signatureBlocks = rects.map((rect, i) => ({
      page: pageCount - 1 + rect.page,
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
      roleLabel: signerRoles[i].label,
    }));
  }

  const baseName = `${template.name} — ${subjectName}`;
  const docxKey = `uploads/contract-${stamp}.docx`;
  const pdfKey = `uploads/contract-${stamp}.pdf`;
  await provider.put(docxKey, docxBuffer);
  await provider.put(pdfKey, pdfBuffer);

  const docxReg = await registerUploadedDocument({
    storageKey: docxKey,
    filename: `${baseName}.docx`,
    mime: DOCX_MIME,
    sizeBytes: docxBuffer.length,
    contentHash: sha256Hex(docxBuffer),
    actor: input.actor,
    dealId: gen.dealId,
    companyId: gen.companyId,
    roomId: gen.roomId,
    tags: ["contract", template.key, template.scope],
  });
  const pdfReg = await registerUploadedDocument({
    storageKey: pdfKey,
    filename: `${baseName}.pdf`,
    mime: "application/pdf",
    sizeBytes: pdfBuffer.length,
    contentHash: sha256Hex(pdfBuffer),
    actor: input.actor,
    dealId: gen.dealId,
    companyId: gen.companyId,
    roomId: gen.roomId,
    tags: ["contract", template.key, template.scope],
  });
  if (gen.investorPersonId) {
    await updateDocument(
      docxReg.document.id,
      { personId: gen.investorPersonId },
      input.actor
    );
    await updateDocument(
      pdfReg.document.id,
      { personId: gen.investorPersonId },
      input.actor
    );
  }

  // Default signers: counterparty first, the firm (actor) second —
  // both editable on the contract before sending.
  const signers: ContractSigner[] = [];
  if (gen.counterparty && (gen.counterparty.email || gen.counterparty.name)) {
    signers.push({
      name: gen.counterparty.name,
      email: gen.counterparty.email,
      title: gen.counterparty.title,
      order: 1,
      status: "pending",
      signedAt: null,
      envelopeId: null,
    });
  }
  signers.push({
    name: input.actor,
    email: input.actorEmail ?? "",
    title: "Partner",
    order: signers.length + 1,
    status: "pending",
    signedAt: null,
    envelopeId: null,
  });

  const keyDates: ContractKeyDates = {
    exclusivityExpiry: input.keyDates?.exclusivityExpiry ?? null,
    closing: input.keyDates?.closing ?? null,
    renewal: input.keyDates?.renewal ?? null,
  };

  const fieldSourceText =
    template.sourceFormat === "docx"
      ? await templatePlainText(template)
      : template.body;
  const usedFieldValues: Record<string, string> = {};
  for (const f of extractTemplateFields(fieldSourceText)) {
    usedFieldValues[f] = context[f] ?? "";
  }

  const contractId = newId();
  const db = sql();
  await db`
    INSERT INTO docgen.contracts
      (id, title, template_id, template_key, template_name,
        template_version, scope, company_id, deal_id, investor_person_id,
        counterparty_person_id, counterparty_name, counterparty_email,
        counterparty_title, counterparty_company, status, current_version,
        room_id, key_dates, signers, field_values, created_by)
    VALUES (${contractId}, ${baseName}, ${template.id}, ${template.key},
      ${template.name}, ${template.version}, ${template.scope},
      ${gen.companyId}, ${gen.dealId}, ${gen.investorPersonId},
      ${gen.counterpartyPersonId},
      ${context["counterparty.name"] ?? ""},
      ${context["counterparty.email"] ?? ""},
      ${context["counterparty.title"] ?? ""},
      ${context["counterparty.company"] ?? ""},
      'draft', 1, ${gen.roomId}, ${JSON.stringify(keyDates)}::jsonb,
      ${JSON.stringify(signers)}::jsonb,
      ${JSON.stringify(usedFieldValues)}::jsonb, ${input.actor})`;

  await db`
    INSERT INTO docgen.contract_versions
      (id, contract_id, version, kind, document_id, pdf_document_id,
        note, text, created_by)
    VALUES (${newId()}, ${contractId}, 1, 'generated',
      ${docxReg.document.id}, ${pdfReg.document.id},
      ${`Generated from ${template.name} v${template.version}`},
      ${filledText.slice(0, MAX_VERSION_TEXT)}, ${input.actor})`;

  const generationId = newId();
  await db`
    INSERT INTO docgen.generations
      (id, template_id, template_key, document_id, deal_id, company_id,
        actor, signature_blocks, contract_id, field_values)
    VALUES (${generationId}, ${template.id}, ${template.key},
      ${pdfReg.document.id}, ${gen.dealId}, ${gen.companyId}, ${input.actor},
      ${signatureBlocks ? JSON.stringify(signatureBlocks) : null}::jsonb,
      ${contractId}, ${JSON.stringify(usedFieldValues)}::jsonb)`;

  await addContractEvent(
    contractId,
    input.actor,
    "generated",
    `Generated from template "${template.name}" v${template.version} (approved by ${template.approvedBy})`
  );
  await writeAudit("contract", contractId, input.actor, "generate", {
    templateKey: template.key,
    templateVersion: template.version,
    companyId: gen.companyId,
    dealId: gen.dealId,
    investorPersonId: gen.investorPersonId,
  });
  if (gen.companyId) {
    await writeActivity(
      "company",
      gen.companyId,
      input.actor,
      "contract_generated",
      `${input.actor} generated ${baseName}`
    );
  }

  const contract = await getContractRow(contractId);
  if (!contract) throw new DocGenError("contract_create_failed");
  return {
    contract,
    version: 1,
    docxDocumentId: docxReg.document.id,
    pdfDocumentId: pdfReg.document.id,
    roomId: gen.roomId,
    unresolvedFields,
  };
}

/* ------------------------------- reads ------------------------------- */

async function getContractRow(id: string): Promise<ContractRow | null> {
  await ensureDocgen();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(CONTRACT_COLS)} ${db.unsafe(CONTRACT_FROM)}
    WHERE c.id = ${id} AND c.deleted_at IS NULL LIMIT 1`;
  return rows.length
    ? rowToContract(rows[0] as Record<string, unknown>)
    : null;
}

async function listContractVersions(
  contractId: string
): Promise<ContractVersionRow[]> {
  const db = sql();
  const rows = await db`
    SELECT v.id, v.contract_id, v.version, v.kind, v.document_id,
      v.pdf_document_id, v.note, v.ai_change_summary, v.created_by,
      v.created_at,
      coalesce(d.name, '') AS document_name,
      coalesce(pd.name, '') AS pdf_document_name
    FROM docgen.contract_versions v
    LEFT JOIN core.documents d ON d.id = v.document_id
    LEFT JOIN core.documents pd ON pd.id = v.pdf_document_id
    WHERE v.contract_id = ${contractId}
    ORDER BY v.version DESC`;
  return rows.map((r) => rowToVersion(r as Record<string, unknown>));
}

async function getVersionText(
  contractId: string,
  version: number
): Promise<string> {
  const db = sql();
  const rows = await db`
    SELECT text, document_id FROM docgen.contract_versions
    WHERE contract_id = ${contractId} AND version = ${version} LIMIT 1`;
  if (!rows.length) return "";
  const rec = rows[0] as Record<string, unknown>;
  const stored = str(rec.text);
  if (stored) return stored;
  // Fallback: extract from the stored bytes (local extractor only).
  const docId = str(rec.document_id);
  if (!docId) return "";
  const doc = await getDocument(docId);
  if (!doc) return "";
  const read = await readDocumentBytes(doc);
  return extractText(read.bytes, read.mime, doc.name).text;
}

/**
 * Reconcile a contract that is out for signature with its in-house
 * envelope: completion flips the contract to executed, records the
 * executed copy as a new version, and updates signer states; a
 * decline returns it to in review. Runs on read (detail/list) — no
 * polling.
 */
async function reconcileContract(contract: ContractRow): Promise<ContractRow> {
  if (contract.status !== "out_for_signature") return contract;
  const versions = await listContractVersions(contract.id);
  const current = versions.find((v) => v.version === contract.currentVersion);
  const docId = current?.pdfDocumentId ?? current?.documentId;
  if (!docId) return contract;
  const envelope = await getLatestEnvelope(docId);
  if (!envelope) return contract;
  const db = sql();

  if (envelope.status === "completed") {
    let executedDocumentId: string | null = null;
    let signers = contract.signers;
    try {
      const detail = await getEnvelopeDetail(envelope.id);
      if (!detail) throw new Error("envelope_detail_missing");
      executedDocumentId = detail.artifacts.executedDocumentId;
      const byEmail = new Map(
        detail.signers.map((s) => [s.email.toLowerCase(), s])
      );
      signers = contract.signers.map((s) => {
        const match = byEmail.get(s.email.toLowerCase());
        if (!match) return { ...s, envelopeId: envelope.id };
        return {
          ...s,
          envelopeId: envelope.id,
          status:
            match.status === "signed"
              ? ("signed" as const)
              : s.status === "pending" || s.status === "sent"
                ? ("viewed" as const)
                : s.status,
          signedAt:
            match.status === "signed"
              ? (match.signedAt ?? s.signedAt)
              : s.signedAt,
        };
      });
    } catch (err) {
      console.error(
        "[contracts] envelope detail reconcile failed",
        err instanceof Error ? err.message : String(err)
      );
    }
    await db`
      UPDATE docgen.contracts SET status = 'executed',
        signers = ${JSON.stringify(signers)}::jsonb, updated_at = now()
      WHERE id = ${contract.id}`;
    if (executedDocumentId) {
      const existing = await db`
        SELECT id FROM docgen.contract_versions
        WHERE contract_id = ${contract.id} AND kind = 'executed'
          AND document_id = ${executedDocumentId} LIMIT 1`;
      if (!existing.length) {
        const nextVersion = contract.currentVersion + 1;
        await db`
          INSERT INTO docgen.contract_versions
            (id, contract_id, version, kind, document_id, pdf_document_id,
              note, text, created_by)
          VALUES (${newId()}, ${contract.id}, ${nextVersion}, 'executed',
            ${executedDocumentId}, NULL,
            'Executed copy filed by the in-house signing module',
            '', 'system')`;
        await db`
          UPDATE docgen.contracts SET current_version = ${nextVersion},
            updated_at = now()
          WHERE id = ${contract.id}`;
      }
    }
    await addContractEvent(
      contract.id,
      "system",
      "signed",
      `All signers completed envelope ${envelope.id} — contract executed`
    );
    await addContractEvent(
      contract.id,
      "system",
      "status_changed",
      "Status: out for signature → executed"
    );
    await writeAudit("contract", contract.id, "system", "executed", {
      envelopeId: envelope.id,
    });
    const fresh = await getContractRow(contract.id);
    return fresh ?? contract;
  }

  if (envelope.status === "declined") {
    await db`
      UPDATE docgen.contracts SET status = 'in_review', updated_at = now()
      WHERE id = ${contract.id}`;
    await addContractEvent(
      contract.id,
      "system",
      "declined",
      `Envelope ${envelope.id} was declined — returned to in review`
    );
    const fresh = await getContractRow(contract.id);
    return fresh ?? contract;
  }

  return contract;
}

export async function listContracts(opts: {
  companyId?: string;
  dealId?: string;
  investorPersonId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ContractRow[]; total: number }> {
  await ensureDocgen();
  const db = sql();
  const companyId = (opts.companyId ?? "").trim();
  const dealId = (opts.dealId ?? "").trim();
  const investorPersonId = (opts.investorPersonId ?? "").trim();
  const limit = Math.min(50, Math.max(1, opts.limit || 25));
  const offset = Math.max(0, opts.offset || 0);
  const countRows = await db`
    SELECT count(*)::int AS n ${db.unsafe(CONTRACT_FROM)}
    WHERE c.deleted_at IS NULL
      AND (${companyId} = '' OR c.company_id = ${companyId})
      AND (${dealId} = '' OR c.deal_id = ${dealId})
      AND (${investorPersonId} = '' OR c.investor_person_id = ${investorPersonId})`;
  const total = countRows.length ? num(countRows[0].n) : 0;
  const rows = await db`
    SELECT ${db.unsafe(CONTRACT_COLS)} ${db.unsafe(CONTRACT_FROM)}
    WHERE c.deleted_at IS NULL
      AND (${companyId} = '' OR c.company_id = ${companyId})
      AND (${dealId} = '' OR c.deal_id = ${dealId})
      AND (${investorPersonId} = '' OR c.investor_person_id = ${investorPersonId})
    ORDER BY c.updated_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  const items: ContractRow[] = [];
  for (const r of rows) {
    items.push(
      await reconcileContract(rowToContract(r as Record<string, unknown>))
    );
  }
  logUsage("contracts_list", items.length, JSON.stringify(items).length);
  return { items, total };
}

export interface ContractDetail {
  contract: ContractRow;
  versions: ContractVersionRow[];
  events: ContractEventRow[];
  envelope: { id: string; status: string; detail: string } | null;
  aiConfigured: boolean;
  esignProvider: string;
}

export async function getContractDetail(
  id: string
): Promise<ContractDetail | null> {
  let contract = await getContractRow(id);
  if (!contract) return null;
  contract = await reconcileContract(contract);
  const db = sql();
  const [versions, eventRows] = await Promise.all([
    listContractVersions(id),
    db`
      SELECT id, contract_id, actor, kind, detail, created_at
      FROM docgen.contract_events
      WHERE contract_id = ${id}
      ORDER BY created_at DESC LIMIT 100`,
  ]);
  const current = versions.find((v) => v.version === contract!.currentVersion);
  const docId = current?.pdfDocumentId ?? current?.documentId;
  let envelope: ContractDetail["envelope"] = null;
  if (docId) {
    const env = await getLatestEnvelope(docId);
    if (env) {
      envelope = { id: env.id, status: env.status, detail: env.detail };
    }
  }
  return {
    contract,
    versions,
    events: eventRows.map((r) => rowToEvent(r as Record<string, unknown>)),
    envelope,
    aiConfigured: contractAiConfigured(),
    esignProvider: contractEsignProviderName(),
  };
}

/* ------------------------------ updates ------------------------------ */

const TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft: ["in_review", "executed"],
  in_review: ["draft", "executed"],
  out_for_signature: ["in_review", "executed"],
  executed: [],
};

export async function updateContract(
  id: string,
  patch: {
    title?: string;
    counterpartyName?: string;
    counterpartyEmail?: string;
    counterpartyTitle?: string;
    counterpartyCompany?: string;
    status?: ContractStatus;
    keyDates?: Partial<ContractKeyDates>;
    signers?: ContractSigner[];
  },
  actor: string
): Promise<ContractRow | null> {
  await ensureDocgen();
  const current = await getContractRow(id);
  if (!current) return null;
  const db = sql();

  if (patch.status && patch.status !== current.status) {
    if (!TRANSITIONS[current.status].includes(patch.status)) {
      throw new DocGenError(
        `invalid_transition_${current.status}_to_${patch.status}`
      );
    }
    await db`
      UPDATE docgen.contracts SET status = ${patch.status}, updated_at = now()
      WHERE id = ${id}`;
    await addContractEvent(
      id,
      actor,
      "status_changed",
      `Status: ${current.status.replace(/_/g, " ")} → ${patch.status.replace(/_/g, " ")}`
    );
    await writeAudit("contract", id, actor, "status", {
      from: current.status,
      to: patch.status,
    });
  }

  const edits: string[] = [];
  if (patch.title !== undefined && patch.title.trim() !== current.title) {
    await db`
      UPDATE docgen.contracts SET title = ${patch.title.trim().slice(0, 300)},
        updated_at = now() WHERE id = ${id}`;
    edits.push("title");
  }
  if (
    patch.counterpartyName !== undefined &&
    patch.counterpartyName.trim() !== current.counterpartyName
  ) {
    await db`
      UPDATE docgen.contracts SET
        counterparty_name = ${patch.counterpartyName.trim().slice(0, 300)},
        updated_at = now() WHERE id = ${id}`;
    edits.push("counterpartyName");
  }
  if (
    patch.counterpartyEmail !== undefined &&
    patch.counterpartyEmail.trim() !== current.counterpartyEmail
  ) {
    await db`
      UPDATE docgen.contracts SET
        counterparty_email = ${patch.counterpartyEmail.trim().slice(0, 300)},
        updated_at = now() WHERE id = ${id}`;
    edits.push("counterpartyEmail");
  }
  if (
    patch.counterpartyTitle !== undefined &&
    patch.counterpartyTitle.trim() !== current.counterpartyTitle
  ) {
    await db`
      UPDATE docgen.contracts SET
        counterparty_title = ${patch.counterpartyTitle.trim().slice(0, 300)},
        updated_at = now() WHERE id = ${id}`;
    edits.push("counterpartyTitle");
  }
  if (
    patch.counterpartyCompany !== undefined &&
    patch.counterpartyCompany.trim() !== current.counterpartyCompany
  ) {
    await db`
      UPDATE docgen.contracts SET
        counterparty_company = ${patch.counterpartyCompany.trim().slice(0, 300)},
        updated_at = now() WHERE id = ${id}`;
    edits.push("counterpartyCompany");
  }
  if (patch.keyDates) {
    const merged: ContractKeyDates = {
      exclusivityExpiry:
        patch.keyDates.exclusivityExpiry !== undefined
          ? patch.keyDates.exclusivityExpiry
          : current.keyDates.exclusivityExpiry,
      closing:
        patch.keyDates.closing !== undefined
          ? patch.keyDates.closing
          : current.keyDates.closing,
      renewal:
        patch.keyDates.renewal !== undefined
          ? patch.keyDates.renewal
          : current.keyDates.renewal,
    };
    await db`
      UPDATE docgen.contracts SET
        key_dates = ${JSON.stringify(merged)}::jsonb, updated_at = now()
      WHERE id = ${id}`;
    edits.push("keyDates");
  }
  if (patch.signers) {
    const signers = patch.signers
      .filter((s) => s && (s.name || s.email))
      .slice(0, 20)
      .map((s, i) => ({
        name: String(s.name ?? "").slice(0, 200),
        email: String(s.email ?? "").slice(0, 200),
        title: String(s.title ?? "").slice(0, 200),
        order: Number(s.order) || i + 1,
        status: s.status ?? "pending",
        signedAt: s.signedAt ?? null,
        envelopeId: s.envelopeId ?? null,
      }));
    await db`
      UPDATE docgen.contracts SET
        signers = ${JSON.stringify(signers)}::jsonb, updated_at = now()
      WHERE id = ${id}`;
    edits.push("signers");
  }
  if (edits.length) {
    await addContractEvent(
      id,
      actor,
      "edited",
      `Edited: ${edits.join(", ")}`
    );
    await writeAudit("contract", id, actor, "update", { edits });
  }
  return getContractRow(id);
}

/* --------------------------- send for signature --------------------------- */

export async function sendContractForSignature(
  id: string,
  actor: string,
  actorEmail?: string
): Promise<{ envelopeId: string; provider: string; links: unknown }> {
  await ensureDocgen();
  const contract = await getContractRow(id);
  if (!contract) throw new DocGenError("contract_not_found");
  if (contract.status === "executed") {
    throw new DocGenError("contract_executed");
  }
  if (contract.status === "out_for_signature") {
    throw new DocGenError("already_sent");
  }
  if (!contract.signers.length) throw new DocGenError("signers_required");
  for (const s of contract.signers) {
    if (!s.email.trim()) throw new DocGenError("signer_email_required");
  }

  // Data-room export controls: when the contract's room is
  // U.S.-persons-only or restricted, signers must be approved
  // parties for the room — the same rule the guest-invite path
  // enforces (Directory person by email, or an allowlisted domain).
  if (contract.roomId) {
    const room = await getRoom(contract.roomId);
    if (room && (room.usPersonsOnly || room.restrictedAccess)) {
      for (const s of contract.signers) {
        const domain = s.email.split("@")[1]?.toLowerCase() ?? "";
        if (domain && room.domainAllowlist.includes(domain)) continue;
        const found = await listDirectory({ q: s.email, limit: 5, offset: 0 });
        const ok = found.items.some(
          (p) => p.email.toLowerCase() === s.email.toLowerCase()
        );
        if (!ok) throw new DocGenError("signer_not_approved_for_room");
      }
    }
  }

  const versions = await listContractVersions(id);
  const current = versions.find((v) => v.version === contract.currentVersion);
  const docId = current?.pdfDocumentId ?? current?.documentId;
  if (!docId) throw new DocGenError("document_not_found");
  const doc = await getDocument(docId);
  if (!doc) throw new DocGenError("document_not_found");
  if (doc.mime !== "application/pdf") {
    // Envelopes sign a PDF; versions created before the redline PDF
    // companion fix may not have one. Fail clean, never a raw 500.
    throw new DocGenError("signable_pdf_unavailable");
  }

  const provider = getContractEsignProvider();
  const result = await provider.sendForSignature({
    documentId: docId,
    documentName: doc.name,
    dealId: contract.dealId,
    signers: contract.signers,
    actor,
    actorEmail,
  });

  const db = sql();
  const signers = contract.signers.map((s) => ({
    ...s,
    status: "sent" as const,
    envelopeId: result.envelopeId,
  }));
  await db`
    UPDATE docgen.contracts SET status = 'out_for_signature',
      signers = ${JSON.stringify(signers)}::jsonb, updated_at = now()
    WHERE id = ${id}`;
  await addContractEvent(
    id,
    actor,
    "sent",
    `Sent for signature via ${result.provider} (envelope ${result.envelopeId}) to ${contract.signers.map((s) => s.email).join(", ")}`
  );
  await writeAudit("contract", id, actor, "send", {
    provider: result.provider,
    envelopeId: result.envelopeId,
  });
  return {
    envelopeId: result.envelopeId,
    provider: result.provider,
    links: result.links,
  };
}

/* ------------------------------- redlines ------------------------------- */

export async function addRedlineVersion(
  id: string,
  input: {
    bytes: Buffer;
    filename: string;
    mime: string;
    note?: string;
  },
  actor: string
): Promise<{ version: number; documentId: string }> {
  await ensureDocgen();
  const contract = await getContractRow(id);
  if (!contract) throw new DocGenError("contract_not_found");
  if (contract.status === "executed") {
    throw new DocGenError("contract_executed");
  }
  const provider = getStorageProvider();
  const tempKey = `uploads/redline-${newId()}`;
  await provider.put(tempKey, input.bytes);
  const reg = await registerUploadedDocument({
    storageKey: tempKey,
    filename: input.filename,
    mime: input.mime,
    sizeBytes: input.bytes.length,
    contentHash: sha256Hex(input.bytes),
    actor,
    dealId: contract.dealId,
    companyId: contract.companyId,
    roomId: contract.roomId,
    tags: ["contract", "redline", contract.templateKey],
    note: input.note ?? "Counterparty redline",
  });
  if (contract.investorPersonId) {
    await updateDocument(
      reg.document.id,
      { personId: contract.investorPersonId },
      actor
    );
  }
  const text = extractText(input.bytes, input.mime, input.filename).text;
  const version = contract.currentVersion + 1;

  // PDF companion (fix, Oct 24, 2026): the signing pipeline signs a
  // PDF, so every version needs one — the first live verification
  // failed at send time because a non-PDF redline left the version
  // without a signable PDF and the envelope builder threw on the raw
  // upload. PDF redlines are banner-stamped and used as-is; any other
  // format is rendered from its extracted text through the same
  // pipeline generation uses. Best-effort: a companion failure must
  // not lose the redline itself (send then reports a clean error).
  let pdfDocumentId: string | null = null;
  try {
    const isPdf =
      input.mime === "application/pdf" || /\.pdf$/i.test(input.filename);
    let pdfBuffer: Buffer;
    if (isPdf) {
      pdfBuffer = await stampDraftBanner(input.bytes);
    } else {
      const tpl = contract.templateId
        ? await getTemplateById(contract.templateId).catch(() => null)
        : null;
      const pdfTemplate =
        tpl ?? ({ name: contract.templateName } as DocgenTemplateRow);
      const subjectName =
        contract.companyName || contract.investorName || contract.templateName;
      const todayLong = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
      pdfBuffer = await stampDraftBanner(
        buildSimplePdf(bodyToPdfInput(pdfTemplate, text, subjectName, todayLong))
      );
    }
    const pdfKey = `uploads/redline-${newId()}.pdf`;
    await provider.put(pdfKey, pdfBuffer);
    const pdfReg = await registerUploadedDocument({
      storageKey: pdfKey,
      filename: `${input.filename.replace(/\.[^.]+$/, "")}.pdf`,
      mime: "application/pdf",
      sizeBytes: pdfBuffer.length,
      contentHash: sha256Hex(pdfBuffer),
      actor,
      dealId: contract.dealId,
      companyId: contract.companyId,
      roomId: contract.roomId,
      tags: ["contract", "redline", contract.templateKey],
      note: "PDF companion of the redline upload (for signing)",
    });
    pdfDocumentId = pdfReg.document.id;
    if (contract.investorPersonId) {
      await updateDocument(
        pdfDocumentId,
        { personId: contract.investorPersonId },
        actor
      );
    }
  } catch (err) {
    console.error("[docgen] redline PDF companion failed", err);
  }

  const db = sql();
  await db`
    INSERT INTO docgen.contract_versions
      (id, contract_id, version, kind, document_id, pdf_document_id,
        note, text, created_by)
    VALUES (${newId()}, ${id}, ${version}, 'redline', ${reg.document.id},
      ${pdfDocumentId}, ${(input.note ?? "Counterparty redline").slice(0, 500)},
      ${text.slice(0, MAX_VERSION_TEXT)}, ${actor})`;
  await db`
    UPDATE docgen.contracts SET current_version = ${version},
      updated_at = now()
    WHERE id = ${id}`;
  await addContractEvent(
    id,
    actor,
    "redline_added",
    `Redline uploaded as v${version}: ${input.filename}`
  );
  await writeAudit("contract", id, actor, "redline", {
    version,
    filename: input.filename,
  });
  return { version, documentId: reg.document.id };
}

/* ------------------------------- compare + AI ------------------------------- */

export async function compareContractVersions(
  id: string,
  from: number,
  to: number
): Promise<TextDiff & { from: number; to: number }> {
  await ensureDocgen();
  const contract = await getContractRow(id);
  if (!contract) throw new DocGenError("contract_not_found");
  const [oldText, newText] = await Promise.all([
    getVersionText(id, from),
    getVersionText(id, to),
  ]);
  const diff = diffTexts(oldText, newText);
  return { ...diff, from, to };
}

export async function aiSummarizeContract(
  id: string,
  actor: string
): Promise<{ summary: string; label: string; version: number }> {
  await ensureDocgen();
  if (!contractAiConfigured()) throw new DocGenError("ai_not_configured");
  const contract = await getContractRow(id);
  if (!contract) throw new DocGenError("contract_not_found");
  const text = await getVersionText(id, contract.currentVersion);
  if (!text.trim()) throw new DocGenError("no_text_available");
  const summary = await summarizeContractText(text);
  const db = sql();
  await db`
    UPDATE docgen.contracts SET ai_summary = ${summary},
      ai_summary_version = ${contract.currentVersion}, updated_at = now()
    WHERE id = ${id}`;
  await addContractEvent(
    id,
    actor,
    "ai_summary",
    `AI summary generated for v${contract.currentVersion} (${AI_DRAFT_LABEL})`
  );
  return { summary, label: AI_DRAFT_LABEL, version: contract.currentVersion };
}

export async function aiSummarizeChanges(
  id: string,
  from: number,
  to: number,
  actor: string
): Promise<{ summary: string; label: string }> {
  await ensureDocgen();
  if (!contractAiConfigured()) throw new DocGenError("ai_not_configured");
  const diff = await compareContractVersions(id, from, to);
  let summary: string;
  if (!diff.changedLines.length) {
    summary = `No differences between version ${from} and version ${to}.`;
  } else {
    summary = await summarizeVersionChanges(diff.changedLines, from, to);
  }
  const db = sql();
  await db`
    UPDATE docgen.contract_versions SET ai_change_summary = ${summary}
    WHERE contract_id = ${id} AND version = ${to}`;
  await addContractEvent(
    id,
    actor,
    "ai_changes",
    `AI change summary generated for v${from} → v${to} (${AI_DRAFT_LABEL})`
  );
  return { summary, label: AI_DRAFT_LABEL };
}

/* ------------------------------- calendar ------------------------------- */

export interface ContractCalendarItem {
  contractId: string;
  companyId: string | null;
  dealId: string | null;
  investorPersonId: string | null;
  companyName: string;
  investorName: string;
  title: string;
  dateType: "exclusivityExpiry" | "closing" | "renewal";
  date: string;
}

/** Executed contracts' key dates, for the calgen "deadline"
 * generator (the portal's generated-calendar plumbing — same shape
 * as diligence's listClosingCalendarItems). */
export async function listContractCalendarItems(): Promise<
  ContractCalendarItem[]
> {
  await ensureDocgen();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(CONTRACT_COLS)} ${db.unsafe(CONTRACT_FROM)}
    WHERE c.deleted_at IS NULL AND c.status = 'executed'
    ORDER BY c.updated_at DESC LIMIT 200`;
  const items: ContractCalendarItem[] = [];
  const types: Array<keyof ContractKeyDates> = [
    "exclusivityExpiry",
    "closing",
    "renewal",
  ];
  for (const r of rows) {
    const c = rowToContract(r as Record<string, unknown>);
    for (const t of types) {
      const date = c.keyDates[t];
      if (!date) continue;
      items.push({
        contractId: c.id,
        companyId: c.companyId,
        dealId: c.dealId,
        investorPersonId: c.investorPersonId,
        companyName: c.companyName,
        investorName: c.investorName,
        title: c.title,
        dateType: t,
        date,
      });
    }
  }
  return items;
}

/* ------------------------------- delete ------------------------------- */

export async function softDeleteContract(
  id: string,
  actor: string
): Promise<boolean> {
  await ensureDocgen();
  const contract = await getContractRow(id);
  if (!contract) return false;
  const db = sql();
  const rows = await db`
    UPDATE docgen.contracts SET deleted_at = now(), updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  if (!rows.length) return false;
  // Soft-delete the version documents too so test artifacts and
  // discarded drafts leave the library (bytes retained by the
  // storage provider, per the portal's soft-delete semantics).
  const versions = await listContractVersions(id);
  for (const v of versions) {
    await softDeleteDocument(v.documentId, actor).catch(() => false);
    if (v.pdfDocumentId) {
      await softDeleteDocument(v.pdfDocumentId, actor).catch(() => false);
    }
  }
  await addContractEvent(id, actor, "deleted", "Contract deleted");
  await writeAudit("contract", id, actor, "delete", {});
  return true;
}
