import { NextResponse } from "next/server";
import { ensurePlatform } from "@/lib/platform/service";
import { getFocusSettings } from "@/lib/platform/focus";
import { datasetVersionHeader } from "@/lib/platform/versions";

/**
 * Public Focus mode probe (Focus & Theme, Oct 26, 2026) — the login
 * page is pre-auth but its tagline is focus-aware, so it needs the
 * mode without a session. Returns ONLY the mode string (nothing
 * sensitive), version-headed and cacheable like the other versioned
 * GETs. Middleware's public prefixes do not include this path; the
 * login page calls it after mount and falls back to the focused
 * copy (the default) if the call fails.
 */
export async function GET() {
  try {
    await ensurePlatform();
    const { focus } = await getFocusSettings();
    const res = NextResponse.json({ focus });
    const vh = await datasetVersionHeader("focus_theme");
    for (const [k, v] of Object.entries(vh)) res.headers.set(k, v);
    res.headers.set("Cache-Control", "private, max-age=300");
    return res;
  } catch {
    return NextResponse.json({ focus: "ad" });
  }
}
