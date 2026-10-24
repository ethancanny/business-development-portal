import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { DocGenError } from "@/lib/docgen/generate";
import { sendContractForSignature } from "@/lib/docgen/contracts";

/**
 * Send a contract for signature through the configured e-signature
 * provider (CONTRACT_ESIGN_PROVIDER; default: the in-house signing
 * module). Returns the envelope id + one-time signer links.
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
  try {
    const result = await sendContractForSignature(
      params.id,
      user.name || user.email,
      user.email
    );
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof DocGenError) {
      const status =
        err.error === "contract_not_found" || err.error === "document_not_found"
          ? 404
          : err.error === "signer_not_approved_for_room"
            ? 403
            : err.error === "already_sent" || err.error === "contract_executed"
              ? 409
              : 400;
      return NextResponse.json({ error: err.error }, { status });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
