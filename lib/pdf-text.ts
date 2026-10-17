/**
 * Minimal PDF text extraction for machine-generated report PDFs
 * (built Oct 17, 2026 for the AOT monthly reports — tailwind §4).
 *
 * The Arizona Office of Tourism's monthly Airports / Lodging PDFs are
 * produced by a generator that embeds subset CID fonts: page text is
 * stored as 2-byte glyph codes, readable only through each file's
 * embedded ToUnicode CMaps. This extractor:
 *   1. walks the file's stream…endstream spans (binary-safe, latin1),
 *   2. inflates FlateDecode streams (zlib) and accepts raw streams,
 *   3. merges every ToUnicode CMap (beginbfchar / beginbfrange) into a
 *      code → Unicode map,
 *   4. scans content streams for literal (…) Tj / hex <…> Tj /
 *      […] TJ text operators and decodes each string through the map
 *      (falling back to latin1 when a string doesn't decode as CIDs).
 *
 * Deliberately small: it targets simple single-layout reports, not
 * arbitrary PDFs. Streams inflating past 200KB are skipped — for
 * these reports the page-content streams are ~30–40KB while the
 * embedded font binaries are 500KB+, so the cap keeps font/image
 * bytes out of the text scan. Verified against the AOT January 2026
 * airport report and the July/August 2026 lodging reports, whose
 * printed figures it reproduces exactly.
 */
import { inflateSync } from "zlib";

const MAX_STREAM_BYTES = 200_000;

function pdfStreams(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  const s = buf.toString("latin1");
  let i = 0;
  while (true) {
    const j = s.indexOf("stream", i);
    if (j < 0) break;
    if (s.slice(j - 3, j) === "end") {
      i = j + 6;
      continue;
    }
    let start = j + 6;
    if (s[start] === "\r" && s[start + 1] === "\n") start += 2;
    else if (s[start] === "\n" || s[start] === "\r") start += 1;
    const end = s.indexOf("endstream", start);
    if (end < 0) break;
    let raw = s.slice(start, end);
    raw = raw.replace(/[\r\n]+$/, "");
    i = end + 9;
    const rawBuf = Buffer.from(raw, "latin1");
    let dec: Buffer;
    try {
      dec = inflateSync(rawBuf);
    } catch {
      dec = rawBuf; // uncompressed stream (the AOT CMaps ship this way)
    }
    if (dec.length > MAX_STREAM_BYTES) continue;
    out.push(dec);
  }
  return out;
}

function buildCmap(buf: Buffer): Map<number, string> {
  const map = new Map<number, string>();
  for (const dec of pdfStreams(buf)) {
    const t = dec.toString("latin1");
    if (!t.includes("begincmap")) continue;
    for (const sec of Array.from(t.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))) {
      for (const m of Array.from(sec[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))) {
        const lo = parseInt(m[1], 16);
        const hi = parseInt(m[2], 16);
        const uni = parseInt(m[3], 16);
        for (let k = lo; k <= hi && k - lo < 500; k++) {
          map.set(k, String.fromCharCode(uni + (k - lo)));
        }
      }
    }
    for (const sec of Array.from(t.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))) {
      for (const m of Array.from(sec[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g))) {
        map.set(parseInt(m[1], 16), String.fromCharCode(parseInt(m[2], 16)));
      }
    }
  }
  return map;
}

function decodeBytes(bs: Buffer, cmap: Map<number, string>): string {
  if (cmap.size && bs.length >= 2 && bs.length % 2 === 0) {
    const out: string[] = [];
    let ok = true;
    for (let k = 0; k < bs.length; k += 2) {
      const ch = cmap.get(bs.readUInt16BE(k));
      if (ch === undefined) {
        ok = false;
        break;
      }
      out.push(ch);
    }
    if (ok) return out.join("");
  }
  return bs.toString("latin1");
}

/** Read a (…) literal string starting at s[i] === '('. Returns the raw
 * bytes and the index just past the closing paren. */
function readLiteral(s: string, i: number): { bytes: Buffer; next: number } {
  const bytes: number[] = [];
  let depth = 1;
  let j = i + 1;
  while (j < s.length && depth > 0) {
    const ch = s[j];
    if (ch === "\\" && j + 1 < s.length) {
      bytes.push(s.charCodeAt(j + 1) & 0xff);
      j += 2;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
    bytes.push(ch.charCodeAt(0) & 0xff);
    j++;
  }
  return { bytes: Buffer.from(bytes), next: j };
}

function readHex(s: string, i: number): { bytes: Buffer; next: number } {
  const j = s.indexOf(">", i);
  if (j < 0) return { bytes: Buffer.alloc(0), next: s.length };
  let hex = s.slice(i + 1, j).replace(/[^0-9A-Fa-f]/g, "");
  if (hex.length % 2) hex += "0";
  return { bytes: Buffer.from(hex, "hex"), next: j + 1 };
}

function scanContent(content: string, cmap: Map<number, string>): string[] {
  const parts: string[] = [];
  const n = content.length;
  let i = 0;
  const skipWs = (k: number) => {
    while (k < n && " \t\r\n".includes(content[k])) k++;
    return k;
  };
  while (i < n) {
    const c = content[i];
    if (c === "(") {
      const { bytes, next } = readLiteral(content, i);
      const k = skipWs(next);
      if (content.startsWith("Tj", k) || content[k] === "'") {
        parts.push(decodeBytes(bytes, cmap));
      }
      i = next;
    } else if (c === "<" && content[i + 1] !== "<") {
      const { bytes, next } = readHex(content, i);
      const k = skipWs(next);
      if (content.startsWith("Tj", k)) parts.push(decodeBytes(bytes, cmap));
      i = next;
    } else if (c === "[") {
      const bufs: Buffer[] = [];
      let j = i + 1;
      while (j < n && content[j] !== "]") {
        if (content[j] === "(") {
          const r = readLiteral(content, j);
          bufs.push(r.bytes);
          j = r.next;
        } else if (content[j] === "<") {
          const r = readHex(content, j);
          bufs.push(r.bytes);
          j = r.next;
        } else {
          j++;
        }
        if (j - i > 60_000) break;
      }
      if (bufs.length) parts.push(bufs.map((b) => decodeBytes(b, cmap)).join(""));
      i = Math.max(j, i + 1);
    } else {
      i++;
    }
  }
  return parts;
}

/**
 * Extract the text strings of a report PDF in content order.
 * Returns [] when nothing decodable is found (caller treats that as a
 * parse failure, never as empty data).
 */
export function extractPdfStrings(buf: Buffer): string[] {
  const cmap = buildCmap(buf);
  const out: string[] = [];
  for (const dec of pdfStreams(buf)) {
    const content = dec.toString("latin1");
    if (!content.includes("BT")) continue;
    out.push(...scanContent(content, cmap));
  }
  return out;
}
