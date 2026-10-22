import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom, UPLOAD_CHUNK_BYTES } from "@/lib/dataroom/schema";
import { beginUploadSession } from "@/lib/dataroom/uploads";
import {
  StorageSetupRequiredError,
} from "@/lib/storage/types";

/** Begin a chunked/resumable upload session. */
export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const session = await beginUploadSession(
      {
        filename: typeof body.filename === "string" ? body.filename : "",
        mime: typeof body.mime === "string" ? body.mime : undefined,
        totalSize: typeof body.totalSize === "number" ? body.totalSize : 0,
        roomId: typeof body.roomId === "string" ? body.roomId : null,
        folderId: typeof body.folderId === "string" ? body.folderId : null,
        documentId:
          typeof body.documentId === "string" ? body.documentId : null,
        dealId: typeof body.dealId === "string" ? body.dealId : null,
        companyId:
          typeof body.companyId === "string" ? body.companyId : null,
        tags: Array.isArray(body.tags)
          ? body.tags.map((t) => String(t))
          : undefined,
        note: typeof body.note === "string" ? body.note : undefined,
      },
      user.name || user.email
    );
    return NextResponse.json(
      { uploadId: session.id, chunkSize: UPLOAD_CHUNK_BYTES, session },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof StorageSetupRequiredError) {
      return NextResponse.json(
        {
          error: err.message,
          setupRequired: true,
          missingScopes: err.missingScopes,
        },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
