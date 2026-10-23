import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { voidEnvelope } from "@/lib/signing/service";

/** Void an envelope. POST { reason } — signer links stop resolving
 * (resolveSignerToken reports 'voided'); the void is hash-chained
 * into the envelope's event log. */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) {
    return NextResponse.json(
      { error: "reason_required", detail: "A void reason is required." },
      { status: 400 }
    );
  }
  try {
    const detail = await voidEnvelope(params.id, reason, {
      name: user.name || user.email,
      email: user.email,
    });
    return NextResponse.json(detail);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "envelope_not_found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg === "envelope_completed") {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
