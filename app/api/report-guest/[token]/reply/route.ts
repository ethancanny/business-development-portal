import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { postRecipientReply } from "@/lib/comms/delivery";

/**
 * PUBLIC recipient reply — NO session; the token is the credential.
 * Guest-handler rules (hard): force-dynamic, headers() read at the
 * top, Cache-Control private, no-store on EVERY response. The
 * delivery service validates the token, then writes the reply as a
 * 'comms_report' comment + activity + notification.
 */
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

function guestError(error: string, status = 403): NextResponse {
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

export async function POST(
  req: NextRequest,
  { params }: { params: { token: string } }
): Promise<NextResponse> {
  headers();
  try {
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) return guestError("body_required", 400);
    const name =
      typeof body.name === "string" && body.name.trim()
        ? body.name.trim()
        : undefined;
    const sectionKey =
      typeof body.sectionKey === "string" && body.sectionKey.trim()
        ? body.sectionKey.trim().slice(0, 120)
        : undefined;
    const result = (await postRecipientReply(params.token, {
      name,
      body: text,
      sectionKey,
    })) as unknown as Record<string, unknown> | null;
    if (result && typeof result.error === "string" && result.error) {
      const e = result.error;
      return guestError(
        e,
        e === "not_found" ? 404 : e === "expired" ? 410 : 403
      );
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (err) {
    const code = errorCode(err);
    if (code === "not_found" || code === "expired" || code === "revoked") {
      return guestError(
        code,
        code === "not_found" ? 404 : code === "expired" ? 410 : 403
      );
    }
    console.error(
      "[report-guest:reply]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
