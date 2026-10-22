import * as XLSX from "xlsx";
import { sql, newId, str, num, numOrNull, isoOrNull } from "../platform/db";
import { publishEvent, onEvent } from "../platform/events";
import { enqueueJob } from "../platform/jobs";
import { logUsage } from "../platform/usage";
import { getDocument } from "../dataroom/documents";
import { getDocumentText } from "../dataroom/extract";
import { writeActivity } from "../dataroom/service";
import { getStorageProvider } from "../storage";
import { ensureFinancials } from "./schema";
import {
  LINE_DEFS,
  mapLabelToLine,
  computeDerivedLines,
  runChecks,
} from "./template";
import { parseFinancialDocument, type ParsedDoc } from "./parse";
import { buildSimplePdf } from "./pdf";

export { ensureFinancials };

/**
 * Financials service (Phase 4, workstream B) — statement sets, lines,
 * extraction orchestration, posting, summaries, comparison, export.
 *
 * Binding spec: phase4-build-2026-10-21.md (Data model / Service /
 * Template lines / API routes sections).
 *
 * Error convention: service functions throw `Error` whose message is
 * the contract error code (routes map codes to HTTP statuses), EXCEPT
 * extractFromDocument, which returns a status object per the contract.
 * postSet's EBITDA validation throws an Error with message
 * 'ebitda_override_required' that ALSO carries the contract's detail
 * fields (error / ebitdaStated / ebitdaComputed / ebitdaVariance) as
 * own properties, so a route can serialize either shape.
 *
 * Financial figures NEVER appear in console output — ids/statuses only.
 */

type ParsedPeriod = ParsedDoc["periods"][number];
type ParsedLine = ParsedPeriod["lines"][number];

/* ------------------------------- types ------------------------------ */

export type StatementKind = "is" | "bs" | "cf";
export type SetLayer = "reported" | "adjusted";
export type SetStatus = "draft" | "posted";

export interface FinancialChecks {
  bsPresent?: boolean;
  bsBalanced?: boolean | null;
  bsVariance?: number | null;
  ebitdaStated?: number | null;
  ebitdaComputed?: number | null;
  ebitdaVariance?: number | null;
  ebitdaReconciles?: boolean | null;
  cfTies?: boolean | null;
  cfVariance?: number | null;
  flags: string[];
  [key: string]: unknown;
}

export interface StatementSet {
  id: string;
  seriesId: string;
  companyId: string;
  dealId: string | null;
  documentId: string | null;
  layer: string;
  basedOnSetId: string | null;
  version: number;
  supersedesId: string | null;
  restateReason: string;
  status: string;
  isCurrent: boolean;
  extractionStatus: string;
  statementKinds: string[];
  periodType: string;
  periodStart: string | null;
  periodEnd: string | null;
  fiscalYearEnd: string;
  basis: string;
  currency: string;
  unitMultiplier: number;
  unitsLabel: string;
  checks: FinancialChecks;
  ebitdaOverrideNote: string;
  extraction: Record<string, unknown>;
  createdBy: string;
  postedBy: string | null;
  postedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StatementLine {
  id: string;
  setId: string;
  statementKind: string;
  lineKey: string;
  label: string;
  value: number | null;
  rawValue: number | null;
  isDerived: boolean;
  isSubtotal: boolean;
  confidence: number | null;
  source: Record<string, unknown>;
  sort: number;
  createdAt: string;
  updatedAt: string;
}

export interface ExtractResult {
  status: string;
  sets: StatementSet[];
  note?: string;
  jobId?: string;
}

export interface CompanySummaryPeriod {
  setId: string;
  seriesId: string;
  layer: string;
  periodType: string;
  periodStart: string | null;
  periodEnd: string | null;
  basis: string;
  kinds: string[];
  flags: string[];
  adjustedSetId?: string;
}

export interface CompanySummaryKpi {
  revenue: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  ebitda: number | null;
  ebitdaMarginPct: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  cfo: number | null;
  cashEnd: number | null;
}

export interface CompanyFinancialSummary {
  periods: CompanySummaryPeriod[];
  kpis: Record<string, CompanySummaryKpi>;
  chartSeries: Array<{
    label: string;
    periodEnd: string | null;
    revenue: number | null;
    ebitda: number | null;
    grossMarginPct: number | null;
    ebitdaMarginPct: number | null;
  }>;
  ttm: {
    periodEnd: string | null;
    revenue: number | null;
    ebitda: number | null;
    netIncome: number | null;
    cfo: number | null;
  } | null;
  yoy: { revenuePct: number | null; ebitdaPct: number | null } | null;
  latest: {
    periodEnd: string | null;
    revenue: number | null;
    ebitda: number | null;
    netIncome: number | null;
  } | null;
  flags: string[];
  updatedAt: string;
}

export class FinancialsError extends Error {
  error: string;
  ebitdaStated?: number | null;
  ebitdaComputed?: number | null;
  ebitdaVariance?: number | null;
  constructor(
    code: string,
    details?: {
      ebitdaStated?: number | null;
      ebitdaComputed?: number | null;
      ebitdaVariance?: number | null;
    }
  ) {
    super(code);
    this.name = "FinancialsError";
    this.error = code;
    if (details) {
      this.ebitdaStated = details.ebitdaStated ?? null;
      this.ebitdaComputed = details.ebitdaComputed ?? null;
      this.ebitdaVariance = details.ebitdaVariance ?? null;
    }
  }
}

/* ------------------------------ helpers ----------------------------- */

const MAX_SYNC_BYTES = 5 * 1024 * 1024;
const OCR_GAP_NOTE =
  "Image OCR is not configured: no OCR provider (e.g. Azure AI Document Intelligence) is connected";

function parseJsonObj(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v) as unknown;
      if (p && typeof p === "object" && !Array.isArray(p)) {
        return p as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}

function parseJsonArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean);
  if (typeof v === "string" && v.trim()) {
    try {
      const p = JSON.parse(v) as unknown;
      if (Array.isArray(p)) return p.map((x) => String(x)).filter(Boolean);
    } catch {
      /* fall through */
    }
  }
  return [];
}

function parseChecks(v: unknown): FinancialChecks {
  const obj = parseJsonObj(v);
  const flags = Array.isArray(obj.flags)
    ? obj.flags.map((x) => String(x)).filter(Boolean)
    : [];
  return { ...(obj as FinancialChecks), flags };
}

