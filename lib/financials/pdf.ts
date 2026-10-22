/**
 * Minimal PDF writer for financial-statement exports (Phase 4).
 *
 * Hand-rolled PDF 1.4: US Letter, Helvetica / Helvetica-Bold, no
 * dependencies. Text is laid out as a flat list of styled lines and
 * paginated by cumulative line height (~48 body lines per page).
 * All output is latin1-safe (non-latin1 glyphs are replaced, PDF string
 * escapes are octal for bytes > 126) so byte offsets in the xref table
 * stay exact.
 */

export interface PdfSection {
  heading: string;
  rows: string[][];
}

export interface SimplePdfInput {
  title: string;
  subtitle?: string;
  sections: PdfSection[];
}

const PAGE_W = 612; // US Letter, points
const PAGE_H = 792;
const MARGIN = 54;
const CONTENT_W = PAGE_W - MARGIN * 2;
const TOP = PAGE_H - MARGIN;
const BOTTOM = MARGIN;

/** WinAnsi code points for common punctuation beyond ASCII. */
const WINANSI_PUNCT: Record<number, number> = {
  8364: 0x80, // €
  8230: 0x85, // …
  8220: 0x93, // "
  8221: 0x94, // "
  8226: 0x95, // •
  8211: 0x96, // –
  8212: 0x97, // —
  8216: 0x91, // '
  8217: 0x92, // '
};

/** Escape a string for a PDF literal string, latin1/octal safe. */
function escapePdfText(input: string): string {
  let out = "";
  for (const ch of input ?? "") {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === "\\") out += "\\\\";
    else if (ch === "(") out += "\\(";
    else if (ch === ")") out += "\\)";
    else if (WINANSI_PUNCT[code] !== undefined) {
      out += "\\" + WINANSI_PUNCT[code].toString(8).padStart(3, "0");
    }
    else if (code === 10 || code === 13 || code === 9) out += " ";
    else if (code >= 32 && code <= 126) out += ch;
    else if (code >= 160 && code <= 255) {
      out += "\\" + code.toString(8).padStart(3, "0");
    } else if (code > 127 && code < 160) {
      out += "?";
    } else if (code > 255) {
      out += "?";
    } else {
      out += " ";
    }
  }
  return out;
}

/** Rough Helvetica advance: ~0.52em average for mixed-case text. */
function approxWidth(text: string, size: number): number {
  return text.length * size * 0.5;
}

/** Hard-truncate a line to the content width (exports are tabular). */
function fitLine(text: string, size: number): string {
  const maxChars = Math.max(10, Math.floor(CONTENT_W / (size * 0.5)));
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 1) + "…".replace("…", ">");
}

interface LayoutLine {
  text: string;
  size: number;
  bold: boolean;
  /** Vertical space consumed by this line (leading + extra gap). */
  height: number;
  gapBefore: number;
}

function layout(input: SimplePdfInput): LayoutLine[] {
  const lines: LayoutLine[] = [];
  lines.push({
    text: fitLine(input.title || "Financial Statements", 16),
    size: 16,
    bold: true,
    height: 22,
    gapBefore: 0,
  });
  if (input.subtitle) {
    lines.push({
      text: fitLine(input.subtitle, 10),
      size: 10,
      bold: false,
      height: 14,
      gapBefore: 2,
    });
  }
  for (const section of input.sections) {
    lines.push({
      text: fitLine(section.heading || "", 12),
      size: 12,
      bold: true,
      height: 17,
      gapBefore: 12,
    });
    if (!section.rows.length) {
      lines.push({
        text: "(no lines)",
        size: 9,
        bold: false,
        height: 13,
        gapBefore: 0,
      });
    }
    for (const row of section.rows) {
      const text = row.map((c) => String(c ?? "")).join("   ");
      lines.push({
        text: fitLine(text, 9),
        size: 9,
        bold: false,
        height: 13,
        gapBefore: 0,
      });
    }
  }
  // Keep approxWidth referenced for future column layout work.
  void approxWidth;
  return lines;
}

function paginate(lines: LayoutLine[]): LayoutLine[][] {
  const pages: LayoutLine[][] = [];
  let current: LayoutLine[] = [];
  let used = 0;
  const capacity = TOP - BOTTOM;
  for (const line of lines) {
    const need = line.gapBefore + line.height;
    if (current.length > 0 && used + need > capacity) {
      pages.push(current);
      current = [];
      used = 0;
    }
    current.push(line);
    used += need;
  }
  if (current.length || !pages.length) pages.push(current);
  return pages;
}

function pageContentStream(lines: LayoutLine[], pageNum: number, pageCount: number): string {
  const parts: string[] = [];
  let y = TOP;
  for (const line of lines) {
    y -= line.gapBefore;
    y -= line.size;
    const font = line.bold ? "F2" : "F1";
    parts.push(
      `BT /${font} ${line.size} Tf 1 0 0 1 ${MARGIN} ${y.toFixed(1)} Tm (${escapePdfText(line.text)}) Tj ET`
    );
    y -= line.height - line.size;
  }
  // Footer: page x of y, small grey text.
  const footer = `Page ${pageNum} of ${pageCount}`;
  parts.push(
    `BT /F1 8 Tf 1 0 0 1 ${MARGIN} ${BOTTOM - 18} Tm (${escapePdfText(footer)}) Tj ET`
  );
  return parts.join("\n");
}

/**
 * Build a complete, valid PDF document and return it as a Buffer.
 * Object layout: 1=Catalog, 2=Pages, 3=Helvetica, 4=Helvetica-Bold,
 * then per page: Page object + Contents object.
 */
export function buildSimplePdf(input: SimplePdfInput): Buffer {
  const pages = paginate(layout(input));
  const pageCount = pages.length;

  const objects: string[] = [];
  // 1: Catalog
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  // 2: Pages (kids filled in below, indices known once pageCount known)
  const kids: string[] = [];
  for (let i = 0; i < pageCount; i++) {
    const pageObjNum = 5 + i * 2;
    kids.push(`${pageObjNum} 0 R`);
  }
  objects.push(`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`);
  // 3/4: Fonts
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  // Per-page objects
  for (let i = 0; i < pageCount; i++) {
    const content = pageContentStream(pages[i], i + 1, pageCount);
    const contentBytes = Buffer.byteLength(content, "latin1");
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`
    );
    objects.push(
      `<< /Length ${contentBytes} >>\nstream\n${content}\nendstream`
    );
  }

  // Serialize with exact byte offsets (everything is latin1-safe).
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objects.length + 1}\n`;
  out += "0000000000 65535 f \n";
  for (const off of offsets) {
    out += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
