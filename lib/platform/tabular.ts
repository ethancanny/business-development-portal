import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

/**
 * Shared CSV / XLSX tabular helpers (Phase 10 import/export).
 *
 * One column definition drives both directions: exports write the
 * column LABELS as the header row; imports accept headers matching
 * either the label or the key (case-insensitive, trimmed), so a file
 * exported by this portal round-trips, and a hand-made sheet using
 * the raw keys works too.
 */

export interface TabularColumn {
  key: string;
  label: string;
}

export type TabularFormat = "csv" | "xlsx";

export function formatFromParam(v: string | null | undefined): TabularFormat {
  return (v ?? "").toLowerCase() === "xlsx" ? "xlsx" : "csv";
}

/* ---------------- shared grid column sets (Phase 10) ----------------
 * Export and import for a grid share ONE column set so an exported
 * file always round-trips. They live here, not in the route modules:
 * Next.js route files may only export route handlers/config. */

export const DEAL_COLUMNS: TabularColumn[] = [
  { key: "id", label: "ID" },
  { key: "companyName", label: "Company" },
  { key: "industry", label: "Industry" },
  { key: "stage", label: "Stage" },
  { key: "city", label: "City" },
  { key: "owner", label: "Owner" },
  { key: "dealValue", label: "Deal Value" },
  { key: "askingPrice", label: "Asking Price" },
  { key: "revenue", label: "Revenue" },
  { key: "ebitda", label: "EBITDA" },
  { key: "growthPct", label: "Growth %" },
  { key: "contactName", label: "Contact Name" },
  { key: "contactEmail", label: "Contact Email" },
  { key: "broker", label: "Broker" },
  { key: "source", label: "Source" },
  { key: "updatedAt", label: "Updated At" },
];

/** `title` maps to OperatorCandidate.currentTitle, `location` to city. */
export const CANDIDATE_COLUMNS: TabularColumn[] = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "title", label: "Title" },
  { key: "sector", label: "Sector" },
  { key: "location", label: "Location" },
  { key: "score", label: "Score" },
  { key: "status", label: "Status" },
  { key: "sourceUrl", label: "Source URL" },
  { key: "sourceType", label: "Source Type" },
  { key: "industry", label: "Industry" },
  { key: "createdAt", label: "Created At" },
];

/* ------------------------------ export ------------------------------ */

function cellString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

function csvEscape(s: string): string {
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text: header row of labels, CRLF line endings, RFC-4180 quoting. */
export function toCsv(
  rows: Record<string, unknown>[],
  columns: TabularColumn[]
): string {
  const lines = [columns.map((c) => csvEscape(c.label)).join(",")];
  for (const row of rows) {
    lines.push(
      columns.map((c) => csvEscape(cellString(row[c.key]))).join(",")
    );
  }
  return lines.join("\r\n");
}

/** XLSX bytes: one sheet, header row of labels, raw values per column. */
export function toXlsxBuffer(
  rows: Record<string, unknown>[],
  columns: TabularColumn[],
  sheetName: string
): Buffer {
  const aoa: unknown[][] = [columns.map((c) => c.label)];
  for (const row of rows) {
    aoa.push(
      columns.map((c) => {
        const v = row[c.key];
        return v === null || v === undefined ? "" : v;
      })
    );
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "Export");
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

/**
 * Attachment response for an export. `truncated` (the source had more
 * rows than the cap) surfaces as the X-Truncated header so clients
 * can warn instead of silently presenting a partial file.
 */
export function tabularResponse(
  body: string | Buffer,
  filename: string,
  format: TabularFormat,
  opts: { truncated?: boolean } = {}
): NextResponse {
  const headers: Record<string, string> = {
    "Content-Type":
      format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "private, no-store",
  };
  if (opts.truncated) headers["X-Truncated"] = "true";
  return new NextResponse(
    typeof body === "string" ? body : new Uint8Array(body),
    { headers }
  );
}

/** Convenience: serialize rows in the requested format and respond. */
export function exportResponse(
  rows: Record<string, unknown>[],
  columns: TabularColumn[],
  baseName: string,
  format: TabularFormat,
  truncated: boolean
): NextResponse {
  if (format === "xlsx") {
    return tabularResponse(
      toXlsxBuffer(rows, columns, baseName),
      `${baseName}.xlsx`,
      "xlsx",
      { truncated }
    );
  }
  return tabularResponse(toCsv(rows, columns), `${baseName}.csv`, "csv", {
    truncated,
  });
}

/* ------------------------------ import ------------------------------ */

export interface ParseResult {
  /** Rows keyed by column.key; every value is a string ("" when the
   * cell was empty/absent). Unrecognized columns are dropped. */
  rows: Record<string, string>[];
  /** Header texts (as written in the file) that matched no column. */
  unknownHeaders: string[];
}

const normHeader = (s: string): string => s.trim().toLowerCase();

/**
 * Parse CSV text or XLSX bytes (SheetJS sniffs the format from the
 * content — CSV text and PK-zip bytes both work). First sheet only;
 * the first row is the header. Headers match a column by label OR by
 * key, normalized by trim + lowercase.
 */
export function parseTabular(
  content: Buffer | string,
  columns: TabularColumn[]
): ParseResult {
  const wb =
    typeof content === "string"
      ? XLSX.read(content, { type: "string" })
      : XLSX.read(content, { type: "buffer" });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], unknownHeaders: [] };
  const ws = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    defval: "",
    raw: true,
  });
  if (!aoa.length) return { rows: [], unknownHeaders: [] };

  const byNorm = new Map<string, string>();
  for (const c of columns) {
    byNorm.set(normHeader(c.key), c.key);
    byNorm.set(normHeader(c.label), c.key);
  }

  const headers = (aoa[0] ?? []).map((h) => String(h ?? ""));
  const colForIndex: (string | null)[] = headers.map((h) => {
    const key = byNorm.get(normHeader(h));
    return key ?? null;
  });
  const unknownHeaders = headers.filter(
    (h, i) => h.trim() !== "" && colForIndex[i] === null
  );

  const rows: Record<string, string>[] = [];
  for (let r = 1; r < aoa.length; r++) {
    const raw = aoa[r] ?? [];
    // Skip fully-blank lines (trailing newline in hand-edited CSVs).
    if (raw.every((v) => String(v ?? "").trim() === "")) continue;
    const row: Record<string, string> = {};
    for (const c of columns) row[c.key] = "";
    headers.forEach((_, i) => {
      const key = colForIndex[i];
      if (key) row[key] = cellString(raw[i]).trim();
    });
    rows.push(row);
  }
  return { rows, unknownHeaders };
}
