import { inflateRawSync } from "zlib";
import { DRAFT_BANNER } from "./generate";

/**
 * Minimal DOCX writer / filler (contract generation, Oct 24, 2026).
 *
 * No new dependency: a Word .docx is a zip of XML parts. Writing uses
 * STORE (uncompressed) entries — valid OOXML that Word, LibreOffice
 * and Google Docs all open. Reading (for uploaded .docx templates)
 * parses the central directory and inflates with Node's zlib.
 *
 * Every composed document carries the guardrail banner in a real
 * header part: "Draft for attorney review."
 */

/* ------------------------------ zip ------------------------------ */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Build a zip archive with STORE entries. */
export function zipStore(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date (1980-01-01-ish, valid)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, e.data);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(0, 12);
    cd.writeUInt16LE(0x21, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(e.data.length, 20);
    cd.writeUInt32LE(e.data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += 30 + nameBuf.length + e.data.length;
  }
  const cdStart = offset;
  let cdSize = 0;
  for (const c of central) cdSize += c.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(cdStart, 16);
  return Buffer.concat([...chunks, ...central, end]);
}

/** Read all entries of a zip buffer into a name → bytes map. */
export function unzipEntries(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  // Locate the End Of Central Directory record (scan from the tail;
  // the comment length is normally 0 in files we consume).
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("invalid_docx_zip");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    // Skip the local header to the data.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) out.set(name, Buffer.from(raw));
    else if (method === 8) out.set(name, inflateRawSync(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* ----------------------------- OOXML ----------------------------- */

export function xmlEscape(s: string): string {
  return (s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:before="280" w:after="120"/><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style></w:styles>`;

function headerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:pStyle w:val="Normal"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="B0281F"/><w:sz w:val="20"/></w:rPr><w:t>${xmlEscape(DRAFT_BANNER)}</w:t></w:r></w:p></w:hdr>`;
}

function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (t.length < 3 || t.length > 90) return false;
  if (/^[A-Z0-9][A-Z0-9 ,&'\/()\-–—:;]+$/.test(t) && /[A-Z]/.test(t)) {
    return !/^_+$/.test(t);
  }
  return /^\d+\.\s+[A-Z]/.test(t);
}

function paragraphXml(line: string): string {
  const t = line.replace(/\s+$/g, "");
  if (!t.trim()) return `<w:p/>`;
  const heading = isHeadingLine(t);
  const style = heading ? `<w:pStyle w:val="Heading1"/>` : "";
  // Preserve leading spaces of signature lines etc. via xml:space.
  return `<w:p><w:pPr>${style}</w:pPr><w:r><w:t xml:space="preserve">${xmlEscape(t)}</w:t></w:r></w:p>`;
}

/**
 * Compose a .docx from filled plain text (the same text the PDF is
 * rendered from, so the two outputs never diverge). The banner rides
 * in a real header part on every page.
 */
export function buildDocxFromText(text: string): Buffer {
  const paras = (text ?? "").split(/\r?\n/).map(paragraphXml).join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${paras}<w:sectPr><w:headerReference w:type="default" r:id="rId2"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`;
  return zipStore([
    { name: "[Content_Types].xml", data: Buffer.from(CONTENT_TYPES, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(ROOT_RELS, "utf8") },
    { name: "word/document.xml", data: Buffer.from(document, "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(DOC_RELS, "utf8") },
    { name: "word/styles.xml", data: Buffer.from(STYLES, "utf8") },
    { name: "word/header1.xml", data: Buffer.from(headerXml(), "utf8") },
  ]);
}

/* --------------------- uploaded-template filling --------------------- */

/**
 * Fill {{placeholders}} inside an uploaded .docx template.
 * Primary path: replace in word/document.xml directly (correct when
 * Word kept each placeholder inside one run — the common case for
 * typed templates). Fallback: if placeholders survive because Word
 * split them across runs, rebuild the document from its extracted
 * text (formatting simplified, flagged via `rebuilt`).
 * Also guarantees the banner: if the package has no header part, a
 * banner header is added exactly as in composed documents.
 */
export function fillDocxTemplate(
  templateBytes: Buffer,
  values: Record<string, string | null>,
  fallbackText: (bytes: Buffer) => string
): { buffer: Buffer; unresolvedFields: string[]; rebuilt: boolean } {
  const entries = unzipEntries(templateBytes);
  const docEntry = entries.get("word/document.xml");
  if (!docEntry) throw new Error("docx_missing_document_xml");
  let xml = docEntry.toString("utf8");
  const unresolved = new Set<string>();
  const replaceAll = (source: string): string =>
    source.replace(/\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g, (_m, field: string) => {
      const v = values[field];
      if (v === null || v === undefined || v === "") {
        unresolved.add(field);
        return "—";
      }
      return xmlEscape(v);
    });
  xml = replaceAll(xml);

  let rebuilt = false;
  if (/\{\{\s*[A-Za-z0-9_.]+\s*\}\}/.test(xml)) {
    // Placeholders were split across runs — rebuild from plain text.
    const text = fallbackText(templateBytes);
    const filled = text.replace(
      /\{\{\s*([A-Za-z0-9_.]+)\s*\}\}/g,
      (_m, field: string) => {
        const v = values[field];
        if (v === null || v === undefined || v === "") {
          unresolved.add(field);
          return "—";
        }
        return v;
      }
    );
    return {
      buffer: buildDocxFromText(filled),
      unresolvedFields: Array.from(unresolved),
      rebuilt: true,
    };
  }

  entries.set("word/document.xml", Buffer.from(xml, "utf8"));
  ensureBannerHeader(entries);
  const buffer = zipStore(
    Array.from(entries.entries()).map(([name, data]) => ({ name, data }))
  );
  return { buffer, unresolvedFields: Array.from(unresolved), rebuilt };
}

/** Add the banner header part to a filled uploaded template that has
 * none (mutates the entry map). Templates that already define headers
 * keep theirs — the banner then also leads the body text path only
 * when rebuilt; portal-generated uploads are Ethan's own templates,
 * and the PDF rendition always carries the stamped banner. */
function ensureBannerHeader(entries: Map<string, Buffer>): void {
  const hasHeader = Array.from(entries.keys()).some((k) =>
    /^word\/header\d*\.xml$/.test(k)
  );
  if (hasHeader) return;
  const ct = entries.get("[Content_Types].xml");
  const rels = entries.get("word/_rels/document.xml.rels");
  const docXml = entries.get("word/document.xml");
  if (!ct || !rels || !docXml) return;
  let ctXml = ct.toString("utf8");
  if (!ctXml.includes("/word/header1.xml")) {
    ctXml = ctXml.replace(
      "</Types>",
      `<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>`
    );
    entries.set("[Content_Types].xml", Buffer.from(ctXml, "utf8"));
  }
  let relsXml = rels.toString("utf8");
  if (!relsXml.includes("header1.xml")) {
    relsXml = relsXml.replace(
      "</Relationships>",
      `<Relationship Id="rIdBanner" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/></Relationships>`
    );
    entries.set(
      "word/_rels/document.xml.rels",
      Buffer.from(relsXml, "utf8")
    );
  }
  let doc = docXml.toString("utf8");
  if (!doc.includes("headerReference")) {
    const ref = `<w:headerReference w:type="default" r:id="rIdBanner"/>`;
    if (doc.includes("<w:sectPr")) {
      doc = doc.replace(/<w:sectPr([^>]*)>/, `<w:sectPr$1>${ref}`);
    } else {
      doc = doc.replace(
        "</w:body>",
        `<w:sectPr>${ref}<w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body>`
      );
    }
    entries.set("word/document.xml", Buffer.from(doc, "utf8"));
  }
  entries.set("word/header1.xml", Buffer.from(headerXml(), "utf8"));
}
