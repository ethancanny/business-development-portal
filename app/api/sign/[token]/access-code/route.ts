import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { checkAccessCode } from "@/lib/signing/service";
import {
  NO_STORE,
  jsonNoStore,
  normalizeAccessResult,
  resolveFailure,
  resolveSigner,
  tooManyFailures,
} from "@/app/api/sign/shared";

/**
 * PUBLIC signer access-code check — NO session; the token is the
 * credential. Every attempt is counted by the service
 * (countAttempt=true) so its lockout applies; >20 failed signing
 * events for this envelope in 10 minutes → 429 (see shared.ts).
 * Locked → 423.
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
    if (await tooManyFailures(v.envelopeId)) {
      return jsonNoStore({ error: "rate_limited" }, { status: 429 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    const code = typeof body.code === "string" ? body.code : "";
    const result = normalizeAccessResult(
      await checkAccessCode(v.signerId, code, true)
    );
    if (result.locked) {
      return jsonNoStore(
        {
          ok: false,
          required: result.required,
          locked: true,
          attemptsLeft: result.attemptsLeft,
        },
        { status: 423 }
      );
    }
    if (!result.ok) {
      return jsonNoStore(
        {
          ok: false,
          required: result.required,
          locked: false,
          attemptsLeft: result.attemptsLeft,
        },
        { status: 401 }
      );
    }
    return jsonNoStore({
      ok: true,
      required: result.required,
      locked: false,
      attemptsLeft: result.attemptsLeft,
    });
  } catch (err) {
    console.error(
      "[sign:access-code]",
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: NO_STORE }
    );
  }
}
