import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getEnvelopeDetail } from "@/lib/signing/service";

/**
 * Verify an executed PDF (Workstream B). POST { pdfBase64? } →
 * verifyExecutedPdf(id, bytes?) result JSON. Without pdfBase64, B
 * verifies the filed executed document for the envelope. Loaded
 * dynamically; 501 until B lands.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const detail = await getEnvelopeDetail(params.id);
  if (!detail) {
    return NextResponse.json({ error: "envelope_not_found" }, { status: 404 });
  }
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  let bytes: Buffer | undefined;
  if (typeof body.pdfBase64 === "string" && body.pdfBase64) {
    try {
      bytes = Buffer.from(body.pdfBase64, "base64");
    } catch {
      return NextResponse.json({ error: "pdf_base64_invalid" }, { status: 400 });
    }
    if (!bytes.length) {
      return NextResponse.json({ error: "pdf_base64_invalid" }, { status: 400 });
    }
  }
  let verifyExecutedPdf:
    | ((id: string, bytes?: Buffer) => Promise<unknown>)
    | null = null;
  try {
    const mod = (await import("@/lib/signing/verify")) as {
      verifyExecutedPdf?: (id: string, bytes?: Buffer) => Promise<unknown>;
    };
    if (typeof mod.verifyExecutedPdf === "function") {
      verifyExecutedPdf = mod.verifyExecutedPdf;
    }
  } catch {
    verifyExecutedPdf = null;
  }
  if (!verifyExecutedPdf) {
    return NextResponse.json(
      {
        error: "verify_unavailable",
        detail: "The verification module is not available in this build yet.",
      },
      { status: 501 }
    );
  }
  try {
    const result = await verifyExecutedPdf(params.id, bytes);
    return NextResponse.json(result as Record<string, unknown>);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "envelope_not_found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
