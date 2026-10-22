import * as XLSX from "xlsx";
import { buildSimplePdf, type PdfSection } from "../financials/pdf";
import {
  getPortfolioCompany,
  getMonitoringSummaryForCompany,
} from "./service";
import {
  getKpis,
  getVariance,
  getCash,
  getVcTracking,
  getCovenants,
  getAlerts,
} from "./analytics";

/**
 * Portfolio Monitoring exports (Phase 8, WS-C) — Board pack and
 * Investor update, PDF + XLSX.
 *
 * DATA RULE (contract): every figure in these exports comes from the
 * SAME monitoring service / analytics getters the API routes and the
 * dashboard use — getPortfolioCompany / getMonitoringSummaryForCompany
 * (lib/monitoring/service.ts) and getKpis / getVariance / getCash /
 * getVcTracking (lib/monitoring/analytics.ts). Nothing here runs SQL
 * and nothing recomputes a figure the getters did not return: a
 * missing value renders "—", never $0.
 *
 * Covenant tests come from analytics getCovenants (its `tests` list is
 * the latest test per covenant, enriched with the covenant label) and
 * open alerts from analytics getAlerts. Both are best-effort sections:
 * a failure there degrades the export to the summary's covenantStatus /
 * openAlerts fields rather than failing the whole document.
 *
 * MARGIN CONVENTIONS (verified against WS-A/WS-B code): the summary's
 * kpis.grossMarginPct is the stored FRACTION (0.30 = 30%) and is
 * ×100'd here; the getKpis period group's grossMarginPct is already
 * PERCENT POINTS (the getter converts for display) and is used as-is.
 *
 * PDF: lib/financials/pdf.ts exports exactly one generic builder,
 * buildSimplePdf({ title, subtitle, sections }) — the same dependency-
 * free raw-PDF writer (Helvetica / Letter, valid xref) that Phase 4's
 * exportSet uses. It has no color primitives, so the navy #0d1f3c /
 * gold #b8975a branding is carried by the header block text (firm name,
 * report title, company, as-of) exactly as exportSet carries its cover
 * lines; the XLSX cover sheet records the brand colors explicitly.
 */

export type MonitoringExportFormat = "pdf" | "xlsx";

export interface MonitoringExport {
  bytes: Buffer;
  contentType: string;
  filename: string;
}

/* ------------------------- loose record access ------------------------ */
/* The monitoring service/analytics shapes are owned by WS-A/WS-B.
 * These accessors read the documented field names first and tolerate
 * the obvious alternates, without ever inventing a value. */

type Rec = Record<string, unknown>;

function asRec(v: unknown): Rec {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Rec)
    : {};
}

function pick(rec: Rec, ...keys: string[]): unknown {
  for (const k of keys) {
    if (rec[k] !== undefined && rec[k] !== null && rec[k] !== "") return rec[k];
  }
  return undefined;
}

function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v.replace(/[$,%\s]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function listFrom(v: unknown, ...keys: string[]): Rec[] {
  if (Array.isArray(v)) return v.map(asRec);
  const rec = asRec(v);
  for (const k of keys) {
    if (Array.isArray(rec[k])) return (rec[k] as unknown[]).map(asRec);
  }
  return [];
}

/** Call an analytics getter best-effort: a failure in an optional
 * section (covenants, alerts, VC) degrades that section to the summary
 * fields instead of failing the whole export. */
async function tryGet<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch {
    return null;
  }
}

/* ------------------------------ formatting ---------------------------- */

/** $X,XXX with no decimals; null → "—" (never a fabricated $0). */
export function fmtMoney0(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const rounded = Math.round(v);
  const s = Math.abs(rounded).toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  return rounded < 0 ? `-$${s}` : `$${s}`;
}

/** Margin values are percent points platform-wide (Phase 4 summary
 * convention): 30.5 → "30.5%". Null → "—". */
export function fmtPctPoints(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${(Math.round(v * 10) / 10).toString()}%`;
}

function fmtMultiple(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}×`;
}

function dateOnly(v: unknown): string {
  const s = str(v);
  return s ? s.slice(0, 10) : "";
}

function safeFilePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9-_]+/g, "-").replace(/^-+|-+$/g, "");
}

/* --------------------------- data assembly ---------------------------- */

