import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { recordView } from "@/lib/signing/service";
import {
  NO_STORE,
  clientIp,
  jsonNoStore,
  resolveSigner,
  userAgent,
} from "@/app/api/sign/shared";

/**
 * PUBLIC signer view beacon — NO session; the token is the
 * credential. Fired once per signer-page load; the service applies
 * first-view semantics (repeat calls are harmless).
 */
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  headers();
  try {
    const outcome = await resolveSigner(params.token);
    if (!outcome.ok) {
      return jsonNoStore({ error: "not_found" }, { status: 404 });
    }
    const v = outcome.view;
    if (v.state === "expired") {
      return jsonNoStore({ error: "expired", state: "expired" }, { status: 410 });
    }
    if (v.state === "voided" || v.state === "declined") {
      return jsonNoStore({ error: v.state }, { status: 403 });
    }
    await recordView(v.signerId, clientIp(req), userAgent(req));
    return jsonNoStore({ ok: true });
  } catch (err) {
    console.error(
      "[sign:view]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
