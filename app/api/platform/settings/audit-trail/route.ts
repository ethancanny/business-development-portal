import { NextRequest, NextResponse } from "next/server";
import { getActivity } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getUserRole } from "@/lib/platform/permissions";

/**
 * Admin-only audit trail feed (Navigation Restructure). Returns the
 * same activity payload shape as /api/activity — it reuses the exact
 * same underlying lib function (getActivity from lib/db) — but gated
 * to role 'admin': 401 with no session, 403 for anyone else.
 * /api/activity itself is NOT gated (deal pages use it).
 */
export async function GET(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const role = await getUserRole(user.email);
  if (role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const limit = Math.min(
    Math.max(Number(req.nextUrl.searchParams.get("limit")) || 100, 1),
    500
  );
  const events = await getActivity();
  return NextResponse.json(events.slice(0, limit));
}
