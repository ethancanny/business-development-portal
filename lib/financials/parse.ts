import { extractPdfStrings } from "../pdf-text";
import {
  buildGridFromCsvText,
  buildGridsFromWorkbookBytes,
  gridsText,
  parseFinancialNumber,
  type Grid,
  type GridCell,
} from "./grid";
import type { PeriodType, StatementBasis } from "./schema";
import { mapLabelToLine, type StatementKind } from "./template";

/**
 * Financial document parser (Phase 4) — turns an uploaded statement
 * (XLSX/XLS/CSV grid, or PDF/plain extracted text) into ParsedPeriods
 * of template-mapped lines with per-line provenance.
 *
 * Values: ParsedLine.rawValue is in the document's OWN units;
 * ParsedPeriod.unitMultiplier converts to dollars
 * (stored value = rawValue × unitMultiplier, applied by the service).
 *
 * Extractors are REUSED, not rewritten: SheetJS for workbooks and
 * lib/pdf-text's extractPdfStrings for PDFs (the Phase 3 extraction
 * dispatch in lib/dataroom/extract.ts uses the same two). DOCX and
 * other Office files arrive through the contract's { text, extractor }
 * input (text already extracted into dataroom.document_text by
 * Phase 3) — no new DOCX parser is written here.
 *
 * parseFinancialDocument is synchronous (both reused extractors are
 * sync); callers may `await` it harmlessly.
 *
 * Images return status 'unsupported' and scanned PDFs status 'empty',
 * both with OCR_GAP_NOTE — the named Phase 4 gap. Figures are never
 * logged.
 */

export const OCR_GAP_NOTE =
  "Image OCR is not configured: no OCR provider (e.g. Azure AI Document " +
  "Intelligence) is connected";

export type ParseStatus = "done" | "unsupported" | "failed" | "empty";

export interface ParseInput {
  bytes?: Buffer;
  mime?: string;
  filename?: string;
  /** Pre-extracted text (e.g. from dataroom.document_text). */
  text?: string;
  extractor?: string;
  textExtractor?: string;
  documentId?: string;
}

export interface ParsedLineSource {
  documentId?: string;
  sheet?: string;
  /** Spreadsheet cell address, e.g. 'B14'. */
  cell?: string;
  /** 1-based line number for text/PDF parses. */
  line?: number;
  page?: number;
  snippet?: string;
}

export interface ParsedLine {
  kind: StatementKind;
  lineKey: string;
  label: string;
  /** Value as printed, in the document's units. */
  rawValue: number;
  confidence: number;
  source: ParsedLineSource;
}

export interface ParsedPeriod {
  periodType: PeriodType;
  periodStart: string | null; // ISO date
  periodEnd: string | null; // ISO date
  fiscalYearEnd: string; // 'MM-DD' or ''
  basis: StatementBasis;
  currency: "USD";
  unitMultiplier: number;
  unitsLabel: string;
  kinds: StatementKind[];
  lines: ParsedLine[];
}

export interface ParsedDoc {
  status: ParseStatus;
  extractor: string;
  notes: string[];
  periods: ParsedPeriod[];
}

/* ------------------------- doc-level detection ----------------------- */

export function detectUnits(text: string): {
  unitMultiplier: number;
  unitsLabel: string;
} {
  const t = (text ?? "").toLowerCase();
  if (
    t.includes("in millions") ||
    t.includes("(in millions)") ||
    t.includes("$ millions")
  ) {
    return { unitMultiplier: 1_000_000, unitsLabel: "in millions" };
  }
  if (
    t.includes("in thousands") ||
    t.includes("(000s)") ||
    t.includes("(000's)") ||
    t.includes("$000") ||
    t.includes("in 000s") ||
    t.includes("(in thousands)")
  ) {
    return { unitMultiplier: 1000, unitsLabel: "in thousands" };
  }
  if (t.includes("in billions")) {
    return { unitMultiplier: 1_000_000_000, unitsLabel: "in billions" };
  }
  return { unitMultiplier: 1, unitsLabel: "" };
}

