import { inflateRawSync } from "zlib";
import * as XLSX from "xlsx";
import { sql, str } from "../platform/db";
import { extractPdfStrings } from "../pdf-text";
import { getStorageProvider, StorageNotFoundError } from "../storage";
import { ensureDataRoom } from "./schema";
import { getDocument } from "./documents";

/**
 * Document text extraction (Phase 3) — runs as the core.jobs kind
 * "extract_document_text" so contents become searchable (extracted
 * text is folded into core.documents.search_vector and kept in
 * dataroom.document_text, never in list payloads).
 *
 * Extractors: PDF (lib/pdf-text.ts), plain text / CSV / Markdown /
 * JSON (UTF-8 decode), DOCX (minimal ZIP reader over
 * word/document.xml), XLSX/XLS (SheetJS → CSV per sheet).
 * Images return status "unsupported": true image OCR needs an OCR
 * provider (e.g. Azure AI Document Intelligence) which is not
 * configured — a named gap, not a silent skip.
 */

export type ExtractionStatus =
  | "done"
  | "empty"
  | "unsupported"
  | "failed"
  | "unavailable";

export interface ExtractionResult {
  text: string;
  extractor: string;
  status: ExtractionStatus;
  note: string;
}

const MAX_STORED_TEXT = 500_000;
const MAX_INDEXED_TEXT = 100_000;

/* ------------------------- minimal ZIP reader ------------------------ */
/** Extract one entry's bytes from a ZIP buffer via the central
 * directory (DOCX is a ZIP). Returns null when not found/unreadable. */
function zipEntry(buf: Buffer, wanted: string): Buffer | null {
  // End Of Central Directory record: scan the tail for PK\x05\x06.
  let eocd = -1;
  const tailStart = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= tailStart; i--) {
    if (
      buf[i] === 0x50 &&
      buf[i + 1] === 0x4b &&
      buf[i + 2] === 0x05 &&
      buf[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (!(buf[p] === 0x50 && buf[p + 1] === 0x4b && buf[p + 2] === 0x01 && buf[p + 3] === 0x02)) {
      break;
    }
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    if (name === wanted) {
      // Local header: find where this entry's data starts.
      const lh = localOffset;
      if (!(buf[lh] === 0x50 && buf[lh + 1] === 0x4b && buf[lh + 2] === 0x03 && buf[lh + 3] === 0x04)) {
        return null;
      }
      const lNameLen = buf.readUInt16LE(lh + 26);
      const lExtraLen = buf.readUInt16LE(lh + 28);
      const dataStart = lh + 30 + lNameLen + lExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      if (method === 0) return Buffer.from(raw);
      if (method === 8) return inflateRawSync(raw);
      return null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<\/w:p>/g, "\n")
    .replace(/<w:tab[^>]*\/>/g, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) =>
      String.fromCharCode(parseInt(d, 10))
    )
    .replace(/&amp;/g, "&");
}

/* ------------------------------ extractors --------------------------- */

function extOf(filename: string): string {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(filename ?? "");
  return m ? m[1].toLowerCase() : "";
}

export function extractText(
  bytes: Buffer,
  mime: string,
  filename: string
): ExtractionResult {
  const m = (mime ?? "").toLowerCase();
  const ext = extOf(filename);
  try {
    if (m === "application/pdf" || ext === "pdf") {
      const parts = extractPdfStrings(bytes);
      const text = parts.join("\n").trim();
      return {
        text,
        extractor: "pdf-text",
        status: text ? "done" : "empty",
        note: text
          ? ""
          : "No embedded text found (scanned PDF? OCR is not configured).",
      };
    }
    if (
      m.startsWith("text/") ||
      m === "application/json" ||
      ["txt", "md", "csv", "json", "log", "tsv"].includes(ext)
    ) {
      const text = bytes.toString("utf8").replace(/^﻿/, "").trim();
      return {
        text,
        extractor: "utf8",
        status: text ? "done" : "empty",
        note: "",
      };
    }
    if (
      m ===
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      ext === "docx"
    ) {
      const xmlBuf = zipEntry(bytes, "word/document.xml");
      if (!xmlBuf) {
        return {
          text: "",
          extractor: "docx-zip",
          status: "failed",
          note: "word/document.xml not found in the DOCX package.",
        };
      }
      const text = xmlToText(xmlBuf.toString("utf8")).trim();
      return {
        text,
        extractor: "docx-zip",
        status: text ? "done" : "empty",
        note: "",
      };
    }
    if (
      m ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      m === "application/vnd.ms-excel" ||
      ext === "xlsx" ||
      ext === "xls"
    ) {
      // SheetJS is a hard dependency (Directory export uses it too).
      const wb = XLSX.read(bytes, { type: "buffer" });
      const parts: string[] = [];
      for (const sheetName of wb.SheetNames) {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[sheetName]);
        if (csv.trim()) parts.push(`# Sheet: ${sheetName}\n${csv}`);
      }
      const text = parts.join("\n\n").trim();
      return {
        text,
        extractor: "xlsx-sheetjs",
        status: text ? "done" : "empty",
        note: "",
      };
    }
    if (m.startsWith("image/")) {
      return {
        text: "",
        extractor: "none",
        status: "unsupported",
        note:
          "Image OCR is not configured: no OCR provider (e.g. Azure AI " +
          "Document Intelligence) is connected, so image contents are " +
          "not searchable. The file itself is stored and previewable.",
      };
    }
    return {
      text: "",
      extractor: "none",
      status: "unsupported",
      note: `No text extractor for ${m || ext || "this file type"}.`,
    };
  } catch (err) {
    return {
      text: "",
      extractor: "error",
      status: "failed",
      note: err instanceof Error ? err.message.slice(0, 300) : String(err),
    };
  }
}