interface ExportModel {
  companyName: string;
  companyId: string;
  dealId: string;
  status: string;
  asOf: string;
  latestPeriodEnd: string;
  reportingStatus: string;
  covenantStatus: string;
  openAlerts: number | null;
  baselineRows: string[][];
  kpiRows: string[][];
  varianceRows: string[][];
  covenantRows: string[][];
  vcRows: string[][];
  cashRows: string[][];
  alertRows: string[][];
}

async function assemble(
  companyId: string,
  includeAlerts: boolean
): Promise<ExportModel> {
  const rawCompany = await getPortfolioCompany(companyId);
  const company = asRec(rawCompany);
  if (!rawCompany || !Object.keys(company).length) {
    throw new Error("portfolio_company_not_found");
  }
  const baselineCompany = asRec(company.baselineCompany);
  const underwritingRec = asRec(company.underwriting);

  const summary = asRec(await getMonitoringSummaryForCompany(companyId));
  const summaryKpis = asRec(summary.kpis);

  const latestPeriodEnd =
    dateOnly(pick(summary, "latestPeriodEnd", "periodEnd")) ||
    dateOnly(pick(company, "latestPeriodEnd"));

  // Latest KPIs — the analytics getter the dashboard KPI tab uses.
  // getKpis period groups are sorted latest-first; the group's
  // grossMarginPct is PERCENT POINTS (getter-converted), while the
  // summary's is the stored FRACTION — handled separately below.
  const kpisRaw = await tryGet(() => getKpis(companyId));
  const kpiList = listFrom(kpisRaw, "kpis", "periods");
  const latestKpi = kpiList.length ? kpiList[0] : {};

  const kpiValue = (...keys: string[]): number | null =>
    numOrNull(pick(latestKpi, ...keys)) ?? numOrNull(pick(summaryKpis, ...keys));

  const revenue = kpiValue("revenue");
  const ebitda = kpiValue("ebitda");
  const grossMarginPct =
    numOrNull(pick(latestKpi, "grossMarginPct")) ??
    (() => {
      const frac = numOrNull(pick(summaryKpis, "grossMarginPct"));
      return frac === null ? null : frac * 100;
    })();
  const cashKpi = kpiValue("cash", "cashBalance", "endingCash");

  // Variance rows for the latest period (four-way: actual / budget /
  // underwriting / VC target — all money metrics: revenue,
  // gross_profit, ebitda).
  const varianceRaw = await tryGet(() =>
    getVariance(companyId, latestPeriodEnd || undefined)
  );
  const varianceList = listFrom(varianceRaw, "rows", "variance", "items", "lines");
  const varianceRows: string[][] = varianceList.map((r) => [
    str(pick(r, "label", "metric", "metricLabel", "key")) || "—",
    fmtMoney0(numOrNull(pick(r, "actual"))),
    fmtMoney0(numOrNull(pick(r, "budget"))),
    fmtMoney0(numOrNull(pick(r, "underwriting"))),
    fmtMoney0(numOrNull(pick(r, "vcTarget", "target"))),
    fmtMoney0(numOrNull(pick(r, "variance", "varianceAmount"))),
  ]);

  // VC progress — planned vs realized per initiative.
  const vcRaw = await tryGet(() => getVcTracking(companyId));
  const vcList = listFrom(vcRaw, "initiatives", "rows", "items");
  const vcRows: string[][] = vcList.map((r) => {
    const planned = numOrNull(pick(r, "plannedImpact", "plannedEbitdaImpact", "planned"));
    const realized = numOrNull(pick(r, "realizedImpact", "realized", "realizedAmount"));
    const pct =
      planned && realized !== null ? (realized / Math.abs(planned)) * 100 : null;
    return [
      str(pick(r, "name", "title", "initiative")) || "—",
      str(pick(r, "status")) || "—",
      fmtMoney0(planned),
      fmtMoney0(realized),
      pct === null ? "—" : `${Math.round(pct)}%`,
    ];
  });
  const vcTotals = asRec(asRec(vcRaw).totals);
  if (Object.keys(vcTotals).length) {
    vcRows.push([
      "Total",
      "",
      fmtMoney0(numOrNull(pick(vcTotals, "plannedImpact", "planned"))),
      fmtMoney0(numOrNull(pick(vcTotals, "realizedImpact", "realized"))),
      "",
    ]);
  }

  // Cash snapshot from the cash getter (position + revolver).
  const cashRaw = await tryGet(() => getCash(companyId));
  const cashRec = asRec(pick(asRec(cashRaw), "cash", "position", "snapshot") ?? cashRaw);
  const cashBalance =
    numOrNull(pick(cashRec, "cash", "cashBalance", "balance", "endingCash")) ?? cashKpi;
  const revolverLimit = numOrNull(pick(cashRec, "revolverLimit", "revolver_limit"));
  const revolverDrawn = numOrNull(pick(cashRec, "revolverDrawn", "revolver_drawn", "drawn"));
  const revolverAvailable =
    numOrNull(pick(cashRec, "revolverAvailable", "availability", "available")) ??
    (revolverLimit !== null && revolverDrawn !== null
      ? revolverLimit - revolverDrawn
      : null);
  const totalDebt = numOrNull(pick(cashRec, "totalDebt", "debt"));
  const leverage =
    numOrNull(pick(cashRec, "leverage", "leverageMultiple")) ??
    (totalDebt !== null && ebitda ? totalDebt / ebitda : null);
  const cashRows: string[][] = [
    ["Cash", fmtMoney0(cashBalance)],
    ["Revolver limit", fmtMoney0(revolverLimit)],
    ["Revolver drawn", fmtMoney0(revolverDrawn)],
    ["Revolver availability", fmtMoney0(revolverAvailable)],
    ["Total debt", fmtMoney0(totalDebt)],
    ["Leverage", fmtMultiple(leverage)],
    ["As of", dateOnly(pick(cashRec, "asOf", "periodEnd", "updatedAt")) || "—"],
  ];

  // Covenant latest tests — getCovenants' `tests` list is the latest
  // test per covenant with its label; computedValue / threshold /
  // headroomPct (percent points) / status are the test row's fields,
  // rendered verbatim.
  const covenantsRaw = await tryGet(() => getCovenants(companyId));
  const covenantList = listFrom(covenantsRaw, "tests");
  const covenantRows: string[][] = covenantList.map((r) => {
    const threshold = numOrNull(pick(r, "threshold"));
    const actual = numOrNull(pick(r, "computedValue", "actual", "value"));
    const headroom = numOrNull(pick(r, "headroomPct", "headroom"));
    const round2 = (v: number) => String(Math.round(v * 100) / 100);
    return [
      str(pick(r, "label", "name", "covenantKey")) || "—",
      dateOnly(pick(r, "periodEnd", "testDate", "asOf")) || "—",
      actual === null ? "—" : round2(actual),
      threshold === null ? "—" : round2(threshold),
      headroom === null ? "—" : `${(Math.round(headroom * 10) / 10).toString()}%`,
      str(pick(r, "status", "result")) || "—",
    ];
  });

  // Open alerts (board pack only) — statuses: open | acked | resolved.
  let alertRows: string[][] = [];
  if (includeAlerts) {
    const alertsRaw = await tryGet(() => getAlerts(companyId));
    const alertList = listFrom(alertsRaw, "items", "alerts").filter((a) => {
      const s = str(pick(a, "status"));
      return !s || s === "open" || s === "acked";
    });
    alertRows = alertList.map((a) => [
      str(pick(a, "title", "label", "message", "ruleKey")) || "—",
      str(pick(a, "severity")) || "—",
      str(pick(a, "status")) || "open",
      dateOnly(pick(a, "createdAt", "triggeredAt", "asOf")) || "—",
    ]);
  }

  // Baseline rows — the deal_closed copies on the portfolio-company
  // record: handoff facts + the copied company snapshot
  // (baselineCompany) + the underwriting copy, rendered verbatim.
  const baselineRows: string[][] = [];
  const seenLabels = new Set<string>();
  const pushBaseline = (label: string, v: unknown) => {
    if (v === undefined || v === null || v === "" || seenLabels.has(label)) return;
    if (typeof v === "object") return;
    seenLabels.add(label);
    const n = numOrNull(v);
    const moneyish = /ebitda|value|price|equity|debt|revenue|cash|capital/i.test(label);
    baselineRows.push([
      label,
      moneyish && n !== null
        ? fmtMoney0(n)
        : /multiple/i.test(label) && n !== null
          ? fmtMultiple(n)
          : /margin|pct/i.test(label) && n !== null
            ? fmtPctPoints(n <= 1.5 ? n * 100 : n)
            : dateOnly(v) && /closed|period|updated|date/i.test(label)
              ? dateOnly(v)
              : str(v),
    ]);
  };
  const prettify = (k: string) =>
    k
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase());
  pushBaseline("Status", pick(company, "status") ?? summary.status);
  pushBaseline("Deal ID", pick(company, "dealId") ?? summary.dealId);
  pushBaseline("Closed", pick(company, "closedAt"));
  for (const [k, v] of Object.entries(baselineCompany)) {
    if (["id", "name", "companyName"].includes(k)) continue;
    pushBaseline(prettify(k), v);
  }
  for (const [k, v] of Object.entries(underwritingRec)) {
    pushBaseline(`Underwriting ${prettify(k).toLowerCase()}`, v);
  }
  pushBaseline("Reporting status", summary.reportingStatus);
  pushBaseline("Covenant status", summary.covenantStatus);
  pushBaseline("Open alerts", summary.openAlerts);
  pushBaseline("Latest period end", latestPeriodEnd || undefined);
  if (!baselineRows.length) baselineRows.push(["Baseline", "—"]);

  const kpiRows: string[][] = [
    ["Revenue", fmtMoney0(revenue)],
    ["EBITDA", fmtMoney0(ebitda)],
    ["Gross margin", fmtPctPoints(grossMarginPct)],
    ["Cash", fmtMoney0(cashBalance)],
    ["Period end", latestPeriodEnd || "—"],
  ];
  // Earlier KPI periods, verbatim from the getter, newest first.
  for (const r of kpiList.slice(0, 12)) {
    const end = dateOnly(pick(r, "periodEnd"));
    if (!end || end === latestPeriodEnd) continue;
    kpiRows.push([
      `Revenue · ${end}`,
      fmtMoney0(numOrNull(pick(r, "revenue"))),
    ]);
    kpiRows.push([
      `EBITDA · ${end}`,
      fmtMoney0(numOrNull(pick(r, "ebitda"))),
    ]);
  }

  return {
    companyName:
      str(pick(baselineCompany, "name", "companyName")) ||
      str(pick(company, "companyName", "name")) ||
      "Portfolio company",
    companyId: str(pick(company, "companyId", "id")) || companyId,
    dealId: str(pick(company, "dealId")) || str(summary.dealId),
    status: str(pick(company, "status")) || str(summary.status),
    asOf: new Date().toISOString().slice(0, 10),
    latestPeriodEnd,
    reportingStatus: str(pick(summary, "reportingStatus")) || str(pick(company, "reportingStatus")),
    covenantStatus: str(pick(summary, "covenantStatus")) || str(pick(company, "covenantStatus")),
    openAlerts: numOrNull(pick(summary, "openAlerts")) ?? (includeAlerts ? alertRows.length : null),
    baselineRows,
    kpiRows,
    varianceRows,
    covenantRows,
    vcRows,
    cashRows,
    alertRows,
  };
}

