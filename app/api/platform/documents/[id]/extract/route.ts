import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { ensureDataRoom } from "@/lib/dataroom/schema";
import { getDocument } from "@/lib/dataroom/documents";
import { enqueueJob, runDueJobs } from "@/lib/platform/jobs";

/** Re-run text extraction for a document (background job, drained
 * inline so the new status is visible immediately). */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  await ensureDataRoom();
  const doc = await getDocument(params.id);
  if (!doc) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }
  await enqueueJob("extract_document_text", { documentId: params.id });
  await runDueJobs(3).catch(() => 0);
  const updated = await getDocument(params.id);
  return NextResponse.json({
    ok: true,
    extractionStatus: updated?.extractionStatus ?? "pending",
  });
}
