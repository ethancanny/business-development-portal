import { createHash } from "crypto";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  degrees,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";
import { sql, num, str } from "../platform/db";
import { getStorageProvider } from "../storage";
import { monogramColor } from "../identity/shared";
import { ensureComms } from "./schema";
import {
  buildPresentModel,
  columnAlign,
  confidentialityLine,
  fmtDateLong,
  formatCell,
  formatFigure,
  notesLabel,
  periodLabel,
  type PresentSection,
} from "./present";
import type { AppendixFigure, ReportRender } from "./types";

/**
 * Institutional report PDF (Report redesign, Oct 24, 2026) — a real
 * print renderer on pdf-lib, mirroring the web document: navy cover
 * band with the firm wordmark, subject logo/monogram per codename
 * rules, executive summary tiles + takeaways, vector charts in the
 * company accent color, clean tables (rows never split), a numbered
 * sources appendix, running header/footer with page numbers and the
 * audience confidentiality line, and a subtle per-recipient
 * watermark on every page.
 *
 * Bytes live ONLY in the storage provider at
 * `comms/<reportId>/v<version>.pdf`; comms.report_files stores the
 * key, byte count, and sha256 (never the bytes). Recipient downloads
 * and email attachments are rebuilt per recipient (buildPersonalPdf
 * in delivery.ts) so the watermark is personal; the stored copy is
 * the shared internal snapshot of a version.
 */

export interface ReportPdfMeta {
  id: string;
  title?: string;
  currentVersion?: number;
  isSample?: boolean;
}

export interface ReportPdfOptions {
  /** Internal snapshot mode: internal-only blocks render and
   * missing sections carry a status line (the platform's stored
   * copy). Recipient builds leave this off — hidden means hidden. */
  internal?: boolean;
  audience?: string;
  recipientName?: string;
  recipientEmail?: string;
  preparedForOrg?: string;
  reportType?: string;
  purpose?: string;
  version?: number;
  subjectName?: string;
  subjectSecondary?: string | null;
  codenameActive?: boolean;
  /** PNG bytes of the subject logo (codename rules already applied). */
  subjectLogoPng?: Buffer | null;
  /** Monogram fallback when there is no logo (seed = company id). */
  subjectMonogram?: { initials: string; seed: string } | null;
  accentColor?: string;
  senderName?: string;
  senderEmail?: string;
  senderPhone?: string;
  confidentiality?: string;
}

const SAMPLE_LINE = "SAMPLE — NOT A REAL REPORT";
const FIRM_WORDMARK_URL = "https://cannycapitalpartners.com/canny-logo-white.png";

/** Kept for call-site compatibility; the canonical formatter lives
 * in present.ts so web and PDF can never diverge. */
export const formatFigureValue = formatFigure;

/* ------------------------------ colors ------------------------------ */

