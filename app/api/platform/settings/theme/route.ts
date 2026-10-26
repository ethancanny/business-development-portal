import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getUserTheme, setUserTheme, type NamedTheme } from "@/lib/platform/focus";

/**
 * Per-user Theme preference (Focus & Theme, Oct 26, 2026).
 * GET → { theme } for the signed-in user ("desert" default).
 * PUT { theme: "desert" | "classic" } — stored server-side so the
 * choice follows the user across devices; the client also caches it in
 * localStorage for first paint. Theme switches are the user's own
 * preference — no admin gate, no confirmation; the change is still
 * written to core.audit_log by the service.
 */

export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  return NextResponse.json({ theme: await getUserTheme(user.email) });
}

export async function PUT(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const body = (await req.json().catch(() => ({}))) as { theme?: string };
  const theme: NamedTheme = body.theme === "classic" ? "classic" : "desert";
  return NextResponse.json({ theme: await setUserTheme(user.email, theme) });
}
