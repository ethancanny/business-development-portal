import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { recordEmailPixelOpen } from "@/lib/comms/delivery";

/**
 * PUBLIC open pixel — NO session; the delivery token is the
 * credential. Follows the report-guest route law (hard rules):
 * force-dynamic, headers() read at the top of the handler,
 * Cache-Control private, no-store on EVERY response, and the token
 * re-validated on every call (hash + revoked + expired + report not
 * deleted) inside the delivery service. Error mapping mirrors the
 * guest routes: not_found 404, expired 410, anything else 403.
 *
 * A valid hit stamps the delivery's email_opened_at (first hit only)
 * and returns a 1×1 transparent PNG. It NEVER stamps opened_at /
 * viewed_at — those record the recipient opening the portal link.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

/** 1×1 transparent PNG. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

function trackError(error: string): NextResponse {
  const status =
    error === "not_found" ? 404 : error === "expired" ? 410 : 403;
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  headers();
  try {
    const result = await recordEmailPixelOpen(params.token);
    if ("error" in result) return trackError(result.error);
    return new NextResponse(PIXEL, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "image/png",
        "Content-Length": String(PIXEL.length),
      },
    });
  } catch (err) {
    console.error(
      "[track:get]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
