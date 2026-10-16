import "server-only";

import type {
  CalendarItem,
  DailyBrief,
  HeadsUpItem,
  HourlyWeatherPoint,
  OccasionItem,
  ReminderItem,
  SportsItem,
  WeatherItem,
} from "@/lib/briefing-types";
import { shiftDateKey } from "@/lib/briefing-window";
import { dayModeAt } from "@/lib/briefing-view";
import { headsUpFor, type CalendarDay } from "@/lib/heads-up";
import type { LiveWeather } from "@/lib/live-weather";
import { upcomingOccasions } from "@/lib/occasions";
import { groupReminders } from "@/lib/priorities";
import { fetchIcalCalendar } from "@/lib/providers/ical/calendar";
import { dailyBrief } from "@/lib/server/daily-brief";
import { markHolds } from "@/lib/server/holds";
import { withDepartures } from "@/lib/server/travel";
import { weatherAlerts } from "@/lib/weather-plans";

/**
 * What only today's page carries: upcoming occasions, the rule-based
 * heads-up list, and the AI summary that draws on both.
 */

/** Days after today checked for overlaps, missing locations and an early start. */
const LOOKAHEAD_DAYS = 3;

type LocalTime = (date: string, hour: number, minute: number, timeZone: string) => string;

const dayCache = new Map<string, Promise<CalendarItem[]>>();

/** Both calendars for one local day, once per build. */
function calendarDay(date: string, timeZone: string, localTimeToIso: LocalTime) {
  const key = `${date}|${timeZone}`;
  let pending = dayCache.get(key);
  if (!pending) {
    const from = localTimeToIso(date, 0, 0, timeZone);
    const to = localTimeToIso(shiftDateKey(date, 1), 0, 0, timeZone);
    pending = Promise.all([
      fetchIcalCalendar({ feed: "work", from, to, timeZone }),
      fetchIcalCalendar({ feed: "home", from, to, timeZone }),
    ])
      .then((results) => markHolds(results.flatMap((result) => (result.ok ? result.items : []))))
      .then(withDepartures);
    dayCache.set(key, pending);
  }
  return pending;
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(
    Date.parse(iso),
  );
}

function eventFact(item: CalendarItem, timeZone: string) {
  return {
    title: item.title,
    ...(item.time.mode === "timed"
      ? {
          start: clock(item.time.start, timeZone),
          ...(item.time.end ? { end: clock(item.time.end, timeZone) } : {}),
        }
      : { allDay: true }),
    ...(item.locationLabel ? { location: item.locationLabel } : {}),
    ...(item.departure
      ? {
          leaveBy: clock(item.departure.leaveAt, timeZone),
          driveMinutes: item.departure.travelMinutes,
        }
      : {}),
    calendar: item.source.provider === "apple-calendar" ? "home" : "work",
    ...(item.status !== "confirmed" ? { status: item.status } : {}),
  };
}

/** "Monday, Oct 12", so no event is ever placed on the wrong day. */
function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(Date.parse(`${date}T12:00:00Z`));
}

function weatherFact(weather: WeatherItem, hourly: HourlyWeatherPoint[], timeZone: string) {
  const wettest = hourly.reduce<HourlyWeatherPoint | undefined>(
    (peak, point) => (!peak || point.precipitationChance > peak.precipitationChance ? point : peak),
    undefined,
  );
  return {
    condition: weather.condition,
    high: `${weather.high}°${weather.unit}`,
    low: `${weather.low}°${weather.unit}`,
    ...(wettest && wettest.precipitationChance >= 30
      ? { rainChance: `${wettest.precipitationChance}% around ${clock(wettest.startsAt, timeZone)}` }
      : {}),
  };
}