/** DATE columns come back as Date or 'YYYY-MM-DD...' strings. */
function dateOnly(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function rowToSet(r: Record<string, unknown>): StatementSet {
  return {
    id: str(r.id),
    seriesId: str(r.series_id),
    companyId: str(r.company_id),
    dealId: r.deal_id ? str(r.deal_id) : null,
    documentId: r.document_id ? str(r.document_id) : null,
    layer: str(r.layer) || "reported",
    basedOnSetId: r.based_on_set_id ? str(r.based_on_set_id) : null,
    version: num(r.version) || 1,
    supersedesId: r.supersedes_id ? str(r.supersedes_id) : null,
    restateReason: str(r.restate_reason),
    status: str(r.status) || "draft",
    isCurrent: Boolean(r.is_current),
    extractionStatus: str(r.extraction_status) || "pending",
    statementKinds: parseJsonArr(r.statement_kinds),
    periodType: str(r.period_type) || "annual",
    periodStart: dateOnly(r.period_start),
    periodEnd: dateOnly(r.period_end),
    fiscalYearEnd: str(r.fiscal_year_end),
    basis: str(r.basis) || "COMPANY-PREPARED",
    currency: str(r.currency) || "USD",
    unitMultiplier: num(r.unit_multiplier) || 1,
    unitsLabel: str(r.units_label),
    checks: parseChecks(r.checks),
    ebitdaOverrideNote: str(r.ebitda_override_note),
    extraction: parseJsonObj(r.extraction),
    createdBy: str(r.created_by),
    postedBy: r.posted_by ? str(r.posted_by) : null,
    postedAt: isoOrNull(r.posted_at),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

function rowToLine(r: Record<string, unknown>): StatementLine {
  return {
    id: str(r.id),
    setId: str(r.set_id),
    statementKind: str(r.statement_kind),
    lineKey: str(r.line_key),
    label: str(r.label),
    value: numOrNull(r.value),
    rawValue: numOrNull(r.raw_value),
    isDerived: Boolean(r.is_derived),
    isSubtotal: Boolean(r.is_subtotal),
    confidence: numOrNull(r.confidence),
    source: parseJsonObj(r.source),
    sort: num(r.sort),
    createdAt: isoOrNull(r.created_at) ?? "",
    updatedAt: isoOrNull(r.updated_at) ?? "",
  };
}

const SET_COLS = `
  id, series_id, company_id, deal_id, document_id, layer,
  based_on_set_id, version, supersedes_id, restate_reason, status,
  is_current, extraction_status, statement_kinds, period_type,
  period_start, period_end, fiscal_year_end, basis, currency,
  unit_multiplier, units_label, checks, ebitda_override_note,
  extraction, created_by, posted_by, posted_at, created_at, updated_at`;

const LINE_COLS = `
  id, set_id, statement_kind, line_key, label, value, raw_value,
  is_derived, is_subtotal, confidence, source, sort, created_at, updated_at`;

async function fetchSetRow(id: string): Promise<StatementSet | null> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SET_COLS)} FROM financials.statement_sets
    WHERE id = ${id} AND deleted_at IS NULL LIMIT 1`;
  return rows.length ? rowToSet(rows[0] as Record<string, unknown>) : null;
}

async function fetchLines(setId: string): Promise<StatementLine[]> {
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(LINE_COLS)} FROM financials.lines
    WHERE set_id = ${setId}
    ORDER BY statement_kind ASC, sort ASC, created_at ASC`;
  return rows.map((r) => rowToLine(r as Record<string, unknown>));
}

async function insertLineRow(line: StatementLine): Promise<void> {
  const db = sql();
  await db`
    INSERT INTO financials.lines
      (id, set_id, statement_kind, line_key, label, value, raw_value,
        is_derived, is_subtotal, confidence, source, sort)
    VALUES (${line.id}, ${line.setId}, ${line.statementKind},
      ${line.lineKey}, ${line.label}, ${line.value}, ${line.rawValue},
      ${line.isDerived}, ${line.isSubtotal}, ${line.confidence},
      ${JSON.stringify(line.source ?? {})}::jsonb, ${line.sort})`;
}

/* --------------------- template adapter layer ----------------------- */
/**
 * Workstream A's template functions operate on their own line shape.
 * We pass lines carrying BOTH naming conventions (kind +
 * statementKind, lineKey) and normalize whatever comes back, so the
 * service is insensitive to which spelling the template layer uses
 * internally.
 */
type TemplateLineShape = Record<string, unknown>;

function toTemplateLine(l: StatementLine): TemplateLineShape {
  return {
    id: l.id,
    setId: l.setId,
    kind: l.statementKind,
    statementKind: l.statementKind,
    statement_kind: l.statementKind,
    lineKey: l.lineKey,
    line_key: l.lineKey,
    label: l.label,
    value: l.value,
    rawValue: l.rawValue,
    raw_value: l.rawValue,
    isDerived: l.isDerived,
    is_derived: l.isDerived,
    isSubtotal: l.isSubtotal,
    is_subtotal: l.isSubtotal,
    confidence: l.confidence,
    source: l.source,
    sort: l.sort,
  };
}

function fromTemplateLine(
  t: TemplateLineShape,
  setId: string,
  fallbackSort: number
): StatementLine {
  const kindRaw =
    (t.statementKind as string) ?? (t.kind as string) ?? (t.statement_kind as string) ?? "is";
  const confRaw = t.confidence;
  return {
    id: typeof t.id === "string" && t.id ? t.id : newId(),
    setId,
    statementKind: String(kindRaw || "is"),
    lineKey: String((t.lineKey as string) ?? (t.line_key as string) ?? "unmapped"),
    label: String(t.label ?? ""),
    value: numOrNull(t.value),
    rawValue: numOrNull(t.rawValue ?? t.raw_value),
    isDerived: Boolean(t.isDerived ?? t.is_derived),
    isSubtotal: Boolean(t.isSubtotal ?? t.is_subtotal),
    confidence:
      confRaw === null || confRaw === undefined ? null : numOrNull(confRaw),
    source:
      t.source && typeof t.source === "object"
        ? (t.source as Record<string, unknown>)
        : {},
    sort:
      t.sort === null || t.sort === undefined ? fallbackSort : num(t.sort),
    createdAt: "",
    updatedAt: "",
  };
}

interface LineDefShape {
  key: string;
  label?: string;
  kind?: string;
  isSubtotal?: boolean;
}

function lineDefFor(lineKey: string): LineDefShape | null {
  const defs = LINE_DEFS as unknown;
  if (Array.isArray(defs)) {
    for (const d of defs as Array<Record<string, unknown>>) {
      if (d && String(d.key ?? "") === lineKey) {
        return {
          key: lineKey,
          label: d.label ? String(d.label) : undefined,
          kind: d.kind ? String(d.kind) : undefined,
          isSubtotal: Boolean(d.isSubtotal ?? d.is_subtotal),
        };
      }
    }
    return null;
  }
  if (defs && typeof defs === "object") {
    const rec = (defs as Record<string, Record<string, unknown>>)[lineKey];
    if (rec) {
      return {
        key: lineKey,
        label: rec.label ? String(rec.label) : undefined,
        kind: rec.kind ? String(rec.kind) : undefined,
        isSubtotal: Boolean(rec.isSubtotal ?? rec.is_subtotal),
      };
    }
  }
  return null;
}

/**
 * Recompute derived lines + checks for a line list.
 * Derived lines are regenerated from the non-derived lines; the
 * persisted/user lines are never mutated in place — a merged list is
 * returned (originals first-class, derived appended/replaced).
 */
function recomputeDerivedAndChecks(
  lines: StatementLine[],
  set: StatementSet
): { lines: StatementLine[]; checks: FinancialChecks } {
  const base = lines.filter((l) => !l.isDerived);
  let merged: StatementLine[] = [...base];
  try {
    const input = base.map(toTemplateLine);
    const out = (computeDerivedLines as unknown as (ls: TemplateLineShape[]) => unknown)(
      input
    );
    if (Array.isArray(out)) {
      const normalized = (out as TemplateLineShape[]).map((t, i) =>
        fromTemplateLine(t, set.id, base.length + i)
      );
      const baseKeys = new Set(
        base.map((l) => `${l.statementKind}|${l.lineKey}|${l.id}`)
      );
      const derivedOnly = normalized.filter(
        (l) => l.isDerived || !baseKeys.has(`${l.statementKind}|${l.lineKey}|${l.id}`)
      );
      // If the template returned the full list flagged correctly, prefer
      // its derived entries; de-dupe against base by (kind, lineKey).
      const derivedKeys = new Set(
        derivedOnly.map((l) => `${l.statementKind}|${l.lineKey}`)
      );
      void derivedKeys;
      merged = [...base, ...derivedOnly.filter((l) => l.isDerived)];
      // Template implementations that return new-but-unflagged lines
      // (key absent from base) are also honored as derived.
      if (!derivedOnly.some((l) => l.isDerived)) {
        const baseLineKeys = new Set(
          base.map((l) => `${l.statementKind}|${l.lineKey}`)
        );
        const extras = normalized.filter(
          (l) => !baseLineKeys.has(`${l.statementKind}|${l.lineKey}`)
        );
        merged = [
          ...base,
          ...extras.map((l) => ({ ...l, isDerived: true })),
        ];
      }
    }
  } catch (err) {
    console.error("[financials] computeDerivedLines failed for set", set.id, err);
  }
  let checks: FinancialChecks = { flags: [] };
  try {
    const raw = (runChecks as unknown as (ls: TemplateLineShape[], s: unknown) => unknown)(
      merged.map(toTemplateLine),
      set
    );
    if (raw && typeof raw === "object") {
      checks = parseChecks(raw);
    }
  } catch (err) {
    console.error("[financials] runChecks failed for set", set.id, err);
  }
  return { lines: merged, checks };
}