function hex(c: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(c.trim());
  if (!m) return { r: 0.05, g: 0.12, b: 0.24 };
  const n = parseInt(m[1], 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
const NAVY = rgb(0.051, 0.122, 0.235); // #0d1f3c
const NAVY_DEEP = rgb(0.031, 0.078, 0.149); // #081426
const GOLD = rgb(0.722, 0.592, 0.353); // #b8975a
const IVORY = rgb(0.969, 0.957, 0.925); // #f7f4ec
const BODY = rgb(0.29, 0.27, 0.25);
const MUTED = rgb(0.45, 0.43, 0.4);
const LINE = rgb(0.85, 0.83, 0.78);
const ZEBRA = rgb(0.976, 0.965, 0.941);
const UP = rgb(0.18, 0.42, 0.3);
const DOWN = rgb(0.62, 0.25, 0.22);
const SERIES = ["#0d1f3c", "#b8975a", "#3b5b84", "#2f7f79", "#b5703a"];

/* --------------------------- text helpers --------------------------- */

/** WinAnsi-safe text: map the punctuation our content uses onto
 * characters pdf-lib's standard fonts can encode. */
function san(s: string): string {
  return (s ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, "->")
    .replace(/[▲]/g, "^")
    .replace(/[▼]/g, "v")
    .replace(/≥/g, ">=")
    .replace(/≤/g, "<=")
    .replace(/[✓✔]/g, "Yes")
    .replace(/[^\x20-\x7E\xA0-\xFF—–‘’“”…•·–]/g, "");
}

/** Truncate a string so it fits `maxWidth` at the given font/size,
 * with an ellipsis. Prevents table cells colliding across columns. */
function fit(
  font: PDFFont,
  s: string,
  size: number,
  maxWidth: number
): string {
  const clean = san(s);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let out = clean;
  while (out.length > 1 && font.widthOfTextAtSize(`${out}…`, size) > maxWidth) {
    out = out.slice(0, -1);
  }
  return `${out.trimEnd()}…`;
}

function wrap(
  font: PDFFont,
  text: string,
  size: number,
  maxWidth: number
): string[] {
  const out: string[] = [];
  for (const para of san(text).split("\n")) {
    if (!para.trim()) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of para.split(/\s+/)) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) <= maxWidth || !line) {
        line = trial;
      } else {
        out.push(line);
        line = word;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/* --------------------------- firm wordmark -------------------------- */

let wordmarkCache: Promise<Buffer | null> | undefined;

async function firmWordmarkPng(): Promise<Buffer | null> {
  if (!wordmarkCache) {
    wordmarkCache = (async () => {
      try {
        const res = await fetch(FIRM_WORDMARK_URL, {
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return null;
        const buf = Buffer.from(await res.arrayBuffer());
        const sharp = (await import("sharp")).default;
        return await sharp(buf).png().toBuffer();
      } catch {
        return null;
      }
    })();
  }
  return wordmarkCache;
}

/* ------------------------------ renderer ---------------------------- */

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = PAGE_H - 58;
const BOTTOM = 64;

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  helv: PDFFont;
  helvB: PDFFont;
  helvO: PDFFont;
  times: PDFFont;
  timesB: PDFFont;
  accent: ReturnType<typeof rgb>;
  pages: PDFPage[];
}

function newPage(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.pages.push(ctx.page);
  ctx.y = TOP;
}

function ensure(ctx: Ctx, h: number): void {
  if (ctx.y - h < BOTTOM) newPage(ctx);
}

function text(
  ctx: Ctx,
  s: string,
  opts: {
    x?: number;
    size?: number;
    font?: PDFFont;
    color?: ReturnType<typeof rgb>;
    maxWidth?: number;
    lineHeight?: number;
    align?: "left" | "right" | "center";
  } = {}
): number {
  const size = opts.size ?? 9.5;
  const font = opts.font ?? ctx.helv;
  const lh = opts.lineHeight ?? size * 1.42;
  const maxWidth = opts.maxWidth ?? CONTENT_W;
  const lines = wrap(font, s, size, maxWidth);
  for (const line of lines) {
    if (line === "") {
      ctx.y -= lh * 0.6;
      continue;
    }
    ensure(ctx, lh);
    let x = opts.x ?? MARGIN;
    if (opts.align === "right") {
      x = (opts.x ?? MARGIN) + maxWidth - font.widthOfTextAtSize(line, size);
    } else if (opts.align === "center") {
      x = (opts.x ?? MARGIN) + (maxWidth - font.widthOfTextAtSize(line, size)) / 2;
    }
    ctx.page.drawText(line, { x, y: ctx.y - size, size, font, color: opts.color ?? BODY });
    ctx.y -= lh;
  }
  return lines.length;
}

function rule(ctx: Ctx, color = GOLD, thickness = 1.1): void {
  ensure(ctx, 8);
  ctx.page.drawLine({
    start: { x: MARGIN, y: ctx.y },
    end: { x: PAGE_W - MARGIN, y: ctx.y },
    thickness,
    color,
  });
  ctx.y -= 8;
}

/* ------------------------------ charts ------------------------------ */

function drawChart(
  ctx: Ctx,
  chart: NonNullable<PresentSection["block"]["chart"]>,
  accentFirst: boolean
): void {
  const H = 168;
  const labelW = 44;
  const chartW = CONTENT_W - labelW - 6;
  ensure(ctx, H + 26);
  const top = ctx.y;
  const bottom = top - H + 18;
  const xs: string[] = [];
  for (const s of chart.series) {
    for (const p of s.points) if (!xs.includes(p.x)) xs.push(p.x);
  }
  let maxY = 0;
  for (const s of chart.series) {
    for (const p of s.points) maxY = Math.max(maxY, p.y);
  }
  if (maxY <= 0 || xs.length === 0) return;
  maxY *= 1.12;
  const plotH = H - 34;
  const yOf = (v: number) => bottom + 16 + (v / maxY) * plotH;
  // gridlines + y labels
  for (let i = 0; i <= 3; i++) {
    const v = (maxY / 3) * i;
    const y = yOf(v);
    ctx.page.drawLine({
      start: { x: MARGIN + labelW, y },
      end: { x: MARGIN + labelW + chartW, y },
      thickness: 0.5,
      color: LINE,
    });
    const label =
      v >= 1_000_000
        ? `$${(v / 1_000_000).toFixed(1)}M`
        : v >= 1000
          ? `$${Math.round(v / 1000)}k`
          : `${Math.round(v)}`;
    const w = ctx.helv.widthOfTextAtSize(label, 7);
    ctx.page.drawText(label, {
      x: MARGIN + labelW - w - 4,
      y: y - 2.5,
      size: 7,
      font: ctx.helv,
      color: MUTED,
    });
  }
  const palette = chart.series.map((_, i) => {
    if (i === 0 && accentFirst) return ctx.accent;
    const c = hex(SERIES[i % SERIES.length]);
    return rgb(c.r, c.g, c.b);
  });
  if (chart.kind === "bar") {
    const groupW = chartW / xs.length;
    const barW = Math.min(26, (groupW * 0.7) / chart.series.length);
    xs.forEach((x, xi) => {
      chart.series.forEach((s, si) => {
        const pt = s.points.find((p) => p.x === x);
        if (!pt) return;
        const bx =
          MARGIN + labelW + xi * groupW + groupW / 2 -
          (barW * chart.series.length) / 2 + si * barW;
        ctx.page.drawRectangle({
          x: bx,
          y: bottom + 16,
          width: barW - 1.5,
          height: Math.max(0.5, yOf(pt.y) - (bottom + 16)),
          color: palette[si],
        });
      });
      const label = san(x);
      const w = ctx.helv.widthOfTextAtSize(label, 7);
      ctx.page.drawText(label, {
        x: MARGIN + labelW + xi * groupW + (groupW - w) / 2,
        y: bottom + 4,
        size: 7,
        font: ctx.helv,
        color: MUTED,
      });
    });
  } else {
    chart.series.forEach((s, si) => {
      const pts = xs
        .map((x, xi) => {
          const pt = s.points.find((p) => p.x === x);
          if (!pt) return null;
          return {
            x: MARGIN + labelW + (xi + 0.5) * (chartW / xs.length),
            y: yOf(pt.y),
          };
        })
        .filter((p): p is { x: number; y: number } => p !== null);
      for (let i = 1; i < pts.length; i++) {
        ctx.page.drawLine({
          start: pts[i - 1],
          end: pts[i],
          thickness: 1.4,
          color: palette[si],
        });
      }
      for (const p of pts) {
        ctx.page.drawCircle({ x: p.x, y: p.y, size: 1.8, color: palette[si] });
      }
    });
    xs.forEach((x, xi) => {
      const label = san(x);
      const w = ctx.helv.widthOfTextAtSize(label, 7);
      ctx.page.drawText(label, {
        x: MARGIN + labelW + (xi + 0.5) * (chartW / xs.length) - w / 2,
        y: bottom + 4,
        size: 7,
        font: ctx.helv,
        color: MUTED,
      });
    });
  }
  // legend
  let lx = MARGIN + labelW;
  const ly = top - 8;
  chart.series.forEach((s, si) => {
    ctx.page.drawRectangle({ x: lx, y: ly - 1, width: 8, height: 8, color: palette[si] });
    ctx.page.drawText(san(s.name), {
      x: lx + 11,
      y: ly,
      size: 7.5,
      font: ctx.helv,
      color: MUTED,
    });
    lx += 11 + ctx.helv.widthOfTextAtSize(san(s.name), 7.5) + 14;
  });
  ctx.y = bottom - 8;
}

/* ------------------------------ tables ------------------------------ */

function drawTable(
  ctx: Ctx,
  table: NonNullable<PresentSection["block"]["table"]>
): void {
  const cols = table.columns.length;
  if (!cols) return;
  // The widest column goes to the textiest one (longest string
  // cells — "Finding", "Figure", "KPI"); the rest share equally.
  let wideIdx = 0;
  let wideScore = -1;
  table.columns.forEach((_, i) => {
    let score = 0;
    for (const row of table.rows) {
      const v = row[i];
      if (typeof v === "string") score += v.length;
    }
    if (score > wideScore) {
      wideScore = score;
      wideIdx = i;
    }
  });
  const wideW = Math.min(215, CONTENT_W * 0.44);
  const restW = (CONTENT_W - wideW) / Math.max(1, cols - 1);
  const widths = table.columns.map((_, i) => (i === wideIdx ? wideW : restW));
  const aligns = table.columns.map((_, i) =>
    i === wideIdx ? "left" : columnAlign(table.rows, i)
  );
  const rowH = 15.5;
  const drawHeader = () => {
    ensure(ctx, rowH + 2);
    ctx.page.drawRectangle({
      x: MARGIN,
      y: ctx.y - rowH + 3.5,
      width: CONTENT_W,
      height: rowH,
      color: NAVY,
    });
    let x = MARGIN;
    table.columns.forEach((c, i) => {
      const label = fit(ctx.helvB, san(c).toUpperCase(), 7.2, widths[i] - 12);
      const w = ctx.helvB.widthOfTextAtSize(label, 7.2);
      const tx =
        aligns[i] === "right" ? x + widths[i] - w - 6 : x + 6;
      ctx.page.drawText(label, {
        x: tx,
        y: ctx.y - rowH + 8,
        size: 7.2,
        font: ctx.helvB,
        color: IVORY,
      });
      x += widths[i];
    });
    ctx.y -= rowH + 2;
  };
  drawHeader();
  table.rows.forEach((row, ri) => {
    if (ctx.y - rowH < BOTTOM) {
      newPage(ctx);
      drawHeader();
    }
    if (ri % 2 === 1) {
      ctx.page.drawRectangle({
        x: MARGIN,
        y: ctx.y - rowH + 3.5,
        width: CONTENT_W,
        height: rowH,
        color: ZEBRA,
      });
    }
    let x = MARGIN;
    row.forEach((cell, ci) => {
      const font = ci === wideIdx ? ctx.helvB : ctx.helv;
      const val = fit(font, formatCell(cell), 8.3, widths[ci] - 12);
      const isSeverity = /severity/i.test(table.columns[ci] ?? "");
      const sev = String(cell ?? "").toLowerCase();
      let color = BODY;
      if (isSeverity) {
        if (sev === "high" || sev === "critical") color = DOWN;
        else if (sev === "medium") color = rgb(0.55, 0.42, 0.13);
        else if (sev === "low") color = UP;
      }
      const w = font.widthOfTextAtSize(val, 8.3);
      const tx = aligns[ci] === "right" ? x + widths[ci] - w - 6 : x + 6;
      ctx.page.drawText(val, {
        x: tx,
        y: ctx.y - rowH + 8,
        size: 8.3,
        font,
        color,
      });
      x += widths[ci];
    });
    ctx.y -= rowH;
    ctx.page.drawLine({
      start: { x: MARGIN, y: ctx.y + 3.5 },
      end: { x: PAGE_W - MARGIN, y: ctx.y + 3.5 },
      thickness: 0.4,
      color: LINE,
    });
  });
  ctx.y -= 6;
}

/* ------------------------------ sections ----------------------------- */

function drawSection(
  ctx: Ctx,
  section: PresentSection,
  footnotes: Record<string, number>
): void {
  ctx.y -= 6;
  rule(ctx);
  ensure(ctx, 30);
  ctx.page.drawText(san(section.heading), {
    x: MARGIN,
    y: ctx.y - 14,
    size: 14.5,
    font: ctx.timesB,
    color: NAVY,
  });
  ctx.y -= 24;
  if (section.internalOnly || section.dataStatus !== "ok") {
    // Reachable only in internal snapshot mode — recipient models
    // hide these sections entirely.
    const label = section.internalOnly
      ? "Internal only"
      : section.dataStatus === "missing"
        ? "Status: data missing"
        : "Status: not applicable";
    text(ctx, label, { size: 8, font: ctx.helvB, color: MUTED });
    ctx.y -= 2;
  }
  if (section.headline && section.type !== "narrative") {
    text(ctx, section.headline, { size: 9.5, font: ctx.helvO, color: MUTED });
    ctx.y -= 2;
  }
  const b = section.block;

  if (b.type === "narrative") {
    for (const s of b.narrative?.statements ?? []) {
      const refs = (s.figureKeys ?? [])
        .map((k) => footnotes[k])
        .filter((n): n is number => typeof n === "number")
        .map((n) => `[${n}]`)
        .join(" ");
      text(ctx, refs ? `${s.text} ${refs}` : s.text, { size: 9.5 });
      ctx.y -= 3;
    }
  }

  if (b.table?.rows?.length) drawTable(ctx, b.table);
  if (b.chart?.series?.length) drawChart(ctx, b.chart, true);

  if (b.text && b.type !== "narrative") {
    // Memo-style text carries "## " subheads; citations render small.
    for (const rawLine of b.text.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        ctx.y -= 3;
        continue;
      }
      if (line.startsWith("## ")) {
        ctx.y -= 2;
        ensure(ctx, 16);
        ctx.page.drawText(san(line.slice(3)), {
          x: MARGIN,
          y: ctx.y - 10.5,
          size: 10.5,
          font: ctx.timesB,
          color: NAVY,
        });
        ctx.y -= 16;
      } else if (/^citations:/i.test(line)) {
        text(ctx, line, { size: 7.8, font: ctx.helvO, color: MUTED });
      } else if (b.type === "findings") {
        // The findings summary sentence already ran as the headline.
        continue;
      } else {
        text(ctx, line, { size: 9.5 });
      }
    }
  }

  // Figures without a table: compact label/value rows with the
  // footnote number that ties them to the appendix.
  if (!b.table && (b.figures?.length ?? 0) > 0) {
    ctx.y -= 2;
    for (const f of b.figures) {
      ensure(ctx, 14);
      const note = footnotes[f.key] ? ` [${footnotes[f.key]}]` : "";
      ctx.page.drawText(san(f.label), {
        x: MARGIN,
        y: ctx.y - 8.5,
        size: 8.5,
        font: ctx.helv,
        color: MUTED,
      });
      const val = `${formatFigure(f)}${note}`;
      const w = ctx.helvB.widthOfTextAtSize(san(val), 8.5);
      ctx.page.drawText(san(val), {
        x: PAGE_W - MARGIN - w,
        y: ctx.y - 8.5,
        size: 8.5,
        font: ctx.helvB,
        color: NAVY,
      });
      ctx.y -= 14;
    }
  } else if (b.table && section.figureNotes.length) {
    text(ctx, `Sources: ${notesLabel(section.figureNotes)} in the appendix.`, {
      size: 7.8,
      font: ctx.helvO,
      color: MUTED,
    });
  }
  ctx.y -= 6;
}

/* ------------------------------ build ------------------------------- */

/**
 * Build the institutional PDF for an (already audience-filtered)
 * render. `appendix` defaults to the render's own figures.
 */
export async function buildReportPdf(
  report: ReportPdfMeta,
  renderInput: ReportRender,
  appendixInput?: AppendixFigure[],
  opts: ReportPdfOptions = {}
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
  const purpose = opts.purpose;
  const model = buildPresentModel(render, {
    purpose,
    internal: Boolean(opts.internal),
  });
  const appendix = appendixInput ?? model.appendix;
  const footnotes: Record<string, number> = {};
  appendix.forEach((f, i) => {
    footnotes[f.key] = i + 1;
  });
  const reportType = opts.reportType || report.title || render.title || "Report";
  const subjectName =
    opts.subjectName !== undefined ? opts.subjectName : render.subjectLabel;
  const version = opts.version ?? report.currentVersion ?? 1;
  const confidentiality =
    opts.confidentiality ??
    confidentialityLine(opts.audience, opts.recipientName);
  const accentHex = opts.accentColor;

  const doc = await PDFDocument.create();
  const ctx: Ctx = {
    doc,
    page: doc.addPage([PAGE_W, PAGE_H]),
    y: TOP,
    helv: await doc.embedFont(StandardFonts.Helvetica),
    helvB: await doc.embedFont(StandardFonts.HelveticaBold),
    helvO: await doc.embedFont(StandardFonts.HelveticaOblique),
    times: await doc.embedFont(StandardFonts.TimesRoman),
    timesB: await doc.embedFont(StandardFonts.TimesRomanBold),
    accent: accentHex
      ? (() => {
          const c = hex(accentHex);
          return rgb(c.r, c.g, c.b);
        })()
      : NAVY,
    pages: [],
  };
  ctx.pages.push(ctx.page);

  /* ------------------------------ cover ------------------------------ */
  const cover = ctx.page;
  // Navy band with the firm wordmark.
  cover.drawRectangle({ x: 0, y: PAGE_H - 148, width: PAGE_W, height: 148, color: NAVY_DEEP });
  const wordmark = await firmWordmarkPng();
  if (wordmark) {
    try {
      const img = await doc.embedPng(wordmark);
      const scale = Math.min(250 / img.width, 54 / img.height);
      cover.drawImage(img, {
        x: MARGIN,
        y: PAGE_H - 62 - img.height * scale + 22,
        width: img.width * scale,
        height: img.height * scale,
      });
    } catch {
      cover.drawText("CANNY CAPITAL PARTNERS", {
        x: MARGIN, y: PAGE_H - 78, size: 15, font: ctx.helvB, color: IVORY,
      });
    }
  } else {
    cover.drawText("CANNY CAPITAL PARTNERS", {
      x: MARGIN, y: PAGE_H - 78, size: 15, font: ctx.helvB, color: IVORY,
    });
  }
  cover.drawText(san(reportType).toUpperCase(), {
    x: MARGIN, y: PAGE_H - 118, size: 9.5, font: ctx.helvB, color: GOLD,
  });
  cover.drawLine({
    start: { x: 0, y: PAGE_H - 148 },
    end: { x: PAGE_W, y: PAGE_H - 148 },
    thickness: 2.2,
    color: GOLD,
  });

  let cy = PAGE_H - 196;
  // Subject mark: logo image, or monogram, or (codename) nothing.
  if (!opts.codenameActive && opts.subjectLogoPng) {
    try {
      const img = await doc.embedPng(opts.subjectLogoPng);
      const scale = Math.min(150 / img.width, 44 / img.height);
      cover.drawImage(img, {
        x: MARGIN,
        y: cy - img.height * scale + 12,
        width: img.width * scale,
        height: img.height * scale,
      });
      cy -= Math.max(30, img.height * scale) + 8;
    } catch {
      /* fall through to title */
    }
  } else if (!opts.codenameActive && opts.subjectMonogram) {
    const c = hex(monogramColor(opts.subjectMonogram.seed));
    cover.drawRectangle({
      x: MARGIN, y: cy - 26, width: 40, height: 40,
      color: rgb(c.r, c.g, c.b),
    });
    const init = san(opts.subjectMonogram.initials);
    const w = ctx.timesB.widthOfTextAtSize(init, 16);
    cover.drawText(init, {
      x: MARGIN + (40 - w) / 2, y: cy - 15, size: 16, font: ctx.timesB, color: IVORY,
    });
    cy -= 50;
  }

  // Cover title: the render title minus a trailing " — {subject}"
  // (assembly composes "{type} — {subject}"); the subject then gets
  // its own line instead of appearing twice.
  let coverTitle = render.title || reportType;
  if (subjectName && coverTitle.endsWith(` — ${subjectName}`)) {
    coverTitle = coverTitle.slice(0, coverTitle.length - subjectName.length - 3);
  }
  const titleLines = wrap(ctx.timesB, coverTitle, 25, CONTENT_W);
  for (const line of titleLines) {
    cover.drawText(line, { x: MARGIN, y: cy - 22, size: 25, font: ctx.timesB, color: NAVY });
    cy -= 32;
  }
  if (subjectName && subjectName !== coverTitle) {
    cover.drawText(san(subjectName), {
      x: MARGIN, y: cy - 13, size: 13, font: ctx.times, color: MUTED,
    });
    cy -= 26;
  }
  if (sample) {
    cover.drawText(SAMPLE_LINE, {
      x: MARGIN, y: cy - 12, size: 10.5, font: ctx.helvB, color: DOWN,
    });
    cy -= 24;
  }

  cy -= 14;
  const metaRows: [string, string][] = [
    ["Prepared for", opts.recipientName
      ? `${opts.recipientName}${opts.preparedForOrg ? `, ${opts.preparedForOrg}` : ""}`
      : "—"],
    ["Prepared by", `Canny Capital Partners${opts.senderName ? ` — ${opts.senderName}` : ""}`],
    ["Reporting period", periodLabel(purpose, render.asOf) || "—"],
    ["As of", render.asOf ? fmtDateLong(render.asOf) : "—"],
    ["Version", `Version ${version}`],
    ["Report ID", report.id],
  ];
  for (const [k, v] of metaRows) {
    cover.drawText(san(k).toUpperCase(), {
      x: MARGIN, y: cy - 9, size: 7.5, font: ctx.helvB, color: GOLD,
    });
    cover.drawText(san(v), {
      x: MARGIN + 118, y: cy - 9.5, size: 9.5, font: ctx.helv, color: BODY,
    });
    cy -= 17;
  }
  cover.drawText(san(confidentiality), {
    x: MARGIN, y: 84, size: 8, font: ctx.helvO, color: MUTED,
  });
  if (opts.senderEmail || opts.senderPhone) {
    cover.drawText(
      san(`Questions: ${[opts.senderName, opts.senderEmail, opts.senderPhone].filter(Boolean).join(" · ")}`),
      { x: MARGIN, y: 70, size: 8, font: ctx.helv, color: MUTED }
    );
  }

  /* --------------------------- TOC + body ---------------------------- */
  newPage(ctx);
  if (model.showToc) {
    text(ctx, "Contents", { size: 15, font: ctx.timesB, color: NAVY });
    ctx.y -= 4;
    rule(ctx);
    const tocItems = [
      ...(model.exec ? ["Executive summary"] : []),
      ...model.sections.map((s) => s.heading),
      "Sources and data",
      "Disclaimers",
    ];
    for (const item of tocItems) {
      ensure(ctx, 16);
      ctx.page.drawText(san(item), {
        x: MARGIN + 4, y: ctx.y - 10, size: 10, font: ctx.helv, color: BODY,
      });
      ctx.y -= 17;
    }
    newPage(ctx);
  }

  if (model.exec) {
    text(ctx, "Executive summary", { size: 15, font: ctx.timesB, color: NAVY });
    ctx.y -= 2;
    rule(ctx);
    const tiles = model.exec.tiles;
    if (tiles.length) {
      const cols = Math.min(3, tiles.length);
      const tileW = (CONTENT_W - (cols - 1) * 8) / cols;
      let rowY = ctx.y;
      tiles.forEach((tile, i) => {
        const col = i % cols;
        if (col === 0) {
          if (i > 0) rowY -= 62;
          ensure(ctx, 62);
        }
        const x = MARGIN + col * (tileW + 8);
        const topY = i < cols ? ctx.y : rowY;
        ctx.page.drawRectangle({
          x, y: topY - 52, width: tileW, height: 52, color: ZEBRA,
        });
        ctx.page.drawRectangle({
          x, y: topY - 52, width: 2.2, height: 52,
          color: i === 0 ? ctx.accent : GOLD,
        });
        ctx.page.drawText(san(tile.label).toUpperCase(), {
          x: x + 8, y: topY - 13, size: 6.8, font: ctx.helvB, color: MUTED,
        });
        ctx.page.drawText(san(tile.value), {
          x: x + 8, y: topY - 29, size: 13.5, font: ctx.helvB, color: NAVY,
        });
        if (tile.delta) {
          ctx.page.drawText(san(tile.delta), {
            x: x + 8, y: topY - 43, size: 7.5, font: ctx.helv,
            color: tile.deltaTone === "down" ? DOWN : tile.deltaTone === "up" ? UP : MUTED,
          });
        }
      });
      ctx.y = (tiles.length > cols ? rowY : ctx.y) - 60;
    }
    for (const t of model.exec.takeaways) {
      const line = `${t.text} (see ${model.sections.find((s) => s.key === t.sectionKey)?.heading ?? "below"})`;
      const lines = wrap(ctx.helv, line, 9.5, CONTENT_W - 14);
      ensure(ctx, lines.length * 13.5 + 2);
      ctx.page.drawText("•", { x: MARGIN + 2, y: ctx.y - 9.5, size: 9.5, font: ctx.helv, color: GOLD });
      for (const l of lines) {
        ctx.page.drawText(l, { x: MARGIN + 14, y: ctx.y - 9.5, size: 9.5, font: ctx.helv, color: BODY });
        ctx.y -= 13.5;
      }
      ctx.y -= 1.5;
    }
    ctx.y -= 4;
  }

  for (const section of model.sections) {
    drawSection(ctx, section, footnotes);
  }

  /* ----------------------------- appendix ---------------------------- */
  ctx.y -= 6;
  rule(ctx);
  ensure(ctx, 30);
  ctx.page.drawText("Sources and data", {
    x: MARGIN, y: ctx.y - 14, size: 14.5, font: ctx.timesB, color: NAVY,
  });
  ctx.y -= 24;
  if (!appendix.length) {
    text(ctx, "No figures were used in this report.", { size: 9.5, color: MUTED });
  } else {
    const table = {
      columns: ["#", "Figure", "Value", "Source", "Status"],
      rows: appendix.map((f, i) => [
        String(i + 1),
        f.label,
        formatFigure(f),
        f.sourceLabel || f.sourceModule,
        f.verification === "reviewed" ? "Reviewed" : "Unreviewed",
      ]) as (string | number | null)[][],
    };
    drawTable(ctx, table);
  }

  /* ---------------------------- disclaimers --------------------------- */
  ctx.y -= 6;
  rule(ctx);
  ensure(ctx, 30);
  ctx.page.drawText("Disclaimers", {
    x: MARGIN, y: ctx.y - 14, size: 14.5, font: ctx.timesB, color: NAVY,
  });
  ctx.y -= 24;
  const disclaimerLines = [
    ...(render.disclaimers ?? []),
    confidentiality,
    "Figures are drawn from the sources listed in the appendix; figures marked 'unreviewed' have not completed partner review.",
  ];
  for (const d of disclaimerLines) {
    text(ctx, d, { size: 8, color: MUTED });
    ctx.y -= 2;
  }

  /* --------------------- running header/footer ---------------------- */
  const total = ctx.pages.length;
  const watermark = [opts.recipientName, opts.recipientEmail]
    .filter(Boolean)
    .join("  ·  ");
  ctx.pages.forEach((page, i) => {
    if (watermark) {
      page.drawText(san(watermark), {
        x: PAGE_W / 2 - 150,
        y: PAGE_H / 2,
        size: 23,
        font: ctx.helv,
        color: NAVY,
        opacity: 0.045,
        rotate: degrees(32),
      });
    }
    if (i === 0) return; // cover carries its own band
    page.drawText("CANNY CAPITAL PARTNERS", {
      x: MARGIN, y: PAGE_H - 34, size: 7.5, font: ctx.helvB, color: MUTED,
    });
    const rt = san(reportType);
    page.drawText(rt, {
      x: PAGE_W - MARGIN - ctx.helv.widthOfTextAtSize(rt, 7.5),
      y: PAGE_H - 34, size: 7.5, font: ctx.helv, color: MUTED,
    });
    page.drawLine({
      start: { x: MARGIN, y: PAGE_H - 40 },
      end: { x: PAGE_W - MARGIN, y: PAGE_H - 40 },
      thickness: 0.6,
      color: GOLD,
    });
    const foot = san(confidentiality);
    page.drawText(foot.length > 88 ? `${foot.slice(0, 87)}…` : foot, {
      x: MARGIN, y: 34, size: 7.3, font: ctx.helv, color: MUTED,
    });
    const pg = `Page ${i + 1} of ${total}  ·  ${report.id}`;
    page.drawText(pg, {
      x: PAGE_W - MARGIN - ctx.helv.widthOfTextAtSize(pg, 7.3),
      y: 34, size: 7.3, font: ctx.helv, color: MUTED,
    });
  });

  const bytes = await doc.save();
  return Buffer.from(bytes);
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
  // The stored copy is the INTERNAL snapshot of the version (the
  // platform PDF route documents "internal full render"); recipient
  // surfaces never serve it directly — they rebuild per recipient.
  const buffer = await buildReportPdf(report, render, undefined, {
    internal: true,
  });
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
