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

  const token = signToken(user, epoch);
  const res = NextResponse.json({ ok: true, user });
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
