import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensurePlatform } from "@/lib/platform/service";
import { getUserRole } from "@/lib/platform/permissions";
import {
  getFocusSettings,
  getFocusImpact,
  updateFocusSettings,
  type FocusPatch,
} from "@/lib/platform/focus";
import { datasetVersionHeader } from "@/lib/platform/versions";

/**
 * Settings → Focus & Theme: workspace Focus (Oct 26, 2026).
 * GET  → { settings, impact, role } — any signed-in user (clients need
 *        the mode to render); `impact` carries the live counts and
 *        hide/pause/restore lines the confirmation dialog shows.
 * PUT  — admin only. Body: { focus?, taxonomy?, naics?,
 *        matchingBoost? }. Every write is audit-logged in the service
 *        and bumps the `focus_theme` dataset version. The GET carries
 *        the dataset version header (perf-pass convention) so
 *        loadDataset clients refetch exactly when it moves.
 */

export async function GET() {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const [settings, impact, role] = await Promise.all([
    getFocusSettings(),
    getFocusImpact(),
    getUserRole(user.email),
  ]);
  const res = NextResponse.json({ settings, impact, role });
  const vh = await datasetVersionHeader("focus_theme");
  for (const [k, val] of Object.entries(vh)) res.headers.set(k, val);
  res.headers.set("Cache-Control", "private, max-age=300");
  return res;
}

export async function PUT(req: NextRequest) {
  const user = getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  await ensurePlatform();
  const role = await getUserRole(user.email);
  if (role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as FocusPatch;
  const settings = await updateFocusSettings(user.email, body);
  const impact = await getFocusImpact();
  return NextResponse.json({ settings, impact });
}
