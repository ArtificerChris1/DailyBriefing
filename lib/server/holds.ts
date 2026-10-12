import "server-only";

import type { CalendarItem } from "@/lib/briefing-types";

/**
 * Calendar holds: placeholder blocks such as "Check with me prior to
 * scheduling" that reserve time rather than describe plans. Titles containing
 * any comma-separated fragment of IGNORED_EVENT_TITLES (case-insensitive) are
 * marked `hold`: the schedule still shows them, but the summary, suggestions,
 * Up Next and the Tomorrow card pass over them. HEADS_UP_IGNORE_TITLES, the
 * setting's earlier name, still works.
 */
function fragments(): string[] {
  return (process.env.IGNORED_EVENT_TITLES ?? process.env.HEADS_UP_IGNORE_TITLES ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

export function markHolds(items: CalendarItem[]): CalendarItem[] {
  const ignored = fragments();
  if (!ignored.length) return items;
  return items.map((item) =>
    ignored.some((fragment) => item.title.toLowerCase().includes(fragment))
      ? { ...item, hold: true }
      : item,
  );
}
