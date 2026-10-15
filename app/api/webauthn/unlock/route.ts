import { NextRequest, NextResponse } from "next/server";
import {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { getSessionUser } from "@/lib/auth";
import {
  EXPECTED_ORIGIN,
  RP_ID,
  deleteChallenge,
  getChallenge,
  getCredential,
  listCredentials,
  saveChallenge,
  updateCredentialCounter,
} from "@/lib/webauthn-db";

/**
 * POST /api/webauthn/unlock — re-verify the signed-in user with a passkey
 * to lift the idle auto-lock. Two steps in one route:
 *   { step: "options" }            → authentication options
 *   { step: "verify", response }   → { ok, unlockedAt }
 * The session cookie must still be valid; unlocking does not re-issue it.
 */
export async function POST(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const step = body.step as string | undefined;

  if (step === "options") {
    const creds = await listCredentials(user.id);
    if (!creds.length) {
      return NextResponse.json({ error: "No passkey registered" }, { status: 400 });
    }
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      allowCredentials: creds.map((c) => ({
        id: c.credentialId,
        transports: c.transports,
      })),
      userVerification: "preferred",
    });
    await saveChallenge(user.id, options.challenge, "unlock");
    return NextResponse.json(options);
  }

  if (step === "verify") {
    const response = body.response as AuthenticationResponseJSON | undefined;
    if (!response || typeof response.id !== "string") {
      return NextResponse.json({ error: "Missing authentication response" }, { status: 400 });
    }
    const challenge = await getChallenge(user.id, "unlock");
    if (!challenge) {
      return NextResponse.json(
        { error: "Unlock challenge expired — try again" },
        { status: 400 }
      );
    }
    await deleteChallenge(user.id, "unlock");

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
    return NextResponse.json({ ok: true, unlockedAt: new Date().toISOString() });
  }

  return NextResponse.json({ error: "Unknown step" }, { status: 400 });
}