export function detectBasis(text: string): StatementBasis {
  const t = (text ?? "").toLowerCase();
  if (
    t.includes("tax basis") ||
    t.includes("form 1120") ||
    t.includes("form 1065")
  ) {
    return "TAX-BASIS";
  }
  if (
    t.includes("independent auditor") ||
    t.includes("audited financial") ||
    t.includes("audit report") ||
    /\baudited\b/.test(t)
  ) {
    return "AUDITED";
  }
  if (/\breviewed\b/.test(t) || t.includes("review report")) return "REVIEWED";
  if (t.includes("compilation") || /\bcompiled\b/.test(t)) return "COMPILED";
  return "COMPANY-PREPARED";
}

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  jan: 0, feb: 1, mar: 2, apr: 3, jun: 5, jul: 6, aug: 7, sep: 8,
  sept: 8, oct: 9, nov: 10, dec: 11,
};
const MONTH_NAME_LIST = Object.keys(MONTHS);
const MONTH_NAMES = MONTH_NAME_LIST.join("|");

function pad(n: number): string {
  return String(n).padStart(2, "0");
}
function isoDate(y: number, m0: number, d: number): string {
  return `${y}-${pad(m0 + 1)}-${pad(d)}`;
}
function lastDayOfMonth(y: number, m0: number): number {
  return new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
}
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function addMonths(iso: string, months: number): string {
  const parts = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1 + months, 1));
  const day = Math.min(
    parts[2],
    lastDayOfMonth(dt.getUTCFullYear(), dt.getUTCMonth())
  );
  return isoDate(dt.getUTCFullYear(), dt.getUTCMonth(), day);
}

export function detectFiscalYearEnd(text: string): string {
  const t = text ?? "";
  const patterns = [
    new RegExp(
      `fiscal year[- ]end(?:s|ing)?[^a-z0-9]{0,12}(${MONTH_NAMES})\\s+(\\d{1,2})`,
      "i"
    ),
    new RegExp(
      `year[- ]end[^a-z0-9]{0,8}(${MONTH_NAMES})\\s+(\\d{1,2})`,
      "i"
    ),
  ];
  for (const re of patterns) {
    const m = re.exec(t);
    if (m) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo !== undefined) return `${pad(mo + 1)}-${pad(Number(m[2]))}`;
    }
  }
  return "";
}

/* --------------------------- period parsing -------------------------- */

interface PeriodInfo {
  periodType: PeriodType;
  periodStart: string | null;
  periodEnd: string | null;
  fiscalYearEnd: string;
}

function periodFromEnd(
  end: string,
  type: PeriodType,
  fiscalYearEnd = ""
): PeriodInfo {
  const parts = end.split("-").map(Number);
  const y = parts[0];
  const m = parts[1];
  let start: string | null = null;
  if (type === "annual") {
    if (fiscalYearEnd && end.slice(5) === fiscalYearEnd) {
      start = addDays(addMonths(end, -12), 1);
    } else {
      start = isoDate(y, 0, 1);
    }
  } else if (type === "quarterly") {
    start = addMonths(isoDate(y, m - 1, 1), -2);
  } else if (type === "monthly") {
    start = isoDate(y, m - 1, 1);
  } else if (type === "ytd") {
    start = isoDate(y, 0, 1);
  } else if (type === "ttm") {
    start = addDays(addMonths(end, -12), 1);
  }
  return {
    periodType: type,
    periodStart: start,
    periodEnd: end,
    fiscalYearEnd,
  };
}

/**
 * Scan a header cell/line for every period it mentions, in order.
 * Capture-group layout of the combined pattern (keep in sync):
 *  1-3 Month DD, YYYY · 4-5 Month YYYY · 6-8 YYYY-MM-DD ·
 *  9-11 MM/DD/YYYY · 12-13 Qn YYYY · 14 FYyyyy · 15 fiscal year YYYY ·
 *  16 bare year.
 */
