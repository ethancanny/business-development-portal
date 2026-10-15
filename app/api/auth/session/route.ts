import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { AUTH_COOKIE, verifyToken } from "@/lib/auth";
import { getSecurity, setLockMinutes } from "@/lib/webauthn-db";

/**
 * GET /api/auth/session — session validity for the client lock screen.
 * A token is epoch-valid when its epoch claim matches the user's current
 * session epoch (bumped by "sign out everywhere"). getSessionUser() alone
 * does not enforce the epoch; this route is the enforcement path.
 */
export async function GET() {
  const token = cookies().get(AUTH_COOKIE)?.value;
  const user = token ? verifyToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let epoch = 0;
  let lockMinutes = 15;
  try {
    const sec = await getSecurity(user.id);
    epoch = sec.sessionEpoch;
    lockMinutes = sec.lockMinutes;
  } catch {
    /* DATABASE_URL unset (local dev): fall back to defaults */
  }
  return NextResponse.json({
    user: { id: user.id, name: user.name, email: user.email },
    epochValid: (user.epoch ?? 0) === epoch,
    lockMinutes,
  });
}

/** POST /api/auth/session { lockMinutes } — update the auto-lock setting. */
export async function POST(req: NextRequest) {
  const token = cookies().get(AUTH_COOKIE)?.value;
  const user = token ? verifyToken(token) : null;
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const minutes = Number(body.lockMinutes);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 480) {
    return NextResponse.json({ error: "Invalid lockMinutes" }, { status: 400 });
  }
  await setLockMinutes(user.id, minutes);
  return NextResponse.json({ ok: true, lockMinutes: Math.round(minutes) });
}
