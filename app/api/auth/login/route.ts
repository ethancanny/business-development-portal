import { NextRequest, NextResponse } from "next/server";
import {
  verifyCredentials,
  signToken,
  AUTH_COOKIE,
  authCookieOptions,
} from "@/lib/auth";

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

  const token = signToken(user);
  const res = NextResponse.json({ ok: true, user });
  res.cookies.set(AUTH_COOKIE, token, authCookieOptions());
  return res;
}