/* ------------------------------ job entry ---------------------------- */

/**
 * Run extraction for one document (core.jobs kind
 * "extract_document_text"). Never throws — failures are recorded in
 * core.documents.extraction_status so they surface in the library.
 */
export async function runExtraction(documentId: string): Promise<void> {
  await ensureDataRoom();
  const db = sql();
  const doc = await getDocument(documentId);
  if (!doc) return;

  let result: ExtractionResult;
  if (!doc.storageUrl) {
    result = {
      text: "",
      extractor: "none",
      status: "unavailable",
      note: "Metadata-only record (legacy attachment) — no stored bytes to extract.",
    };
  } else {
    try {
      const bytes = await getStorageProvider().get(doc.storageUrl);
      result = extractText(bytes, doc.mime, doc.name);
    } catch (err) {
      result = {
        text: "",
        extractor: "none",
        status: err instanceof StorageNotFoundError ? "unavailable" : "failed",
        note:
          err instanceof StorageNotFoundError
            ? "Stored bytes not found in the active provider (interim store is per-instance)."
            : err instanceof Error
              ? err.message.slice(0, 300)
              : String(err),
      };
    }
  }

  const storedText = result.text.slice(0, MAX_STORED_TEXT);
  if (storedText) {
    await db`
      INSERT INTO dataroom.document_text (document_id, text, extractor, extracted_at)
      VALUES (${documentId}, ${storedText}, ${result.extractor}, now())
      ON CONFLICT (document_id) DO UPDATE SET
        text = EXCLUDED.text, extractor = EXCLUDED.extractor,
        extracted_at = now()`;
  }
  const tagsText = doc.tags.join(" ");
  await db`
    UPDATE core.documents SET
      extraction_status = ${result.status},
      search_vector =
        setweight(to_tsvector('english', ${doc.name}), 'A') ||
        setweight(to_tsvector('english', ${tagsText}), 'B') ||
        setweight(to_tsvector('english', ${storedText.slice(0, MAX_INDEXED_TEXT)}), 'B'),
      updated_at = now()
    WHERE id = ${documentId}`;
  if (result.status === "failed") {
    // A failure should be visible, not silent (but never break the
    // caller's job loop — the job row records completion either way,
    // and the status on the document carries the signal).
    console.error(
      `[dataroom/extract] ${documentId} failed: ${result.note}`
    );
  }
}

export async function getDocumentText(
  documentId: string
): Promise<{ status: string; text: string; extractor: string; note: string }> {
  await ensureDataRoom();
  const db = sql();
  const doc = await getDocument(documentId);
  if (!doc) {
    return { status: "missing", text: "", extractor: "", note: "Document not found" };
  }
  const rows = await db`
    SELECT text, extractor FROM dataroom.document_text
    WHERE document_id = ${documentId} LIMIT 1`;
  if (rows.length) {
    const rec = rows[0] as Record<string, unknown>;
    return {
      status: doc.extractionStatus,
      text: str(rec.text).slice(0, MAX_INDEXED_TEXT),
      extractor: str(rec.extractor),
      note: "",
    };
  }
  return {
    status: doc.extractionStatus,
    text: "",
    extractor: "",
    note:
      doc.extractionStatus === "unsupported"
        ? "No text extractor for this file type (images need an OCR provider — not configured)."
        : doc.extractionStatus === "unavailable"
          ? "No stored bytes are available for this record."
          : "Text extraction has not produced text for this document yet.",
  };
}
