import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { buildSimplePdf, type PdfSection } from "../financials/pdf";

/**
 * Signing PDF engine (in-house e-signature build, Workstream B).
 *
 * Signature pages are rendered with the platform's dependency-free
 * writer (lib/financials/pdf.ts buildSimplePdf) so their geometry is
 * FULLY deterministic: every line's advance (gapBefore + height) is a
 * constant of that writer, which lets signatureFieldRects() compute —
 * with a faithful simulation of the writer's own pagination — the
 * exact pdf-lib (bottom-up) rectangle each signature appearance must
 * be stamped into. The SAME sections builder backs both flows:
 *
 *  - docgen preset blocks: generate.ts appends the sections to the
 *    generated document (first section pageBreakBefore) and persists
 *    signatureFieldRects() output into docgen.generations.
 *  - append mode: prepareDocument() renders the sections as a
 *    standalone signature page and merges it onto any source PDF.
 *
 * Writer constants (lib/financials/pdf.ts — do not change there
 * without updating these): Letter 612×792pt, MARGIN 54, TOP 738,
 * BOTTOM 54, per-page capacity 684pt. Line advances: title 22
 * (gap 0 + height 22, size 16), subtitle 16 (gap 2 + height 14,
 * size 10), section heading 29 (gap 12 + height 17, size 12),
 * body row 13 (gap 0 + height 13, size 9).
 *
 * Coordinate conversion: buildSimplePdf flows TOP-DOWN — a line
 * whose in-page consumed offset is C has its baseline at
 * top-down y = MARGIN + C + gapBefore + size. pdf-lib draws
 * BOTTOM-UP, so a top-down baseline B maps to PDF y = 792 − B.
 * Each signature rect is anchored with its BOTTOM edge exactly on
 * the "Signature:" line's baseline (the image sits on the line),
 * x = MARGIN, width 260, height 36.
 *
 * Per-signer block lines (advances): heading/caption 29, spacer 13,
 * spacer 13, "Signature:" row 13, caption row (blank in the rendered
 * page — applySignatures stamps the gray caption text there) 13,
 * "Printed name" 13, optional "Title" 13, "Date" 13.
 */

export const SIG_PAGE_W = 612;
export const SIG_PAGE_H = 792;
export const SIG_MARGIN = 54;
export const SIG_PAGE_CAPACITY = 684; // TOP (738) − BOTTOM (54)
export const SIG_TITLE_ADVANCE = 22;
export const SIG_SUBTITLE_ADVANCE = 16;
export const SIG_HEADING_ADVANCE = 29;
export const SIG_ROW_ADVANCE = 13;
export const SIG_ROW_SIZE = 9;
export const SIG_RECT_X = SIG_MARGIN;
export const SIG_RECT_WIDTH = 260;
export const SIG_RECT_HEIGHT = 36;

/** Header lines of a standalone (append-mode) signature page:
 *  title + subtitle. */
export const SIG_APPEND_HEADER_LINES: readonly number[] = [
  SIG_TITLE_ADVANCE,
  SIG_SUBTITLE_ADVANCE,
];
/** Header lines of a docgen signature appendix on its fresh final
 *  page: the "Electronic Signatures" section heading + intro row. */
export const SIG_DOCGEN_HEADER_LINES: readonly number[] = [
  SIG_HEADING_ADVANCE,
  SIG_ROW_ADVANCE,
];

