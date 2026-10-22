import { NextResponse } from "next/server";

/**
 * Serve document bytes with safe preview semantics: only formats a
 * browser can render without executing uploader-controlled code are
 * served inline (PDF, raster images, plain text, MP4, audio). SVG and
 * everything else download as attachments, and nosniff is always set
 * so a mislabeled upload can't be reinterpreted. Responses are
 * no-store — these are sensitive deal documents.
 */

const INLINE_SAFE_EXACT = new Set([
  "application/pdf",
  "text/plain",
  "video/mp4",
  "audio/mpeg",
  "audio/mp4",
]);

function isInlineSafe(mime: string): boolean {
  const m = (mime ?? "").toLowerCase();
  if (INLINE_SAFE_EXACT.has(m)) return true;
  if (m.startsWith("image/") && m !== "image/svg+xml") return true;
  return false;
}

export function documentFileResponse(
  bytes: Buffer,
  opts: { filename: string; mime: string; download: boolean }
): NextResponse {
  const mime = opts.mime || "application/octet-stream";
  const inline = !opts.download && isInlineSafe(mime);
  const disposition = `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(
    opts.filename || "document"
  )}`;
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Disposition": disposition,
      "Content-Length": String(bytes.length),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
