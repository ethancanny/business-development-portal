import { sql, newId, str, isoOrNull } from "../platform/db";
import { logUsage } from "../platform/usage";
import { getDeals } from "../db";
import { getCompanyFinancials } from "../financials/service";
import { buildSimplePdf, type SimplePdfInput } from "../financials/pdf";
import { getStorageProvider } from "../storage";
import {
  registerUploadedDocument,
  sha256Hex,
} from "../dataroom/documents";
import { getRoomResolutionByDeal } from "../dataroom/service";
import {
  ensureDocgen,
  getTemplateById,
  getTemplateByKey,
} from "./templates";
import type {
  DocgenGenerationRow,
  DocgenTemplateRow,
} from "./schema";

/**
 * Document generation (Phase 10).
 *
 * generateDocument resolves a template + a legacy CRM deal, builds
 * the merge-field context from services only (legacy deals via
 * lib/db's getDeals; the deal → company link via core.deals /
 * core.companies, which is shared core reference data; financials
 * via getCompanyFinancials — latest period only), renders the body,
 * builds a PDF with the financials module's buildSimplePdf, and
 * registers the bytes in the document store.
 *
 * Byte flow (mirrors lib/dataroom/uploads.ts completeUploadSession
 * and lib/portmgmt/service.ts storeBytesAsDocument, both verified):
 *   provider.put(`uploads/docgen-<generationId>.pdf`, buffer)
 *   → registerUploadedDocument({ storageKey: tempKey, … })
 *   → register calls provider.finalizeUpload(tempKey, versionKey)
 *     moving the bytes to documents/<documentId>/v1/<filename>,
 *     creates the core.documents row + dataroom version row, places
 *     the document in the deal's room when one exists, publishes
 *     document_uploaded, and queues text extraction.
 * The local provider's finalizeUpload is a plain rename/copy of the
 * .pdf file written by put(), so a simple put() under an uploads/
 * key is sufficient — no chunked session is needed.
 *
 * Unknown or empty {{fields}} render as "—" and are returned in
 * unresolvedFields; raw {{ }} never reaches the output and no value
 * is ever invented.
 */

export class DocGenError extends Error {
  error: string;
  constructor(code: string) {
    super(code);
    this.name = "DocGenError";
    this.error = code;
  }
}

/** The exact merge-field set templates may use. */
export const MERGE_FIELDS = [
  "deal.companyName",
  "deal.industry",
  "deal.city",
  "deal.stage",
  "deal.contactName",
  "deal.contactEmail",
  "deal.broker",
  "deal.owner",
  "deal.askingPrice",
  "deal.dealValue",
  "deal.revenue",
  "deal.ebitda",
  "company.name",
  "company.city",
  "fin.latestRevenue",
  "fin.latestEbitda",
  "fin.latestPeriodEnd",
  "firm.name",
  "date.today",
  "date.year",
] as const;

const FIRM_NAME = "Canny Capital Partners";

/** $X,XXX,XXX or null when the figure is absent / zero / non-finite. */
function moneyOrNull(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !isFinite(v) || v === 0) return null;
  const r = Math.round(v);
  const s = Math.abs(r).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  return r < 0 ? `-$${s}` : `$${s}`;
}

function textOrNull(v: string | null | undefined): string | null {
  const s = (v ?? "").trim();
  return s ? s : null;
}

interface BuiltContext {
  context: Record<string, string | null>;
  companyId: string | null;
  companyName: string;
  dealId: string;
}