function kindsOf(lines: StatementLine[]): string[] {
  const out: string[] = [];
  for (const l of lines) {
    if (l.statementKind && !out.includes(l.statementKind)) {
      out.push(l.statementKind);
    }
  }
  return out;
}

function formatSource(source: Record<string, unknown>): string {
  if (!source || typeof source !== "object") return "";
  const parts: string[] = [];
  const sheet = source.sheet ? String(source.sheet) : "";
  const cell = source.cell ? String(source.cell) : "";
  if (sheet && cell) parts.push(`${sheet}!${cell}`);
  else if (cell) parts.push(cell);
  else if (sheet) parts.push(sheet);
  if (source.page !== undefined && source.page !== null && source.page !== "") {
    parts.push(`p.${String(source.page)}`);
  }
  if (source.line !== undefined && source.line !== null && source.line !== "") {
    parts.push(`line ${String(source.line)}`);
  }
  if (source.snippet) parts.push(String(source.snippet).slice(0, 60));
  if (!parts.length && source.documentId) parts.push(String(source.documentId));
  return parts.join(" · ");
}

function fmtMoney(v: number | null): string {
  if (v === null || v === undefined || !isFinite(v)) return "";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(v);
}

function pctChange(next: number | null, prev: number | null): number | null {
  if (next === null || prev === null || prev === 0) return null;
  return ((next - prev) / Math.abs(prev)) * 100;
}

function pctOf(part: number | null, whole: number | null): number | null {
  if (part === null || whole === null || whole === 0) return null;
  return (part / whole) * 100;
}

/* --------------------------- set creation --------------------------- */

/**
 * Create draft statement sets from a parsed document — one set per
 * parsed period. Line values are normalized with the period's
 * unit_multiplier (value = rawValue × multiplier); the raw value is
 * stored alongside. Derived lines + checks are computed before save.
 */
export async function createSetsFromParsed(
  companyId: string,
  dealId: string | null,
  documentId: string | null,
  parsed: ParsedDoc,
  actor: string
): Promise<StatementSet[]> {
  await ensureFinancials();
  const db = sql();
  const out: StatementSet[] = [];
  const periods = Array.isArray(parsed.periods) ? parsed.periods : [];
  for (const period of periods) {
    const pLines = Array.isArray(period.lines) ? period.lines : [];
    if (!pLines.length) continue;
    const unitMultiplier =
      num((period as ParsedPeriod).unitMultiplier) || 1;
    const setId = newId();
    const seriesId = newId();
    const draft: StatementSet = {
      id: setId,
      seriesId,
      companyId,
      dealId: dealId ?? null,
      documentId: documentId ?? null,
      layer: "reported",
      basedOnSetId: null,
      version: 1,
      supersedesId: null,
      restateReason: "",
      status: "draft",
      isCurrent: false,
      extractionStatus: parsed.status === "done" ? "done" : parsed.status,
      statementKinds: Array.isArray(period.kinds)
        ? period.kinds.map((k) => String(k)).filter(Boolean)
        : [],
      periodType: String(period.periodType || "annual"),
      periodStart: period.periodStart ? String(period.periodStart).slice(0, 10) : null,
      periodEnd: period.periodEnd ? String(period.periodEnd).slice(0, 10) : null,
      fiscalYearEnd: String(period.fiscalYearEnd || ""),
      basis: String(period.basis || "COMPANY-PREPARED"),
      currency: String(period.currency || "USD"),
      unitMultiplier,
      unitsLabel: String(period.unitsLabel || ""),
      checks: { flags: [] },
      ebitdaOverrideNote: "",
      extraction: {
        extractor: parsed.extractor ?? "",
        status: parsed.status,
        notes: Array.isArray(parsed.notes) ? parsed.notes : [],
        documentId: documentId ?? "",
      },
      createdBy: actor,
      postedBy: null,
      postedAt: null,
      createdAt: "",
      updatedAt: "",
    };

    const baseLines: StatementLine[] = pLines.map(
      (pl: ParsedLine, idx: number) => {
        const rawValue = numOrNull((pl as ParsedLine).rawValue);
        const lineKey = String(pl.lineKey || "unmapped");
        const kind = String(pl.kind || "is");
        const def = lineDefFor(lineKey);
        const src =
          pl.source && typeof pl.source === "object"
            ? { ...(pl.source as Record<string, unknown>) }
            : {};
        if (documentId && !src.documentId) src.documentId = documentId;
        return {
          id: newId(),
          setId,
          statementKind: kind,
          lineKey,
          label: String(pl.label || def?.label || lineKey),
          value: rawValue === null ? null : rawValue * unitMultiplier,
          rawValue,
          isDerived: false,
          isSubtotal: def ? Boolean(def.isSubtotal) : false,
          confidence:
            pl.confidence === null || pl.confidence === undefined
              ? null
              : numOrNull(pl.confidence),
          source: src,
          sort: idx,
          createdAt: "",
          updatedAt: "",
        };
      }
    );

    const { lines: withDerived, checks } = recomputeDerivedAndChecks(
      baseLines,
      draft
    );
    const kinds = draft.statementKinds.length
      ? draft.statementKinds
      : kindsOf(withDerived);
    draft.statementKinds = kinds;
    draft.checks = checks;

    await db`
      INSERT INTO financials.statement_sets
        (id, series_id, company_id, deal_id, document_id, layer,
          based_on_set_id, version, supersedes_id, restate_reason, status,
          is_current, extraction_status, statement_kinds, period_type,
          period_start, period_end, fiscal_year_end, basis, currency,
          unit_multiplier, units_label, checks, ebitda_override_note,
          extraction, created_by)
      VALUES (${draft.id}, ${draft.seriesId}, ${draft.companyId},
        ${draft.dealId}, ${draft.documentId}, ${draft.layer},
        ${draft.basedOnSetId}, ${draft.version}, ${draft.supersedesId},
        ${draft.restateReason}, ${draft.status}, ${draft.isCurrent},
        ${draft.extractionStatus},
        ${JSON.stringify(draft.statementKinds)}::jsonb, ${draft.periodType},
        ${draft.periodStart}, ${draft.periodEnd}, ${draft.fiscalYearEnd},
        ${draft.basis}, ${draft.currency}, ${draft.unitMultiplier},
        ${draft.unitsLabel}, ${JSON.stringify(checks)}::jsonb,
        ${draft.ebitdaOverrideNote},
        ${JSON.stringify(draft.extraction)}::jsonb, ${draft.createdBy})`;
    for (const line of withDerived) {
      await insertLineRow(line);
    }
    const saved = await fetchSetRow(setId);
    if (saved) out.push(saved);
  }
  return out;
}

/* ---------------------------- extraction ---------------------------- */

