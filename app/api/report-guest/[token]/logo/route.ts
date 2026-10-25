import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getRecipientLogo } from "@/lib/comms/delivery";

/**
 * PUBLIC recipient subject-logo — NO session; the token is the
 * credential. Serves the subject company's logo rendition ONLY when
 * the deal identity codename rules allow a logo on this surface
 * (an active external codename hides the logo entirely — 404).
 * Guest-handler rules (hard): force-dynamic, headers() read at the
 * top, token re-validated on every call by the delivery service.
 * The bytes are a company logo (not report content), so a short
 * private cache is safe.
 */
export const dynamic = "force-dynamic";

function guestError(error: string): NextResponse {
  const status =
    error === "not_found" ? 404 : error === "expired" ? 410 : 403;
  return NextResponse.json(
    { error },
    { status, headers: { "Cache-Control": "private, no-store" } }
  );
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  headers();
  try {
    const result = await getRecipientLogo(params.token);
    if ("error" in result) return guestError(result.error);
    return new NextResponse(result.data as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": result.mime,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error(
      "[report-guest:logo]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