async function buildContext(dealId: string): Promise<BuiltContext> {
  const deals = await getDeals();
  const deal = deals.find((d) => d.id === dealId);
  if (!deal) throw new DocGenError("deal_not_found");

  // Deal → company link through the core projection (shared core
  // reference data), then the company's name/city from core.companies.
  let companyId: string | null = null;
  let coreCompanyName: string | null = null;
  let coreCompanyCity: string | null = null;
  try {
    const db = sql();
    const linkRows = await db`
      SELECT company_id FROM core.deals WHERE id = ${dealId} LIMIT 1`;
    if (linkRows.length) {
      const cid = (linkRows[0] as Record<string, unknown>).company_id;
      companyId = cid ? str(cid) : null;
    }
    if (companyId) {
      const compRows = await db`
        SELECT name, city FROM core.companies
        WHERE id = ${companyId} AND deleted_at IS NULL LIMIT 1`;
      if (compRows.length) {
        const rec = compRows[0] as Record<string, unknown>;
        coreCompanyName = textOrNull(str(rec.name));
        coreCompanyCity = textOrNull(str(rec.city));
      }
    }
  } catch (err) {
    console.error(
      "[docgen] core company resolution failed for deal",
      dealId,
      err instanceof Error ? err.message : String(err)
    );
  }

  // Financials via the financials service — latest period only.
  let finRevenue: string | null = null;
  let finEbitda: string | null = null;
  let finPeriodEnd: string | null = null;
  if (companyId) {
    try {
      const { summary } = await getCompanyFinancials(companyId);
      const latest = summary?.latest ?? null;
      if (latest) {
        finRevenue = moneyOrNull(latest.revenue);
        finEbitda = moneyOrNull(latest.ebitda);
        finPeriodEnd = textOrNull(latest.periodEnd ?? "");
      }
    } catch (err) {
      console.error(
        "[docgen] financials lookup failed for company",
        companyId,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

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

  const context: Record<string, string | null> = {
    "deal.companyName": textOrNull(deal.companyName),
    "deal.industry": textOrNull(deal.industry),
    "deal.city": textOrNull(deal.city),
    "deal.stage": textOrNull(String(deal.stage ?? "")),
    "deal.contactName": textOrNull(deal.contactName),
    "deal.contactEmail": textOrNull(deal.contactEmail),
    "deal.broker": textOrNull(deal.broker),
    "deal.owner": textOrNull(deal.owner),
    "deal.askingPrice": moneyOrNull(deal.askingPrice),
    "deal.dealValue": moneyOrNull(deal.dealValue),
    "deal.revenue": moneyOrNull(deal.revenue),
    "deal.ebitda": moneyOrNull(deal.ebitda),
    "company.name": coreCompanyName ?? textOrNull(deal.companyName),
    "company.city": coreCompanyCity ?? textOrNull(deal.city),
    "fin.latestRevenue": finRevenue,
    "fin.latestEbitda": finEbitda,
    "fin.latestPeriodEnd": finPeriodEnd,
    "firm.name": FIRM_NAME,
    "date.today": todayLong,
    "date.year": year,
  };

  return {
    context,
    companyId,
    companyName:
      context["company.name"] ?? context["deal.companyName"] ?? dealId,
    dealId,
  };
}

/** Render a template body against the context. */
export function renderBody(
  body: string,
  context: Record<string, string | null>
): { text: string; unresolvedFields: string[] } {
  const unresolved = new Set<string>();
  const text = (body ?? "").replace(
    /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g,
    (_m, field: string) => {
      const value = context[field];
      if (value === null || value === undefined || value === "") {
        unresolved.add(field);
        return "—";
      }
      return value;
    }
  );
  return { text, unresolvedFields: Array.from(unresolved) };
}

/* --------------------------- PDF shaping ---------------------------- */

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 90) return false;
  if (/^[A-Z0-9][A-Z0-9 ,&'\/()\-–—:;]+$/.test(t) && /[A-Z]/.test(t)) {
    // All-caps lines are headings, except signature underscores etc.
    return !/^_+$/.test(t);
  }
  if (/^\d+\.\s+[A-Z]/.test(t)) return true;
  return false;
}

function wrapLine(line: string, width = 100): string[] {
  const t = line.trim();
  if (!t) return [];
  if (t.length <= width) return [t];
  const words = t.split(/\s+/);
  const out: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= width) cur += ` ${w}`;
    else {
      out.push(cur);
      cur = w;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function bodyToPdfInput(
  template: DocgenTemplateRow,
  rendered: string,
  companyName: string,
  todayLong: string
): SimplePdfInput {
  const sections: SimplePdfInput["sections"] = [];
  let heading = template.name;
  let rows: string[][] = [];
  const flush = () => {
    if (rows.length) sections.push({ heading, rows });
    rows = [];
  };
  for (const rawLine of rendered.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (isHeadingLine(line)) {
      flush();
      heading = line.trim();
      continue;
    }
    for (const part of wrapLine(line)) rows.push([part]);
  }
  flush();
  if (!sections.length) {
    sections.push({ heading: template.name, rows: [["(no content)"]] });
  }
  return {
    title: `${template.name} — ${companyName}`,
    subtitle: `${FIRM_NAME} · ${todayLong}`,
    sections,
  };
}

/* ----------------------------- generate ----------------------------- */

export interface GenerateResult {
  documentId: string;
  documentName: string;
  version: number;
  roomId: string | null;
  unresolvedFields: string[];
  generationId: string;
  templateId: string;
  templateKey: string;
  dealId: string;
  companyId: string | null;
}

export async function generateDocument(input: {
  templateId?: string;
  templateKey?: string;
  dealId: string;
  actor: string;
}): Promise<GenerateResult> {
  await ensureDocgen();
  const dealId = (input.dealId ?? "").trim();
  if (!dealId) throw new DocGenError("deal_required");

  let template: DocgenTemplateRow | null = null;
  if (input.templateId) template = await getTemplateById(input.templateId);
  else if (input.templateKey)
    template = await getTemplateByKey(input.templateKey.trim());
  if (!template) throw new DocGenError("template_not_found");

  const built = await buildContext(dealId);
  const { text, unresolvedFields } = renderBody(template.body, built.context);
  const todayLong = built.context["date.today"] ?? "";
  const pdfInput = bodyToPdfInput(
    template,
    text,
    built.companyName,
    todayLong
  );
  const buffer = buildSimplePdf(pdfInput);

  const generationId = newId();
  const filename = `${template.name} — ${built.companyName}.pdf`;
  const tempKey = `uploads/docgen-${generationId}.pdf`;
  const provider = getStorageProvider();
  await provider.put(tempKey, buffer);

  let roomId: string | null = null;
  try {
    const resolution = await getRoomResolutionByDeal(dealId);
    roomId = resolution.roomId;
  } catch (err) {
    console.error(
      "[docgen] room resolution failed for deal",
      dealId,
      err instanceof Error ? err.message : String(err)
    );
  }

  const { document, version } = await registerUploadedDocument({
    storageKey: tempKey,
    filename,
    mime: "application/pdf",
    sizeBytes: buffer.length,
    contentHash: sha256Hex(buffer),
    actor: input.actor,
    dealId,
    companyId: built.companyId,
    roomId,
    tags: ["generated", template.key],
  });

  const db = sql();
  await db`
    INSERT INTO docgen.generations
      (id, template_id, template_key, document_id, deal_id, company_id, actor)
    VALUES (${generationId}, ${template.id}, ${template.key},
      ${document.id}, ${dealId}, ${built.companyId}, ${input.actor})`;

  return {
    documentId: document.id,
    documentName: document.name,
    version,
    roomId,
    unresolvedFields,
    generationId,
    templateId: template.id,
    templateKey: template.key,
    dealId,
    companyId: built.companyId,
  };
}

/* ---------------------------- generations ---------------------------- */

function rowToGeneration(r: Record<string, unknown>): DocgenGenerationRow {
  return {
    id: str(r.id),
    templateId: r.template_id ? str(r.template_id) : null,
    templateKey: str(r.template_key),
    templateName: str(r.template_name),
    documentId: str(r.document_id),
    documentName: str(r.document_name),
    dealId: r.deal_id ? str(r.deal_id) : null,
    companyId: r.company_id ? str(r.company_id) : null,
    actor: str(r.actor),
    createdAt: isoOrNull(r.created_at) ?? "",
  };
}

export async function listGenerations(opts: {
  dealId?: string;
  companyId?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: DocgenGenerationRow[]; total: number }> {
  await ensureDocgen();
  const db = sql();
  const dealId = (opts.dealId ?? "").trim();
  const companyId = (opts.companyId ?? "").trim();
  const limit = Math.min(50, Math.max(1, opts.limit || 25));
  const offset = Math.max(0, opts.offset || 0);
  const countRows = await db`
    SELECT count(*)::int AS n FROM docgen.generations g
    WHERE (${dealId} = '' OR g.deal_id = ${dealId})
      AND (${companyId} = '' OR g.company_id = ${companyId})`;
  const total = countRows.length ? Number(countRows[0].n ?? 0) : 0;
  const rows = await db`
    SELECT g.id, g.template_id, g.template_key, g.document_id, g.deal_id,
      g.company_id, g.actor, g.created_at,
      coalesce(t.name, g.template_key) AS template_name,
      coalesce(d.name, '') AS document_name
    FROM docgen.generations g
    LEFT JOIN docgen.templates t ON t.id = g.template_id
    LEFT JOIN core.documents d ON d.id = g.document_id
    WHERE (${dealId} = '' OR g.deal_id = ${dealId})
      AND (${companyId} = '' OR g.company_id = ${companyId})
    ORDER BY g.created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  const items = rows.map((r) =>
    rowToGeneration(r as Record<string, unknown>)
  );
  logUsage("docgen_generations_list", items.length, JSON.stringify(items).length);
  return { items, total };
}