async function extractSync(opts: {
  documentId: string;
  companyId: string;
  dealId: string | null;
  actor: string;
}): Promise<ExtractResult> {
  const doc = await getDocument(opts.documentId);
  if (!doc) throw new Error("document_not_found");
  const mime = (doc.mime || "").toLowerCase();
  if (mime.startsWith("image/")) {
    return { status: "unsupported", sets: [], note: OCR_GAP_NOTE };
  }

  let parsed: ParsedDoc | null = null;
  let bytesError = "";
  if (doc.storageUrl) {
    try {
      const bytes = await getStorageProvider().get(doc.storageUrl);
      parsed = await parseFinancialDocument({
        bytes,
        mime: doc.mime,
        filename: doc.name,
        documentId: opts.documentId,
      } as Parameters<typeof parseFinancialDocument>[0]);
    } catch (err) {
      bytesError = err instanceof Error ? err.message : String(err);
      console.error(
        "[financials] byte read/parse failed for document",
        opts.documentId,
        bytesError
      );
    }
  }
  // Fall back to the dataroom extracted text when bytes are unavailable
  // or the byte parse produced no text (metadata-only / interim store).
  if (!parsed || parsed.status === "empty" || parsed.status === "failed") {
    try {
      const dt = await getDocumentText(opts.documentId);
      if (dt.text) {
        const viaText = await parseFinancialDocument({
          text: dt.text,
          extractor: dt.extractor,
          mime: doc.mime,
          filename: doc.name,
          documentId: opts.documentId,
        } as Parameters<typeof parseFinancialDocument>[0]);
        if (!parsed || viaText.status === "done" || parsed.status !== "done") {
          if (viaText.status === "done" || !parsed) parsed = viaText;
        }
      }
    } catch (err) {
      console.error(
        "[financials] text fallback failed for document",
        opts.documentId,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  if (!parsed) {
    return {
      status: "failed",
      sets: [],
      note: bytesError || "Extraction failed",
    };
  }
  const note =
    Array.isArray(parsed.notes) && parsed.notes.length
      ? parsed.notes.join(" ")
      : undefined;
  if (parsed.status === "unsupported") {
    return { status: "unsupported", sets: [], note: note || OCR_GAP_NOTE };
  }
  if (parsed.status === "failed") {
    return { status: "failed", sets: [], note };
  }
  if (parsed.status === "empty") {
    return {
      status: "empty",
      sets: [],
      note:
        note ||
        "No financial statement lines could be parsed from this document.",
    };
  }
  const sets = await createSetsFromParsed(
    opts.companyId,
    opts.dealId,
    opts.documentId,
    parsed,
    opts.actor
  );
  if (!sets.length) {
    return { status: "empty", sets: [], note };
  }
  return { status: "done", sets, note };
}

/**
 * Extract financial statement sets from an uploaded document.
 * Sync path for documents up to 5MB; larger documents are queued as a
 * core.jobs 'extract_financials' job. Images return 'unsupported' with
 * the named OCR gap. Company is resolved from the document when the
 * caller does not pass one.
 */
export async function extractFromDocument(opts: {
  documentId: string;
  companyId?: string;
  dealId?: string;
  actor: string;
}): Promise<ExtractResult> {
  await ensureFinancials();
  const doc = await getDocument(opts.documentId);
  if (!doc) throw new Error("document_not_found");
  const companyId = opts.companyId || doc.companyId || "";
  if (!companyId) throw new Error("company_required");
  const dealId = opts.dealId || doc.dealId || null;
  const mime = (doc.mime || "").toLowerCase();
  if (mime.startsWith("image/")) {
    return { status: "unsupported", sets: [], note: OCR_GAP_NOTE };
  }
  if (doc.sizeBytes > MAX_SYNC_BYTES) {
    const jobId = await enqueueJob("extract_financials", {
      documentId: opts.documentId,
      companyId,
      dealId: dealId ?? "",
      actor: opts.actor,
    });
    return { status: "queued", sets: [], jobId };
  }
  return extractSync({
    documentId: opts.documentId,
    companyId,
    dealId,
    actor: opts.actor,
  });
}

/** Job entry for core.jobs kind 'extract_financials' (see jobs.ts). */
export async function runFinancialExtractionJob(
  payload: Record<string, unknown>
): Promise<ExtractResult> {
  await ensureFinancials();
  const documentId = str(payload.documentId ?? payload.document_id);
  if (!documentId) throw new Error("document_required");
  const doc = await getDocument(documentId);
  if (!doc) throw new Error("document_not_found");
  const companyId =
    str(payload.companyId ?? payload.company_id) || doc.companyId || "";
  if (!companyId) throw new Error("company_required");
  const dealIdRaw = str(payload.dealId ?? payload.deal_id) || doc.dealId || "";
  const actor = str(payload.actor) || "system";
  // Job path always extracts synchronously (no re-queue), regardless of
  // document size — the 5MB gate lives in extractFromDocument only.
  return extractSync({
    documentId,
    companyId,
    dealId: dealIdRaw || null,
    actor,
  });
}

/* ------------------------------ reads ------------------------------- */

export async function listSets(opts: {
  companyId: string;
  status?: string;
  layer?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: StatementSet[]; total: number }> {
  await ensureFinancials();
  const db = sql();
  const companyId = (opts.companyId ?? "").trim();
  const status = (opts.status ?? "").trim();
  const layer = (opts.layer ?? "").trim();
  const limit = Math.min(50, Math.max(1, opts.limit || 25));
  const offset = Math.max(0, opts.offset || 0);
  const countRows = await db`
    SELECT count(*)::int AS n FROM financials.statement_sets
    WHERE deleted_at IS NULL
      AND (${companyId} = '' OR company_id = ${companyId})
      AND (${status} = '' OR status = ${status})
      AND (${layer} = '' OR layer = ${layer})`;
  const total = countRows.length ? num(countRows[0].n) : 0;
  const rows = await db`
    SELECT ${db.unsafe(SET_COLS)} FROM financials.statement_sets
    WHERE deleted_at IS NULL
      AND (${companyId} = '' OR company_id = ${companyId})
      AND (${status} = '' OR status = ${status})
      AND (${layer} = '' OR layer = ${layer})
    ORDER BY period_end DESC NULLS LAST, created_at DESC
    LIMIT ${limit} OFFSET ${offset}`;
  const items = rows.map((r) => rowToSet(r as Record<string, unknown>));
  logUsage("financials_sets_list", items.length, JSON.stringify(items).length);
  return { items, total };
}

/**
 * Fetch one set with its lines. Drafts get derived lines + checks
 * recomputed on read (in memory — nothing is persisted by a read).
 * Returns null when the set does not exist (codebase convention).
 */
export async function getSet(
  id: string
): Promise<{ set: StatementSet; lines: StatementLine[] } | null> {
  await ensureFinancials();
  const set = await fetchSetRow(id);
  if (!set) return null;
  let lines = await fetchLines(id);
  if (set.status === "draft") {
    const recomputed = recomputeDerivedAndChecks(lines, set);
    lines = recomputed.lines;
    set.checks = recomputed.checks;
  }
  return { set, lines };
}

/* ------------------------------ update ------------------------------ */

export interface SetMetadataPatch {
  periodType?: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  fiscalYearEnd?: string;
  basis?: string;
  currency?: string;
  unitMultiplier?: number;
  unitsLabel?: string;
  statementKinds?: string[];
  ebitdaOverrideNote?: string;
  dealId?: string | null;
  documentId?: string | null;
}

export interface LinePatch {
  id?: string;
  statementKind?: string;
  kind?: string;
  lineKey?: string;
  label?: string;
  value?: number | null;
  rawValue?: number | null;
  confidence?: number | null;
  source?: Record<string, unknown>;
  sort?: number;
  isSubtotal?: boolean;
  deleted?: boolean;
}

/**
 * Edit a DRAFT set: metadata patch plus line upserts (by id), new
 * lines (no id), and deletions (deleted: true). Derived lines and
 * checks are recomputed and persisted before return. Posted sets are
 * immutable — throws Error('posted_immutable').
 */
export async function updateSet(
  id: string,
  input: {
    metadata?: SetMetadataPatch;
    lines?: LinePatch[];
    ebitdaOverrideNote?: string;
    actor: string;
  }
): Promise<{ set: StatementSet; lines: StatementLine[] }> {
  await ensureFinancials();
  const db = sql();
  const set = await fetchSetRow(id);
  if (!set) throw new Error("set_not_found");
  if (set.status !== "draft") throw new Error("posted_immutable");

  const metadata: SetMetadataPatch = { ...(input.metadata ?? {}) };
  if (input.ebitdaOverrideNote !== undefined) {
    metadata.ebitdaOverrideNote = input.ebitdaOverrideNote;
  }

  // --- line edits -------------------------------------------------
  if (Array.isArray(input.lines)) {
    const existing = await fetchLines(id);
    const existingById = new Map(existing.map((l) => [l.id, l]));
    let maxSort = existing.reduce((m, l) => Math.max(m, l.sort), -1);
    for (const patch of input.lines) {
      if (patch.deleted) {
        if (patch.id) {
          await db`
            DELETE FROM financials.lines WHERE id = ${patch.id} AND set_id = ${id}`;
        }
        continue;
      }
      const kind = patch.statementKind || patch.kind || "";
      if (patch.id && existingById.has(patch.id)) {
        const cur = existingById.get(patch.id)!;
        // Derived lines are regenerated below; manual edits to them are
        // not persisted (they are computed values).
        if (cur.isDerived) continue;
        const next: StatementLine = {
          ...cur,
          statementKind: kind || cur.statementKind,
          lineKey:
            patch.lineKey !== undefined ? patch.lineKey : cur.lineKey,
          label: patch.label !== undefined ? patch.label : cur.label,
          value: patch.value !== undefined ? patch.value : cur.value,
          rawValue:
            patch.rawValue !== undefined ? patch.rawValue : cur.rawValue,
          confidence:
            patch.confidence !== undefined
              ? patch.confidence
              : cur.confidence,
          source: patch.source !== undefined ? patch.source : cur.source,
          sort: patch.sort !== undefined ? patch.sort : cur.sort,
          isSubtotal:
            patch.isSubtotal !== undefined
              ? patch.isSubtotal
              : cur.isSubtotal,
        };
        await db`
          UPDATE financials.lines SET
            statement_kind = ${next.statementKind},
            line_key = ${next.lineKey}, label = ${next.label},
            value = ${next.value}, raw_value = ${next.rawValue},
            confidence = ${next.confidence},
            source = ${JSON.stringify(next.source ?? {})}::jsonb,
            sort = ${next.sort}, is_subtotal = ${next.isSubtotal},
            updated_at = now()
          WHERE id = ${next.id} AND set_id = ${id}`;
      } else if (!patch.id) {
        maxSort += 1;
        let lineKey = patch.lineKey || "";
        let resolvedKind = kind;
        if (!lineKey && patch.label) {
          try {
            const mapped = (mapLabelToLine as unknown as (label: string) => {
              lineKey?: string;
              kind?: string;
            } | null)(patch.label);
            if (mapped?.lineKey) {
              lineKey = mapped.lineKey;
              if (!resolvedKind && mapped.kind) resolvedKind = mapped.kind;
            }
          } catch {
            /* mapping is best-effort */
          }
        }
        if (!lineKey) lineKey = "unmapped";
        if (!resolvedKind) resolvedKind = lineDefFor(lineKey)?.kind || "is";
        const def = lineDefFor(lineKey);
        const line: StatementLine = {
          id: newId(),
          setId: id,
          statementKind: resolvedKind,
          lineKey,
          label: patch.label ?? def?.label ?? lineKey,
          value: patch.value !== undefined ? patch.value : null,
          rawValue: patch.rawValue !== undefined ? patch.rawValue : null,
          isDerived: false,
          isSubtotal:
            patch.isSubtotal !== undefined
              ? patch.isSubtotal
              : def
                ? Boolean(def.isSubtotal)
                : false,
          confidence:
            patch.confidence !== undefined ? patch.confidence : null,
          source: patch.source ?? {},
          sort: patch.sort !== undefined ? patch.sort : maxSort,
          createdAt: "",
          updatedAt: "",
        };
        await insertLineRow(line);
      }
    }
  }

  // --- recompute derived + checks, persist derived -----------------
  const freshLines = await fetchLines(id);
  const { lines: merged, checks } = recomputeDerivedAndChecks(freshLines, set);
  const dbDerived = freshLines.filter((l) => l.isDerived);
  for (const d of dbDerived) {
    await db`DELETE FROM financials.lines WHERE id = ${d.id} AND set_id = ${id}`;
  }
  for (const d of merged.filter((l) => l.isDerived)) {
    await insertLineRow({ ...d, setId: id });
  }

  // --- metadata ----------------------------------------------------
  const next: StatementSet = {
    ...set,
    periodType: metadata.periodType ?? set.periodType,
    periodStart:
      metadata.periodStart !== undefined
        ? metadata.periodStart
          ? String(metadata.periodStart).slice(0, 10)
          : null
        : set.periodStart,
    periodEnd:
      metadata.periodEnd !== undefined
        ? metadata.periodEnd
          ? String(metadata.periodEnd).slice(0, 10)
          : null
        : set.periodEnd,
    fiscalYearEnd: metadata.fiscalYearEnd ?? set.fiscalYearEnd,
    basis: metadata.basis ?? set.basis,
    currency: metadata.currency ?? set.currency,
    unitMultiplier:
      metadata.unitMultiplier !== undefined
        ? num(metadata.unitMultiplier) || 1
        : set.unitMultiplier,
    unitsLabel: metadata.unitsLabel ?? set.unitsLabel,
    statementKinds:
      metadata.statementKinds !== undefined
        ? metadata.statementKinds
        : kindsOf(merged),
    ebitdaOverrideNote:
      metadata.ebitdaOverrideNote !== undefined
        ? metadata.ebitdaOverrideNote
        : set.ebitdaOverrideNote,
    dealId: metadata.dealId !== undefined ? metadata.dealId : set.dealId,
    documentId:
      metadata.documentId !== undefined
        ? metadata.documentId
        : set.documentId,
    checks,
  };
  await db`
    UPDATE financials.statement_sets SET
      period_type = ${next.periodType},
      period_start = ${next.periodStart},
      period_end = ${next.periodEnd},
      fiscal_year_end = ${next.fiscalYearEnd},
      basis = ${next.basis}, currency = ${next.currency},
      unit_multiplier = ${next.unitMultiplier},
      units_label = ${next.unitsLabel},
      statement_kinds = ${JSON.stringify(next.statementKinds)}::jsonb,
      ebitda_override_note = ${next.ebitdaOverrideNote},
      deal_id = ${next.dealId}, document_id = ${next.documentId},
      checks = ${JSON.stringify(checks)}::jsonb,
      updated_at = now()
    WHERE id = ${id}`;
  const saved = await getSet(id);
  if (!saved) throw new Error("set_not_found");
  return saved;
}

/* ------------------------- post / restate --------------------------- */

/**
 * Post a draft set. Validations: at least one line; EBITDA variance
 * beyond tolerance requires an override note (the set's stored note or
 * one supplied here) — otherwise throws FinancialsError with message /
 * .error = 'ebitda_override_required' plus ebitdaStated /
 * ebitdaComputed / ebitdaVariance fields. Balance-sheet imbalance is
 * flagged in checks only; it never blocks posting.
 * On success the set becomes the current posted set for its
 * (series, layer), financials_posted is published, the company summary
 * is refreshed, and an activity entry is written (no figures).
 */
export async function postSet(
  id: string,
  opts: { ebitdaOverrideNote?: string } | string,
  actorArg?: string
): Promise<{ set: StatementSet; lines: StatementLine[] }> {
  await ensureFinancials();
  const db = sql();
  const options: { ebitdaOverrideNote?: string } =
    typeof opts === "string" ? {} : (opts ?? {});
  const actor = typeof opts === "string" ? opts : (actorArg ?? "");
  const set = await fetchSetRow(id);
  if (!set) throw new Error("set_not_found");
  if (set.status !== "draft") throw new Error("posted_immutable");
  const lines = await fetchLines(id);
  if (!lines.length) throw new Error("no_lines");

  const { lines: merged, checks } = recomputeDerivedAndChecks(lines, set);
  void merged;
  const overrideNote =
    options.ebitdaOverrideNote !== undefined
      ? options.ebitdaOverrideNote
      : set.ebitdaOverrideNote;
  if (checks.ebitdaReconciles === false && !String(overrideNote ?? "").trim()) {
    throw new FinancialsError("ebitda_override_required", {
      ebitdaStated: checks.ebitdaStated ?? null,
      ebitdaComputed: checks.ebitdaComputed ?? null,
      ebitdaVariance: checks.ebitdaVariance ?? null,
    });
  }

  // Flip the prior current posted set in the same (series, layer).
  await db`
    UPDATE financials.statement_sets
    SET is_current = false, updated_at = now()
    WHERE series_id = ${set.seriesId} AND layer = ${set.layer}
      AND is_current = true AND id <> ${id} AND deleted_at IS NULL`;
  await db`
    UPDATE financials.statement_sets SET
      status = 'posted', is_current = true,
      posted_at = now(), posted_by = ${actor},
      ebitda_override_note = ${overrideNote ?? ""},
      checks = ${JSON.stringify(checks)}::jsonb,
      updated_at = now()
    WHERE id = ${id}`;

  const saved = await getSet(id);
  if (!saved) throw new Error("set_not_found");

  await publishEvent("financials_posted", {
    entityKind: "company",
    entityId: set.companyId,
    actor,
    payload: {
      companyId: set.companyId,
      setId: id,
      seriesId: set.seriesId,
      layer: set.layer,
      periodEnd: set.periodEnd ?? "",
    },
  });
  try {
    await refreshCompanyFinancialSummary(set.companyId);
  } catch (err) {
    console.error(
      "[financials] summary refresh failed for company",
      set.companyId,
      err instanceof Error ? err.message : String(err)
    );
  }
  await writeActivity(
    "company",
    set.companyId,
    actor,
    "financials_posted",
    `${actor} posted financial statements (${set.periodType} period ending ${set.periodEnd ?? "n/a"})`
  );
  return saved;
}

async function copySetAsDraft(opts: {
  source: StatementSet;
  layer: string;
  basedOnSetId: string | null;
  supersedesId: string | null;
  restateReason: string;
  actor: string;
}): Promise<{ set: StatementSet; lines: StatementLine[] }> {
  const db = sql();
  const sourceLines = await fetchLines(opts.source.id);
  const maxRows = await db`
    SELECT coalesce(max(version), 0)::int AS m
    FROM financials.statement_sets
    WHERE series_id = ${opts.source.seriesId} AND layer = ${opts.layer}
      AND deleted_at IS NULL`;
  const version = (maxRows.length ? num(maxRows[0].m) : 0) + 1;
  const newSetId = newId();
  const draft: StatementSet = {
    ...opts.source,
    id: newSetId,
    layer: opts.layer,
    basedOnSetId: opts.basedOnSetId,
    version,
    supersedesId: opts.supersedesId,
    restateReason: opts.restateReason,
    status: "draft",
    isCurrent: false,
    extractionStatus: "done",
    createdBy: opts.actor,
    postedBy: null,
    postedAt: null,
    createdAt: "",
    updatedAt: "",
  };
  await db`
    INSERT INTO financials.statement_sets
      (id, series_id, company_id, deal_id, document_id, layer,
        based_on_set_id, version, supersedes_id, restate_reason, status,
        is_current, extraction_status, statement_kinds, period_type,
        period_start, period_end, fiscal_year_end, basis, currency,
        unit_multiplier, units_label, checks, ebitda_override_note,
        extraction, created_by)
    VALUES (${draft.id}, ${draft.seriesId}, ${draft.companyId},
      ${draft.dealId}, ${draft.documentId}, ${draft.layer},
      ${draft.basedOnSetId}, ${draft.version}, ${draft.supersedesId},
      ${draft.restateReason}, ${draft.status}, ${draft.isCurrent},
      ${draft.extractionStatus},
      ${JSON.stringify(draft.statementKinds)}::jsonb, ${draft.periodType},
      ${draft.periodStart}, ${draft.periodEnd}, ${draft.fiscalYearEnd},
      ${draft.basis}, ${draft.currency}, ${draft.unitMultiplier},
      ${draft.unitsLabel}, ${JSON.stringify(draft.checks)}::jsonb,
      ${draft.ebitdaOverrideNote},
      ${JSON.stringify(draft.extraction)}::jsonb, ${draft.createdBy})`;
  for (const l of sourceLines) {
    await insertLineRow({ ...l, id: newId(), setId: newSetId });
  }
  const saved = await getSet(newSetId);
  if (!saved) throw new Error("set_not_found");
  return saved;
}

/**
 * Restate a POSTED set: creates a draft copy in the same series with
 * version = max+1 (per series+layer), supersedes_id pointing at the
 * original, and the restate reason recorded. The original is untouched.
 */
export async function restateSet(
  id: string,
  opts: { reason: string },
  actor: string
): Promise<{ set: StatementSet; lines: StatementLine[] }> {
  await ensureFinancials();
  const set = await fetchSetRow(id);
  if (!set) throw new Error("set_not_found");
  if (set.status !== "posted") throw new Error("not_posted");
  const result = await copySetAsDraft({
    source: set,
    layer: set.layer,
    basedOnSetId: null,
    supersedesId: id,
    restateReason: (opts?.reason ?? "").trim(),
    actor,
  });
  await writeActivity(
    "company",
    set.companyId,
    actor,
    "financials_restated",
    `${actor} created a restatement draft for a posted statement set`
  );
  return result;
}

/**
 * Create an adjusted-layer draft from a POSTED reported set: same
 * series, layer 'adjusted', based_on_set_id = source, version
 * max+1 within (series, 'adjusted') (1 when none exists yet).
 */
export async function createAdjustedDraft(
  id: string,
  actor: string
): Promise<{ set: StatementSet; lines: StatementLine[] }> {
  await ensureFinancials();
  const set = await fetchSetRow(id);
  if (!set) throw new Error("set_not_found");
  if (set.status !== "posted") throw new Error("not_posted");
  if (set.layer !== "reported") throw new Error("not_reported");
  const result = await copySetAsDraft({
    source: set,
    layer: "adjusted",
    basedOnSetId: id,
    supersedesId: null,
    restateReason: "",
    actor,
  });
  await writeActivity(
    "company",
    set.companyId,
    actor,
    "financials_adjusted_draft",
    `${actor} created an adjusted draft from a posted statement set`
  );
  return result;
}

/** Soft-delete a set. Posted deletes also refresh the summary. */
export async function deleteSet(id: string, actor: string): Promise<boolean> {
  await ensureFinancials();
  const db = sql();
  const set = await fetchSetRow(id);
  if (!set) return false;
  const rows = await db`
    UPDATE financials.statement_sets
    SET deleted_at = now(), is_current = false, updated_at = now()
    WHERE id = ${id} AND deleted_at IS NULL
    RETURNING id`;
  if (!rows.length) return false;
  await writeActivity(
    "company",
    set.companyId,
    actor,
    "financials_deleted",
    `${actor} deleted a financial statement set (${set.status})`
  );
  if (set.status === "posted") {
    try {
      await refreshCompanyFinancialSummary(set.companyId);
    } catch (err) {
      console.error(
        "[financials] summary refresh after delete failed for company",
        set.companyId,
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  return true;
}

/* ----------------------------- summary ------------------------------ */

function lineVal(lines: StatementLine[], lineKey: string): number | null {
  const hit = lines.find((l) => l.lineKey === lineKey);
  return hit ? hit.value : null;
}

function buildKpi(lines: StatementLine[]): CompanySummaryKpi {
  const revenue = lineVal(lines, "revenue");
  const grossProfit = lineVal(lines, "gross_profit");
  const ebitda = lineVal(lines, "ebitda");
  const cashEndCf = lineVal(lines, "cash_end");
  const cashBs = lineVal(lines, "cash");
  return {
    revenue,
    grossProfit,
    grossMarginPct: pctOf(grossProfit, revenue),
    ebitda,
    ebitdaMarginPct: pctOf(ebitda, revenue),
    netIncome: lineVal(lines, "net_income"),
    totalAssets: lineVal(lines, "total_assets"),
    totalLiabilities: lineVal(lines, "total_liabilities"),
    totalEquity: lineVal(lines, "total_equity"),
    cfo: lineVal(lines, "cfo"),
    cashEnd: cashEndCf ?? cashBs,
  };
}

function emptySummary(): CompanyFinancialSummary {
  return {
    periods: [],
    kpis: {},
    chartSeries: [],
    ttm: null,
    yoy: null,
    latest: null,
    flags: [],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Rebuild financials.company_summary for one company from its posted,
 * current sets. Reported layer is primary; the latest adjusted set for
 * a period is linked from periods[].adjustedSetId. TTM: sum of the
 * last 4 quarterly (or 12 monthly) flow values; failing that, with
 * >= 2 annual sets, the latest annual stands in as TTM. YoY compares
 * the latest two annual sets.
 */
export async function refreshCompanyFinancialSummary(
  companyId: string
): Promise<CompanyFinancialSummary> {
  await ensureFinancials();
  const db = sql();
  const rows = await db`
    SELECT ${db.unsafe(SET_COLS)} FROM financials.statement_sets
    WHERE company_id = ${companyId} AND deleted_at IS NULL
      AND status = 'posted' AND is_current = true
    ORDER BY period_end ASC NULLS FIRST, created_at ASC`;
  const sets = rows.map((r) => rowToSet(r as Record<string, unknown>));
  const summary = emptySummary();
  if (!sets.length) {
    await db`
      INSERT INTO financials.company_summary (company_id, data, updated_at)
      VALUES (${companyId}, ${JSON.stringify(summary)}::jsonb, now())
      ON CONFLICT (company_id) DO UPDATE SET
        data = EXCLUDED.data, updated_at = now()`;
    return summary;
  }

  const setIds = sets.map((s) => s.id);
  const lineRows = await db`
    SELECT ${db.unsafe(LINE_COLS)} FROM financials.lines
    WHERE set_id = ANY(${setIds})
    ORDER BY statement_kind ASC, sort ASC`;
  const linesBySet = new Map<string, StatementLine[]>();
  for (const r of lineRows) {
    const line = rowToLine(r as Record<string, unknown>);
    const list = linesBySet.get(line.setId) ?? [];
    list.push(line);
    linesBySet.set(line.setId, list);
  }

  const reported = sets.filter((s) => s.layer === "reported");
  const adjusted = sets.filter((s) => s.layer === "adjusted");
  const flagSet = new Set<string>();

  for (const s of reported) {
    for (const f of s.checks.flags ?? []) flagSet.add(f);
    const adj = adjusted
      .filter(
        (a) =>
          a.periodEnd === s.periodEnd && a.periodType === s.periodType
      )
      .sort((a, b) => b.version - a.version)[0];
    const period: CompanySummaryPeriod = {
      setId: s.id,
      seriesId: s.seriesId,
      layer: s.layer,
      periodType: s.periodType,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      basis: s.basis,
      kinds: s.statementKinds,
      flags: [...(s.checks.flags ?? [])],
    };
    if (adj) period.adjustedSetId = adj.id;
    summary.periods.push(period);
    const kpi = buildKpi(linesBySet.get(s.id) ?? []);
    summary.kpis[s.periodEnd || s.id] = kpi;
    summary.chartSeries.push({
      label: s.periodEnd || s.periodType,
      periodEnd: s.periodEnd,
      revenue: kpi.revenue,
      ebitda: kpi.ebitda,
      grossMarginPct: kpi.grossMarginPct,
      ebitdaMarginPct: kpi.ebitdaMarginPct,
    });
  }

  const byEndDesc = [...reported].sort((a, b) =>
    String(b.periodEnd ?? "") < String(a.periodEnd ?? "")
      ? -1
      : String(b.periodEnd ?? "") > String(a.periodEnd ?? "")
        ? 1
        : 0
  );
  const flowSum = (
    group: StatementSet[]
  ): { revenue: number | null; ebitda: number | null; netIncome: number | null; cfo: number | null } => {
    const sumKey = (key: string): number | null => {
      let total: number | null = null;
      for (const s of group) {
        const v = lineVal(linesBySet.get(s.id) ?? [], key);
        if (v !== null) total = (total ?? 0) + v;
      }
      return total;
    };
    return {
      revenue: sumKey("revenue"),
      ebitda: sumKey("ebitda"),
      netIncome: sumKey("net_income"),
      cfo: sumKey("cfo"),
    };
  };

  const quarterly = byEndDesc.filter((s) => s.periodType === "quarterly");
  const monthly = byEndDesc.filter((s) => s.periodType === "monthly");
  const annual = byEndDesc.filter((s) => s.periodType === "annual");
  if (quarterly.length >= 4) {
    const last4 = quarterly.slice(0, 4);
    summary.ttm = {
      periodEnd: last4[0].periodEnd,
      ...flowSum(last4),
    };
  } else if (monthly.length >= 12) {
    const last12 = monthly.slice(0, 12);
    summary.ttm = {
      periodEnd: last12[0].periodEnd,
      ...flowSum(last12),
    };
  } else if (annual.length >= 2) {
    const kpi = summary.kpis[annual[0].periodEnd || annual[0].id];
    summary.ttm = {
      periodEnd: annual[0].periodEnd,
      revenue: kpi?.revenue ?? null,
      ebitda: kpi?.ebitda ?? null,
      netIncome: kpi?.netIncome ?? null,
      cfo: kpi?.cfo ?? null,
    };
  }

  if (annual.length >= 2) {
    const latestKpi = summary.kpis[annual[0].periodEnd || annual[0].id];
    const priorKpi = summary.kpis[annual[1].periodEnd || annual[1].id];
    summary.yoy = {
      revenuePct: pctChange(latestKpi?.revenue ?? null, priorKpi?.revenue ?? null),
      ebitdaPct: pctChange(latestKpi?.ebitda ?? null, priorKpi?.ebitda ?? null),
    };
  }

  const latestSet = byEndDesc[0];
  if (latestSet) {
    const kpi = summary.kpis[latestSet.periodEnd || latestSet.id];
    summary.latest = {
      periodEnd: latestSet.periodEnd,
      revenue: kpi?.revenue ?? null,
      ebitda: kpi?.ebitda ?? null,
      netIncome: kpi?.netIncome ?? null,
    };
  }
  summary.flags = Array.from(flagSet);
  summary.updatedAt = new Date().toISOString();

  await db`
    INSERT INTO financials.company_summary (company_id, data, updated_at)
    VALUES (${companyId}, ${JSON.stringify(summary)}::jsonb, now())
    ON CONFLICT (company_id) DO UPDATE SET
      data = EXCLUDED.data, updated_at = now()`;
  return summary;
}

async function readSummary(
  companyId: string
): Promise<CompanyFinancialSummary | null> {
  const db = sql();
  const rows = await db`
    SELECT data FROM financials.company_summary
    WHERE company_id = ${companyId} LIMIT 1`;
  if (!rows.length) return null;
  const raw = (rows[0] as Record<string, unknown>).data;
  const obj =
    raw && typeof raw === "object"
      ? (raw as unknown as CompanyFinancialSummary)
      : typeof raw === "string"
        ? (JSON.parse(raw) as CompanyFinancialSummary)
        : null;
  if (!obj) return null;
  return {
    periods: Array.isArray(obj.periods) ? obj.periods : [],
    kpis: obj.kpis ?? {},
    chartSeries: Array.isArray(obj.chartSeries) ? obj.chartSeries : [],
    ttm: obj.ttm ?? null,
    yoy: obj.yoy ?? null,
    latest: obj.latest ?? null,
    flags: Array.isArray(obj.flags) ? obj.flags : [],
    updatedAt: obj.updatedAt ?? "",
  };
}

/**
 * Company financials read model: the pre-aggregated summary (rebuilt
 * when missing) plus the set index charts/UI need — posted current
 * sets and all drafts, selected columns only (no lines).
 */
export async function getCompanyFinancials(
  companyId: string
): Promise<{ summary: CompanyFinancialSummary; sets: StatementSet[] }> {
  await ensureFinancials();
  const db = sql();
  let summary = await readSummary(companyId);
  if (!summary) {
    summary = await refreshCompanyFinancialSummary(companyId);
  }
  const rows = await db`
    SELECT ${db.unsafe(SET_COLS)} FROM financials.statement_sets
    WHERE company_id = ${companyId} AND deleted_at IS NULL
      AND (is_current = true OR status = 'draft')
    ORDER BY period_end DESC NULLS LAST, created_at DESC
    LIMIT 50`;
  const sets = rows.map((r) => rowToSet(r as Record<string, unknown>));
  logUsage("financials_company", sets.length, JSON.stringify(summary).length);
  return { summary, sets };
}

/* ----------------------------- compare ------------------------------ */

export interface CompareRow {
  kind: string;
  lineKey: string;
  label: string;
  aValue: number | null;
  bValue: number | null;
  delta: number | null;
  deltaPct: number | null;
}

export async function compareSets(
  companyId: string,
  aId: string,
  bId: string
): Promise<{
  a: { set: StatementSet; lines: StatementLine[] };
  b: { set: StatementSet; lines: StatementLine[] };
  rows: CompareRow[];
}> {
  await ensureFinancials();
  const aRes = await getSet(aId);
  const bRes = await getSet(bId);
  if (!aRes || aRes.set.companyId !== companyId) {
    throw new Error("set_not_found");
  }
  if (!bRes || bRes.set.companyId !== companyId) {
    throw new Error("set_not_found");
  }
  const keyOf = (l: StatementLine) =>
    `${l.statementKind}|${l.lineKey}|${l.lineKey === "unmapped" ? l.label : ""}`;
  const aMap = new Map<string, StatementLine>();
  const bMap = new Map<string, StatementLine>();
  for (const l of aRes.lines) aMap.set(keyOf(l), l);
  for (const l of bRes.lines) bMap.set(keyOf(l), l);
  const keys: string[] = [];
  for (const k of [...Array.from(aMap.keys()), ...Array.from(bMap.keys())]) {
    if (!keys.includes(k)) keys.push(k);
  }
  const kindOrder: Record<string, number> = { is: 0, bs: 1, cf: 2 };
  const rows: CompareRow[] = keys
    .map((k) => {
      const a = aMap.get(k);
      const b = bMap.get(k);
      const ref = a ?? b!;
      const aValue = a ? a.value : null;
      const bValue = b ? b.value : null;
      const delta =
        aValue !== null && bValue !== null ? bValue - aValue : null;
      return {
        kind: ref.statementKind,
        lineKey: ref.lineKey,
        label: ref.label,
        aValue,
        bValue,
        delta,
        deltaPct:
          delta !== null && aValue !== null && aValue !== 0
            ? (delta / Math.abs(aValue)) * 100
            : null,
      };
    })
    .sort((x, y) => {
      const ko =
        (kindOrder[x.kind] ?? 3) - (kindOrder[y.kind] ?? 3);
      if (ko !== 0) return ko;
      const xa = aMap.get(
        `${x.kind}|${x.lineKey}|${x.lineKey === "unmapped" ? x.label : ""}`
      );
      const xb = aMap.get(
        `${y.kind}|${y.lineKey}|${y.lineKey === "unmapped" ? y.label : ""}`
      );
      return (xa?.sort ?? 999) - (xb?.sort ?? 999);
    });
  return { a: aRes, b: bRes, rows };
}

/* ------------------------------ export ------------------------------ */

const KIND_TITLES: Record<string, string> = {
  is: "Income Statement",
  bs: "Balance Sheet",
  cf: "Cash Flow Statement",
};

function safeFilePart(s: string): string {
  return (s || "").replace(/[^A-Za-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
}

/**
 * Export one set: xlsx (SheetJS — cover sheet + one sheet per kind,
 * Label/Value/Source columns) or pdf (lib/financials/pdf.ts minimal
 * writer, statement tables as text). Lines only — never raw document
 * bytes.
 */
export async function exportSet(
  companyId: string,
  setId: string,
  format: string
): Promise<{ buffer: Buffer; filename: string; mime: string }> {
  await ensureFinancials();
  const res = await getSet(setId);
  if (!res || res.set.companyId !== companyId) {
    throw new Error("set_not_found");
  }
  const { set, lines } = res;
  const fmt = (format || "xlsx").toLowerCase();
  const baseName = `financials-${safeFilePart(companyId) || "company"}-${
    safeFilePart(set.periodEnd || set.id) || "set"
  }`;
  const kinds = ["is", "bs", "cf"].filter((k) =>
    lines.some((l) => l.statementKind === k)
  );
  const kindsToShow = kinds.length
    ? kinds
    : Array.from(new Set(lines.map((l) => l.statementKind)));

  if (fmt === "xlsx") {
    const wb = XLSX.utils.book_new();
    const cover: Array<Array<string>> = [
      ["Canny Capital — Financial Statements"],
      [],
      ["Company ID", companyId],
      ["Set ID", set.id],
      ["Series ID", set.seriesId],
      ["Layer", set.layer],
      ["Version", String(set.version)],
      ["Status", set.status],
      ["Period type", set.periodType],
      ["Period start", set.periodStart ?? ""],
      ["Period end", set.periodEnd ?? ""],
      ["Basis", set.basis],
      ["Currency", set.currency],
      [
        "Units",
        set.unitsLabel || `x${set.unitMultiplier}`,
      ],
      ["Document ID", set.documentId ?? ""],
      ["Exported at", new Date().toISOString()],
    ];
    const coverWs = XLSX.utils.aoa_to_sheet(cover);
    XLSX.utils.book_append_sheet(wb, coverWs, "Cover");
    for (const kind of kindsToShow) {
      const rows: Array<Array<string | number>> = [["Label", "Value", "Source"]];
      const kindLines = lines
        .filter((l) => l.statementKind === kind)
        .sort((a, b) => a.sort - b.sort);
      for (const l of kindLines) {
        rows.push([
          l.label || l.lineKey,
          l.value === null ? "" : l.value,
          formatSource(l.source),
        ]);
      }
      const ws = XLSX.utils.aoa_to_sheet(rows);
      const title = (KIND_TITLES[kind] ?? kind).slice(0, 31);
      XLSX.utils.book_append_sheet(wb, ws, title);
    }
    const buffer = XLSX.write(wb, {
      bookType: "xlsx",
      type: "buffer",
    }) as Buffer;
    return {
      buffer,
      filename: `${baseName}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  }

  if (fmt === "pdf") {
    const sections = kindsToShow.map((kind) => ({
      heading: KIND_TITLES[kind] ?? kind,
      rows: [
        ["Label", "Value", "Source"],
        ...lines
          .filter((l) => l.statementKind === kind)
          .sort((a, b) => a.sort - b.sort)
          .map((l) => [
            l.label || l.lineKey,
            fmtMoney(l.value),
            formatSource(l.source),
          ]),
      ],
    }));
    const buffer = buildSimplePdf({
      title: `Financial Statements — period ending ${set.periodEnd ?? "n/a"}`,
      subtitle: `${set.layer} · v${set.version} · ${set.basis} · ${set.currency}${
        set.unitsLabel ? ` · ${set.unitsLabel}` : ""
      } · ${set.status}`,
      sections,
    });
    return { buffer, filename: `${baseName}.pdf`, mime: "application/pdf" };
  }

  throw new Error("unsupported_format");
}

/* ------------------------- event registration ----------------------- */
/**
 * The service ALSO refreshes its own company summary when
 * financials_posted fires (postSet refreshes directly too; the handler
 * covers posts from any other path). Registered once per process.
 */
let financialsHandlerRegistered = false;
function registerFinancialsHandlers(): void {
  if (financialsHandlerRegistered) return;
  financialsHandlerRegistered = true;
  onEvent("financials_posted", async (evt) => {
    const payload = evt.payload ?? {};
    const cid =
      typeof payload.companyId === "string" && payload.companyId
        ? payload.companyId
        : evt.entityId;
    if (!cid) return;
    try {
      await refreshCompanyFinancialSummary(cid);
    } catch (err) {
      console.error(
        "[financials] onEvent summary refresh failed for company",
        cid,
        err instanceof Error ? err.message : String(err)
      );
    }
  });
}
registerFinancialsHandlers();