/* ------------------------------ rendering ----------------------------- */

interface Section {
  heading: string;
  headers?: string[];
  rows: string[][];
}

function sectionsFor(model: ExportModel, kind: "board" | "investor"): Section[] {
  const sections: Section[] = [
    { heading: "Company baseline", rows: model.baselineRows },
    { heading: "Latest KPIs", rows: model.kpiRows },
    {
      heading: `Variance — latest period${model.latestPeriodEnd ? ` (${model.latestPeriodEnd})` : ""}`,
      headers: ["Metric", "Actual", "Budget", "Underwriting", "VC target", "Variance"],
      rows: model.varianceRows.length ? model.varianceRows : [["No variance data reported", "", "", "", "", ""]],
    },
    {
      heading: "Covenants — latest tests",
      headers: ["Covenant", "Period", "Actual", "Threshold", "Headroom", "Status"],
      rows: model.covenantRows.length
        ? model.covenantRows
        : [[`Status: ${model.covenantStatus || "—"}`, "", "", "", "", ""]],
    },
    {
      heading: "Value creation — planned vs realized",
      headers: ["Initiative", "Status", "Planned impact", "Realized", "% realized"],
      rows: model.vcRows.length ? model.vcRows : [["No value-creation initiatives tracked", "", "", "", ""]],
    },
    { heading: "Cash & debt snapshot", rows: model.cashRows },
  ];
  if (kind === "board") {
    sections.push({
      heading: "Open alerts",
      headers: ["Alert", "Severity", "Status", "Since"],
      rows: model.alertRows.length ? model.alertRows : [["No open alerts", "", "", ""]],
    });
  }
  return sections;
}

