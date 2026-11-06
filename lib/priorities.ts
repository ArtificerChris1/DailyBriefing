import type { ReminderItem } from "@/lib/briefing-types";
import { dayOffsetBetween } from "@/lib/briefing-window";

/**
 * Reminder grouping and due labels. Everything a viewer does here —
 * ticking off, pinning, snoozing — is kept in
 * that browser only: the site is static and cannot write back to Apple
 * Reminders, so the next Shortcut snapshot remains the source of truth.
 */

export interface ReminderGroups {
  /** Due before today and still open: carried over from earlier days. */
  overdue: ReminderItem[];
  today: ReminderItem[];
  upcoming: ReminderItem[];
  undated: ReminderItem[];
}

function dueDateKey(reminder: ReminderItem, timeZone: string): string | undefined {
  if (!reminder.dueAt) return undefined;
  const due = Date.parse(reminder.dueAt);
  if (Number.isNaN(due)) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(due);
}

export function groupReminders(
  items: ReminderItem[],
  today: string,
  timeZone: string,
): ReminderGroups {
  const groups: ReminderGroups = { overdue: [], today: [], upcoming: [], undated: [] };
  for (const item of items) {
    const due = dueDateKey(item, timeZone);
    if (!due) groups.undated.push(item);
    else if (due < today) groups.overdue.push(item);
    else if (due === today) groups.today.push(item);
    else groups.upcoming.push(item);
  }
  const byDue = (left: ReminderItem, right: ReminderItem) =>
    Date.parse(left.dueAt ?? "") - Date.parse(right.dueAt ?? "");
  groups.overdue.sort(byDue);
  groups.today.sort(byDue);
  groups.upcoming.sort(byDue);
  return groups;
}

/** "3 days overdue", "Due 4:30 PM", "Due Fri" — relative to today. */
export function dueLabel(reminder: ReminderItem, today: string, timeZone: string): string {
  const due = dueDateKey(reminder, timeZone);
  if (!due || !reminder.dueAt) return "No due date";
  const offset = dayOffsetBetween(today, due);
  if (offset < 0) return offset === -1 ? "Due yesterday" : `${-offset} days overdue`;
  const instant = Date.parse(reminder.dueAt);
  if (offset === 0) {
    return `Due ${new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(instant)}`;
  }
  if (offset === 1) return "Due tomorrow";
  return `Due ${new Intl.DateTimeFormat("en-US", {
    weekday: offset < 7 ? "short" : undefined,
    month: offset < 7 ? undefined : "short",
    day: offset < 7 ? undefined : "numeric",
    timeZone,
  }).format(instant)}`;
}
