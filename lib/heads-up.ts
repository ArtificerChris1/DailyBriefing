import type { CalendarItem, HeadsUpItem } from "@/lib/briefing-types";

/**
 * "Things you might have forgotten": fixed rules over the next few days of
 * calendar, run at build time. Each finding is a suggestion the page labels as
 * such. Gift reminders are added in the browser instead, because whether a
 * gift is sorted is recorded on the device (see components/heads-up-card.tsx).
 */

/** A first event before this hour counts as an early start. */
const EARLY_START_HOUR = 8;
/** The afternoon window checked for free time, in local hours. */
const AFTERNOON = { from: 13, to: 18 };
const FREE_TIME_MIN_OVERDUE = 2;
/**
 * Events longer than this are holds ("Check with me before scheduling"),
 * not appointments: they overlap everything and say nothing about the start
 * of the day, so the overlap and early-start checks ignore them.
 */
const MAX_APPOINTMENT_MINUTES = 4 * 60;
/** Shorter entries are usually chores or markers ("Garbage out"). */
const MIN_OVERLAP_MINUTES = 15;
const MIN_LOCATION_MINUTES = 30;
/** Only events this many days out are checked for a missing location. */
const LOCATION_LOOKAHEAD_DAYS = 2;
const MAX_LOCATION_MINUTES = 8 * 60;

/** Most useful first; the page shows only the top three. */
export const HEADS_UP_PRIORITY: Record<HeadsUpItem["kind"], number> = {
  "early-start": 0,
  overlap: 1,
  weather: 2,
  gift: 3,
  "free-time": 4,
  "missing-location": 5,
};

export interface CalendarDay {
  date: string;
  agenda: CalendarItem[];
}

function timed(item: CalendarItem): item is CalendarItem & { time: { mode: "timed"; start: string; end?: string } } {
  return item.time.mode === "timed" && item.status !== "cancelled";
}

function startMs(item: CalendarItem): number {
  return item.time.mode === "timed" ? Date.parse(item.time.start) : Number.NaN;
}

function endMs(item: CalendarItem): number {
  return item.time.mode === "timed" ? Date.parse(item.time.end ?? item.time.start) : Number.NaN;
}

function minutes(item: CalendarItem): number {
  return (endMs(item) - startMs(item)) / 60_000;
}

function isAppointment(item: CalendarItem, minimum: number): boolean {
  const length = minutes(item);
  return length >= minimum && length <= MAX_APPOINTMENT_MINUTES;
}

function clock(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(
    instant,
  );
}

function hourOf(instant: number, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(instant),
  );
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(
    Date.parse(`${date}T12:00:00Z`),
  );
}

function dayName(date: string, today: string): string {
  if (date === today) return "today";
  const tomorrow = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return date === tomorrow ? "tomorrow" : weekday(date);
}

export function headsUpFor({
  days,
  today,
  nowMs,
  timeZone,
  overdueReminders,
}: {
  /** Today first, then the following days, each with its full agenda. */
  days: CalendarDay[];
  today: string;
  nowMs: number;
  timeZone: string;
  overdueReminders: number;
}): HeadsUpItem[] {
  const found: HeadsUpItem[] = [];
  // Holds are placeholders, not plans; see lib/server/holds.ts.
  const considered = (item: CalendarItem) => !item.hold;

  for (const [dayIndex, day] of days.entries()) {
    const events = day.agenda
      .filter(timed)
      .filter(considered)
      .filter((item) => endMs(item) > nowMs);
    const when = dayName(day.date, today);
    const appointments = events.filter((item) => isAppointment(item, MIN_OVERLAP_MINUTES));

    // Two appointments that overlap by more than a few minutes.
    for (let first = 0; first < appointments.length; first += 1) {
      for (let second = first + 1; second < appointments.length; second += 1) {
        const a = appointments[first];
        const b = appointments[second];
        const overlap = Math.min(endMs(a), endMs(b)) - Math.max(startMs(a), startMs(b));
        if (overlap >= MIN_OVERLAP_MINUTES * 60_000) {
          found.push({
            id: `overlap-${a.id}-${b.id}`,
            kind: "overlap",
            title: `Overlapping events ${when}`,
            detail: `${a.title} (${clock(startMs(a), timeZone)}) and ${b.title} (${clock(startMs(b), timeZone)})`,
          });
        }
      }
    }

    // Personal events with nowhere to go. Work events are usually online, so
    // only the home calendar is checked.
    for (const item of dayIndex <= LOCATION_LOOKAHEAD_DAYS ? events : []) {
      if (item.source.provider !== "apple-calendar" || item.locationLabel) continue;
      const length = minutes(item);
      if (length < MIN_LOCATION_MINUTES || length > MAX_LOCATION_MINUTES) continue;
      found.push({
        id: `missing-location-${item.id}`,
        kind: "missing-location",
        title: `No location for ${item.title}`,
        detail: `${when[0].toUpperCase()}${when.slice(1)} at ${clock(startMs(item), timeZone)}. Adding one lets the page work out when to leave.`,
        reminderText: `Add a location for "${item.title}"`,
      });
    }
  }

  // Tomorrow's day starting before most days do.
  const tomorrow = days[1];
  const firstTomorrow = tomorrow?.agenda
    .filter(timed)
    .filter(considered)
    .filter((item) => minutes(item) <= MAX_APPOINTMENT_MINUTES)
    .sort((a, b) => startMs(a) - startMs(b))[0];
  if (firstTomorrow && hourOf(startMs(firstTomorrow), timeZone) < EARLY_START_HOUR) {
    found.push({
      id: `early-start-${firstTomorrow.id}`,
      kind: "early-start",
      title: "Early start tomorrow",
      detail: `${firstTomorrow.title} at ${clock(startMs(firstTomorrow), timeZone)}.`,
    });
  }

  // An open afternoon today while errands pile up.
  const todayEvents = days[0]?.date === today ? days[0].agenda.filter(timed) : [];
  const hourNow = hourOf(nowMs, timeZone);
  const afternoonBusy = todayEvents.some((item) => {
    const startHour = hourOf(startMs(item), timeZone);
    const endHour = hourOf(endMs(item), timeZone);
    return startHour < AFTERNOON.to && endHour >= AFTERNOON.from;
  });
  if (hourNow < AFTERNOON.from && !afternoonBusy && overdueReminders >= FREE_TIME_MIN_OVERDUE) {
    found.push({
      id: `free-time-${today}`,
      kind: "free-time",
      title: "Free afternoon",
      detail: `Nothing is scheduled between 1 and 6 PM, and ${overdueReminders} reminders are overdue.`,
    });
  }

  return found.sort((a, b) => HEADS_UP_PRIORITY[a.kind] - HEADS_UP_PRIORITY[b.kind]);
}
