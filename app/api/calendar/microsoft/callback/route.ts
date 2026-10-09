import { NextRequest, NextResponse } from "next/server";
import { ensureSubscription, msExchangeCode, pullGraphWindow } from "@/lib/microsoft";

const CAL = "https://portal.cannycapitalpartners.com/calendar";

/** OAuth callback: exchange the code, store tokens, subscribe to changes. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const code = sp.get("code");
  const state = sp.get("state");
  const cookieState = req.cookies.get("ms_oauth_state")?.value;
  if (!code) {
    return NextResponse.redirect(`${CAL}?ms=error-no-code`);
  }
  if (!state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(`${CAL}?ms=error-state`);
  }
  try {
    await msExchangeCode(code);
    await ensureSubscription();
    // Initial pull so the mirror is Graph-fresh immediately.
    await pullGraphWindow().catch(() => null);
    const res = NextResponse.redirect(`${CAL}?ms=connected`);
    res.cookies.delete("ms_oauth_state");
    return res;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.redirect(
      `${CAL}?ms=error&detail=${encodeURIComponent(msg.slice(0, 120))}`
    );
  }
}
