import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { getPublicKey } from "@/lib/push";

/** VAPID public key for the client-side subscribe flow. */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ publicKey: await getPublicKey() });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
