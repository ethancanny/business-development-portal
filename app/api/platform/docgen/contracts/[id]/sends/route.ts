import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { listDocumentSends } from "@/lib/docgen/contracts";

/**
 * Send log for one contract (Send anywhere, Oct 25, 2026): every
 * signature send and email-attachment send, newest first, with the
 * real per-recipient outcome. Read on dialog open only.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const sends = await listDocumentSends(params.id);
  return NextResponse.json(
    { sends },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
