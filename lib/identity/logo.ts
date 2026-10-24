import sharp from "sharp";
import { LOGO_SIZES, type LogoSize } from "./shared";

/**
 * Logo ingest pipeline (server-side only). Takes raw uploaded or
 * fetched bytes and produces everything the identity service stores:
 * a metadata-stripped original + 64/128/256 renditions + a dominant
 * color suggestion. Re-encoding through sharp strips EXIF/metadata
 * by construction; SVGs are sanitized as text (script / event-handler
 * / foreignObject / external-reference stripping is mandatory — a
 * stored SVG is served back through our own route and must be inert).
 */

export type LogoMime = "image/png" | "image/jpeg" | "image/svg+xml";

export interface ProcessedLogo {
  mime: LogoMime;
  /** Extension for the stored original ("png" | "jpg" | "svg"). */
  ext: string;
  original: Buffer;
  /** Renditions keyed by size; format is WebP unless WebP failed. */
  renditions: Record<LogoSize, { data: Buffer; ext: "webp" | "png" }>;
  /** Dominant color of the artwork, "#rrggbb" — the accent suggestion. */
  dominantColor: string;
  width: number;
  height: number;
}

export const MAX_LOGO_BYTES = 2 * 1024 * 1024; // 2 MB upload cap

/** Sniff the real type from magic bytes / SVG text — never trust a
 *  caller-supplied content type. */
export function detectLogoMime(buf: Buffer): LogoMime | null {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "image/png";
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  const head = buf.slice(0, 1024).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) {
    return "image/svg+xml";
  }
  return null;
}

/**
 * Sanitize an SVG document for safe storage + serving. Conservative:
 * drops scripts, event handlers, foreignObject, external references
 * (anything not a data: URI or a fragment), and XML prolog/doctype.
 */
