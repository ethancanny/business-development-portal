import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { updateChecklistItem } from "@/lib/dataroom/service";

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; itemId: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  try {
    const item = await updateChecklistItem(
      params.id,
      params.itemId,
      {
        status: typeof body.status === "string" ? body.status : undefined,
        documentId:
          body.documentId === null
            ? null
            : typeof body.documentId === "string"
              ? body.documentId
              : undefined,
      },
      user.name || user.email
    );
    if (!item) {
      return NextResponse.json({ error: "Checklist item not found" }, { status: 404 });
    }
    return NextResponse.json({ item });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 }
    );
  }
}
