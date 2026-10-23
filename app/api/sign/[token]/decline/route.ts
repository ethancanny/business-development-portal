import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { recordDecline } from "@/lib/signing/service";
import {
  NO_STORE,
  clientIp,
  jsonNoStore,
  resolveFailure,
  resolveSigner,
  userAgent,
} from "@/app/api/sign/shared";

/**
 * PUBLIC signer decline — NO session; the token is the credential.
 * Records the decline (with reason + IP + user agent) via the
 * signing service; the envelope closes for everyone.
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
    if (v.state !== "active" && v.state !== "waiting") {
      return jsonNoStore(
        { error: "not_active", state: v.state },
        { status: 409 }
      );
    }
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const reason =
      typeof body.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
    await recordDecline(v.signerId, reason, clientIp(req), userAgent(req));
    return jsonNoStore({ ok: true });
  } catch (err) {
    console.error(
      "[sign:decline]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