export function sanitizeSvg(svg: string): string {
  let out = svg;
  out = out.replace(/<\?xml[\s\S]*?\?>/gi, "");
  out = out.replace(/<!DOCTYPE[\s\S]*?>/gi, "");
  out = out.replace(/<script[\s\S]*?<\/script>/gi, "");
  out = out.replace(/<script[^>]*\/?>/gi, "");
  out = out.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "");
  out = out.replace(/<foreignObject[^>]*\/?>/gi, "");
  out = out.replace(/<(iframe|object|embed|link|meta|base)\b[^>]*>/gi, "");
  // Event-handler attributes (onclick=, onload=, …).
  out = out.replace(/\son[a-zA-Z]+\s*=\s*"[^"]*"/gi, "");
  out = out.replace(/\son[a-zA-Z]+\s*=\s*'[^']*'/gi, "");
  out = out.replace(/\son[a-zA-Z]+\s*=\s*[^\s>]+/gi, "");
  // javascript: URLs anywhere.
  out = out.replace(/javascript\s*:/gi, "removed:");
  // href / xlink:href pointing anywhere but a fragment or data:image.
  out = out.replace(
    /\s(?:xlink:href|href)\s*=\s*"(?!#|data:image\/)[^"]*"/gi,
    ""
  );
  out = out.replace(
    /\s(?:xlink:href|href)\s*=\s*'(?!#|data:image\/)[^']*'/gi,
    ""
  );
  // CSS url(...) external references inside <style> or attributes.
  out = out.replace(/url\(\s*(?!['"]?#|['"]?data:image\/)[^)]*\)/gi, "none");
  return out.trim();
}

function rgbHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/**
 * Many sites only publish a favicon.ico. ICO files frequently embed a
 * PNG image; extract the largest PNG entry so the normal pipeline can
 * take it. (BMP-only ICOs are rejected — sharp cannot decode them.)
 */
export function extractIcoPng(buf: Buffer): Buffer | null {
  if (buf.length < 6) return null;
  if (!(buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0)) {
    return null;
  }
  const count = buf.readUInt16LE(4);
  let best: { size: number; data: Buffer } | null = null;
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    if (off + 16 > buf.length) break;
    const size = buf.readUInt32LE(off + 8);
    const start = buf.readUInt32LE(off + 12);
    if (!size || start + size > buf.length) continue;
    const entry = buf.subarray(start, start + size);
    if (
      entry.length >= 8 &&
      entry[0] === 0x89 &&
      entry[1] === 0x50 &&
      entry[2] === 0x4e &&
      entry[3] === 0x47 &&
      (!best || size > best.size)
    ) {
      best = { size, data: Buffer.from(entry) };
    }
  }
  return best?.data ?? null;
}

export async function processLogo(
  rawInput: Buffer,
  declaredMime?: string
): Promise<ProcessedLogo> {
  if (!rawInput.length || rawInput.length > MAX_LOGO_BYTES) {
    throw new Error(`Logo must be between 1 byte and ${MAX_LOGO_BYTES} bytes`);
  }
  const input = extractIcoPng(rawInput) ?? rawInput;
  const mime = detectLogoMime(input);
  if (!mime) {
    throw new Error(
      `Unsupported logo type${declaredMime ? ` (${declaredMime})` : ""} — use PNG, JPG, or SVG`
    );
  }

  if (mime === "image/svg+xml") {
    const clean = sanitizeSvg(input.toString("utf8"));
    if (!/<svg[\s>]/i.test(clean)) throw new Error("Invalid SVG logo");
    const original = Buffer.from(clean, "utf8");
    // Rasterize renditions from the sanitized SVG.
    const base = sharp(original, { density: 288 });
    const meta = await base.metadata();
    const renditions = await makeRenditions(base);
    const dominant = await dominantColor(
      sharp(original, { density: 144 }).resize(48, 48, { fit: "inside" })
    );
    return {
      mime,
      ext: "svg",
      original,
      renditions,
      dominantColor: dominant,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
    };
  }

  // Raster: rotate per EXIF once, then re-encode (strips metadata).
  const src = sharp(input).rotate();
  const meta = await src.metadata();
  const original =
    mime === "image/png"
      ? await src.png({ compressionLevel: 9 }).toBuffer()
      : await src.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
  const renditions = await makeRenditions(sharp(original));
  const dominant = await dominantColor(
    sharp(original).resize(48, 48, { fit: "inside" })
  );
  return {
    mime,
    ext: mime === "image/png" ? "png" : "jpg",
    original,
    renditions,
    dominantColor: dominant,
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

async function makeRenditions(
  img: sharp.Sharp
): Promise<ProcessedLogo["renditions"]> {
  const out = {} as ProcessedLogo["renditions"];
  for (const size of LOGO_SIZES) {
    const resized = img
      .clone()
      .resize(size, size, { fit: "inside", withoutEnlargement: false });
    try {
      out[size] = { data: await resized.webp({ quality: 88 }).toBuffer(), ext: "webp" };
    } catch {
      out[size] = {
        data: await img
          .clone()
          .resize(size, size, { fit: "inside" })
          .png()
          .toBuffer(),
        ext: "png",
      };
    }
  }
  return out;
}

/**
 * Dominant color: average the opaque pixels of a downscaled copy,
 * ignoring near-white / near-transparent pixels (logo backgrounds),
 * then fall back to the plain average.
 */
async function dominantColor(img: sharp.Sharp): Promise<string> {
  try {
    const stats = await img.stats();
    const d = stats.dominant;
    if (d && typeof d.r === "number") return rgbHex(d.r, d.g, d.b);
  } catch {
    /* fall through to manual average */
  }
  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = info.channels;
  let r = 0, g = 0, b = 0, n = 0;
  let fr = 0, fg = 0, fb = 0, fn = 0;
  for (let i = 0; i + ch <= data.length; i += ch) {
    const a = ch === 4 ? data[i + 3] : 255;
    if (a < 128) continue;
    const pr = data[i], pg = data[i + 1], pb = data[i + 2];
    fr += pr; fg += pg; fb += pb; fn++;
    const lum = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
    if (lum < 242) { r += pr; g += pg; b += pb; n++; }
  }
  if (n > 0) return rgbHex(r / n, g / n, b / n);
  if (fn > 0) return rgbHex(fr / fn, fg / fn, fb / fn);
  return "#0d1f3c";
}
