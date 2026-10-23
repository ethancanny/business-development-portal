import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { getRecipientPdf } from "@/lib/comms/delivery";

/**
 * PUBLIC recipient PDF download — NO session; the token is the
 * credential. Guest-handler rules (hard): force-dynamic, headers()
 * read at the top, Cache-Control private, no-store on EVERY response.
 *
 * The bytes come from delivery.getRecipientPdf: it re-validates the
 * token on every call, tracks the 'downloaded' access, and returns
 * the stored PDF for the delivered version (built from the
 * audience-filtered render when none is stored) — so a recipient
 * never receives internal-only content.
 *
 * allow_pdf semantics (per the Part 12 contract): the delivery's
 * allow_pdf flag governs the EMAIL ATTACHMENT only. Portal viewing is
 * the default delivery, and PDF download through this portal link is
 * a tracked delivery feature — allowed whenever the delivery exists
 * and validates.
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
    const result = await getRecipientPdf(params.token);
    if ("error" in result) return guestError(result.error);
    return new NextResponse(result.buffer as BodyInit, {
      status: 200,
      headers: {
        ...NO_STORE,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
      },
    });
  } catch (err) {
    const code = errorCode(err);
    if (code === "not_found" || code === "expired" || code === "revoked") {
      return guestError(code);
    }
    console.error(
      "[report-guest:pdf]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
