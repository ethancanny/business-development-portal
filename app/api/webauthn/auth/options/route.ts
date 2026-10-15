import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import {
  RP_ID,
  findSeedUser,
  listCredentials,
  saveChallenge,
} from "@/lib/webauthn-db";

/** POST /api/webauthn/auth/options — begin passkey sign-in for an email. */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";

  const user = findSeedUser(email);
  if (!user) {
    return NextResponse.json({ error: "No passkey registered" }, { status: 400 });
  }
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

  await saveChallenge(email, options.challenge, "auth");
  return NextResponse.json(options);
}
