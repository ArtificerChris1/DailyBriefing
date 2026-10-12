import type { CalendarItem, HourlyWeatherPoint } from "@/lib/briefing-types";

/**
 * Display formatting shared by the dashboard's cards. Instants are formatted
 * in the briefing's time zone; date keys (`YYYY-MM-DD`) are formatted from
 * their own parts so they never slide a day west of Greenwich.
 */

export function clockLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(Date.parse(iso));
}

export function hourLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone }).format(Date.parse(iso));
}

export function timeRange(item: CalendarItem, timeZone: string): string {
  if (item.time.mode === "all-day") return "All day";
  const start = clockLabel(item.time.start, timeZone);
  return item.time.end ? `${start}–${clockLabel(item.time.end, timeZone)}` : start;
}

/** "9:00" and "AM", for layouts that set the period smaller. */
export function eventStartParts(item: CalendarItem, timeZone: string) {
  if (item.time.mode === "all-day") return { clock: "All", meridiem: "day" };
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).formatToParts(Date.parse(item.time.start));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { clock: `${value("hour")}:${value("minute")}`, meridiem: value("dayPeriod") };
}

/** NaN for all-day events, which have no clock position. */
export function eventStartMs(item: CalendarItem): number {
  return item.time.mode === "timed" ? Date.parse(item.time.start) : Number.NaN;
}

export function eventEndMs(item: CalendarItem): number {
  return item.time.mode === "timed" ? Date.parse(item.time.end ?? item.time.start) : Number.NaN;
}

/** "45 min", "1 hr 30 min"; null without an end time. */
export function eventDuration(item: CalendarItem): string | null {
  if (item.time.mode !== "timed" || !item.time.end) return null;
  const minutes = Math.max(
    0,
    Math.round((Date.parse(item.time.end) - Date.parse(item.time.start)) / 60_000),
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function relativeDayLabel(offset: number): string {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  return offset > 0 ? `In ${offset} days` : `${-offset} days ago`;
}

/** "Oct" and "11" for a `YYYY-MM-DD` key. */
export function dateKeyParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(
    Date.UTC(year, month - 1, day),
  );
  return { month: label, day: String(day) };
}

/** "Monday, October 12" for a `YYYY-MM-DD` key. */
export function longDateLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(Date.parse(`${value}T12:00:00Z`));
}

/** The wettest hour overlapping an event, if the forecast covers it. */
export function eventForecast(
  item: CalendarItem,
  hourlyWeather: HourlyWeatherPoint[],
): HourlyWeatherPoint | null {
  if (item.time.mode !== "timed") return null;
  const start = Date.parse(item.time.start);
  const end = item.time.end ? Date.parse(item.time.end) : start + 30 * 60 * 1000;
  const overlapping = hourlyWeather.filter((point) => {
    const at = Date.parse(point.startsAt);
    return at < end && at + 60 * 60 * 1000 > start;
  });
  if (!overlapping.length) return null;
  return overlapping.reduce((worst, point) =>
    point.precipitationChance > worst.precipitationChance ? point : worst,
  );
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
