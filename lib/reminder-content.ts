import type { CalendarEvent } from "./calendar-db";
import type { Task } from "./types";

/**
 * Rich notification content (Ethan, Oct 16, 2026): every reminder and
 * digest body is composed HERE, server-side at send time, from the live
 * record — never a generic placeholder. All times America/Phoenix,
 * 12-hour clock. Follow-up bodies follow his layout:
 *   [🔴 High priority]
 *   Today at 2:00 PM · in 15 minutes        (or the overdue form)
 *   Call · Harbor Foods · Ronan Canny        (type · account · assignee)
 *   First line of the notes…                 (when present)
 */

const TZ = "America/Phoenix";
const DAY = 864e5;

export function phxDateStr(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function clock(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function monthDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
  }).format(d);
}

function weekdayMonthDay(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(d);
}

/** "15 minutes" / "1 hour" / "2 hours" / "1 day" for a duration in ms. */
function durationLabel(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${Math.max(1, mins)} minute${mins === 1 ? "" : "s"}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

function dayRelation(d: Date, now: Date): "today" | "tomorrow" | "other" {
  const today = phxDateStr(now);
  const tomorrow = phxDateStr(new Date(now.getTime() + DAY));
  const ds = phxDateStr(d);
  if (ds === today) return "today";
  if (ds === tomorrow) return "tomorrow";
  return "other";
}

/** Line 1 for a timed instant: "Today at 2:00 PM · in 15 minutes",
 * "Tomorrow at 9:00 AM", "Mon, Oct 19 at 9:00 AM" — or the overdue
 * form "Was due Oct 14 at 9:00 AM · 2 days overdue". */
function timedLine(due: Date, now: Date): string {
  const rel = dayRelation(due, now);
  if (due.getTime() <= now.getTime()) {
    const late = durationLabel(now.getTime() - due.getTime());
    return `Was due ${monthDay(due)} at ${clock(due)} · ${late} overdue`;
  }
  if (rel === "today") {
    const inLabel = durationLabel(due.getTime() - now.getTime());
    return `Today at ${clock(due)} · in ${inLabel}`;
  }
  if (rel === "tomorrow") return `Tomorrow at ${clock(due)}`;
  return `${weekdayMonthDay(due)} at ${clock(due)}`;
}

function allDayLine(dateStr: string, now: Date): string {
  const day = new Date(`${dateStr}T12:00:00-07:00`);
  const rel = dayRelation(day, now);
  if (rel === "today") return "Today · All day";
  if (rel === "tomorrow") return "Tomorrow · All day";
  return `${monthDay(day)} · All day`;
}

function truncateLine(text: string, max = 90): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** The instant a follow-up is due: its time, or the 8:00 AM Phoenix
 * anchor for all-day items. */
export function taskDueInstant(task: Task): Date {
  if (task.dueTime) return new Date(`${task.dueDate}T${task.dueTime}:00-07:00`);
  return new Date(`${task.dueDate}T08:00:00-07:00`);
}

export interface BuiltNotification {
  title: string;
  body: string;
  url: string;
}

export function buildTaskReminder(task: Task, now: Date): BuiltNotification {
  const lines: string[] = [];
  if (task.priority === "high") lines.push("🔴 High priority");
  if (task.dueTime) {
    lines.push(timedLine(taskDueInstant(task), now));
  } else {
    // All-day overdue reads "Was due Oct 14 · All day · 2 days overdue".
    const today = phxDateStr(now);
    if (task.dueDate < today) {
      const dueDay = new Date(`${task.dueDate}T12:00:00-07:00`);
      const late = durationLabel(now.getTime() - taskDueInstant(task).getTime());
      lines.push(`Was due ${monthDay(dueDay)} · All day · ${late} overdue`);
    } else {
      lines.push(allDayLine(task.dueDate, now));
    }
  }
  const meta: string[] = [task.type];
  if (task.relatedName) meta.push(task.relatedName);
  if (task.owner && task.owner !== "Ethan Canny") meta.push(task.owner);
  lines.push(meta.join(" · "));
  const firstNote = (task.notes ?? "").split("\n").map((s) => s.trim()).find(Boolean);
  if (firstNote) lines.push(truncateLine(firstNote));
  return {
    title: task.title,
    body: lines.join("\n"),
    url: `/overview?task=${task.id}#overview-tasks`,
  };
}

export function buildEventReminder(ev: CalendarEvent, now: Date): BuiltNotification {
  const lines: string[] = [];
  if (ev.allDay) {
    lines.push(allDayLine(ev.startsAt.slice(0, 10), now));
  } else {
    lines.push(timedLine(new Date(ev.startsAt), now));
  }
  if (ev.location) {
    lines.push(/^https?:\/\//i.test(ev.location) ? "Online" : truncateLine(ev.location, 60));
  }
  return {
    title: ev.title,
    body: lines.join("\n"),
    url: `/calendar?event=${encodeURIComponent(ev.eventId)}`,
  };
}

/** Morning digest: "3 follow-ups today: Call Harbor Foods (2:00 PM),
 * Send LOI draft, +1 more". Items arrive pre-sorted (all-day first). */
export function buildMorningDigest(tasks: Task[]): BuiltNotification {
  const shown = tasks.slice(0, 3).map((t) =>
    t.dueTime
      ? `${t.title} (${clock(new Date(`${t.dueDate}T${t.dueTime}:00-07:00`))})`
      : t.title
  );
  const rest = tasks.length - shown.length;
  const list = shown.join(", ") + (rest > 0 ? `, +${rest} more` : "");
  return {
    title: "Follow-ups today",
    body: `${tasks.length} follow-up${tasks.length === 1 ? "" : "s"} today: ${list}`,
    url: "/overview#overview-tasks",
  };
}
