/**
 * How far the day pager can travel, in days either side of today. The bounds
 * exist because the weather forecast does: the briefing asks Open-Meteo for
 * exactly this window, so paging can never land on a day with no forecast.
 * Shared by the client pager and the server so both agree on the edges.
 */
export const MIN_DAY_OFFSET = -7;
export const MAX_DAY_OFFSET = 13;

/** Days of history to request, matching MIN_DAY_OFFSET. */
export const WEATHER_PAST_DAYS = -MIN_DAY_OFFSET;
/** Forecast days to request; the count includes today, hence the +1. */
export const WEATHER_FORECAST_DAYS = MAX_DAY_OFFSET + 1;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

/** Calendar arithmetic in UTC, so a DST boundary cannot skip or repeat a day. */
export function shiftDateKey(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

export function dayOffsetBetween(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  return Math.round((end - start) / 86_400_000);
}

export function clampToWindow(today: string, requested: string): string {
  const offset = dayOffsetBetween(today, requested);
  if (offset < MIN_DAY_OFFSET) return shiftDateKey(today, MIN_DAY_OFFSET);
  if (offset > MAX_DAY_OFFSET) return shiftDateKey(today, MAX_DAY_OFFSET);
  return requested;
}
