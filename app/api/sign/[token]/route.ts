import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSigningSettings } from "@/lib/signing/service";
import {
  NO_STORE,
  jsonNoStore,
  resolveSigner,
  stateBody,
} from "@/app/api/sign/shared";

/**
 * PUBLIC signer state — NO session; the token is the credential
 * (middleware lists /api/sign as public; the session cookie is never
 * read here). Guest-handler rules (hard): force-dynamic, headers()
 * read at the top, Cache-Control private, no-store on EVERY
 * response. Unknown token → 404; expired → 410 with state; voided /
 * declined → 200 with state (informational page). Returns ONLY this
 * envelope's public state — no other portal data.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  headers();
  try {
    const outcome = await resolveSigner(params.token);
    if (!outcome.ok) {
      return jsonNoStore({ error: "not_found" }, { status: 404 });
    }
    const v = outcome.view;

    let consentText = "";
    try {
      const settings = await getSigningSettings();
      consentText =
        settings && typeof settings.consentText === "string"
          ? settings.consentText
          : "";
    } catch {
      /* consent text is additive; the flow still works without it */
    }

    const body = stateBody(v, consentText);
    if (v.state === "expired") {
      return jsonNoStore(body, { status: 410 });
    }
    return jsonNoStore(body);
  } catch (err) {
    console.error(
      "[sign:get]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
