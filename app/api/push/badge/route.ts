import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { computeBadgeCount } from "@/lib/badge";

/** App-icon badge count, served from the single server computation
 * (lib/badge): open follow-ups due today or overdue + unread Activity
 * items. The client applies it verbatim — setAppBadge(count) when > 0,
 * clearAppBadge() when 0. */
export async function GET() {
  if (!getSessionUser()) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const badge = await computeBadgeCount();
  // newItems kept as an alias of unreadNotifications for older clients.
  return NextResponse.json({ ...badge, newItems: badge.unreadNotifications });
}
