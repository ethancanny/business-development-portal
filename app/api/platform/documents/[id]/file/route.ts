import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import {
  getDocument,
  getDocumentRooms,
  readDocumentBytes,
} from "@/lib/dataroom/documents";
import { logAccess } from "@/lib/dataroom/guests";
import { documentFileResponse } from "@/lib/dataroom/files";
import { StorageNotFoundError } from "@/lib/storage/types";

export const maxDuration = 60;

/** Serve a document's bytes to a signed-in user. Inline only for
 * browser-safe formats; ?dl=1 forces a download. ?version=N serves a
 * specific version. Views/downloads of room documents are written to
 * the room access log. */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const doc = await getDocument(params.id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const sp = req.nextUrl.searchParams;
  const download = sp.get("dl") === "1";
  const versionRaw = Number(sp.get("version") ?? 0);
  const version = isFinite(versionRaw) && versionRaw > 0 ? Math.floor(versionRaw) : undefined;
  try {
    const { bytes, mime } = await readDocumentBytes(doc, version);
    const rooms = await getDocumentRooms(doc.id);
    const roomIdParam = sp.get("roomId");
    const roomId =
      roomIdParam && rooms.some((r) => r.roomId === roomIdParam)
        ? roomIdParam
        : (rooms[0]?.roomId ?? null);
    await logAccess({
      roomId,
      documentId: doc.id,
      actor: user.name || user.email,
      actorKind: "internal",
      action: download ? "download" : "view",
      detail: version ? `v${version}` : `v${doc.currentVersion}`,
    });
    return documentFileResponse(bytes, {
      filename: doc.name,
      mime,
      download,
    });
  } catch (err) {
    if (err instanceof StorageNotFoundError) {
      return NextResponse.json(
        {
          error:
            "Stored bytes are not available in the active storage provider (the interim store is per-instance; production bytes await the SharePoint decision).",
          code: "bytes_unavailable",
        },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
