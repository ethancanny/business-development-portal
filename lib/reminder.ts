import { clearEventReminder, setEventReminder } from "./calendar-db";

/**
 * Per-event reminder choices (Ethan, Oct 16, 2026). The Calendar UI sends
 * one field per event: "default" (no explicit choice — the portal's
 * standard meeting alert governs pushes and Outlook's own reminder is
 * left untouched), "off", or a minutes-before-start number as a string
 * ("0", "5", "15", "30", "60", "120", "1440"). The choice is applied to
 * BOTH channels: the Graph event (isReminderOn /
 * reminderMinutesBeforeStart, via EventDraft.reminderMinutes) and the
 * portal store (calendar_event_reminders) that the push checker reads.
 */

export type ReminderInput =
  | { present: false }
  | { present: true; choice: "default" | "off" | number };

export function parseReminderInput(v: unknown): ReminderInput {
  if (v === undefined || v === null) return { present: false };
  if (v === "default") return { present: true, choice: "default" };
  if (v === "off") return { present: true, choice: "off" };
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && /^\d+$/.test(v.trim())
        ? parseInt(v.trim(), 10)
        : NaN;
  if (Number.isFinite(n) && n >= 0 && n <= 43200) {
    return { present: true, choice: Math.round(n) };
  }
  return { present: false };
}

/** EventDraft.reminderMinutes for a parsed choice: undefined leaves the
 * Graph reminder untouched (the "default" choice); null = Off. */
export function reminderDraftMinutes(
  input: ReminderInput
): number | null | undefined {
  if (!input.present || input.choice === "default") return undefined;
  return input.choice === "off" ? null : input.choice;
}

/** Persist a parsed choice in the portal store. No-op when the request
 * carried no reminder field (unrelated edits never disturb a choice). */
export async function applyReminderChoice(
  eventId: string,
  input: ReminderInput
): Promise<void> {
  if (!input.present || !eventId) return;
  if (input.choice === "default") {
    await clearEventReminder(eventId);
  } else if (input.choice === "off") {
    await setEventReminder(eventId, null);
  } else {
    await setEventReminder(eventId, input.choice);
  }
}

/** Human label for a minutes-before-start offset. */
export function reminderOffsetLabel(minutes: number): string {
  if (minutes === 0) return "at start time";
  if (minutes === 1) return "1 minute before";
  if (minutes < 60) return `${minutes} minutes before`;
  if (minutes === 60) return "1 hour before";
  if (minutes === 1440) return "1 day before";
  if (minutes % 1440 === 0) return `${minutes / 1440} days before`;
  if (minutes % 60 === 0) return `${minutes / 60} hours before`;
  return `${minutes} minutes before`;
}
