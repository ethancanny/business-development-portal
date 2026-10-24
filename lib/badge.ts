import { getDealFlow, getTasks } from "@/lib/db";
import { dismissBadgeItem, getBadgeDismissals, phoenixDate } from "@/lib/push-db";

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
 *
 * Clear-to-empty (Ethan, Oct 24, 2026): "Mark all read" in the
 * notification center ALSO dismisses the follow-ups counted at that
 * moment, durably, via badge_dismissals (lib/push-db) — otherwise the
 * badge could never reach zero while any follow-up sat due or
 * overdue. A dismissal is keyed to the follow-up's due STATE
 * (followupStateKey): the same unchanged follow-up stays dismissed,
 * but a due-date change, or escalation from due-today to overdue,
 * produces a new state key and the follow-up counts again. Nothing
 * here mutes future follow-ups — a new or materially changed one
 * always counts.
 */
export interface BadgeBreakdown {
  count: number;
  dueFollowups: number;
  unreadNotifications: number;
}

/** The due state a follow-up is dismissed in: its due date plus
 * whether it is merely due today or already overdue. Changing the
 * due date, or crossing from due-today into overdue, is a new state
 * — a dismissal recorded against the old state no longer matches. */
export function followupStateKey(dueDate: string, today: string): string {
  return `${dueDate}|${dueDate < today ? "overdue" : "due"}`;
}

export async function computeBadgeCount(): Promise<BadgeBreakdown> {
  const today = phoenixDate();
  const [tasks, flow, dismissed] = await Promise.all([
    getTasks(),
    getDealFlow(),
    getBadgeDismissals("followup").catch(() => new Set<string>()),
  ]);
  const dueFollowups = tasks.filter(
    (t) =>
      !t.done &&
      t.dueDate !== "" &&
      t.dueDate <= today &&
      !dismissed.has(`${t.id}|${followupStateKey(t.dueDate, today)}`)
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

/** Dismiss every follow-up the badge is counting right now, each in
 * its current due state. Called by the notification center's
 * "Mark all read" so clearing can actually reach a zero badge.
 * Returns how many follow-ups were dismissed. */
export async function dismissCurrentlyDueFollowups(): Promise<number> {
  const today = phoenixDate();
  const [tasks, dismissed] = await Promise.all([
    getTasks(),
    getBadgeDismissals("followup").catch(() => new Set<string>()),
  ]);
  let n = 0;
  for (const t of tasks) {
    if (t.done || t.dueDate === "" || t.dueDate > today) continue;
    const state = followupStateKey(t.dueDate, today);
    if (dismissed.has(`${t.id}|${state}`)) continue;
    await dismissBadgeItem("followup", t.id, state);
    n += 1;
  }
  return n;
}
