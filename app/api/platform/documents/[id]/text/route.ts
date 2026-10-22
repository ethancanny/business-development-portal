import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { getDocumentText } from "@/lib/dataroom/extract";

/** Extracted text for one document — powers the in-app preview for
 * Office documents (browsers can't render DOCX/XLSX inline) and shows
 * the extraction state honestly when there is no text. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const result = await getDocumentText(params.id);
  if (result.status === "missing") {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
