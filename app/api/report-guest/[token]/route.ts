import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getRecipientRender } from "@/lib/comms/delivery";

/**
 * PUBLIC recipient render — NO session; the token is the credential.
 * Guest-handler rules (hard): force-dynamic, headers() read at the
 * top of the handler, Cache-Control private, no-store on EVERY
 * response. The delivery service re-validates the token on every
 * call (revoked/expired/deleted reports fail closed) and returns the
 * audience-filtered render ONLY.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function guestError(error: string): NextResponse {
  const status =
    error === "not_found" ? 404 : error === "expired" ? 410 : 403;
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

function errorCode(err: unknown): string {
  if (err instanceof Error && /^[a-z][a-z0-9_]+$/.test(err.message)) {
    return err.message;
  }
  const rec =
    err && typeof err === "object" ? (err as Record<string, unknown>) : null;
  if (typeof rec?.error === "string") return rec.error;
  return "";
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  headers();
  try {
    const result = (await getRecipientRender(params.token)) as unknown as
      | Record<string, unknown>
      | null;
    if (!result) return guestError("not_found");
    if (typeof result.error === "string" && result.error) {
      return guestError(result.error);
    }
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (err) {
    const code = errorCode(err);
    if (code === "not_found" || code === "expired" || code === "revoked") {
      return guestError(code);
    }
    console.error(
      "[report-guest:get]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
