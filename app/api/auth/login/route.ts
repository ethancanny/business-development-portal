import { NextRequest, NextResponse } from "next/server";
import {
  verifyCredentials,
  signToken,
  AUTH_COOKIE,
  authCookieOptions,
} from "@/lib/auth";
import {
  DEVICE_COOKIE,
  deviceCookieOptions,
  deviceLabelFromUA,
  getSecurity,
  registerDevice,
} from "@/lib/webauthn-db";
import { getLoginClaims } from "@/lib/portmgmt/users";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { email, password } = body as { email?: string; password?: string };

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 }
    );
  }

  const user = await verifyCredentials(email, password);
  if (!user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Stamp the token with the current session epoch ("sign out everywhere"
  // bumps it) and record this browser as a session device. Both are
  // best-effort: a DB hiccup must never block a valid password sign-in.
  let epoch = 0;
  try {
    epoch = (await getSecurity(user.id)).sessionEpoch;
  } catch {
    epoch = 0;
  }

  // Phase 9: company-scoped management logins carry role/companyIds
  // claims in the token (partners get none). Best-effort like the
  // epoch lookup: a claims hiccup must never block a valid sign-in —
  // route-level authz re-resolves scope from the DB regardless.
  let claims: Awaited<ReturnType<typeof getLoginClaims>> = null;
  try {
    claims = await getLoginClaims(user.email);
  } catch {
    claims = null;
  }

  const token = signToken(user, epoch, claims ?? undefined);
  const res = NextResponse.json({
    ok: true,
    user: claims ? { ...user, role: claims.role, companyIds: claims.companyIds } : user,
  });
  res.cookies.set(AUTH_COOKIE, token, authCookieOptions());

  const existingDevice = req.cookies.get(DEVICE_COOKIE)?.value;
  const deviceId = existingDevice || crypto.randomUUID();
  if (!existingDevice) {
    res.cookies.set(DEVICE_COOKIE, deviceId, deviceCookieOptions());
  }
  try {
    await registerDevice({
      id: deviceId,
      userId: user.id,
      kind: "session",
      label: deviceLabelFromUA(req.headers.get("user-agent") ?? ""),
    });
  } catch {
    /* device registry is best-effort */
  }

  return res;
}
