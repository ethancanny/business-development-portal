import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { computeBadgeCount, type BadgeBreakdown } from "@/lib/badge";

/** App-icon badge count, served from the single server computation
 * (lib/badge): open follow-ups due today or overdue + unread Activity
 * items. The client applies it verbatim — setAppBadge(count) when > 0,
 * clearAppBadge() when 0.
 *
 * CPU slimming (Nov 7, 2026): the PWA polls this route, and each poll
 * used to pay the full computation. A 30-second per-instance cache
 * serves repeat polls for free; the count still derives from live
 * data on every recompute (never a stored running total), and the
 * push paths call computeBadgeCount directly, bypassing this cache,
 * so a just-cleared badge is pushed fresh immediately. */
const CACHE_MS = 30_000;
let cached: { at: number; badge: BadgeBreakdown } | null = null;

export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!cached || Date.now() - cached.at >= CACHE_MS) {
    cached = { at: Date.now(), badge: await computeBadgeCount() };
  }
  const badge = cached.badge;
  // newItems kept as an alias of unreadNotifications for older clients.
  return NextResponse.json({ ...badge, newItems: badge.unreadNotifications });
}