export function findPeriodMentions(text: string): PeriodInfo[] {
  const src = text ?? "";
  const lower = src.toLowerCase();
  const contextType: PeriodType | null =
    /\bttm\b|trailing twelve|last twelve months|\bltm\b/.test(lower)
      ? "ttm"
      : /\bytd\b|year[- ]to[- ]date/.test(lower)
        ? "ytd"
        : /\bquarter|three months ended/.test(lower)
          ? "quarterly"
          : /\bfiscal|year ended|years ended|annual/.test(lower)
            ? "annual"
            : null;
  const re = new RegExp(
    [
      `(${MONTH_NAMES})\\s+(\\d{1,2}),?\\s+(20\\d{2})`,
      `(${MONTH_NAMES})\\s+(20\\d{2})`,
      `(20\\d{2})-(\\d{2})-(\\d{2})`,
      `(\\d{1,2})\\/(\\d{1,2})\\/(20\\d{2})`,
      `\\bq([1-4])\\s*(?:fy\\s*)?(20\\d{2})`,
      `\\bfy\\s*(20\\d{2})`,
      `\\bfiscal year\\s+(20\\d{2})`,
      `\\b(20\\d{2})\\b`,
    ].join("|"),
    "gi"
  );
  const out: PeriodInfo[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m[1] && m[2] && m[3]) {
      const mo = MONTHS[m[1].toLowerCase()];
      const end = isoDate(Number(m[3]), mo, Number(m[2]));
      const type =
        contextType ?? (mo === 11 && Number(m[2]) === 31 ? "annual" : "monthly");
      out.push(periodFromEnd(end, type));
    } else if (m[4] && m[5]) {
      const mo = MONTHS[m[4].toLowerCase()];
      const y = Number(m[5]);
      const end = isoDate(y, mo, lastDayOfMonth(y, mo));
      out.push(periodFromEnd(end, contextType ?? "monthly"));
    } else if (m[6] && m[7] && m[8]) {
      const end = isoDate(Number(m[6]), Number(m[7]) - 1, Number(m[8]));
      out.push(periodFromEnd(end, contextType ?? "annual"));
    } else if (m[9] && m[10] && m[11]) {
      const end = isoDate(Number(m[11]), Number(m[9]) - 1, Number(m[10]));
      out.push(periodFromEnd(end, contextType ?? "annual"));
    } else if (m[12] && m[13]) {
      const q = Number(m[12]);
      const y = Number(m[13]);
      const endMonth = q * 3 - 1;
      const end = isoDate(y, endMonth, lastDayOfMonth(y, endMonth));
      out.push(periodFromEnd(end, "quarterly"));
    } else if (m[14]) {
      out.push(periodFromEnd(isoDate(Number(m[14]), 11, 31), "annual"));
    } else if (m[15]) {
      out.push(periodFromEnd(isoDate(Number(m[15]), 11, 31), "annual"));
    } else if (m[16]) {
      if (contextType === "ttm") {
        out.push({
          periodType: "ttm",
          periodStart: null,
          periodEnd: null,
          fiscalYearEnd: "",
        });
      } else {
        out.push(periodFromEnd(isoDate(Number(m[16]), 11, 31), "annual"));
      }
    }
  }
  if (!out.length && (contextType === "ttm" || /\bttm\b/i.test(src))) {
    out.push({
      periodType: "ttm",
      periodStart: null,
      periodEnd: null,
      fiscalYearEnd: "",
    });
  }
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = `${p.periodType}|${p.periodStart}|${p.periodEnd}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function parsePeriodHeader(text: string): PeriodInfo | null {
  const mentions = findPeriodMentions(text);
  return mentions.length ? mentions[0] : null;
}

/* -------------------------- section detection ------------------------ */

const SECTION_PATTERNS: { kind: StatementKind; patterns: string[] }[] = [
  {
    kind: "bs",
    patterns: ["balance sheet", "statement of financial position"],
  },
  {
    kind: "cf",
    patterns: [
      "statement of cash flows",
      "statements of cash flows",
      "cash flow statement",
      "cash flows",
    ],
  },
  {
    kind: "is",
    patterns: [
      "income statement",
      "statement of operations",
      "statements of operations",
      "statement of income",
      "statements of income",
      "statement of earnings",
      "profit and loss",
      "profit & loss",
    ],
  },
];

export function detectSectionHeader(text: string): StatementKind | null {
  const t = (text ?? "").toLowerCase();
  if (t.length > 120) return null;
  let best: { kind: StatementKind; idx: number } | null = null;
  for (const sp of SECTION_PATTERNS) {
    for (const p of sp.patterns) {
      const idx = t.indexOf(p);
      if (idx >= 0 && (!best || idx < best.idx)) {
        best = { kind: sp.kind, idx };
      }
    }
  }
  return best ? best.kind : null;
}

function kindFromSheetName(name: string): StatementKind | null {
  const t = (name ?? "").toLowerCase();
  if (t.includes("balance")) return "bs";
  if (t.includes("cash")) return "cf";
  if (
    t.includes("income") ||
    t.includes("profit") ||
    t.includes("p&l") ||
    t.includes("operations")
  ) {
    return "is";
  }
  return null;
}

/* ---------------------------- label mapping -------------------------- */

const OPEX_DETAIL_HINT =
  /expense|payroll|salaries|wages|rent|utilities|insurance|advertising|marketing|repairs|maintenance|supplies|travel|occupancy|fuel|telephone|janitorial|licen[cs]es?|subscriptions|freight|shipping|contract labor|outside services/i;
const OPEX_EXCLUDE =
  /interest|tax|deprecia|amortiz|income|revenue|cost of goods|cost of revenue|cost of sales/i;

interface MappedLabel {
  lineKey: string;
  kind: StatementKind;
  confidence: number;
}

function mapWithFallback(
  label: string,
  kindHint: StatementKind | null
): MappedLabel | null {
  const mapped = mapLabelToLine(label, kindHint ?? undefined);
  if (mapped) return mapped;
  // An operating-expense-looking detail line inside an income statement
  // is an opex_detail line (label preserved; it rolls into
  // operating_expenses for EBITDA computation).
  const effectiveKind = kindHint ?? "is";
  if (
    effectiveKind === "is" &&
    OPEX_DETAIL_HINT.test(label) &&
    !OPEX_EXCLUDE.test(label)
  ) {
    return { lineKey: "opex_detail", kind: "is", confidence: 0.55 };
  }
  return null;
}

function cleanLabel(raw: string): string {
  return (raw ?? "")
    .replace(/\s+/g, " ")
    .replace(/^[•·\-–—\s]+/, "")
    .replace(/[.\s]*\.{2,}\s*$/, "")
    .replace(/[:.\s]+$/, "")
    .replace(/\s*\$\s*$/, "")
    .trim();
}

/* ------------------------------ buckets ------------------------------ */

interface RawPeriod {
  info: PeriodInfo;
  lines: ParsedLine[];
}

function periodKey(info: PeriodInfo): string {
  return `${info.periodType}|${info.periodStart ?? ""}|${info.periodEnd ?? ""}`;
}

class PeriodBuckets {
  private map = new Map<string, RawPeriod>();
  private order: string[] = [];

  get(info: PeriodInfo): RawPeriod {
    const k = periodKey(info);
    let b = this.map.get(k);
    if (!b) {
      b = { info, lines: [] };
      this.map.set(k, b);
      this.order.push(k);
    }
    return b;
  }

  all(): RawPeriod[] {
    return this.order
      .map((k) => this.map.get(k) as RawPeriod)
      .filter((b) => b.lines.length > 0);
  }
}

const DEFAULT_PERIOD: PeriodInfo = {
  periodType: "annual",
  periodStart: null,
  periodEnd: null,
  fiscalYearEnd: "",
};

/* ----------------------------- grid parse ---------------------------- */

function rowText(row: GridCell[]): string {
  return row
    .map((c) => c.text)
    .filter(Boolean)
    .join(" ")
    .trim();
}

function parseGrids(grids: Grid[], documentId?: string): RawPeriod[] {
  const buckets = new PeriodBuckets();
  for (const grid of grids) {
    let currentKind: StatementKind | null = kindFromSheetName(grid.sheet);

    // Label column = modal first-text column over the first 60 rows.
    const colCounts = new Map<number, number>();
    for (const row of grid.rows.slice(0, 60)) {
      const firstText = row.find(
        (c) =>
          c.text && /[a-z]/i.test(c.text) && parseFinancialNumber(c.text) === null
      );
      if (firstText) {
        colCounts.set(firstText.col, (colCounts.get(firstText.col) ?? 0) + 1);
      }
    }
    let labelCol = 0;
    let labelCount = -1;
    colCounts.forEach((n, col) => {
      if (n > labelCount) {
        labelCount = n;
        labelCol = col;
      }
    });

    // Period columns from header rows (first 20 rows). A row counts as
    // a header row when it carries a strong period phrase (month name /
    // FY / Q / TTM / "ended") or at least two bare-year cells.
    const periodCols = new Map<number, PeriodInfo>();
    const headerRows = new Set<number>();
    let gridDefault: PeriodInfo | null = null;
    grid.rows.slice(0, 20).forEach((row) => {
      let strong = 0;
      let bareYears = 0;
      const found: { col: number; info: PeriodInfo }[] = [];
      for (const cell of row) {
        if (!cell.text) continue;
        const cellLower = cell.text.toLowerCase();
        const hasStrong =
          /[a-z]/i.test(cell.text) &&
          (MONTH_NAME_LIST.some((mn) => cellLower.includes(mn)) ||
            /\bfy\b|\bq[1-4]\b|ttm|quarter|ended/i.test(cell.text));
        const mentions = findPeriodMentions(cell.text);
        if (!mentions.length) continue;
        if (hasStrong) strong++;
        else bareYears++;
        if (cell.col > labelCol) {
          found.push({ col: cell.col, info: mentions[0] });
        } else if (!gridDefault) {
          gridDefault = mentions[0];
        }
      }
      if (strong > 0 || bareYears >= 2) {
        if (row.length) headerRows.add(row[0].row);
        for (const f of found) {
          if (!periodCols.has(f.col)) periodCols.set(f.col, f.info);
        }
      }
    });

    for (const row of grid.rows) {
      if (!row.length) continue;
      if (headerRows.has(row[0].row)) continue;
      const numericCells = row.filter(
        (c) => parseFinancialNumber(c.text) !== null
      );
      const labelCell =
        row.find((c) => c.col === labelCol && c.text) ??
        row.find(
          (c) =>
            c.text && /[a-z]/i.test(c.text) && parseFinancialNumber(c.text) === null
        );
      const labelRaw = labelCell?.text ?? "";
      const joined = rowText(row);

      // Statement section headers switch the active kind.
      const section =
        detectSectionHeader(labelRaw) ?? detectSectionHeader(joined);
      if (section && numericCells.length === 0) {
        currentKind = section;
        continue;
      }
      if (!labelRaw) continue;
      const label = cleanLabel(labelRaw);
      if (!label || label.length < 2) continue;
      if (!numericCells.length) continue;

      const mapped = mapWithFallback(label, currentKind);
      const kind: StatementKind = currentKind ?? mapped?.kind ?? "is";
      const lineKey = mapped?.lineKey ?? "unmapped";
      const confidence = mapped?.confidence ?? 0.4;

      for (const cell of numericCells) {
        if (labelCell && cell.col <= labelCell.col) continue;
        const value = parseFinancialNumber(cell.text);
        if (value === null) continue;
        const info = periodCols.get(cell.col) ?? gridDefault ?? DEFAULT_PERIOD;
        const bucket = buckets.get(info);
        bucket.lines.push({
          kind,
          lineKey,
          label,
          rawValue: value,
          confidence,
          source: {
            ...(documentId ? { documentId } : {}),
            ...(grid.sheet ? { sheet: grid.sheet } : {}),
            cell: cell.address,
            snippet: joined.slice(0, 200),
          },
        });
      }
    }
  }
  return buckets.all();
}

/* ----------------------------- text parse ---------------------------- */

function parseTextLines(text: string, documentId?: string): RawPeriod[] {
  const rawLines = (text ?? "").split(/\r?\n/);

  // Period headers: first 40 lines. Lines ending in a numeric value
  // are normally data lines — EXCEPT explicit period headers like
  // "For the Years Ended December 31, 2023 and 2022", whose trailing
  // bare year is a period, not a value; any header signal (month name,
  // ended/fiscal/quarter/ttm/FY) keeps the line in the scan.
  const headerInfos: PeriodInfo[] = [];
  const seenKeys = new Set<string>();
  for (const line of rawLines.slice(0, 40)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const tokens = trimmed.split(/\s+/);
    const last = tokens[tokens.length - 1];
    const lineLower = trimmed.toLowerCase();
    const hasHeaderSignal =
      MONTH_NAME_LIST.some((mn) => lineLower.includes(mn)) ||
      /ended|fiscal|quarter|ttm|\bfy\b/.test(lineLower);
    if (
      parseFinancialNumber(last) !== null &&
      tokens.length > 3 &&
      !hasHeaderSignal
    ) {
      continue;
    }
    for (const info of findPeriodMentions(trimmed)) {
      const k = periodKey(info);
      if (!seenKeys.has(k) && headerInfos.length < 6) {
        seenKeys.add(k);
        headerInfos.push(info);
      }
    }
  }
  const periods = headerInfos.length ? headerInfos : [DEFAULT_PERIOD];
  const buckets = new PeriodBuckets();
  const periodBuckets = periods.map((p) => buckets.get(p));

  let currentKind: StatementKind | null = null;
  rawLines.forEach((rawLine, idx) => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    const section = detectSectionHeader(trimmed);
    if (section) {
      currentKind = section;
      const tail = trimmed.split(/\s+/).pop() ?? "";
      if (parseFinancialNumber(tail) === null) return;
    }

    // Trailing numeric tokens = the period columns, left → right.
    const tokens = trimmed.split(/\s+/);
    const values: number[] = [];
    let j = tokens.length - 1;
    while (j >= 0) {
      const tok = tokens[j];
      if (tok === "$") {
        j--;
        continue;
      }
      const v = parseFinancialNumber(tok);
      if (v === null) break;
      values.unshift(v);
      j--;
    }
    if (!values.length) return;
    const used =
      values.length > periods.length
        ? values.slice(values.length - periods.length)
        : values;
    const label = cleanLabel(tokens.slice(0, j + 1).join(" "));
    if (!label || label.length < 2) return;
    if (/^\d+$/.test(label)) return;
    // Period-header lines ("For the Years Ended December 31, 2023 and
    // 2022") end in a bare year that the trailing-number walk reads as
    // a value — they are headers, never data lines.
    if (/years? ended|for the (fiscal )?(year|quarter|month|period)/i.test(label)) {
      return;
    }

    const mapped = mapWithFallback(label, currentKind);
    const kind: StatementKind = currentKind ?? mapped?.kind ?? "is";
    const lineKey = mapped?.lineKey ?? "unmapped";
    const confidence = mapped?.confidence ?? 0.4;

    used.forEach((value, vi) => {
      const bucket = periodBuckets[vi] ?? periodBuckets[0];
      bucket.lines.push({
        kind,
        lineKey,
        label,
        rawValue: value,
        confidence,
        source: {
          ...(documentId ? { documentId } : {}),
          line: idx + 1,
          snippet: trimmed.slice(0, 200),
        },
      });
    });
  });
  return buckets.all();
}

/* ------------------------------ dispatch ----------------------------- */

function extOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename ?? "");
  return m ? m[1].toLowerCase() : "";
}

function textToGrids(text: string): Grid[] {
  // Phase 3's XLSX extractor emits "# Sheet: <name>" chunks of CSV.
  if (/# Sheet:/.test(text)) {
    const grids: Grid[] = [];
    const parts = text.split(/^# Sheet:.*$/m);
    const names = Array.from(text.matchAll(/^# Sheet:(.*)$/m)).map((x) =>
      x[1].trim()
    );
    parts.slice(1).forEach((part, i) => {
      if (part.trim()) grids.push(buildGridFromCsvText(part, names[i] ?? ""));
    });
    if (grids.length) return grids;
  }
  return [buildGridFromCsvText(text, "")];
}

function assemble(
  rawPeriods: RawPeriod[],
  docText: string
): { periods: ParsedPeriod[]; notes: string[] } {
  const notes: string[] = [];
  const units = detectUnits(docText);
  const basis = detectBasis(docText);
  const docFye = detectFiscalYearEnd(docText);
  if (units.unitMultiplier !== 1) {
    notes.push(
      `Values are reported ${units.unitsLabel}; stored values apply a ` +
        `unit multiplier of ${units.unitMultiplier}.`
    );
  }
  let unmapped = 0;
  const periods: ParsedPeriod[] = rawPeriods.map((rp) => {
    const kinds: StatementKind[] = [];
    for (const l of rp.lines) {
      if (l.lineKey === "unmapped") unmapped++;
      if (!kinds.includes(l.kind)) kinds.push(l.kind);
    }
    kinds.sort(
      (a, b) => ["is", "bs", "cf"].indexOf(a) - ["is", "bs", "cf"].indexOf(b)
    );
    const derivedFye =
      rp.info.fiscalYearEnd ||
      docFye ||
      (rp.info.periodType === "annual" &&
      rp.info.periodEnd &&
      rp.info.periodEnd.slice(5) !== "12-31"
        ? rp.info.periodEnd.slice(5)
        : "");
    return {
      periodType: rp.info.periodType,
      periodStart: rp.info.periodStart,
      periodEnd: rp.info.periodEnd,
      fiscalYearEnd: derivedFye,
      basis,
      currency: "USD" as const,
      unitMultiplier: units.unitMultiplier,
      unitsLabel: units.unitsLabel,
      kinds,
      lines: rp.lines,
    };
  });
  if (unmapped > 0) {
    notes.push(
      `${unmapped} line(s) could not be mapped to the statement template ` +
        `and were kept as 'unmapped' for review.`
    );
  }
  return { periods, notes };
}

/**
 * Parse one financial document. Synchronous: both reused extractors
 * (SheetJS, extractPdfStrings) are sync; callers may await the result.
 */
export function parseFinancialDocument(input: ParseInput): ParsedDoc {
  const mime = (input.mime ?? "").toLowerCase();
  const filename = input.filename ?? "";
  const ext = extOf(filename);
  const providedText = input.text;
  const providedExtractor = input.textExtractor ?? input.extractor ?? undefined;

  try {
    /* images — named OCR gap */
    if (
      mime.startsWith("image/") ||
      ["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp", "heic"].includes(ext)
    ) {
      return {
        status: "unsupported",
        extractor: "none",
        notes: [OCR_GAP_NOTE],
        periods: [],
      };
    }

    const isSpreadsheet =
      mime ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      mime === "application/vnd.ms-excel" ||
      ext === "xlsx" ||
      ext === "xls";
    const isCsv =
      mime === "text/csv" ||
      mime === "application/csv" ||
      ext === "csv" ||
      ext === "tsv";
    const isPdf = mime === "application/pdf" || ext === "pdf";

    /* spreadsheets / CSV — grid with cell provenance */
    if (isSpreadsheet || isCsv) {
      let grids: Grid[];
      let extractor: string;
      if (input.bytes && isSpreadsheet) {
        grids = buildGridsFromWorkbookBytes(input.bytes);
        extractor = "xlsx-sheetjs";
      } else if (input.bytes && isCsv) {
        grids = [buildGridFromCsvText(input.bytes.toString("utf8"), "")];
        extractor = "csv";
      } else if (providedText) {
        grids = textToGrids(providedText);
        extractor =
          providedExtractor ?? (isSpreadsheet ? "xlsx-sheetjs" : "csv");
      } else {
        return {
          status: "failed",
          extractor: "none",
          notes: ["No document bytes or extracted text provided."],
          periods: [],
        };
      }
      const rawPeriods = parseGrids(grids, input.documentId);
      const { periods, notes } = assemble(rawPeriods, gridsText(grids));
      return {
        status: periods.length ? "done" : "empty",
        extractor,
        notes: periods.length
          ? notes
          : [
              ...notes,
              "No financial statement lines could be parsed from the workbook.",
            ],
        periods,
      };
    }

    /* PDF — provided text or extractPdfStrings over the bytes */
    if (isPdf) {
      let text = providedText;
      let extractor = providedExtractor ?? "pdf-text";
      if (!text && input.bytes) {
        text = extractPdfStrings(input.bytes).join("\n");
        extractor = "pdf-text";
      }
      if (!text || !text.trim()) {
        return {
          status: "empty",
          extractor,
          notes: [
            "No extractable text found in the PDF (scanned document?). " +
              OCR_GAP_NOTE,
          ],
          periods: [],
        };
      }
      const rawPeriods = parseTextLines(text, input.documentId);
      const { periods, notes } = assemble(rawPeriods, text);
      return {
        status: periods.length ? "done" : "empty",
        extractor,
        notes: periods.length
          ? notes
          : [
              ...notes,
              "No financial statement lines could be parsed from the PDF text.",
            ],
        periods,
      };
    }

    /* pre-extracted text (DOCX / TXT / anything Phase 3 extracted) */
    if (providedText && providedText.trim()) {
      const extractor = providedExtractor ?? "text";
      const rawPeriods = parseTextLines(providedText, input.documentId);
      const { periods, notes } = assemble(rawPeriods, providedText);
      return {
        status: periods.length ? "done" : "empty",
        extractor,
        notes,
        periods,
      };
    }

    /* plain-text bytes */
    if (
      input.bytes &&
      (mime.startsWith("text/") || ["txt", "md", "log"].includes(ext))
    ) {
      const text = input.bytes.toString("utf8").replace(/^﻿/, "");
      const rawPeriods = parseTextLines(text, input.documentId);
      const { periods, notes } = assemble(rawPeriods, text);
      return {
        status: periods.length ? "done" : "empty",
        extractor: "utf8",
        notes,
        periods,
      };
    }

    if (input.bytes) {
      return {
        status: "failed",
        extractor: "none",
        notes: [
          `No parser for ${mime || ext || "this file type"} without extracted ` +
            `text; supply the document's extracted text (dataroom.document_text) ` +
            `via the text input.`,
        ],
        periods: [],
      };
    }

    return {
      status: "failed",
      extractor: "none",
      notes: ["No document bytes or extracted text provided."],
      periods: [],
    };
  } catch (err) {
    return {
      status: "failed",
      extractor: "error",
      notes: [err instanceof Error ? err.message.slice(0, 300) : String(err)],
      periods: [],
    };
  }
}
