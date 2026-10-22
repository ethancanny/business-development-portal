import * as XLSX from "xlsx";
import { LINE_DEFS, type StatementKind } from "../financials/template";

/**
 * Portal submission templates (Phase 9, WS-B) — downloadable starter
 * files for portfolio-company reporting.
 *
 * The statements template's line labels come from the Phase 4
 * template constants (lib/financials/template.ts LINE_DEFS) — the
 * single source of truth — so a filled-in workbook re-imports through
 * the financials parser with every label mapping cleanly.
 */

export interface TemplateDownload {
  bytes: Buffer;
  filename: string;
  mime: string;
}

const KIND_SHEETS: Array<{ kind: StatementKind; sheet: string }> = [
  { kind: "is", sheet: "Income Statement" },
  { kind: "bs", sheet: "Balance Sheet" },
  { kind: "cf", sheet: "Cash Flow" },
];

export function buildStatementsTemplate(): TemplateDownload {
  const wb = XLSX.utils.book_new();
  for (const { kind, sheet } of KIND_SHEETS) {
    const rows: string[][] = [["Line", "Amount"]];
    for (const def of LINE_DEFS.filter((d) => d.kind === kind)) {
      rows.push([def.label, ""]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheet);
  }
  const instructions: string[][] = [
    ["Canny Capital Partners — Financial Statements Template"],
    [""],
    ["How to use"],
    ["1. Enter one period per completed workbook (or add a column per period headed with the period end date)."],
    ["2. Fill the Amount column next to each line label. Leave lines that do not apply blank — do not delete rows."],
    ["3. Amounts are in whole dollars unless the workbook states 'in thousands' or 'in millions'."],
    ["4. Upload the completed workbook through the portal's reporting submission for the period."],
    ["Line labels match the portal's statement template exactly; renamed labels may not map on import."],
  ];
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.aoa_to_sheet(instructions),
    "Instructions"
  );
  return {
    bytes: XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer,
    filename: "statements-template.xlsx",
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

export function buildKpiTemplate(): TemplateDownload {
  // period_end + the two standard manual KPIs, plus example custom
  // KPI columns a company can rename/extend (custom keys flow through
  // upsertManualKpi unchanged).
  const csv = [
    "period_end,headcount,customer_count,custom_kpi_1,custom_kpi_2",
    "YYYY-MM-DD,,,,",
    "",
  ].join("\n");
  return {
    bytes: Buffer.from(csv, "utf8"),
    filename: "kpi-template.csv",
    mime: "text/csv",
  };
}
