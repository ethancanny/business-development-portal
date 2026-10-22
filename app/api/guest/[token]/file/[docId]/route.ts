import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { sql } from "@/lib/platform/db";
import { getDocument, readDocumentBytes } from "@/lib/dataroom/documents";
import { logAccess, validateGuestToken } from "@/lib/dataroom/guests";
import { documentFileResponse } from "@/lib/dataroom/files";
import { StorageNotFoundError } from "@/lib/storage/types";

/** Guest responses carry access decisions — they must never be stored
 * by any cache layer. (A cached 200 kept revoked links working in
 * production even with force-dynamic set; no-store ends that class.) */
function jsonNoStore(body: unknown, init?: { status?: number }): NextResponse {
  const res = NextResponse.json(body, init ?? {});
  res.headers.set("Cache-Control", "private, no-store");
  return res;
}


export const maxDuration = 60;

/**
 * Guest document access. View-only grants are enforced HERE, at our
 * layer: ?dl=1 (download) is refused with 403 for "view" guests, and
 * bytes are only ever served inline for them. "download" guests may
 * download. The document must be placed in the guest's room.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { token: string; docId: string } }
) {
  // Per-request dynamic execution (see ../../route.ts): token
  // validation must run on every hit, never a replayed response.
  headers();
  await ensureDataRoom();
  const v = await validateGuestToken(params.token);
  if (!v.ok) {
    const status =
      v.reason === "expired" ? 410 : v.reason === "not_found" ? 404 : 403;
    return jsonNoStore({ error: v.reason }, { status });
  }
  const sp = req.nextUrl.searchParams;
  const wantsDownload = sp.get("dl") === "1";
  if (wantsDownload && v.guest.accessLevel !== "download") {
    await logAccess({
      roomId: v.room.id,
      documentId: params.docId,
      actor: v.guest.email,
      actorKind: "guest",
      action: "download_blocked",
      detail: "view-only grant",
    });
    return jsonNoStore(
      {
        error: "view_only",
        message: "This link is view-only; downloads are disabled.",
      },
      { status: 403 }
    );
  }
  // The document must be placed in THIS room.
  const db = sql();
  const placed = await db`
    SELECT id FROM dataroom.room_documents
    WHERE room_id = ${v.room.id} AND document_id = ${params.docId} LIMIT 1`;
  if (!placed.length) {
    return jsonNoStore({ error: "not_found" }, { status: 404 });
  }
  const doc = await getDocument(params.docId);
  if (!doc) {
    return jsonNoStore({ error: "not_found" }, { status: 404 });
  }
  try {
    const { bytes, mime } = await readDocumentBytes(doc);
    await logAccess({
      roomId: v.room.id,
      documentId: doc.id,
      actor: v.guest.email,
      actorKind: "guest",
      action: wantsDownload ? "download" : "view",
    });
    return documentFileResponse(bytes, {
      filename: doc.name,
      mime,
      download: wantsDownload,
    });
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      return jsonNoStore(
        { error: "bytes_unavailable" },
        { status: 404 }
      );
    }
    return jsonNoStore(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
