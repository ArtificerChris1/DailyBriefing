import type {
  CalendarItem,
  HeadsUpItem,
  HourlyWeatherPoint,
  OutdoorWindow,
} from "@/lib/briefing-types";

/**
 * Weather that changes plans, rather than another forecast: rain or storms
 * during an event, a freeze, strong wind or heat in the next day, and the best
 * stretch of the day to be outside. Fixed thresholds, run at build time.
 */

const WET = new Set<HourlyWeatherPoint["condition"]>([
  "Drizzle",
  "Rain",
  "Showers",
  "Snow",
  "Thunderstorms",
]);
/** Rain chance that counts as "likely" for an event. */
const EVENT_RAIN_CHANCE = 50;
/** Sustained wind worth mentioning. */
const WINDY_MPH = 25;
/** How far ahead the freeze, wind and heat checks look. */
const ALERT_HORIZON_MS = 24 * 60 * 60 * 1000;
/** Outdoor window rules: dry, mild, daylight, at least two clear hours. */
const OUTDOOR = { maxRain: 20, minHours: 2, fromHour: 8, toHour: 19 };

function fahrenheit(value: number, unit: "C" | "F"): number {
  return unit === "F" ? value : value * 1.8 + 32;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone }).format(Date.parse(iso));
}

function hourOf(iso: string, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(
      Date.parse(iso),
    ),
  );
}

function dateOf(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(Date.parse(iso));
}

const HOUR_MS = 60 * 60 * 1000;

export function weatherAlerts({
  hourly,
  events,
  nowMs,
  today,
  timeZone,
}: {
  /** Hourly forecast covering at least the next day. */
  hourly: HourlyWeatherPoint[];
  /** Timed events for today and tomorrow. */
  events: CalendarItem[];
  nowMs: number;
  today: string;
  timeZone: string;
}): HeadsUpItem[] {
  const alerts: HeadsUpItem[] = [];
  const ahead = hourly.filter((point) => {
    const at = Date.parse(point.startsAt);
    return at + HOUR_MS > nowMs && at <= nowMs + ALERT_HORIZON_MS;
  });

  // Rain, snow or storms likely while an event is on.
  for (const item of events) {
    if (item.time.mode !== "timed" || item.status === "cancelled") continue;
    const start = Date.parse(item.time.start);
    const end = Date.parse(item.time.end ?? item.time.start) || start + HOUR_MS;
    if (end < nowMs) continue;
    const wettest = hourly
      .filter((point) => {
        const at = Date.parse(point.startsAt);
        return at < end && at + HOUR_MS > start;
      })
      .filter((point) => WET.has(point.condition) && point.precipitationChance >= EVENT_RAIN_CHANCE)
      .sort((a, b) => b.precipitationChance - a.precipitationChance)[0];
    if (!wettest) continue;
    const day = dateOf(item.time.start, timeZone) === today ? "" : " tomorrow";
    alerts.push({
      id: `weather-event-${item.id}`,
      kind: "weather",
      title: `${wettest.condition} likely during ${item.title}`,
      detail: `${wettest.precipitationChance}% chance around ${clock(wettest.startsAt, timeZone)}${day}.`,
    });
  }

  const unit = ahead[0]?.unit ?? "F";
  const coldest = ahead.reduce<HourlyWeatherPoint | undefined>(
    (low, point) => (!low || point.temperature < low.temperature ? point : low),
    undefined,
  );
  if (coldest && fahrenheit(coldest.temperature, unit) <= 32) {
    alerts.push({
      id: `weather-freeze-${dateOf(coldest.startsAt, timeZone)}`,
      kind: "weather",
      title: "Freezing temperatures ahead",
      detail: `Down to ${coldest.temperature}° around ${clock(coldest.startsAt, timeZone)}. Allow extra time if the car needs scraping.`,
      reminderText: "Cover plants and bring in anything that shouldn't freeze",
    });
  }

  const windiest = ahead.reduce<HourlyWeatherPoint | undefined>(
    (high, point) => ((point.windMph ?? 0) > (high?.windMph ?? 0) ? point : high),
    undefined,
  );
  if (windiest?.windMph !== undefined && windiest.windMph >= WINDY_MPH) {
    alerts.push({
      id: `weather-wind-${dateOf(windiest.startsAt, timeZone)}`,
      kind: "weather",
      title: "Strong wind ahead",
      detail: `Around ${Math.round(windiest.windMph)} mph near ${clock(windiest.startsAt, timeZone)}.`,
    });
  }

  const hottest = ahead.reduce<HourlyWeatherPoint | undefined>(
    (high, point) => (!high || point.feelsLike > high.feelsLike ? point : high),
    undefined,
  );
  if (hottest && fahrenheit(hottest.feelsLike, unit) >= 95) {
    alerts.push({
      id: `weather-heat-${dateOf(hottest.startsAt, timeZone)}`,
      kind: "weather",
      title: "Very hot",
      detail: `Feels like ${hottest.feelsLike}° around ${clock(hottest.startsAt, timeZone)}.`,
    });
  }

  return alerts;
}

/**
 * The longest dry, mild daylight stretch left in `date` that no event
 * occupies, if it lasts at least OUTDOOR.minHours.
 */
export function outdoorWindow({
  hourly,
  events,
  date,
  nowMs,
  timeZone,
}: {
  hourly: HourlyWeatherPoint[];
  events: CalendarItem[];
  date: string;
  nowMs: number;
  timeZone: string;
}): OutdoorWindow | undefined {
  const busy = (at: number) =>
    events.some((item) => {
      if (item.time.mode !== "timed" || item.status === "cancelled") return false;
      const start = Date.parse(item.time.start);
      const end = Date.parse(item.time.end ?? item.time.start);
      return at < end && at + HOUR_MS > start;
    });
  const pleasant = (point: HourlyWeatherPoint) => {
    const feels = fahrenheit(point.feelsLike, point.unit);
    const hour = hourOf(point.startsAt, timeZone);
    return (
      Date.parse(point.startsAt) + HOUR_MS > nowMs &&
      dateOf(point.startsAt, timeZone) === date &&
      hour >= OUTDOOR.fromHour &&
      hour < OUTDOOR.toHour &&
      !WET.has(point.condition) &&
      point.precipitationChance < OUTDOOR.maxRain &&
      feels >= 55 &&
      feels <= 82 &&
      (point.windMph ?? 0) < 20 &&
      !busy(Date.parse(point.startsAt))
    );
  };

  let best: HourlyWeatherPoint[] = [];
  let run: HourlyWeatherPoint[] = [];
  for (const point of hourly) {
    if (pleasant(point)) {
      run.push(point);
      if (run.length > best.length) best = [...run];
    } else {
      run = [];
    }
  }
  if (best.length < OUTDOOR.minHours) return undefined;

  const temperatures = best.map((point) => point.temperature);
  const low = Math.min(...temperatures);
  const high = Math.max(...temperatures);
  const last = best[best.length - 1];
  return {
    from: best[0].startsAt,
    to: new Date(Date.parse(last.startsAt) + HOUR_MS).toISOString(),
    summary: `${best[0].condition}, ${low === high ? `${low}°` : `${low}–${high}°`}`,
  };
}
