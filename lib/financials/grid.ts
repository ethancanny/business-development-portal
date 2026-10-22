import * as XLSX from "xlsx";

/**
 * Grid building for the financial parser (Phase 4) — turns XLSX/XLS
 * workbooks (SheetJS) and CSV text into a uniform cell grid with
 * per-cell provenance (sheet name + cell address like 'B14'; for CSV
 * the sheet is '' and the address is column letter + row number).
 * Also owns the financial number-token parser shared with the
 * text-line parser in parse.ts.
 *
 * Build marker: Phase 5 Item 0 clean redeploy, Oct 22, 2026 — forces a
 * fresh production build of current head (the Oct 21 push storm left
 * the deployed parser behaving like an older build on FY-headed and
 * bare-year-headed workbooks; see the Part 4B checkpoint).
 */

export interface GridCell {
  /** Display text of the cell ('' when empty). */
  text: string;
  /** Cell address, e.g. 'B14' (column letter + 1-based row). */
  address: string;
  col: number; // 0-based
  row: number; // 0-based
}

export interface Grid {
  sheet: string;
  rows: GridCell[][];
}

/** 0 -> 'A', 25 -> 'Z', 26 -> 'AA'. */
export function columnLetter(col: number): string {
  let n = col + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function cellAddress(col: number, row: number): string {
  return `${columnLetter(col)}${row + 1}`;
}

/* --------------------------- number parsing -------------------------- */

/**
 * Parse one financial number token. Handles $ , and spaces; (x) is
 * negative; a trailing '-' is negative; a trailing % is stripped.
 * Em/en dashes, blanks, and lone currency symbols are null (no value).
 * Returns null for anything that is not a clean number.
 */
export function parseFinancialNumber(token: string): number | null {
  let t = (token ?? "").trim();
  if (!t) return null;
  if (t === "-" || t === "—" || t === "–" || t === "$" || t === "%") {
    return null;
  }
  let negative = false;
  if (t.startsWith("(") && t.endsWith(")")) {
    negative = true;
    t = t.slice(1, -1).trim();
  }
  if (t.endsWith("-")) {
    negative = true;
    t = t.slice(0, -1).trim();
  }
  if (t.endsWith("%")) t = t.slice(0, -1).trim();
  t = t.replace(/[$,\s]/g, "");
  if (t.startsWith("+")) t = t.slice(1);
  if (t.startsWith("-")) {
    negative = true;
    t = t.slice(1);
  }
  if (!t || !/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!isFinite(n)) return null;
  return negative ? -n : n;
}

/** Does this text look like a standalone numeric token? */
export function isNumericToken(token: string): boolean {
  return parseFinancialNumber(token) !== null;
}

/* ------------------------------ CSV grid ----------------------------- */

/** Minimal RFC-4180-ish CSV row splitter (quotes, escaped quotes). */
export function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = (text ?? "").replace(/^﻿/, "");
  let i = 0;
  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      pushField();
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue;
    }
    if (ch === "\n") {
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field.length || row.length) pushRow();
  return rows;
}

export function buildGridFromCsvText(text: string, sheet = ""): Grid {
  const raw = parseCsvRows(text);
  const rows: GridCell[][] = raw.map((cells, r) =>
    cells.map((text, c) => ({
      text: (text ?? "").trim(),
      address: cellAddress(c, r),
      col: c,
      row: r,
    }))
  );
  return { sheet, rows };
}

/* ----------------------------- XLSX grid ----------------------------- */

function cellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) return "";
  const v: unknown = cell.v;
  if (v instanceof Date) {
    // Period headers arrive as real dates in many models — emit an
    // unambiguous ISO date the period parser understands.
    return v.toISOString().slice(0, 10);
  }
  if (typeof cell.w === "string" && cell.w.trim()) return cell.w.trim();
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/** One Grid per workbook sheet, preserving exact cell addresses. */
export function buildGridsFromWorkbookBytes(bytes: Buffer): Grid[] {
  const wb = XLSX.read(bytes, { type: "buffer", cellDates: true });
  const grids: Grid[] = [];
  for (const sheetName of wb.SheetNames) {
    const sheet = wb.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) {
      grids.push({ sheet: sheetName, rows: [] });
      continue;
    }
    const range = XLSX.utils.decode_range(sheet["!ref"]);
    const rows: GridCell[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const cells: GridCell[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const address = XLSX.utils.encode_cell({ r, c });
        cells.push({
          text: cellText(sheet[address] as XLSX.CellObject | undefined),
          address,
          col: c,
          row: r,
        });
      }
      rows.push(cells);
    }
    grids.push({ sheet: sheetName, rows });
  }
  return grids;
}

/** All cell text of the grids joined — doc-level scans (units/basis). */
export function gridsText(grids: Grid[]): string {
  const parts: string[] = [];
  for (const g of grids) {
    for (const row of g.rows) {
      const line = row
        .map((c) => c.text)
        .filter(Boolean)
        .join(" ");
      if (line) parts.push(line);
    }
  }
  return parts.join("\n");
}
