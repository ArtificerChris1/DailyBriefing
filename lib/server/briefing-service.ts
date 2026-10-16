import "server-only";

import type {
  BriefingPayload,
  BriefingRequest,
  BriefingSourceStatus,
  CalendarItem,
  ConnectionSummary,
  HourlyWeatherPoint,
  ReminderItem,
  SportsItem,
  WeatherItem,
} from "@/lib/briefing-types";
import {
  WEATHER_FORECAST_DAYS,
  WEATHER_PAST_DAYS,
  clampToWindow,
  dayOffsetBetween,
  isDateKey,
} from "@/lib/briefing-window";
import {
  agenda as demoAgenda,
  headlines,
  hourlyWeather as demoHourlyWeather,
  sports,
  weather as demoWeather,
} from "@/lib/demo-data";
import { dateInTimeZone, weatherForDate } from "@/lib/live-weather";
import { birthdaysInWindow } from "@/lib/providers/birthdays/birthday-list";
import { fetchIcalCalendar } from "@/lib/providers/ical/calendar";
import { fetchRssHeadlines } from "@/lib/providers/news/rss-headlines";
import { fetchBggHotness } from "@/lib/providers/games/bgg-hotness";
import { fetchQuoteOfTheDay } from "@/lib/providers/quotes/quote-of-the-day";
import { fetchUpcomingReleases } from "@/lib/providers/releases/upcoming-releases";
import {
  fetchMemories,
  fetchPhotoOfDay,
  memoryPath,
} from "@/lib/providers/photos/icloud-shared-album";
import { fetchLiveSports } from "@/lib/providers/sports/live-sports";
import { fetchOpenMeteoWeather } from "@/lib/providers/weather/open-meteo";
import { recencyCutoff, withinRecencyWindow } from "@/lib/recency";
import { withRankMovement } from "@/lib/server/bgg-history";
import { withNewsSummaries } from "@/lib/server/news-summaries";
import { markHolds } from "@/lib/server/holds";
import { getReminders } from "@/lib/server/reminders";
import { todayExtras } from "@/lib/server/today-extras";
import { withDepartures } from "@/lib/server/travel";
import { outdoorWindow } from "@/lib/weather-plans";

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

function timeZoneOffsetMs(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value);
  const representedAsUtc = Date.UTC(
    number("year"),
    number("month") - 1,
    number("day"),
    number("hour"),
    number("minute"),
    number("second"),
  );
  return representedAsUtc - value.getTime();
}

function localTimeToIso(
  date: string,
  hour: number,
  minute: number,
  timeZone: string,
): string {
  const [year, month, day] = date.split("-").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  let instant = wallClockAsUtc - timeZoneOffsetMs(new Date(wallClockAsUtc), timeZone);
  instant = wallClockAsUtc - timeZoneOffsetMs(new Date(instant), timeZone);
  return new Date(instant).toISOString();
}

function rebaseDemoAgenda(
  date: string,
  timeZone: string,
  fetchedAt: string,
): CalendarItem[] {
  return demoAgenda.map((item) => {
    if (item.time.mode === "all-day") {
      return {
        ...item,
        time: {
          ...item.time,
          startDate: date,
          endDateExclusive: nextDate(date),
          timeZone,
        },
        source: { ...item.source, fetchedAt },
      };
    }

    const readClock = (value: string) => {
      const match = value.match(/T(\d{2}):(\d{2})/);
      return { hour: Number(match?.[1] ?? 0), minute: Number(match?.[2] ?? 0) };
    };
    const startClock = readClock(item.time.start);
    const endClock = item.time.end ? readClock(item.time.end) : undefined;
    return {
      ...item,
      time: {
        ...item.time,
        start: localTimeToIso(date, startClock.hour, startClock.minute, timeZone),
        end: endClock
          ? localTimeToIso(date, endClock.hour, endClock.minute, timeZone)
          : undefined,
        originalTimeZone: timeZone,
      },
      source: { ...item.source, fetchedAt },
    };
  });
}

function rebaseDemoHourlyWeather(
  date: string,
  timeZone: string,
): HourlyWeatherPoint[] {
  return demoHourlyWeather.map((point) => {
    const match = point.startsAt.match(/T(\d{2}):(\d{2})/);
    return {
      ...point,
      startsAt: localTimeToIso(
        date,
        Number(match?.[1] ?? 0),
        Number(match?.[2] ?? 0),
        timeZone,
      ),
    };
  });
}

