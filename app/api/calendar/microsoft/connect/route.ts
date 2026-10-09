import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { msAuthorizeUrl, msConfigured } from "@/lib/microsoft";

/** Start the Microsoft OAuth flow (Ethan clicks "Connect Outlook"). */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!msConfigured()) {
    return NextResponse.redirect(
      "https://portal.cannycapitalpartners.com/calendar?ms=not-configured"
    );
  }
  const state = `s-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
  const res = NextResponse.redirect(msAuthorizeUrl(state));
  res.cookies.set("ms_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/calendar/microsoft",
    maxAge: 600,
  });
  return res;
}
