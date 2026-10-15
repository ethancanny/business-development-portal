import { NextRequest, NextResponse } from "next/server";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { AUTH_COOKIE, authCookieOptions, signToken } from "@/lib/auth";
import {
  DEVICE_COOKIE,
  EXPECTED_ORIGIN,
  RP_ID,
  deleteChallenge,
  deviceCookieOptions,
  deviceLabelFromUA,
  findSeedUser,
  getChallenge,
  getCredential,
  getSecurity,
  registerDevice,
  updateCredentialCounter,
} from "@/lib/webauthn-db";

/**
 * POST /api/webauthn/auth/verify — finish passkey sign-in.
 * On success issues the session exactly like /api/auth/login (same JWT
 * cookie + options), stamped with the current session epoch, and records
 * this browser as a session device.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const response = body.response as AuthenticationResponseJSON | undefined;

  const user = findSeedUser(email);
  if (!user || !response || typeof response.id !== "string") {
    return NextResponse.json({ error: "Invalid sign-in attempt" }, { status: 400 });
  }

  const challenge = await getChallenge(email, "auth");
  if (!challenge) {
    return NextResponse.json(
      { error: "Sign-in challenge expired — try again" },
      { status: 400 }
    );
  }
  await deleteChallenge(email, "auth");

  const cred = await getCredential(response.id);
  if (!cred || cred.userId !== user.id) {
    return NextResponse.json({ error: "Unknown passkey" }, { status: 400 });
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: cred.credentialId,
        publicKey: new Uint8Array(Buffer.from(cred.publicKey, "base64url")),
        counter: cred.counter,
        transports: cred.transports,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Verification failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "Passkey could not be verified" }, { status: 400 });
  }

  await updateCredentialCounter(cred.credentialId, verification.authenticationInfo.newCounter);

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
    /* device registry is best-effort; never block sign-in */
  }

  return res;
}
