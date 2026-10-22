import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import {
  getDocument,
  getDocumentRooms,
  listDocumentVersions,
  softDeleteDocument,
  updateDocument,
} from "@/lib/dataroom/documents";

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const document = await getDocument(params.id);
  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  const [versions, rooms] = await Promise.all([
    listDocumentVersions(params.id),
    getDocumentRooms(params.id),
  ]);
  return NextResponse.json({
    document,
    versions,
    rooms,
    textStatus: document.extractionStatus,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const updated = await updateDocument(
      params.id,
      {
        name: typeof body.name === "string" ? body.name : undefined,
        tags: Array.isArray(body.tags)
          ? body.tags.map((t) => String(t))
          : undefined,
        companyId:
          body.companyId === null
            ? null
            : typeof body.companyId === "string"
              ? body.companyId
              : undefined,
        dealId:
          body.dealId === null
            ? null
            : typeof body.dealId === "string"
              ? body.dealId
              : undefined,
        personId:
          body.personId === null
            ? null
            : typeof body.personId === "string"
              ? body.personId
              : undefined,
      },
      user.name || user.email
    );
    if (!updated) {
      return NextResponse.json({ error: "Document not found" }, { status: 404 });
    }
    return NextResponse.json({ document: updated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const ok = await softDeleteDocument(params.id, user.name || user.email);
  if (!ok) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