export interface SignatureRect {
  /** Page index RELATIVE to the first signature page (0-based). */
  page: number;
  /** pdf-lib bottom-up coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  roleIndex: number;
}

export interface SignatureField {
  signerIndex: number;
  /** Absolute page index within the prepared document. */
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Pure geometry: simulate buildSimplePdf's pagination over the
 * header lines + per-signer block lines and return each signer's
 * signature-appearance rect. Anchored to the signer's "Signature:"
 * line wherever pagination lands it, so a block that splits across
 * pages still gets a correct rect.
 */
export function signatureFieldRects(
  count: number,
  opts?: {
    headerLines?: readonly number[];
    /** Per signer: a title (string) or truthy flag adds the Title row. */
    titles?: ReadonlyArray<string | boolean | null | undefined>;
  }
): SignatureRect[] {
  const headerLines = opts?.headerLines ?? SIG_APPEND_HEADER_LINES;
  interface SimLine {
    advance: number;
    signerIndex: number;
    isSigLine: boolean;
  }
  const lines: SimLine[] = [];
  for (const advance of headerLines) {
    lines.push({ advance, signerIndex: -1, isSigLine: false });
  }
  for (let i = 0; i < count; i++) {
    const hasTitle = Boolean(opts?.titles?.[i]);
    lines.push({ advance: SIG_HEADING_ADVANCE, signerIndex: i, isSigLine: false });
    lines.push({ advance: SIG_ROW_ADVANCE, signerIndex: i, isSigLine: false }); // spacer
    lines.push({ advance: SIG_ROW_ADVANCE, signerIndex: i, isSigLine: false }); // spacer
    lines.push({ advance: SIG_ROW_ADVANCE, signerIndex: i, isSigLine: true }); // Signature:
    lines.push({ advance: SIG_ROW_ADVANCE, signerIndex: i, isSigLine: false }); // caption row
    lines.push({ advance: SIG_ROW_ADVANCE, signerIndex: i, isSigLine: false }); // Printed name
    if (hasTitle) {
      lines.push({ advance: SIG_ROW_ADVANCE, signerIndex: i, isSigLine: false }); // Title
    }
    lines.push({ advance: SIG_ROW_ADVANCE, signerIndex: i, isSigLine: false }); // Date
  }

  const rects: SignatureRect[] = [];
  let page = 0;
  let used = 0;
  let onPage = 0;
  for (const line of lines) {
    if (onPage > 0 && used + line.advance > SIG_PAGE_CAPACITY) {
      page += 1;
      used = 0;
      onPage = 0;
    }
    if (line.isSigLine) {
      // Baseline (top-down) = MARGIN + consumed-before + gapBefore(0) + size.
      const baselineTopDown = SIG_MARGIN + used + SIG_ROW_SIZE;
      rects.push({
        page,
        x: SIG_RECT_X,
        y: SIG_PAGE_H - baselineTopDown,
        width: SIG_RECT_WIDTH,
        height: SIG_RECT_HEIGHT,
        roleIndex: line.signerIndex,
      });
    }
    used += line.advance;
    onPage += 1;
  }
  return rects;
}

/* ------------------------- section builders ------------------------- */

export interface SignatureBlockInput {
  /** Section heading: "Signer 1: Name <email>" or a role label. */
  caption: string;
  printedName?: string;
  title?: string;
}

const SIG_LINE = `Signature: ${"_".repeat(38)}`;
const DATE_LINE = `Date: ${"_".repeat(20)}`;

/**
 * The shared signature-block sections. With `withHeader`, a leading
 * "Electronic Signatures" section (heading + intro row) is included —
 * the docgen appendix shape; its two lines are exactly
 * SIG_DOCGEN_HEADER_LINES. Without it, the sections are signer blocks
 * only — the append-mode page shape under the title/subtitle header
 * (SIG_APPEND_HEADER_LINES).
 */
export function buildSignatureSections(
  blocks: SignatureBlockInput[],
  opts?: { withHeader?: boolean; pageBreakFirst?: boolean }
): PdfSection[] {
  const sections: PdfSection[] = [];
  if (opts?.withHeader) {
    sections.push({
      heading: "Electronic Signatures",
      rows: [
        [
          "By signing below, each signer agrees to the terms of this document and to the use of electronic signatures via the Canny Capital Portal.",
        ],
      ],
      pageBreakBefore: opts?.pageBreakFirst === true,
    });
  }
  blocks.forEach((block, i) => {
    const rows: string[][] = [
      [""], // spacer — signature image zone
      [""], // spacer — signature image zone
      [SIG_LINE],
      [""], // caption row — stamped by applySignatures
      [`Printed name: ${block.printedName ?? ""}`],
    ];
    if (block.title) rows.push([`Title: ${block.title}`]);
    rows.push([DATE_LINE]);
    sections.push({
      heading: block.caption,
      rows,
      pageBreakBefore:
        i === 0 && !opts?.withHeader ? opts?.pageBreakFirst === true : false,
    });
  });
  return sections;
}

const SIG_PAGE_SUBTITLE = "Canny Capital Portal · Phoenix, Arizona";

/** Standalone signature page (append mode) as a buildSimplePdf input. */
export function buildSignaturePageInput(
  blocks: SignatureBlockInput[]
): { title: string; subtitle: string; sections: PdfSection[] } {
  return {
    title: "Electronic Signatures",
    subtitle: SIG_PAGE_SUBTITLE,
    sections: buildSignatureSections(blocks),
  };
}

/* --------------------------- prepare --------------------------- */

export interface PresetSignatureBlock {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  roleLabel: string;
}

export async function prepareDocument(input: {
  sourceBytes: Buffer;
  signers: Array<{ name: string; email: string }>;
  presetBlocks?: PresetSignatureBlock[] | null;
}): Promise<{
  bytes: Buffer;
  fieldMode: "template" | "append";
  fields: SignatureField[];
}> {
  const signers = input.signers ?? [];
  const preset = input.presetBlocks ?? null;
  if (preset && preset.length > 0 && preset.length === signers.length) {
    return {
      bytes: input.sourceBytes,
      fieldMode: "template",
      fields: preset.map((b, i) => ({
        signerIndex: i,
        page: b.page,
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
      })),
    };
  }

  const blocks: SignatureBlockInput[] = signers.map((s, i) => ({
    caption: `Signer ${i + 1}: ${s.name} <${s.email}>`,
    printedName: s.name,
  }));
  const sigPagePdf = buildSimplePdf(buildSignaturePageInput(blocks));

  const target = await PDFDocument.load(input.sourceBytes);
  const sourcePageCount = target.getPageCount();
  const sigDoc = await PDFDocument.load(sigPagePdf);
  const copied = await target.copyPages(
    sigDoc,
    sigDoc.getPageIndices()
  );
  for (const p of copied) target.addPage(p);
  const bytes = Buffer.from(await target.save());

  const fields = signatureFieldRects(signers.length).map((r) => ({
    signerIndex: r.roleIndex,
    page: sourcePageCount + r.page,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
  }));
  return { bytes, fieldMode: "append", fields };
}

/* --------------------------- stamping --------------------------- */

/** ISO-8601 timestamp in America/Phoenix (UTC−07:00 year-round). */
export function phoenixIso(d: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Phoenix",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}-07:00`;
}

/** pdf-lib standard fonts are WinAnsi-only; drop anything outside it. */
function winAnsiSafe(text: string): string {
  return (text ?? "")
    .replace(/·/g, "-")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
}

export interface SignatureStamp {
  kind: "typed" | "drawn";
  typedName?: string;
  pngBytes?: Buffer;
  /** For the caption line; defaults to typedName. */
  signerName?: string;
  /** Per-signer signing time; defaults to now. */
  signedAtIso?: string;
}

/**
 * Stamp each signer's signature into its field rect (drawn PNG scaled
 * to fit, or typed name in Times-Roman Italic shrunk to fit), plus the
 * gray caption in the caption row directly under the rect. Returns the
 * stamped bytes — NOT yet cryptographically sealed (see finalize.ts).
 */
export async function applySignatures(
  preparedBytes: Buffer,
  fields: SignatureField[],
  signatures: SignatureStamp[]
): Promise<Buffer> {
  const doc = await PDFDocument.load(preparedBytes);
  const helvetica = await doc.embedFont(StandardFonts.Helvetica);
  const italic = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const gray = rgb(0.42, 0.42, 0.42);

  const ordered = [...fields].sort((a, b) => a.signerIndex - b.signerIndex);
  for (const field of ordered) {
    const sig = signatures[field.signerIndex];
    if (!sig) continue;
    if (field.page < 0 || field.page >= doc.getPageCount()) {
      throw new Error(`signature_field_page_out_of_range:${field.page}`);
    }
    const page = doc.getPage(field.page);

    if (sig.kind === "drawn" && sig.pngBytes && sig.pngBytes.length) {
      const img = await doc.embedPng(sig.pngBytes);
      const scale = Math.min(
        field.width / img.width,
        field.height / img.height
      );
      const w = img.width * scale;
      const h = img.height * scale;
      page.drawImage(img, {
        x: field.x + (field.width - w) / 2,
        y: field.y, // bottom-aligned: the image sits on the signature line
        width: w,
        height: h,
      });
    } else {
      const name = winAnsiSafe(sig.typedName ?? sig.signerName ?? "");
      if (name) {
        let size = 20;
        while (
          size > 8 &&
          italic.widthOfTextAtSize(name, size) > field.width - 8
        ) {
          size -= 0.5;
        }
        page.drawText(name, {
          x: field.x + 2,
          y: field.y + (field.height - size * 0.8) / 2,
          size,
          font: italic,
          color: rgb(0.05, 0.1, 0.25),
        });
      }
    }

    const ts = sig.signedAtIso
      ? phoenixIso(new Date(sig.signedAtIso))
      : phoenixIso(new Date());
    const signerName = sig.signerName ?? sig.typedName ?? "";
    const caption = winAnsiSafe(
      `Electronically signed via Canny Capital Portal - ${ts}${signerName ? ` - ${signerName}` : ""}`
    );
    page.drawText(caption, {
      x: field.x,
      y: field.y - SIG_ROW_ADVANCE + 1, // the blank caption row under the rect
      size: 7.5,
      font: helvetica,
      color: gray,
    });
  }
  return Buffer.from(await doc.save());
}

/* --------------------- certificate of completion --------------------- */

export interface CertificateSignerEvidence {
  name: string;
  email: string;
  ip: string;
  userAgent: string;
  consentAt: string | null;
  viewedAt: string | null;
  signedAt: string | null;
  signatureKind: string;
  accessCodeUsed: boolean;
}

export interface CertificateData {
  envelopeId: string;
  documentName: string;
  sourceSha256: string;
  preparedSha256: string;
  executedSha256: string;
  completedAtIso: string;
  senderName: string;
  senderEmail: string;
  signers: CertificateSignerEvidence[];
  events: Array<{ kind: string; at: string; actor: string }>;
}

export const CERTIFICATE_DESIGN_NOTE =
  "Signatures are sealed with the Canny Capital Partners platform certificate (self-signed) and an internal timestamp with a hash-chained audit record; no external timestamp authority or third-party e-signature vendor is involved.";

function wrapText(text: string, width = 100): string[] {
  const words = (text ?? "").split(/\s+/).filter(Boolean);
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
  return out.length ? out : [""];
}

/** Multi-page-safe certificate of completion (buildSimplePdf flows). */
export function buildCertificateOfCompletion(data: CertificateData): Buffer {
  const sections: PdfSection[] = [];
  sections.push({
    heading: "Document",
    rows: [
      [`Document: ${data.documentName}`],
      [`Envelope ID: ${data.envelopeId}`],
      [`Completed: ${data.completedAtIso}`],
      [`Sent by: ${data.senderName} <${data.senderEmail}>`],
      [`SHA-256 (as-sent source): ${data.sourceSha256}`],
      [`SHA-256 (prepared for signing): ${data.preparedSha256}`],
      [`SHA-256 (executed, sealed): ${data.executedSha256}`],
    ],
  });
  data.signers.forEach((s, i) => {
    sections.push({
      heading: `Signer ${i + 1}: ${s.name} <${s.email}>`,
      rows: [
        [`Signature kind: ${s.signatureKind}`],
        [`Consent recorded: ${s.consentAt ?? "—"}`],
        [`Document viewed: ${s.viewedAt ?? "—"}`],
        [`Signed: ${s.signedAt ?? "—"}`],
        [`IP address: ${s.ip || "—"}`],
        [`Access code used: ${s.accessCodeUsed ? "yes" : "no"}`],
        ...wrapText(`User agent: ${s.userAgent || "—"}`).map((l) => [l]),
      ],
    });
  });
  sections.push({
    heading: "Event timeline",
    rows: data.events.length
      ? data.events.map((e) => [`${e.at}  ${e.kind}  (${e.actor})`])
      : [["(no events recorded)"]],
  });
  sections.push({
    heading: "About this certificate",
    rows: wrapText(CERTIFICATE_DESIGN_NOTE).map((l) => [l]),
  });
  return buildSimplePdf({
    title: "Certificate of Completion",
    subtitle: `Envelope ${data.envelopeId} · Canny Capital Partners`,
    sections,
  });
}
