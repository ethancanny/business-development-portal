import { NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { getSessionUser } from "@/lib/auth";
import {
  RP_ID,
  RP_NAME,
  listCredentials,
  saveChallenge,
} from "@/lib/webauthn-db";

/** POST /api/webauthn/register/options — begin passkey registration (session required). */
export async function POST() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const existing = await listCredentials(user.id);
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userName: user.email,
    userID: new TextEncoder().encode(user.id),
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.credentialId,
      transports: c.transports,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  await saveChallenge(user.id, options.challenge, "register");
  return NextResponse.json(options);
}
