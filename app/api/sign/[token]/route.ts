import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getSigningSettings } from "@/lib/signing/service";
import {
  NO_STORE,
  jsonNoStore,
  resolveFailure,
  resolveSigner,
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
    if (!outcome.ok) return resolveFailure(outcome);
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

    return jsonNoStore({
      state: v.state,
      documentName: v.documentName,
      senderName: v.senderName,
      senderEmail: v.senderEmail,
      signer: { name: v.signerName, email: v.signerEmail },
      signingOrder: v.signingOrder,
      position: v.position,
      totalSigners: v.totalSigners,
      requiresAccessCode: v.requiresAccessCode,
      consented: v.consented,
      expiresAt: v.expiresAt,
      consentText,
      downloadAvailable: v.state === "completed",
    });
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
