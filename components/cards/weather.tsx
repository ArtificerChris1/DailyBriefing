"use client";

import { CloudSun, Droplets, MapPin, Thermometer, Umbrella, Wind } from "lucide-react";
import { useId, useState } from "react";

import { Card, ShowMore, WeatherGlyph } from "@/components/ui";
import type {
  CalendarItem,
  HourlyWeatherPoint,
  OutdoorWindow,
  WeatherItem,
} from "@/lib/briefing-types";
import { clockLabel, eventForecast, hourLabel } from "@/lib/format";

/** Hours shown before "Show all hours". */
const HOURS_PREVIEW = 6;

/** Current conditions, the forecast that matters, and the hour-by-hour detail. */
export function WeatherCard({
  weather,
  hourly,
  agenda,
  outdoorWindow,
  isToday,
  nowMs,
  timeZone,
}: {
  weather: WeatherItem;
  hourly: HourlyWeatherPoint[];
  agenda: CalendarItem[];
  outdoorWindow?: OutdoorWindow;
  isToday: boolean;
  nowMs: number;
  timeZone: string;
}) {
  const [allHours, setAllHours] = useState(false);
  const listId = useId();
  const remaining = isToday
    ? hourly.filter((point) => Date.parse(point.startsAt) + 60 * 60 * 1000 > nowMs)
    : hourly;
  const shown = allHours ? remaining : remaining.slice(0, HOURS_PREVIEW);
  const wettest = remaining.reduce<HourlyWeatherPoint | undefined>(
    (peak, point) => (!peak || point.precipitationChance > peak.precipitationChance ? point : peak),
    undefined,
  );
  const windiest = remaining.reduce((peak, point) => Math.max(peak, point.windMph ?? 0), 0);
  const risk = agenda
    .filter((item) => !item.hold)
    .map((item) => ({ item, forecast: eventForecast(item, hourly) }))
    .find(({ forecast }) => (forecast?.precipitationChance ?? 0) >= 50);

  return (
    <Card
      title={isToday ? "Weather" : "Weather that day"}
      icon={CloudSun}
      className="weather-card"
      meta={
        <>
          <MapPin size={14} aria-hidden="true" /> {weather.location}
        </>
      }
    >
      <div className="weather-now">
        <span className="weather-glyph">
          <WeatherGlyph condition={weather.condition} size={44} />
        </span>
        <p className="weather-temp">
          {weather.temperature}°
          <span className="visually-hidden"> {isToday ? "now" : "at the warmest"}</span>
        </p>
        <div>
          <p className="weather-condition">{weather.condition}</p>
          <p className="weather-feels">
            Feels like {weather.feelsLike}° {isToday ? "now" : "at the peak"}
          </p>
        </div>
      </div>

      <ul className="weather-stats">
        <li>
          <Thermometer size={16} aria-hidden="true" />
          High {weather.high}°, low {weather.low}°
        </li>
        <li>
          <Umbrella size={16} aria-hidden="true" />
          {wettest
            ? `${wettest.precipitationChance}% chance of rain around ${hourLabel(wettest.startsAt, timeZone)}`
            : `${weather.precipitationChance ?? 0}% chance of rain`}
        </li>
        {windiest > 0 && (
          <li>
            <Wind size={16} aria-hidden="true" />
            Wind up to {Math.round(windiest)} mph
          </li>
        )}
      </ul>

      <p className="weather-note">
        {risk
          ? `${risk.forecast?.condition ?? "Rain"} may affect ${risk.item.title}.`
          : outdoorWindow
            ? `Good time to be outside: ${clockLabel(outdoorWindow.from, timeZone)}–${clockLabel(outdoorWindow.to, timeZone)} (${outdoorWindow.summary}).`
            : "No weather is forecast to affect your schedule."}
      </p>

      {remaining.length > 0 && (
        <>
          <h3 className="list-group-title">Hour by hour</h3>
          <ul className="hourly" id={listId}>
            {shown.map((point) => (
              <li key={point.id} className={point.precipitationChance >= 50 ? "hour-wet" : undefined}>
                <time dateTime={point.startsAt}>{hourLabel(point.startsAt, timeZone)}</time>
                <WeatherGlyph condition={point.condition} size={20} />
                <span className="hour-temp">{point.temperature}°</span>
                <span className="hour-condition">{point.condition}</span>
                <span className="hour-rain">
                  <Droplets size={13} aria-hidden="true" />
                  {point.precipitationChance}%<span className="visually-hidden"> chance of rain</span>
                </span>
              </li>
            ))}
          </ul>
          {remaining.length > HOURS_PREVIEW && (
            <div className="card-footer">
              <ShowMore
                expanded={allHours}
                onToggle={() => setAllHours((value) => !value)}
                moreLabel={`Show all ${remaining.length} hours`}
                lessLabel="Show fewer hours"
                controls={listId}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