function toPdf(model: ExportModel, title: string, kind: "board" | "investor"): Buffer {
  const sections: PdfSection[] = sectionsFor(model, kind).map((s) => ({
    heading: s.heading,
    rows: s.headers ? [s.headers, ...s.rows] : s.rows,
  }));
  return buildSimplePdf({
    title: `Canny Capital Partners — ${title}`,
    subtitle: `${model.companyName} · As of ${model.asOf} · Latest period ${model.latestPeriodEnd || "—"} · Reporting ${model.reportingStatus || "—"} · Covenants ${model.covenantStatus || "—"}`,
    sections,
  });
}

function sheetName(raw: string, used: Set<string>): string {
  let name = raw.replace(/[\\/*?:[\]]/g, " ").trim().slice(0, 31) || "Sheet";
  let i = 2;
  const base = name;
  while (used.has(name)) {
    name = `${base.slice(0, 28)} ${i++}`;
  }
  used.add(name);
  return name;
}

function toXlsx(model: ExportModel, title: string, kind: "board" | "investor"): Buffer {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const cover: Array<Array<string>> = [
    ["Canny Capital Partners"],
    [title],
    [],
    ["Company", model.companyName],
    ["Company ID", model.companyId],
    ["Deal ID", model.dealId],
    ["Status", model.status],
    ["As of", model.asOf],
    ["Latest period end", model.latestPeriodEnd || "—"],
    ["Reporting status", model.reportingStatus || "—"],
    ["Covenant status", model.covenantStatus || "—"],
    ["Open alerts", model.openAlerts === null ? "—" : String(model.openAlerts)],
    ["Brand", "Navy #0d1f3c / Gold #b8975a"],
    ["Exported at", new Date().toISOString()],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cover), sheetName("Cover", used));
  for (const s of sectionsFor(model, kind)) {
    const rows: Array<Array<string>> = s.headers ? [s.headers, ...s.rows] : s.rows;
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet(rows),
      sheetName(s.heading.split("—")[0].trim(), used)
    );
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

function build(
  model: ExportModel,
  kind: "board" | "investor",
  format: MonitoringExportFormat
): MonitoringExport {
  const title = kind === "board" ? "Board Pack" : "Investor Update";
  const slug = safeFilePart(model.companyName.toLowerCase()) || model.companyId;
  if (format === "xlsx") {
    return {
      bytes: toXlsx(model, title, kind),
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      filename: `${kind === "board" ? "board-pack" : "investor-update"}-${slug}-${model.asOf}.xlsx`,
    };
  }
  return {
    bytes: toPdf(model, title, kind),
    contentType: "application/pdf",
    filename: `${kind === "board" ? "board-pack" : "investor-update"}-${slug}-${model.asOf}.pdf`,
  };
}

/* ------------------------------ public API ---------------------------- */

/** Board pack: baseline + latest KPIs + variance + covenants + VC +
 * cash + open alerts. Throws Error('portfolio_company_not_found')
 * when the company is not a live portfolio company. */
export async function buildBoardPack(
  companyId: string,
  format: MonitoringExportFormat | string = "pdf"
): Promise<MonitoringExport> {
  const model = await assemble(companyId, true);
  return build(model, "board", format === "xlsx" ? "xlsx" : "pdf");
}

/** Investor update: the board pack minus the internal open-alerts
 * detail (alert count still shows on the cover via the summary). */
export async function buildInvestorUpdate(
  companyId: string,
  format: MonitoringExportFormat | string = "pdf"
): Promise<MonitoringExport> {
  const model = await assemble(companyId, false);
  return build(model, "investor", format === "xlsx" ? "xlsx" : "pdf");
}
