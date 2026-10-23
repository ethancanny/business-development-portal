import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { updateExpiry } from "@/lib/signing/service";

/** Update an envelope's expiry. POST { expiresAt } (ISO string, or
 * null to clear). An 'expired' envelope with a future expiry revives
 * to docgen status 'sent'. */
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
  const expiresAt =
    body.expiresAt === null
      ? null
      : typeof body.expiresAt === "string"
        ? body.expiresAt
        : undefined;
  if (expiresAt === undefined) {
    return NextResponse.json(
      { error: "expires_at_required", detail: "Provide expiresAt (ISO string or null)." },
      { status: 400 }
    );
  }
  try {
    const detail = await updateExpiry(params.id, expiresAt, {
      name: user.name || user.email,
      email: user.email,
    });
    return NextResponse.json(detail);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "envelope_not_found") {
      return NextResponse.json({ error: msg }, { status: 404 });
    }
    if (msg === "expires_at_invalid") {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
