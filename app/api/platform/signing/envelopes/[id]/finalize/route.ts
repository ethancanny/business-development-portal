import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getEnvelopeDetail } from "@/lib/signing/service";

/**
 * Finalize an all-signed envelope (Workstream B's seal + executed
 * PDF + certificate). POST → finalizeEnvelope(id) result. This is
 * the idempotent retry path: when B reports the envelope is already
 * completed, its result is returned as-is. The B module is loaded
 * dynamically so this route degrades honestly (501) until it lands.
 */
export async function POST(
  _req: NextRequest,
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
  let finalizeEnvelope: ((id: string) => Promise<unknown>) | null = null;
  try {
    const mod = (await import("@/lib/signing/finalize")) as {
      finalizeEnvelope?: (id: string) => Promise<unknown>;
    };
    if (typeof mod.finalizeEnvelope === "function") {
      finalizeEnvelope = mod.finalizeEnvelope;
    }
  } catch {
    finalizeEnvelope = null;
  }
  if (!finalizeEnvelope) {
    return NextResponse.json(
      {
        error: "finalize_unavailable",
        detail: "The finalize module (seal + certificate) is not available in this build yet.",
      },
      { status: 501 }
    );
  }
  try {
    const result = await finalizeEnvelope(params.id);
    return NextResponse.json(result as Record<string, unknown>);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "envelope_not_found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (
      msg.includes("not_signed") ||
      msg.includes("not_all_signed") ||
      msg.includes("envelope_not_live")
    ) {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
