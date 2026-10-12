import type { ReminderItem } from "@/lib/briefing-types";
import { dayOffsetBetween } from "@/lib/briefing-window";

/**
 * Reminder grouping and the day's top three. Everything a viewer does here —
 * ticking off, pinning, snoozing, adding their own priorities — is kept in
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

/** A priority typed in by the viewer rather than taken from Reminders. */
export interface CustomPriority {
  id: string;
  title: string;
}

export interface PriorityEntry {
  id: string;
  title: string;
  detail: string;
  /** Why it is in the top three, for the badge beside it. */
  reason: "Pinned" | "Your priority" | "Overdue" | "Due today" | "Coming up";
  /** Reminders can be ticked off; custom priorities are removed instead. */
  source: "reminder" | "custom";
}

export const TOP_PRIORITY_COUNT = 3;

/**
 * Pinned reminders first, then the viewer's own priorities, then whatever is
 * most pressing: overdue, due today, then the soonest upcoming.
 */
export function topPriorities({
  groups,
  pinned,
  custom,
  today,
  timeZone,
}: {
  groups: ReminderGroups;
  pinned: string[];
  custom: CustomPriority[];
  today: string;
  timeZone: string;
}): PriorityEntry[] {
  const all = [...groups.overdue, ...groups.today, ...groups.upcoming, ...groups.undated];
  const entries: PriorityEntry[] = [];
  const used = new Set<string>();
  const fromReminder = (item: ReminderItem, reason: PriorityEntry["reason"]): PriorityEntry => ({
    id: item.id,
    title: item.title,
    detail: [dueLabel(item, today, timeZone), item.listLabel].filter(Boolean).join(" · "),
    reason,
    source: "reminder",
  });

  for (const id of pinned) {
    const item = all.find((candidate) => candidate.id === id);
    if (item && !used.has(item.id)) {
      entries.push(fromReminder(item, "Pinned"));
      used.add(item.id);
    }
  }
  for (const priority of custom) {
    entries.push({
      id: priority.id,
      title: priority.title,
      detail: "Added by you",
      reason: "Your priority",
      source: "custom",
    });
  }
  const automatic: [ReminderItem[], PriorityEntry["reason"]][] = [
    [groups.overdue, "Overdue"],
    [groups.today, "Due today"],
    [groups.upcoming, "Coming up"],
  ];
  for (const [items, reason] of automatic) {
    for (const item of items) {
      if (entries.length >= TOP_PRIORITY_COUNT) break;
      if (!used.has(item.id)) {
        entries.push(fromReminder(item, reason));
        used.add(item.id);
      }
    }
  }
  return entries.slice(0, Math.max(TOP_PRIORITY_COUNT, pinned.length + custom.length));
}
