import { createHash } from "crypto";
import { sql, num, str } from "../platform/db";
import { buildSimplePdf, type PdfSection } from "../financials/pdf";
import { getStorageProvider } from "../storage";
import { ensureComms } from "./schema";
import type { AppendixFigure, ReportRender } from "./types";

/**
 * Branded report PDF (Part 12) — built on the financials module's
 * dependency-free buildSimplePdf. Structure: cover section, one
 * section per visible render block, a full appendix section (every
 * figure with source + verification), and a closing disclaimers
 * section. Sample reports carry 'SAMPLE — NOT A REAL REPORT' as the
 * first line of EVERY section.
 *
 * Bytes live ONLY in the storage provider at
 * `comms/<reportId>/v<version>.pdf`; comms.report_files stores the
 * key, byte count, and sha256 (never the bytes).
 */

export interface ReportPdfMeta {
  id: string;
  title?: string;
  currentVersion?: number;
  isSample?: boolean;
}

const SAMPLE_LINE = "SAMPLE — NOT A REAL REPORT";

export function formatFigureValue(fig: AppendixFigure): string {
  if (fig.value === null || fig.value === undefined || fig.value === "") {
    return "—";
  }
  if (typeof fig.value === "string") return fig.value;
  const n = fig.value;
  switch (fig.format) {
    case "money":
      return `$${Math.round(n).toLocaleString("en-US")}`;
    case "pct":
      return `${(Math.abs(n) <= 1 ? n * 100 : n).toFixed(1)}%`;
    case "multiple":
      return `${n.toFixed(2)}x`;
    case "number":
      return n.toLocaleString("en-US");
    default:
      return String(n);
  }
}

function figureLine(fig: AppendixFigure): string {
  const source = fig.sourceLabel || fig.sourceModule || "";
  return `${fig.label}: ${formatFigureValue(fig)} — ${source} (${fig.verification})`;
}

function withSample(lines: string[], sample: boolean): string[][] {
  const rows = lines.map((l) => [l]);
  return sample ? [[SAMPLE_LINE], ...rows] : rows;
}

/**
 * Build the branded PDF for an (already audience-filtered) render.
 * Async signature (Promise<Buffer>) so route handlers can treat the
 * result uniformly with the stored-PDF fetch; the build itself is
 * synchronous CPU work over buildSimplePdf.
 */
export async function buildReportPdf(
  report: ReportPdfMeta,
  renderInput: ReportRender
): Promise<Buffer> {
  const render: ReportRender = renderInput ?? {
    title: report.title ?? "Report",
    subjectLabel: "",
    asOf: "",
    sample: Boolean(report.isSample),
    firm: "Canny Capital Partners",
    disclaimers: [],
    blocks: [],
    warnings: [],
  };
  const sample = Boolean(report.isSample || render.sample);
  const sections: PdfSection[] = [];

  const coverLines = [
    "Canny Capital Partners",
    render.title || report.title || "Report",
    render.subjectLabel ? `Subject: ${render.subjectLabel}` : "",
    render.asOf ? `As of: ${render.asOf}` : "",
    ...(render.disclaimers ?? []),
  ].filter(Boolean);
  sections.push({
    heading: "Canny Capital Partners",
    rows: withSample(coverLines, sample),
  });

  for (const block of render.blocks ?? []) {
    const lines: string[] = [];
    if (block.dataStatus && block.dataStatus !== "ok") {
      lines.push(`Status: ${block.dataStatus}`);
    }
    if (block.table) {
      lines.push(block.table.columns.join(" | "));
      for (const row of block.table.rows) {
        lines.push(
          row.map((c) => (c === null || c === undefined ? "—" : String(c))).join(" | ")
        );
      }
    }
    if (block.text) {
      lines.push(...block.text.split("\n"));
    }
    if (block.narrative?.statements?.length) {
      for (const s of block.narrative.statements) {
        const refs = (s.figureKeys ?? []).map((k) => `[fig: ${k}]`).join(" ");
        lines.push(refs ? `${s.text} ${refs}` : s.text);
      }
    } else if (block.type === "narrative") {
      lines.push(`(Narrative ${block.narrative?.status ?? "pending"})`);
    }
    for (const fig of block.figures ?? []) {
      lines.push(figureLine(fig));
    }
    if (!lines.length) lines.push("(no content)");
    sections.push({
      heading: block.heading || block.type,
      rows: withSample(lines, sample),
    });
  }

  // Appendix: every figure in the render, deduped by key.
  const seen = new Set<string>();
  const appendixLines: string[] = [];
  for (const block of render.blocks ?? []) {
    for (const fig of block.figures ?? []) {
      if (seen.has(fig.key)) continue;
      seen.add(fig.key);
      appendixLines.push(figureLine(fig));
    }
  }
  sections.push({
    heading: "Appendix — Figures & Sources",
    rows: withSample(
      appendixLines.length ? appendixLines : ["(no figures)"],
      sample
    ),
  });

  const disclaimerLines = [
    ...(render.disclaimers ?? []),
    "This report was prepared by Canny Capital Partners for the named audience. Figures are drawn from the sources listed in the appendix; figures marked 'unreviewed' have not completed partner review. This document is confidential and intended only for its recipients.",
  ];
  sections.push({
    heading: "Disclaimers",
    rows: withSample(disclaimerLines, sample),
  });

  return buildSimplePdf({
    title: render.title || report.title || "Report",
    subtitle: render.subjectLabel || undefined,
    sections,
  });
}

