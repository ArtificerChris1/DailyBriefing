import type {
  BriefingPayload,
  HourlyWeatherPoint,
  WeatherItem,
} from "@/lib/briefing-types";
import {
  WEATHER_FORECAST_DAYS,
  WEATHER_PAST_DAYS,
} from "@/lib/briefing-window";
import type {
  DailyWeatherSummary,
  OpenMeteoWeatherResult,
} from "@/lib/providers/weather/open-meteo";
import { fetchOpenMeteoWeather } from "@/lib/providers/weather/open-meteo";
import { reverseGeocode } from "@/lib/providers/weather/reverse-geocode";

/**
 * Weather shaping shared by the build, which bakes in the configured location,
 * and the browser, which swaps in the viewer's current location afterwards.
 * Nothing here may be server-only: the static site has no server to call.
 */

export type LiveWeather = Extract<OpenMeteoWeatherResult, { ok: true }>;

function datePartsInTimeZone(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return { year: part("year"), month: part("month"), day: part("day") };
}

export function dateInTimeZone(value: Date, timeZone: string): string {
  const { year, month, day } = datePartsInTimeZone(value, timeZone);
  return `${year}-${month}-${day}`;
}

/**
 * The live `WeatherItem` describes right now, which is meaningless on any other
 * day. When the pager moves off today, restate the card from that day's summary:
 * the headline number becomes the forecast high rather than a current reading.
 */
function weatherForDay(
  current: WeatherItem,
  day: DailyWeatherSummary,
): WeatherItem {
  return {
    ...current,
    id: `open-meteo-weather-${day.startsOn}`,
    title: `${day.condition} in ${current.location}`,
    condition: day.condition,
    temperature: day.high,
    feelsLike: day.feelsLikeHigh,
    high: day.high,
    low: day.low,
    precipitationChance: day.precipitationChance,
    importance:
      day.condition === "Thunderstorms" || day.precipitationChance >= 70
        ? "high"
        : "normal",
    surfacedBecause: "Daily forecast for the selected day",
    source: { ...current.source, externalId: `open-meteo:${day.startsOn}` },
  };
}

/** The weather card and hourly strip for one page of the day pager. */
export function weatherForDate(
  result: LiveWeather,
  date: string,
  today: string,
  timeZone: string,
): { weather: WeatherItem; hourlyWeather: HourlyWeatherPoint[] } {
  const selectedDay = result.dailyWeather.find((day) => day.startsOn === date);
  return {
    weather:
      date === today || !selectedDay
        ? result.weather
        : weatherForDay(result.weather, selectedDay),
    hourlyWeather: result.hourlyWeather.filter(
      (point) => dateInTimeZone(new Date(point.startsAt), timeZone) === date,
    ),
  };
}

/**
 * Forecast for the viewer's coordinates, fetched straight from Open-Meteo by
 * the browser. Undefined on any failure, so the baked-in weather stays put.
 */
export async function fetchLocalWeather(
  latitude: number,
  longitude: number,
): Promise<LiveWeather | undefined> {
  // Name the coordinates before asking for weather, so the card can say
  // "Current location (Madison, WI)" rather than just "Current location".
  const place = await reverseGeocode(latitude, longitude);
  const result = await fetchOpenMeteoWeather({
    config: {
      latitude,
      longitude,
      location: place ? `Current location (${place})` : "Current location",
      timeZone: "auto",
      pastDays: WEATHER_PAST_DAYS,
      forecastDays: WEATHER_FORECAST_DAYS,
    },
  });
  return result.ok ? result : undefined;
}

/** Replaces the baked-in weather on a payload with the viewer's own. */
export function withLocalWeather(
  payload: BriefingPayload,
  local: LiveWeather,
): BriefingPayload {
  const { briefing } = payload;
  const { weather, hourlyWeather } = weatherForDate(
    local,
    briefing.date,
    briefing.today,
    local.metadata.timeZone,
  );
  return {
    briefing: {
      ...briefing,
      weather,
      hourlyWeather,
      sources: briefing.sources.map((source) =>
        source.provider === "weather"
          ? { ...source, state: "live", lastSyncedAt: local.metadata.fetchedAt }
          : source,
      ),
    },
    connections: payload.connections.map((connection) =>
      connection.provider === "weather"
        ? {
            ...connection,
            state: "connected",
            accountLabel: `Open-Meteo · ${local.metadata.location}`,
            lastSyncedAt: local.metadata.fetchedAt,
          }
        : connection,
    ),
  };
}
