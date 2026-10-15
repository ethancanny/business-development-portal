import { NextRequest, NextResponse } from "next/server";
import {
  verifyRegistrationResponse,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { getSessionUser } from "@/lib/auth";
import {
  EXPECTED_ORIGIN,
  RP_ID,
  deleteChallenge,
  getChallenge,
  registerDevice,
  saveCredential,
} from "@/lib/webauthn-db";

/** POST /api/webauthn/register/verify — finish passkey registration (session required). */
export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const response = body.response as RegistrationResponseJSON | undefined;
  const deviceName =
    typeof body.deviceName === "string" && body.deviceName.trim()
      ? body.deviceName.trim().slice(0, 80)
      : "Passkey";
  if (!response || typeof response.id !== "string") {
    return NextResponse.json({ error: "Missing registration response" }, { status: 400 });
  }

  const challenge = await getChallenge(user.id, "register");
  if (!challenge) {
    return NextResponse.json(
      { error: "Registration challenge expired — try again" },
      { status: 400 }
    );
  }
  // Single-use: burn the challenge before verifying.
  await deleteChallenge(user.id, "register");

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: EXPECTED_ORIGIN,
      expectedRPID: RP_ID,
      requireUserVerification: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Verification failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Passkey could not be verified" }, { status: 400 });
  }

  const { credential } = verification.registrationInfo;
  const transports: AuthenticatorTransport[] =
    ((response.response?.transports as AuthenticatorTransport[] | undefined) ??
      credential.transports ??
      []) as AuthenticatorTransport[];

  await saveCredential({
    credentialId: credential.id,
    userId: user.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports,
    deviceName,
  });
  // The device row for a passkey is keyed by its credential id.
  await registerDevice({
    id: credential.id,
    userId: user.id,
    kind: "passkey",
    label: deviceName,
  });

  return NextResponse.json({ ok: true });
}