export interface StoredReportPdf {
  storageKey: string;
  bytes: number;
  sha256: string;
  buffer: Buffer;
}

/** Build + store the PDF for a report version; upsert report_files. */
export async function storeReportPdf(
  report: ReportPdfMeta & { id: string; currentVersion: number },
  render: ReportRender
): Promise<StoredReportPdf> {
  await ensureComms();
  const buffer = await buildReportPdf(report, render);
  const storageKey = `comms/${report.id}/v${report.currentVersion}.pdf`;
  const provider = getStorageProvider();
  await provider.put(storageKey, buffer);
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const db = sql();
  await db`
    INSERT INTO comms.report_files (report_id, version, storage_key, bytes, sha256)
    VALUES (${report.id}, ${report.currentVersion}, ${storageKey},
      ${buffer.length}, ${sha256})
    ON CONFLICT (report_id, version) DO UPDATE SET
      storage_key = EXCLUDED.storage_key,
      bytes = EXCLUDED.bytes,
      sha256 = EXCLUDED.sha256,
      created_at = now()`;
  return { storageKey, bytes: buffer.length, sha256, buffer };
}

/** Fetch a previously stored PDF; null when none was stored. */
export async function getStoredReportPdf(
  reportId: string,
  version: number
): Promise<Buffer | null> {
  await ensureComms();
  const db = sql();
  const rows = await db`
    SELECT storage_key FROM comms.report_files
    WHERE report_id = ${reportId} AND version = ${version} LIMIT 1`;
  if (!rows.length) return null;
  const key = str((rows[0] as Record<string, unknown>).storage_key);
  if (!key) return null;
  const provider = getStorageProvider();
  try {
    if (!(await provider.exists(key))) return null;
    return await provider.get(key);
  } catch {
    return null;
  }
}

/** Contract name for getStoredReportPdf (used by the PDF routes). */
export const getReportPdf = getStoredReportPdf;

/** Metadata for a stored PDF (no bytes) — used by status/diagnostics. */
export async function getReportPdfMeta(
  reportId: string,
  version: number
): Promise<{ storageKey: string; bytes: number; sha256: string } | null> {
  await ensureComms();
  const db = sql();
  const rows = await db`
    SELECT storage_key, bytes, sha256 FROM comms.report_files
    WHERE report_id = ${reportId} AND version = ${version} LIMIT 1`;
  if (!rows.length) return null;
  const rec = rows[0] as Record<string, unknown>;
  return {
    storageKey: str(rec.storage_key),
    bytes: num(rec.bytes),
    sha256: str(rec.sha256),
  };
}
