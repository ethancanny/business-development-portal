import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { resendSignerLink } from "@/lib/signing/service";

/** Rotate one signer's link. POST { signerId } → { url, signerId,
 * envelopeId }. The url carries the NEW raw token (returned once);
 * the old link dies immediately. Access attempts/lock reset. */
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
  const signerId = typeof body.signerId === "string" ? body.signerId : "";
  if (!signerId) {
    return NextResponse.json({ error: "signer_required" }, { status: 400 });
  }
  try {
    const result = await resendSignerLink(params.id, signerId, {
      name: user.name || user.email,
      email: user.email,
    });
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "envelope_not_found" || msg === "signer_not_found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg === "envelope_not_live" || msg === "signer_finished") {
      return NextResponse.json({ error: msg }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
