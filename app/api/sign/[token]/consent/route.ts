import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { recordConsent } from "@/lib/signing/service";
import {
  NO_STORE,
  clientIp,
  jsonNoStore,
  resolveFailure,
  resolveSigner,
  userAgent,
} from "@/app/api/sign/shared";

/**
 * PUBLIC signer consent — NO session; the token is the credential.
 * Records the signer's ESIGN consent (with IP + user agent) via the
 * signing service. Only an active signer can consent.
 */
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  headers();
  try {
    const outcome = await resolveSigner(params.token);
    if (!outcome.ok) return resolveFailure(outcome);
    const v = outcome.view;
    if (v.state !== "active") {
      return jsonNoStore(
        { error: "not_active", state: v.state },
        { status: 409 }
      );
    }
    await recordConsent(v.signerId, clientIp(req), userAgent(req));
    return jsonNoStore({ ok: true });
  } catch (err) {
    console.error(
      "[sign:consent]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
