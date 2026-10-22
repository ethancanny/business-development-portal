import { NextRequest, NextResponse } from "next/server";
import {
  authed,
  internalGate,
  ok,
  readBody,
  serviceError,
  sStr,
} from "@/lib/portmgmt/http";
import { setUserPassword } from "@/lib/portmgmt/users";

/** POST set/reset a portal user's password (internal only).
 * Body: { password } — the value is passed straight to the users
 * service (which hashes it); it is never logged or echoed back. */
export async function POST(
  req: NextRequest,
  { params }: { params: { email: string } }
): Promise<NextResponse> {
  const gate = await authed();
  if ("response" in gate) return gate.response;
  const denied = internalGate(gate.ctx);
  if (denied) return denied;
  const actor = gate.user.name || gate.user.email;
  try {
    const body = await readBody(req);
    await setUserPassword(
      decodeURIComponent(params.email),
      sStr(body.password) ?? "",
      actor
    );
    return ok({ ok: true });
  } catch (err) {
    return serviceError(err, "users-password");
  }
}
