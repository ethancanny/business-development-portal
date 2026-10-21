import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDirectory } from "@/lib/directory/schema";
import { deleteTemplate } from "@/lib/directory/service";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDirectory();
  const ok = await deleteTemplate(params.id);
  if (!ok) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
