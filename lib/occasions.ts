import type { OccasionItem } from "@/lib/briefing-types";
import { shiftDateKey } from "@/lib/briefing-window";
import { familyBirthdays } from "@/lib/data/birthdays";

/**
 * Occasions worth planning for: family birthdays and anniversaries, and the
 * holidays that usually involve a card, a gift, or plans. Only the family list
 * counts here; the much longer Facebook list stays in the birthdays card,
 * where a quick message is the right response rather than a gift.
 */

/** How far ahead to plan. */
export const OCCASION_HORIZON_DAYS = 21;

interface Holiday {
  name: string;
  /** `MM-DD` for the year in question. */
  on: (year: number) => string;
  giftable: boolean;
}

function mmdd(month: number, day: number): string {
  return `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The nth given weekday (0 = Sunday) of a month; n = -1 for the last. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return mmdd(month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return mmdd(month, lastDay - ((last - weekday + 7) % 7));
}

/** Western Easter Sunday (anonymous Gregorian algorithm). */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return mmdd(month, day);
}

const HOLIDAYS: Holiday[] = [
  { name: "New Year’s Day", on: () => "01-01", giftable: false },
  { name: "Valentine’s Day", on: () => "02-14", giftable: true },
  { name: "Easter", on: easter, giftable: false },
  { name: "Mother’s Day", on: (year) => nthWeekday(year, 5, 0, 2), giftable: true },
  { name: "Memorial Day", on: (year) => nthWeekday(year, 5, 1, -1), giftable: false },
  { name: "Father’s Day", on: (year) => nthWeekday(year, 6, 0, 3), giftable: true },
  { name: "Independence Day", on: () => "07-04", giftable: false },
  { name: "Labor Day", on: (year) => nthWeekday(year, 9, 1, 1), giftable: false },
  { name: "Halloween", on: () => "10-31", giftable: false },
  { name: "Thanksgiving", on: (year) => nthWeekday(year, 11, 4, 4), giftable: false },
  { name: "Christmas", on: () => "12-25", giftable: true },
  { name: "New Year’s Eve", on: () => "12-31", giftable: false },
];

function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(Date.parse(`${date}T12:00:00Z`));
}

export function upcomingOccasions(today: string): OccasionItem[] {
  const items: OccasionItem[] = [];
  for (let offset = 0; offset <= OCCASION_HORIZON_DAYS; offset += 1) {
    const date = shiftDateKey(today, offset);
    const year = Number(date.slice(0, 4));
    const monthDay = date.slice(5);

    for (const record of familyBirthdays) {
      if (record.on !== monthDay || record.died !== undefined) continue;
      const kind = record.kind ?? "birthday";
      const years = record.since !== undefined ? year - record.since : undefined;
      items.push({
        id: `occasion-${kind}-${monthDay}-${record.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: record.name,
        kind,
        date,
        offset,
        dateLabel: dateLabel(date),
        detail:
          years === undefined || years <= 0
            ? undefined
            : kind === "anniversary"
              ? `${years} years`
              : `Turns ${years}`,
        giftable: true,
      });
    }
    for (const holiday of HOLIDAYS) {
      if (holiday.on(year) !== monthDay) continue;
      items.push({
        id: `occasion-holiday-${date}`,
        name: holiday.name,
        kind: "holiday",
        date,
        offset,
        dateLabel: dateLabel(date),
        giftable: holiday.giftable,
      });
    }
  }
  return items;
}
