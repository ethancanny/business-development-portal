import { getDealFlow, getTasks } from "@/lib/db";
import { phoenixDate } from "@/lib/push-db";

/**
 * THE app-icon badge computation (Oct 16, 2026) — the single source of
 * truth for what the badge shows. Used by GET /api/push/badge, the push
 * sender (every payload carries the count), and badge-only update
 * pushes. The count is ALWAYS derived from live data here; it is never
 * stored as a running total anywhere, so it cannot drift.
 *
 *   count = open follow-ups due today or overdue (Phoenix date)
 *         + unread notifications.
 *
 * "Notifications" in this portal are Activity (deal-flow) items — the
 * triage feed every attention push points at. An item is unread while
 * status = "new" and readAt is null; viewing the Activity list (or
 * "Mark all as read") stamps readAt. Triaged items (reviewed / added /
 * dismissed) leave the count by status regardless of read state, and
 * follow-ups leave it by being completed or rescheduled — never by a
 * local increment/decrement.
 */
export interface BadgeBreakdown {
  count: number;
  dueFollowups: number;
  unreadNotifications: number;
}

export async function computeBadgeCount(): Promise<BadgeBreakdown> {
  const today = phoenixDate();
  const [tasks, flow] = await Promise.all([getTasks(), getDealFlow()]);
  const dueFollowups = tasks.filter(
    (t) => !t.done && t.dueDate !== "" && t.dueDate <= today
  ).length;
  const unreadNotifications = flow.filter(
    (i) => i.status === "new" && !i.readAt
  ).length;
  return {
    count: dueFollowups + unreadNotifications,
    dueFollowups,
    unreadNotifications,
  };
}