export async function todayExtras({
  today,
  timeZone,
  nowMs,
  agenda,
  calendarLive,
  weather,
  hourlyWeather,
  liveWeather,
  reminders,
  sports,
  localTimeToIso,
}: {
  today: string;
  timeZone: string;
  nowMs: number;
  /** Today's full agenda, before events that have ended are dropped. */
  agenda: CalendarItem[];
  /** False when the calendars failed and the agenda is sample data. */
  calendarLive: boolean;
  weather?: WeatherItem;
  hourlyWeather: HourlyWeatherPoint[];
  liveWeather?: LiveWeather;
  reminders?: ReminderItem[];
  sports: SportsItem[];
  localTimeToIso: LocalTime;
}): Promise<{ occasions: OccasionItem[]; headsUp: HeadsUpItem[]; dailyBrief?: DailyBrief }> {
  const occasions = upcomingOccasions(today);
  const reminderGroups = groupReminders(reminders ?? [], today, timeZone);

  const days: CalendarDay[] = calendarLive
    ? [
        { date: today, agenda },
        ...(await Promise.all(
          Array.from({ length: LOOKAHEAD_DAYS }, async (_, index) => {
            const date = shiftDateKey(today, index + 1);
            return { date, agenda: await calendarDay(date, timeZone, localTimeToIso) };
          }),
        )),
      ]
    : [];
  const headsUp = [
    ...headsUpFor({
      days,
      today,
      nowMs,
      timeZone,
      overdueReminders: reminderGroups.overdue.length,
    }),
    ...(liveWeather
      ? weatherAlerts({
          hourly: liveWeather.hourlyWeather,
          events: [...(days[0]?.agenda ?? []), ...(days[1]?.agenda ?? [])],
          nowMs,
          today,
          timeZone,
        })
      : []),
  ];

  const mode = dayModeAt(nowMs, timeZone);
  const tomorrow = shiftDateKey(today, 1);
  const tomorrowWeather = liveWeather?.dailyWeather.find((day) => day.startsOn === tomorrow);
  // Sample data must never reach the summary: it would be written up as fact.
  const visible = (items: CalendarItem[]) =>
    items.filter((item) => item.status !== "cancelled" && !item.hold);
  const facts: Record<string, unknown> = {
    now: new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(nowMs),
    planningFor: mode === "evening" ? `tomorrow, ${dayLabel(tomorrow)}` : `today, ${dayLabel(today)}`,
    today: {
      date: dayLabel(today),
      ...(calendarLive
        ? {
            events: visible(agenda).map((item) => ({
              ...eventFact(item, timeZone),
              ...(item.time.mode === "timed" &&
              Date.parse(item.time.end ?? item.time.start) < nowMs
                ? { finished: true }
                : {}),
            })),
          }
        : {}),
      ...(weather && liveWeather ? { weather: weatherFact(weather, hourlyWeather, timeZone) } : {}),
    },
    tomorrow: {
      date: dayLabel(tomorrow),
      ...(calendarLive
        ? { events: visible(days[1]?.agenda ?? []).map((item) => eventFact(item, timeZone)) }
        : {}),
      ...(tomorrowWeather
        ? {
            weather: {
              condition: tomorrowWeather.condition,
              high: `${tomorrowWeather.high}°${tomorrowWeather.unit}`,
              low: `${tomorrowWeather.low}°${tomorrowWeather.unit}`,
              rainChance: `${tomorrowWeather.precipitationChance}%`,
            },
          }
        : {}),
    },
    ...(reminders
      ? {
          reminders: {
            overdue: reminderGroups.overdue.map((item) => item.title),
            dueToday: reminderGroups.today.map((item) => item.title),
            upcomingCount: reminderGroups.upcoming.length,
          },
        }
      : {}),
    occasions: occasions
      .filter((item) => item.offset <= 14)
      .map((item) => ({
        name: item.name,
        kind: item.kind,
        date: dayLabel(item.date),
        inDays: item.offset,
        ...(item.detail ? { detail: item.detail } : {}),
      })),
    dashboardSuggestions: headsUp.map((item) => `${item.title}: ${item.detail}`),
    sports: sports
      .filter((item) => item.state !== "scheduled" || item.startsAt?.startsWith("Today"))
      .slice(0, 6)
      .map((item) =>
        item.state === "final"
          ? `${item.title}: ${item.scoreLabel ?? "final"}${item.context ? `. ${item.context}` : ""}`
          : `${item.title}, ${item.startsAt ?? ""}`,
      ),
  };

  return { occasions, headsUp, dailyBrief: await dailyBrief(facts, mode) };
}
