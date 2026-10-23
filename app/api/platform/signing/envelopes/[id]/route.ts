import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getEnvelopeDetail } from "@/lib/signing/service";

/** One envelope: docgen row + signing row + public signers +
 * hash-chained events + artifact ids/hashes. No token or access
 * hashes are ever included. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const detail = await getEnvelopeDetail(params.id);
  if (!detail) {
    return NextResponse.json({ error: "envelope_not_found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
