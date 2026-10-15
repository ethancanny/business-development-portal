import { NextResponse } from "next/server";
import { AUTH_COOKIE, getSessionUser } from "@/lib/auth";
import { bumpEpoch } from "@/lib/webauthn-db";

/**
 * POST /api/auth/sign-out-everywhere — bump the user's session epoch so
 * every previously issued token fails its next /api/auth/session check,
 * and clear this device's auth cookie too (mirrors /api/auth/logout).
 */
export async function POST() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await bumpEpoch(user.id);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(AUTH_COOKIE, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return res;
}