function demoWeatherFor(fetchedAt: string): WeatherItem {
  return {
    ...demoWeather,
    source: { ...demoWeather.source, fetchedAt },
  };
}

function validTimeZone(value: string | undefined): value is string {
  if (!value) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function calendarStart(item: CalendarItem): number {
  return item.time.mode === "timed"
    ? Date.parse(item.time.start)
    : Date.parse(`${item.time.startDate}T00:00:00Z`);
}

/** An event ages out on when it finishes, not when it began. */
function calendarEnd(item: CalendarItem): number {
  return item.time.mode === "timed"
    ? Date.parse(item.time.end ?? item.time.start)
    : Date.parse(`${item.time.endDateExclusive}T00:00:00Z`);
}

/** A game is only worth a card from yesterday through the coming week. */
const SPORTS_LOOKAHEAD_MS = 7 * 24 * 60 * 60 * 1000;

function sportsInWindow(
  items: SportsItem[],
  cutoff: number,
  now: number,
): SportsItem[] {
  const horizon = now + SPORTS_LOOKAHEAD_MS;
  return items.filter((item) => {
    if (!item.occursAt) return false;
    const instant = Date.parse(item.occursAt);
    if (Number.isNaN(instant)) return false;
    return instant >= cutoff && instant <= horizon;
  });
}

function reminderWithDueLabel(
  reminder: ReminderItem,
  timeZone: string,
  date: string,
): ReminderItem {
  if (!reminder.dueAt) return { ...reminder, dueLabel: "No due date" };
  const due = new Date(reminder.dueAt);
  const dueDate = dateInTimeZone(due, timeZone);
  const dueLabel =
    dueDate === date
      ? `Due ${new Intl.DateTimeFormat("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone,
        }).format(due)}`
      : `Due ${new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric",
          timeZone,
        }).format(due)}`;
  return { ...reminder, dueLabel };
}

export async function getBriefingPayload(
  options: BriefingRequest = {},
): Promise<BriefingPayload> {
  const generatedAt = new Date().toISOString();
  const weatherResult = await fetchOpenMeteoWeather({
    config: {
      pastDays: WEATHER_PAST_DAYS,
      forecastDays: WEATHER_FORECAST_DAYS,
    },
  });
  const timeZone = validTimeZone(weatherResult.metadata.timeZone)
    ? weatherResult.metadata.timeZone
    : "America/Chicago";
  const today = dateInTimeZone(new Date(generatedAt), timeZone);
  const date = isDateKey(options.date)
    ? clampToWindow(today, options.date)
    : today;
  const from = localTimeToIso(date, 0, 0, timeZone);
  const to = localTimeToIso(nextDate(date), 0, 0, timeZone);
  const [
    icalResult,
    homeCalendarResult,
    reminderStatus,
    photoResult,
    memoryResults,
    sportsResult,
    headlineResult,
    quoteResult,
    hotGames,
    upcomingReleases,
  ] = await Promise.all([
    fetchIcalCalendar({ feed: "work", from, to, timeZone }),
    fetchIcalCalendar({ feed: "home", from, to, timeZone }),
    getReminders(),
    // Only today has a photo; it is the one image the build publishes.
    date === today ? fetchPhotoOfDay(today) : Promise.resolve(undefined),
    date === today ? fetchMemories(today, timeZone) : Promise.resolve([]),
    fetchLiveSports(timeZone),
    fetchRssHeadlines(),
    fetchQuoteOfTheDay(),
    fetchBggHotness(),
    // Anchored to the page being viewed, so the pager moves the window too.
    fetchUpcomingReleases(date),
  ]);

  const liveCalendarItems = markHolds([
    ...(icalResult.ok ? icalResult.items : []),
    ...(homeCalendarResult.ok ? homeCalendarResult.items : []),
  ]);
  const calendarLive = icalResult.ok || homeCalendarResult.ok;
  const offsetFromToday = dayOffsetBetween(today, date);
  const agenda = calendarLive
    ? // Leave-by times only where they can still be useful: today and the next two days.
      await (offsetFromToday >= 0 && offsetFromToday <= 2
        ? withDepartures(liveCalendarItems)
        : Promise.resolve(liveCalendarItems)
      ).then((items) =>
        items.sort((left, right) => calendarStart(left) - calendarStart(right)),
      )
    : rebaseDemoAgenda(date, timeZone, generatedAt);
  const icalSource: BriefingSourceStatus = icalResult.ok
    ? {
        provider: "ical",
        capability: "calendar",
        label: `${icalResult.label} iCal feed`,
        state: "live",
        lastSyncedAt: icalResult.fetchedAt,
        message: icalResult.warnings[0],
      }
    : {
        provider: "ical",
        capability: "calendar",
        label: "Work calendar iCal feed",
        state: icalResult.configured ? "error" : "not-configured",
        message: icalResult.error,
      };
  const icalConnection: ConnectionSummary = {
    provider: "ical",
    state: icalResult.ok
      ? "connected"
      : icalResult.configured
        ? "error"
        : "not-configured",
    accountLabel: icalResult.ok ? icalResult.label : undefined,
    lastSyncedAt: icalResult.ok ? icalResult.fetchedAt : undefined,
    message: icalResult.ok ? icalResult.warnings[0] : icalResult.error,
  };
  const homeCalendarSource: BriefingSourceStatus = homeCalendarResult.ok
    ? {
        provider: "apple-calendar",
        capability: "calendar",
        label: `${homeCalendarResult.label} iCal feed`,
        state: "live",
        lastSyncedAt: homeCalendarResult.fetchedAt,
        message: homeCalendarResult.warnings[0],
      }
    : {
        provider: "apple-calendar",
        capability: "calendar",
        label: "Apple home calendar",
        state: homeCalendarResult.configured ? "error" : "not-configured",
        message: homeCalendarResult.error,
      };
  const homeCalendarConnection: ConnectionSummary = {
    provider: "apple-calendar",
    state: homeCalendarResult.ok
      ? "connected"
      : homeCalendarResult.configured
        ? "error"
        : "not-configured",
    accountLabel: homeCalendarResult.ok ? homeCalendarResult.label : undefined,
    lastSyncedAt: homeCalendarResult.ok
      ? homeCalendarResult.fetchedAt
      : undefined,
    message: homeCalendarResult.ok
      ? homeCalendarResult.warnings[0]
      : homeCalendarResult.error,
  };

  const reminderSource: BriefingSourceStatus = {
    provider: "apple-shortcut",
    capability: "reminders",
    label: "Apple Reminders Shortcut",
    state: reminderStatus.state === "connected" ? "live" : reminderStatus.state,
    lastSyncedAt: reminderStatus.panel?.syncedAt,
    message: reminderStatus.message,
  };
  const reminderConnection: ConnectionSummary = {
    provider: "apple-shortcut",
    state: reminderStatus.state,
    accountLabel: reminderStatus.panel ? "iPhone Shortcut" : undefined,
    lastSyncedAt: reminderStatus.panel?.syncedAt,
    message: reminderStatus.message,
  };
  const reminders = reminderStatus.panel && {
    ...reminderStatus.panel,
    items: reminderStatus.panel.items.map((reminder) =>
      reminderWithDueLabel(reminder, timeZone, date),
    ),
  };

  const { weather, hourlyWeather } = weatherResult.ok
    ? weatherForDate(weatherResult, date, today, timeZone)
    : {
        weather: demoWeatherFor(generatedAt),
        hourlyWeather: rebaseDemoHourlyWeather(date, timeZone),
      };
  const weatherSource: BriefingSourceStatus = weatherResult.ok
    ? {
        provider: "weather",
        capability: "hourly forecast",
        label: "Open-Meteo weather",
        state: "live",
        lastSyncedAt: weatherResult.metadata.fetchedAt,
        message: weatherResult.metadata.attribution,
      }
    : {
        provider: "weather",
        capability: "hourly forecast",
        label: "Open-Meteo weather",
        state: "error",
        message: `${weatherResult.error.message} Sample weather is shown.`,
      };
  const weatherConnection: ConnectionSummary = {
    provider: "weather",
    state: weatherResult.ok ? "connected" : "error",
    accountLabel: weatherResult.ok
      ? `Open-Meteo · ${weatherResult.metadata.location}`
      : undefined,
    lastSyncedAt: weatherResult.ok ? weatherResult.metadata.fetchedAt : undefined,
    message: weatherSource.message,
  };
  const sportsSource: BriefingSourceStatus = sportsResult.ok
    ? {
        provider: "sports",
        capability: "scores and schedules",
        label: "TheSportsDB and MLB Stats",
        state: "live",
        lastSyncedAt: sportsResult.fetchedAt,
        message: sportsResult.warnings[0],
      }
    : {
        provider: "sports",
        capability: "scores and schedules",
        label: "Live sports feeds",
        state: "error",
        message: `${sportsResult.error ?? "Sports feeds unavailable."} Sample cards are shown.`,
      };
  const sportsConnection: ConnectionSummary = {
    provider: "sports",
    state: sportsResult.ok ? "connected" : "error",
    accountLabel: sportsResult.ok ? "TheSportsDB · MLB Stats" : undefined,
    lastSyncedAt: sportsResult.ok ? sportsResult.fetchedAt : undefined,
    message: sportsSource.message,
  };
  const headlineSource: BriefingSourceStatus = headlineResult.ok
    ? {
        provider: "news",
        capability: "attributed RSS headlines",
        label: "Selected publisher feeds",
        state: "live",
        lastSyncedAt: headlineResult.fetchedAt,
        message: headlineResult.warnings[0],
      }
    : {
        provider: "news",
        capability: "attributed RSS headlines",
        label: "Selected publisher feeds",
        state: "error",
        message: `${headlineResult.error ?? "Headline feeds unavailable."} Sample cards are shown.`,
      };
  const headlineConnection: ConnectionSummary = {
    provider: "news",
    state: headlineResult.ok ? "connected" : "error",
    accountLabel: headlineResult.ok ? "Publisher RSS feeds" : undefined,
    lastSyncedAt: headlineResult.ok ? headlineResult.fetchedAt : undefined,
    message: headlineSource.message,
  };

  // One rolling-day window across every dated section, applied after the
  // providers' own caches so the cutoff never goes stale with a cached result.
  const nowMs = Date.parse(generatedAt);
  const cutoff = recencyCutoff(nowMs);
  // Only today's agenda ages out. On any other page the whole point is to see
  // that day, so a past date must keep the events it actually held.
  const recentAgenda =
    date === today
      ? agenda.filter((item) => {
          const end = calendarEnd(item);
          return Number.isNaN(end) || end >= cutoff;
        })
      : agenda;
  const recentSports = sportsInWindow(
    sportsResult.ok ? sportsResult.items : sports,
    cutoff,
    nowMs,
  );
  const recentHeadlines = (
    headlineResult.ok ? headlineResult.items : headlines
  ).filter((item) => withinRecencyWindow(item.source.modifiedAt, cutoff));

  const sources: BriefingSourceStatus[] = [
    icalSource,
    homeCalendarSource,
    reminderSource,
    weatherSource,
    sportsSource,
    headlineSource,
  ];
  const hasLiveSource = sources.some((source) => source.state === "live");
  // Started before the daily brief so the two Claude requests overlap.
  const summarisedHeadlines = withNewsSummaries(recentHeadlines, today);
  const extras =
    date === today
      ? await todayExtras({
          today,
          timeZone,
          nowMs,
          agenda,
          calendarLive,
          weather: weatherResult.ok ? weather : undefined,
          hourlyWeather,
          liveWeather: weatherResult.ok ? weatherResult : undefined,
          reminders: reminders?.items,
          sports: recentSports,
          localTimeToIso,
        })
      : undefined;
  const hasDemoSource = sources.some((source) => source.state === "demo");

  return {
    briefing: {
      generatedAt,
      date,
      today,
      timeZone,
      mode: hasLiveSource ? (hasDemoSource ? "mixed" : "live") : "demo",
      quote: quoteResult.quote,
      hotGames: hotGames && (await withRankMovement(hotGames, today)),
      // Local data, so it needs no fetch and never appears in `sources`.
      birthdays: birthdaysInWindow(date),
      reminders,
      photo: photoResult?.photo,
      memories: memoryResults.length
        ? memoryResults.map((result, index) => ({ ...result.memory, src: memoryPath(index) }))
        : undefined,
      occasions: extras?.occasions,
      headsUp: extras?.headsUp,
      dailyBrief: extras?.dailyBrief,
      outdoorWindow: weatherResult.ok
        ? outdoorWindow({ hourly: hourlyWeather, events: agenda, date, nowMs, timeZone })
        : undefined,
      upcomingReleases,
      agenda: recentAgenda,
      weather,
      hourlyWeather,
      sports: recentSports,
      headlines: await summarisedHeadlines,
      sources,
    },
    connections: [
      icalConnection,
      homeCalendarConnection,
      reminderConnection,
      weatherConnection,
      sportsConnection,
      headlineConnection,
    ],
  };
}
