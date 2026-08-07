"use client";

import Image from "next/image";
import {
  ArrowUpRight,
  Bell,
  BookOpen,
  Cake,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudRain,
  CloudSun,
  Eye,
  EyeOff,
  FileText,
  Film,
  Heart,
  Link2,
  MapPin,
  Newspaper,
  RefreshCw,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  Trophy,
  Tv,
  Umbrella,
  X,
} from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  connectors,
  newsInterests,
  preferredNewsSources,
  sportsWatchlist,
} from "@/lib/demo-data";
import type {
  BriefingPayload,
  CalendarItem,
  ConnectionSummary,
  ConnectorDefinition,
  CurrentLocationInput,
  HourlyWeatherPoint,
  ProviderId,
  ReleaseMedium,
  TrustZone,
} from "@/lib/briefing-types";
import {
  MAX_DAY_OFFSET,
  MIN_DAY_OFFSET,
  dayOffsetBetween,
  shiftDateKey,
} from "@/lib/briefing-window";

type Panel = "connections" | "preferences" | null;

/**
 * Hides the Connections entry point in the top bar. The panel and everything
 * behind it stay in place; flip this back to true to surface it again.
 */
const SHOW_CONNECTIONS_ENTRY = false;

interface Preferences {
  briefingTime: string;
  timeZone: string;
  emailDigest: boolean;
  showReminders: boolean;
  showSports: boolean;
  showNews: boolean;
  weatherAlerts: boolean;
  hideScores: boolean;
}

const defaultPreferences: Preferences = {
  briefingTime: "07:00",
  timeZone: "America/Chicago",
  emailDigest: true,
  showReminders: true,
  showSports: true,
  showNews: true,
  weatherAlerts: true,
  hideScores: false,
};

const providerIcon: Record<ProviderId, typeof CalendarDays> = {
  ical: CalendarDays,
  "apple-calendar": CalendarDays,
  "apple-shortcut": Bell,
  weather: CloudSun,
  sports: Trophy,
  news: Newspaper,
};

function timeRange(item: CalendarItem, timeZone: string) {
  if (item.time.mode === "all-day") return "All day";

  const timeFormat = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  });
  const start = timeFormat.format(new Date(item.time.start));
  const end = item.time.end ? timeFormat.format(new Date(item.time.end)) : null;
  return end ? `${start}–${end}` : start;
}

function relativeDayLabel(offset: number) {
  if (offset === 0) return "Today";
  if (offset === 1) return "Tomorrow";
  if (offset === -1) return "Yesterday";
  return offset > 0 ? `In ${offset} days` : `${-offset} days ago`;
}

function hourLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZone,
  }).format(new Date(value));
}

function eventStartParts(item: CalendarItem, timeZone: string) {
  if (item.time.mode === "all-day") return { clock: "All", meridiem: "day" };
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).formatToParts(new Date(item.time.start));
  const hour = parts.find((part) => part.type === "hour")?.value ?? "";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "";
  const meridiem = parts.find((part) => part.type === "dayPeriod")?.value ?? "";
  return { clock: `${hour}:${minute}`, meridiem };
}

function WeatherGlyph({ condition, size = 17 }: { condition: string; size?: number }) {
  if (
    condition === "Drizzle" ||
    condition === "Rain" ||
    condition === "Showers" ||
    condition === "Snow" ||
    condition === "Thunderstorms"
  ) {
    return <CloudRain size={size} aria-hidden="true" />;
  }
  if (condition === "Clear") return <Sun size={size} aria-hidden="true" />;
  if (condition === "Cloudy") return <Cloud size={size} aria-hidden="true" />;
  return <CloudSun size={size} aria-hidden="true" />;
}

function eventForecast(item: CalendarItem, hourlyWeather: HourlyWeatherPoint[]) {
  if (item.time.mode !== "timed") return null;
  const eventStart = new Date(item.time.start).getTime();
  const eventEnd = item.time.end
    ? new Date(item.time.end).getTime()
    : eventStart + 30 * 60 * 1000;
  const overlapping = hourlyWeather.filter((point) => {
    const forecastStart = new Date(point.startsAt).getTime();
    return forecastStart < eventEnd && forecastStart + 60 * 60 * 1000 > eventStart;
  });
  if (!overlapping.length) return null;
  return overlapping.reduce((worst, point) =>
    point.precipitationChance > worst.precipitationChance ? point : worst,
  );
}

/** Games shown before the "show more" fold. */
const SPORTS_PREVIEW_COUNT = 10;
const RELEASES_PREVIEW_COUNT = 8;

const releaseMedium: Record<
  ReleaseMedium,
  { label: string; icon: typeof Film }
> = {
  movie: { label: "Film", icon: Film },
  tv: { label: "TV", icon: Tv },
  comic: { label: "Comic", icon: Sparkles },
  book: { label: "Book", icon: BookOpen },
};

/**
 * Release dates are calendar days, not instants, so they are formatted from
 * their own parts. Passing `2026-08-11` through `new Date()` would read it as
 * UTC midnight and slide it to the 10th anywhere west of Greenwich.
 */
function releaseDateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const label = new Intl.DateTimeFormat("en-US", {
    month: "short",
    timeZone: "UTC",
  }).format(Date.UTC(year, month - 1, day));
  return { month: label, day: String(day) };
}

const CLOCK_TICK_MS = 30_000;

/** Cached so getSnapshot stays referentially stable between ticks. */
let clockNow = 0;

function subscribeToClock(onStoreChange: () => void) {
  clockNow = Date.now();
  const timer = window.setInterval(() => {
    clockNow = Date.now();
    onStoreChange();
  }, CLOCK_TICK_MS);
  return () => window.clearInterval(timer);
}

function readClock() {
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}

/**
 * Wall-clock time that advances on its own. On the server and through hydration
 * it reports the briefing's own timestamp, so the first paint matches the markup
 * it replaces; afterwards it follows the real clock.
 */
function useNow(serverNow: number) {
  return useSyncExternalStore(subscribeToClock, readClock, () => serverNow);
}

/** NaN for all-day events, which have no clock position on the schedule. */
function eventStartMs(item: CalendarItem) {
  return item.time.mode === "timed" ? Date.parse(item.time.start) : Number.NaN;
}

function eventEndMs(item: CalendarItem) {
  return item.time.mode === "timed"
    ? Date.parse(item.time.end ?? item.time.start)
    : Number.NaN;
}

function eventDuration(item: CalendarItem) {
  if (item.time.mode !== "timed" || !item.time.end) return null;
  const minutes = Math.max(
    0,
    Math.round(
      (new Date(item.time.end).getTime() - new Date(item.time.start).getTime()) /
        60_000,
    ),
  );
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function connectionFor(
  connections: ConnectionSummary[],
  provider: ProviderId,
) {
  return connections.find((connection) => connection.provider === provider);
}

function SourceBadge({ zone, label }: { zone: TrustZone; label: string }) {
  return (
    <span className={`source-badge source-${zone}`}>
      <span className="source-dot" aria-hidden="true" />
      {label}
    </span>
  );
}

function SectionHeading({
  title,
  action,
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="section-heading">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

export function DashboardShell({ initialPayload }: { initialPayload: BriefingPayload }) {
  const [payload, setPayload] = useState(initialPayload);
  const [panel, setPanel] = useState<Panel>(null);
  const [preferences, setPreferences] =
    useState<Preferences>({
      ...defaultPreferences,
      timeZone: initialPayload.briefing.timeZone,
    });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [changingDay, setChangingDay] = useState(false);
  const [showAllSports, setShowAllSports] = useState(false);
  const [showAllReleases, setShowAllReleases] = useState(false);
  const [completedReminders, setCompletedReminders] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const nowMs = useNow(Date.parse(initialPayload.briefing.generatedAt));
  const currentLocationRef = useRef<CurrentLocationInput | undefined>(undefined);

  const { briefing, connections } = payload;
  const {
    agenda,
    headlines,
    hourlyWeather,
    reminders,
    sports,
    weather,
  } = briefing;
  const timeZone = preferences.timeZone || briefing.timeZone;
  const icalConnection = connectionFor(connections, "ical");
  const homeCalendarConnection = connectionFor(connections, "apple-calendar");
  const appleReminderConnection = connectionFor(connections, "apple-shortcut");

  // Rendered from the date key at midday UTC so the label always names the day
  // being shown, independent of the viewer's own zone.
  const formattedDate = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(`${briefing.date}T12:00:00Z`)),
    [briefing.date],
  );
  const dayOffset = dayOffsetBetween(briefing.today, briefing.date);
  const isToday = dayOffset === 0;

  const lastUpdated = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }).format(new Date(briefing.generatedAt)),
    [briefing.generatedAt, timeZone],
  );

  useEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      const savedPreferences = window.localStorage.getItem("brief-preferences");
      const savedCompleted = window.localStorage.getItem("brief-completed-reminders");

      if (savedPreferences) {
        try {
          const parsedPreferences = JSON.parse(savedPreferences) as Record<string, unknown>;
          const supportedPreferences = Object.fromEntries(
            Object.keys(defaultPreferences)
              .filter((key) => key in parsedPreferences)
              .map((key) => [key, parsedPreferences[key]]),
          ) as Partial<Preferences>;
          setPreferences({
            ...defaultPreferences,
            ...supportedPreferences,
          });
        } catch {
          window.localStorage.removeItem("brief-preferences");
        }
      }

      if (savedCompleted) {
        try {
          setCompletedReminders(JSON.parse(savedCompleted) as string[]);
        } catch {
          window.localStorage.removeItem("brief-completed-reminders");
        }
      }
      setPreferencesReady(true);
    }, 0);

    return () => window.clearTimeout(hydrateTimer);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    window.localStorage.setItem("brief-preferences", JSON.stringify(preferences));
  }, [preferences, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    window.localStorage.setItem(
      "brief-completed-reminders",
      JSON.stringify(completedReminders),
    );
  }, [completedReminders, preferencesReady]);

  useEffect(() => {
    let disposed = false;
    const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    async function loadLocationBriefing(location: CurrentLocationInput) {
      currentLocationRef.current = location;
      try {
        const response = await fetch("/api/briefing", {
          method: "POST",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(location),
        });
        if (!response.ok) throw new Error("Location briefing failed");
        const locationPayload = (await response.json()) as BriefingPayload;
        if (disposed) return;
        setPayload(locationPayload);
        setPreferences((current) => ({
          ...current,
          timeZone: locationPayload.briefing.timeZone,
        }));
      } catch {
        if (disposed) return;
        setToast("Current-location weather could not be loaded");
        window.setTimeout(() => setToast(null), 3600);
      }
    }

    if (!("geolocation" in navigator)) {
      void loadLocationBriefing({ timeZone: browserTimeZone });
      return () => {
        disposed = true;
      };
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void loadLocationBriefing({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          timeZone: browserTimeZone,
        });
      },
      () => {
        void loadLocationBriefing({ timeZone: browserTimeZone });
        setToast("Location permission was unavailable; using the configured weather location");
        window.setTimeout(() => setToast(null), 4200);
      },
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10_000 },
    );

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    if (!panel) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [panel]);

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  }

  function updatePreference<K extends keyof Preferences>(
    key: K,
    value: Preferences[K],
  ) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  /** Single request path, so refreshing and paging always agree on location. */
  async function loadBriefing(date: string): Promise<BriefingPayload> {
    const response = await fetch("/api/briefing", {
      method: "POST",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ ...(currentLocationRef.current ?? {}), date }),
    });
    if (!response.ok) throw new Error("Briefing request failed");
    return (await response.json()) as BriefingPayload;
  }

  async function refreshBriefing(showNotification = true) {
    if (refreshing) return;
    setRefreshing(true);
    try {
      setPayload(await loadBriefing(briefing.date));
      if (showNotification) notify("Live sources refreshed");
    } catch {
      notify("Could not refresh live sources; the last briefing is still shown");
    } finally {
      setRefreshing(false);
    }
  }

  async function goToDay(date: string) {
    if (changingDay || date === briefing.date) return;
    setChangingDay(true);
    try {
      setPayload(await loadBriefing(date));
    } catch {
      notify("That day could not be loaded; the current day is still shown");
    } finally {
      setChangingDay(false);
    }
  }

  function openSource(source: string, deepLink?: string) {
    if (deepLink) {
      window.open(deepLink, "_blank", "noopener,noreferrer");
      return;
    }
    notify(`${source} will open here after the account is connected`);
  }

  function toggleReminder(id: string) {
    setCompletedReminders((current) =>
      current.includes(id)
        ? current.filter((reminderId) => reminderId !== id)
        : [...current, id],
    );
  }

  function resetDemo() {
    setPreferences(defaultPreferences);
    setCompletedReminders([]);
    setShowAllSports(false);
    setShowAllReleases(false);
    window.localStorage.removeItem("brief-preferences");
    window.localStorage.removeItem("brief-completed-reminders");
    notify("Prototype preferences reset");
  }

  const visibleSports = showAllSports
    ? sports
    : sports.slice(0, SPORTS_PREVIEW_COUNT);
  const hiddenSportsCount = Math.max(0, sports.length - visibleSports.length);
  const releases = briefing.upcomingReleases?.items ?? [];
  const visibleReleases = showAllReleases
    ? releases
    : releases.slice(0, RELEASES_PREVIEW_COUNT);
  const hiddenReleasesCount = Math.max(0, releases.length - visibleReleases.length);
  const releaseHeadline = headlines.find((headline) => headline.lane === "events");
  const now = nowMs;
  const nextEvent =
    agenda.find((item) => {
      if (item.status === "cancelled") return false;
      if (item.time.mode === "all-day") return true;
      return new Date(item.time.end ?? item.time.start).getTime() >= now;
    }) ?? agenda[0] ?? null;
  const nextEventParts = nextEvent ? eventStartParts(nextEvent, timeZone) : null;
  const weatherRisk = agenda
    .map((item) => ({ item, forecast: eventForecast(item, hourlyWeather) }))
    .find(({ forecast }) => (forecast?.precipitationChance ?? 0) >= 50);
  const peakPrecipitation = hourlyWeather.reduce<HourlyWeatherPoint | null>(
    (peak, point) =>
      !peak || point.precipitationChance > peak.precipitationChance ? point : peak,
    null,
  );

  const nowLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      }).format(nowMs),
    [nowMs, timeZone],
  );
  // A tab left open past midnight still shows yesterday's agenda; marking "now"
  // on it would be a lie, so the indicator only appears on the day it describes.
  const showNowMarker = useMemo(
    () =>
      agenda.length > 0 &&
      new Intl.DateTimeFormat("en-CA", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        timeZone,
      }).format(nowMs) === briefing.date,
    [agenda.length, briefing.date, nowMs, timeZone],
  );
  // The agenda is sorted by start, so the marker belongs above the first event
  // yet to begin. -1 means the day's last event has already started.
  const nowMarkerIndex = agenda.findIndex((item) => {
    const start = eventStartMs(item);
    return !Number.isNaN(start) && start > nowMs;
  });
  const nowMarker = (
    <div className="schedule-now" role="separator" aria-label={`Current time, ${nowLabel}`}>
      <span className="schedule-now-time">{nowLabel}</span>
      <span className="schedule-now-line" aria-hidden="true" />
    </div>
  );

  return (
    <div className="app-shell">
      <main className="main-content">
        <header className="app-topbar">
          <div className="topbar-content">
            <span className="topbar-brand" aria-label="Daily Briefing">
              <span className="brand-mark" aria-hidden="true" />
              Daily Briefing
            </span>
            <div className="topbar-actions">
              {SHOW_CONNECTIONS_ENTRY && (
                <button type="button" onClick={() => setPanel("connections")}>
                  <Link2 size={16} />
                  <span>Connections</span>
                  {(icalConnection?.state !== "connected" ||
                    homeCalendarConnection?.state !== "connected" ||
                    appleReminderConnection?.state !== "connected") && (
                    <span className="setup-dot" aria-label="Setup needed" />
                  )}
                </button>
              )}
              <button type="button" onClick={() => setPanel("preferences")}>
                <Settings2 size={16} />
                <span>Preferences</span>
              </button>
            </div>
          </div>
        </header>

        <div className="page-frame">
          <header className="page-header">
            <div>
              <p className="date-line">{relativeDayLabel(dayOffset)}</p>
              <h1>{formattedDate}</h1>
              <p className="page-summary">
                A focused view of what&rsquo;s happening and what&rsquo;s next.
              </p>
              {briefing.quote && (
                <figure className="day-quote">
                  <blockquote>{briefing.quote.text}</blockquote>
                  <figcaption>
                    {briefing.quote.author}
                    {briefing.quote.work && <cite>{briefing.quote.work}</cite>}
                    <span className="quote-attribution">
                      Quote of the day · {briefing.quote.attribution}
                    </span>
                  </figcaption>
                </figure>
              )}
            </div>
            <div className="header-actions">
              <div className="day-pager" role="group" aria-label="Change day">
                <button
                  type="button"
                  onClick={() => void goToDay(shiftDateKey(briefing.date, -1))}
                  disabled={changingDay || dayOffset <= MIN_DAY_OFFSET}
                  aria-label="Previous day"
                >
                  <ChevronLeft size={17} />
                </button>
                <button
                  type="button"
                  className="day-pager-today"
                  onClick={() => void goToDay(briefing.today)}
                  disabled={changingDay || isToday}
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={() => void goToDay(shiftDateKey(briefing.date, 1))}
                  disabled={changingDay || dayOffset >= MAX_DAY_OFFSET}
                  aria-label="Next day"
                >
                  <ChevronRight size={17} />
                </button>
              </div>
              <button
                type="button"
                className="refresh-button"
                onClick={() => void refreshBriefing()}
                disabled={refreshing}
              >
                <RefreshCw size={17} className={refreshing ? "spin" : ""} />
                <span>{refreshing ? "Refreshing" : `Updated ${lastUpdated}`}</span>
              </button>
            </div>
          </header>

          <div className="dashboard-grid">
            <section className="card next-card" aria-labelledby="next-title">
              <SectionHeading title={isToday ? "Up Next" : "First event"} />
              {nextEvent && nextEventParts ? (
                <div className="next-event">
                  <time
                    className="next-time"
                    dateTime={nextEvent.time.mode === "timed" ? nextEvent.time.start : undefined}
                  >
                    <span>{nextEventParts.clock}</span>
                    <small>{nextEventParts.meridiem}</small>
                  </time>
                  <div className="next-details">
                    <SourceBadge zone={nextEvent.zone} label={nextEvent.sourceLabel} />
                    <h3 id="next-title">{nextEvent.title}</h3>
                    <p>
                      <MapPin size={16} />
                      {nextEvent.locationLabel ?? "No location"}
                      {eventDuration(nextEvent) && (
                        <>
                          <span aria-hidden="true">·</span>
                          {eventDuration(nextEvent)}
                        </>
                      )}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="next-event next-event-empty">
                  <div className="next-details">
                    <h3 id="next-title">Your calendar is clear</h3>
                    <p>
                      {isToday
                        ? "No more scheduled events are available for today."
                        : "Nothing is scheduled on this day."}
                    </p>
                  </div>
                </div>
              )}
            </section>

            <section className="card weather-card" aria-labelledby="weather-title">
              <div className="weather-topline">
                <span className="weather-location"><MapPin size={13} /> {weather.location}</span>
              </div>
              <div className="weather-main">
                <WeatherGlyph condition={weather.condition} size={46} />
                <div>
                  <p className="temperature">{weather.temperature}°</p>
                  <h2 id="weather-title">{weather.condition}</h2>
                </div>
              </div>
              <div className="weather-stats">
                <span><strong>H {weather.high}°</strong> / L {weather.low}°</span>
                <span>
                  <strong>Feels {weather.feelsLike}°</strong>
                  {isToday ? " now" : " at peak"}
                </span>
                <span>
                  <Umbrella size={14} /> {peakPrecipitation?.precipitationChance ?? weather.precipitationChance ?? 0}%
                  {peakPrecipitation
                    ? ` around ${hourLabel(peakPrecipitation.startsAt, timeZone)}`
                    : isToday
                      ? " today"
                      : " that day"}
                </span>
              </div>
              <p className="weather-note">
                {weatherRisk
                  ? `${weatherRisk.forecast?.condition ?? "Weather"} may affect ${weatherRisk.item.title}.`
                  : "No significant weather overlap is forecast for your schedule."}
              </p>
              <details className="hourly-details weather-hourly-details">
                <summary>View full hourly forecast <ChevronRight size={15} /></summary>
                <div className="mobile-hourly-list">
                  {hourlyWeather.map((point) => (
                    <div className={point.precipitationChance >= 50 ? "mobile-hour mobile-hour-rain" : "mobile-hour"} key={point.id}>
                      <time dateTime={point.startsAt}>{hourLabel(point.startsAt, timeZone)}</time>
                      <WeatherGlyph condition={point.condition} />
                      <strong>{point.temperature}°</strong>
                      <span>{point.condition} · Feels {point.feelsLike}°</span>
                      <small><Umbrella size={11} /> {point.precipitationChance}%</small>
                    </div>
                  ))}
                </div>
              </details>
            </section>

            <section className="card agenda-card dayline-card" aria-labelledby="agenda-title">
              <SectionHeading
                title="Daily Schedule"
                action={<span className="forecast-freshness"><RefreshCw size={12} /> Forecast updated {lastUpdated}</span>}
              />
              <div className="schedule-list" aria-label="Calendar with weather for each event">
                {agenda.length === 0 && (
                  <div className="schedule-empty">
                    <CalendarDays size={20} aria-hidden="true" />
                    <div>
                      <strong>No events on your work calendar today</strong>
                      <span>Your hourly forecast is still available below.</span>
                    </div>
                  </div>
                )}
                {agenda.map((item, index) => {
                  const forecast = eventForecast(item, hourlyWeather);
                  const start = eventStartParts(item, timeZone);
                  const end = eventEndMs(item);
                  const isPast = showNowMarker && !Number.isNaN(end) && end < nowMs;
                  return (
                    <Fragment key={item.id}>
                    {showNowMarker && index === nowMarkerIndex && nowMarker}
                    <article
                      className={`schedule-entry schedule-entry-${item.zone}${isPast ? " schedule-entry-past" : ""}`}
                      aria-label={`${timeRange(item, timeZone)}, ${item.title}${isPast ? ", already finished" : ""}${forecast ? `, ${forecast.condition}, ${forecast.temperature} degrees, feels like ${forecast.feelsLike} degrees, ${forecast.precipitationChance} percent chance of precipitation` : ""}`}
                    >
                      <time className="schedule-entry-time" dateTime={item.time.mode === "timed" ? item.time.start : undefined}>
                        <strong>{start.clock}</strong>
                        <span>{start.meridiem}</span>
                      </time>
                      <div className="schedule-entry-copy">
                        <div className="schedule-entry-context">
                          <span className={`schedule-check check-${item.zone}`} aria-hidden="true"><Check size={12} /></span>
                          <SourceBadge zone={item.zone} label={item.sourceLabel} />
                        </div>
                        <h3>{item.title}</h3>
                        <p><MapPin size={13} /> {item.locationLabel}</p>
                      </div>
                      {forecast && (
                        <div className={`schedule-entry-weather ${forecast.precipitationChance >= 50 ? "schedule-weather-alert" : ""}`}>
                          <WeatherGlyph condition={forecast.condition} size={24} />
                          <div>
                            <strong>{forecast.temperature}°</strong>
                            <span>Feels like {forecast.feelsLike}°</span>
                          </div>
                          <small><Umbrella size={11} /> {forecast.precipitationChance}%</small>
                        </div>
                      )}
                    </article>
                    </Fragment>
                  );
                })}
                {showNowMarker && nowMarkerIndex === -1 && nowMarker}
              </div>
            </section>

            {preferences.showReminders && (
              <section className="card reminders-card" aria-labelledby="reminders-title">
                <SectionHeading
                  title="Reminders"
                  action={<span className="item-count">{reminders.length}</span>}
                />
                <div className="reminder-list">
                  {reminders.map((item) => {
                    const isComplete = completedReminders.includes(item.id);
                    return (
                      <label className={`reminder-item ${isComplete ? "reminder-complete" : ""}`} key={item.id}>
                        <input
                          type="checkbox"
                          checked={isComplete}
                          onChange={() => toggleReminder(item.id)}
                        />
                        <span className="custom-check" aria-hidden="true"><Check size={13} /></span>
                        <span className="reminder-copy">
                          <strong>{item.title}</strong>
                          <small>{item.dueLabel} · {item.listLabel}</small>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            {preferences.showSports && sports.length > 0 && (
              <section className="card sports-card" aria-labelledby="sports-title">
                <SectionHeading
                  title="Sports watch"
                  action={<span className="watch-count">15 followed</span>}
                />
                <div className="sports-list">
                  {visibleSports.map((game) => (
                    <article className="game-row" key={game.id}>
                      <div className="team-logo">
                        <Image
                          src={game.logoPath}
                          alt={`${game.team} logo`}
                          width={42}
                          height={42}
                        />
                      </div>
                      <div className="game-copy">
                        <h3>{game.title}</h3>
                        <p className="game-result">
                          {(game.state === "final"
                            ? [
                                preferences.hideScores
                                  ? "Score hidden"
                                  : game.scoreLabel,
                                game.startsAt,
                              ]
                            : [game.startsAt]
                          )
                            .filter(Boolean)
                            .join(" · ")}
                          {game.broadcast && ` · ${game.broadcast}`}
                        </p>
                        {game.context && <p className="game-context">{game.context}</p>}
                        {game.standingLabel && <span className="standing-label">{game.standingLabel}</span>}
                      </div>
                      <span className={`game-state game-state-${game.state}`}>
                        {game.state === "scheduled" ? "Upcoming" : game.state === "final" ? "Final" : "Live"}
                      </span>
                    </article>
                  ))}
                </div>
                <div className="sports-controls">
                  {sports.length > SPORTS_PREVIEW_COUNT && (
                    <button type="button" onClick={() => setShowAllSports((value) => !value)}>
                      {showAllSports ? "Show priority only" : `Show ${hiddenSportsCount} more updates`}
                      <ChevronRight size={14} className={showAllSports ? "chevron-up" : ""} />
                    </button>
                  )}
                  <button type="button" onClick={() => updatePreference("hideScores", !preferences.hideScores)}>
                    {preferences.hideScores ? <Eye size={13} /> : <EyeOff size={13} />}
                    {preferences.hideScores ? "Show scores" : "Hide spoilers"}
                  </button>
                </div>
              </section>
            )}

            {briefing.hotGames && (
              <section className="card hotness-card" aria-labelledby="hotness-title">
                <SectionHeading
                  title="BGG Hotness"
                  action={<span className="watch-count">{briefing.hotGames.attribution}</span>}
                />
                {briefing.hotGames.message ? (
                  <p className="hotness-message" id="hotness-title">
                    {briefing.hotGames.message}
                  </p>
                ) : (
                  <ol className="hotness-list" id="hotness-title">
                    {briefing.hotGames.items.map((game) => (
                      <li className="hotness-row" key={game.id}>
                        <span className="hotness-rank" aria-hidden="true">
                          {game.rank}
                        </span>
                        <span className="hotness-thumb">
                          {game.thumbnailUrl && (
                            <Image
                              src={game.thumbnailUrl}
                              alt=""
                              width={34}
                              height={34}
                              unoptimized
                            />
                          )}
                        </span>
                        <span className="hotness-copy">
                          <strong>{game.name}</strong>
                          {game.yearPublished && <small>{game.yearPublished}</small>}
                        </span>
                        <button
                          className="row-action"
                          type="button"
                          onClick={() => openSource(game.name, game.url)}
                          aria-label={`Open ${game.name} on BoardGameGeek`}
                        >
                          <ArrowUpRight size={16} />
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {briefing.upcomingReleases && (
              <section className="card releases-card" aria-labelledby="releases-title">
                <SectionHeading
                  title="Upcoming releases"
                  action={
                    <span className="watch-count">
                      {briefing.upcomingReleases.attribution}
                    </span>
                  }
                />
                {briefing.upcomingReleases.message ? (
                  <p className="hotness-message" id="releases-title">
                    {briefing.upcomingReleases.message}
                  </p>
                ) : (
                  <>
                    <ol className="releases-list" id="releases-title">
                      {visibleReleases.map((release) => {
                        const medium = releaseMedium[release.medium];
                        const MediumIcon = medium.icon;
                        const date = releaseDateParts(release.releasesOn);
                        return (
                          <li className="release-row" key={release.id}>
                            <span className="release-date" aria-hidden="true">
                              <small>{date.month}</small>
                              <strong>{date.day}</strong>
                            </span>
                            <span
                              className={`release-thumb release-thumb-${release.medium}`}
                            >
                              {release.posterUrl ? (
                                <Image
                                  src={release.posterUrl}
                                  alt=""
                                  width={32}
                                  height={44}
                                  unoptimized
                                />
                              ) : (
                                <MediumIcon size={15} aria-hidden="true" />
                              )}
                            </span>
                            <span className="release-copy">
                              <strong>{release.title}</strong>
                              <small>
                                {[release.detail, release.by]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            </span>
                            <span
                              className={`release-medium release-medium-${release.medium}`}
                            >
                              {medium.label}
                            </span>
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => openSource(release.title, release.url)}
                              aria-label={`Open ${release.title}, releasing ${date.month} ${date.day}`}
                            >
                              <ArrowUpRight size={16} />
                            </button>
                          </li>
                        );
                      })}
                    </ol>
                    {briefing.upcomingReleases.warnings.length > 0 && (
                      <p className="release-warning">
                        {briefing.upcomingReleases.warnings.join(" ")}
                      </p>
                    )}
                    {releases.length > RELEASES_PREVIEW_COUNT && (
                      <div className="sports-controls">
                        <button
                          type="button"
                          onClick={() => setShowAllReleases((value) => !value)}
                        >
                          {showAllReleases
                            ? "Show fewer"
                            : `Show ${hiddenReleasesCount} more releases`}
                          <ChevronRight
                            size={14}
                            className={showAllReleases ? "chevron-up" : ""}
                          />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}

            {briefing.birthdays && (
              <section className="card birthdays-card" aria-labelledby="birthdays-title">
                <SectionHeading
                  title="Birthdays &amp; anniversaries"
                  action={
                    <span className="watch-count">
                      {dayOffset === 0 && briefing.birthdays.onDayCount > 0
                        ? `${briefing.birthdays.onDayCount} today`
                        : `${briefing.birthdays.items.length} nearby`}
                    </span>
                  }
                />
                {briefing.birthdays.items.length === 0 ? (
                  <p className="hotness-message" id="birthdays-title">
                    Nothing from the last three days or the coming week.
                  </p>
                ) : (
                  <ul className="birthday-list" id="birthdays-title">
                    {briefing.birthdays.items.map((person) => {
                      // The window follows the pager, so restate each offset
                      // against the real today before labelling it.
                      const offset = dayOffset + person.offset;
                      const OccasionIcon =
                        person.kind === "anniversary" ? Heart : Cake;
                      const rowClass = [
                        "birthday-row",
                        offset === 0 && !person.inMemoriam
                          ? "birthday-row-today"
                          : "",
                        person.inMemoriam ? "birthday-row-memoriam" : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <li className={rowClass} key={person.id}>
                          <span className="birthday-when">
                            <strong>{relativeDayLabel(offset)}</strong>
                            <small>{person.dateLabel}</small>
                          </span>
                          <span className="birthday-mark" aria-hidden="true">
                            <OccasionIcon size={15} />
                          </span>
                          <span className="birthday-copy">
                            <strong>{person.name}</strong>
                            {(person.detail || person.note) && (
                              <small>
                                {[person.detail, person.note]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </small>
                            )}
                          </span>
                          {person.profileUrl && (
                            <button
                              className="row-action"
                              type="button"
                              onClick={() => openSource(person.name, person.profileUrl)}
                              aria-label={`Open ${person.name} on Facebook`}
                            >
                              <ArrowUpRight size={16} />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {preferences.showNews && (
              <section className="card news-card" aria-labelledby="news-title">
                <SectionHeading
                  title="News, on your wavelength"
                  action={<span className="preferred-source">Al Jazeera preferred</span>}
                />
                <div className="news-lanes">
                  {[
                    { id: "world", title: "World headlines" },
                    { id: "geek", title: "Geek culture" },
                  ].map((lane) => (
                    <section className="news-lane" key={lane.id}>
                      <div className="news-lane-title">
                        <h3>{lane.title}</h3>
                      </div>
                      {headlines.filter((headline) => headline.lane === lane.id).map((headline) => (
                        <article className="lane-headline" key={headline.id}>
                          <div>
                            <p className="headline-meta"><span>{headline.interestTag}</span> {headline.publisher} · {headline.publishedAt}</p>
                            <h4>{headline.title}</h4>
                          </div>
                          <button
                            className="row-action"
                            type="button"
                            onClick={() =>
                              openSource(
                                headline.publisher,
                                headline.url !== "#" ? headline.url : headline.source.deepLink,
                              )
                            }
                            aria-label={`Open headline from ${headline.publisher}`}
                          >
                            <ArrowUpRight size={16} />
                          </button>
                        </article>
                      ))}
                    </section>
                  ))}
                  {releaseHeadline && (
                    <section className="release-lane">
                      <div className="release-icon"><CalendarDays size={18} /></div>
                      <div>
                        <h3>{releaseHeadline.title}</h3>
                        <p>Only confirmed first-party dates · Next 30 days</p>
                      </div>
                      <button
                        type="button"
                        className="text-action"
                        onClick={() => openSource(releaseHeadline.publisher, releaseHeadline.url)}
                      >
                        Preview calendar <ChevronRight size={14} />
                      </button>
                    </section>
                  )}
                </div>
              </section>
            )}
          </div>

        </div>
      </main>

      {panel && (
        <>
          <button className="panel-backdrop" type="button" aria-label="Close panel" onClick={() => setPanel(null)} />
          <aside className="slide-panel" role="dialog" aria-modal="true" aria-labelledby="panel-title">
            <div className="panel-header">
              <div>
                <h2 id="panel-title">{panel === "connections" ? "Connections" : "Preferences"}</h2>
              </div>
              <button className="icon-button" type="button" onClick={() => setPanel(null)} aria-label="Close panel"><X size={20} /></button>
            </div>

            {panel === "connections" ? (
              <ConnectionsPanel
                connections={connections}
                onNotify={notify}
              />
            ) : (
              <PreferencesPanel
                preferences={preferences}
                updatePreference={updatePreference}
                onReset={resetDemo}
              />
            )}
          </aside>
        </>
      )}

      {toast && <div className="toast" role="status"><Check size={16} /> {toast}</div>}
    </div>
  );
}

function ConnectionsPanel({
  connections,
  onNotify,
}: {
  connections: ConnectionSummary[];
  onNotify: (message: string) => void;
}) {
  const icalConnection = connectionFor(connections, "ical");
  return (
    <div className="panel-body">
      <div className="panel-notice">
        <FileText size={18} />
        <p>
          <strong>
            {icalConnection?.state === "connected"
              ? "Your work calendar is connected."
              : "Your iCal connection is ready to configure."}
          </strong>{" "}
          {icalConnection?.state === "connected"
            ? `Calendar events are syncing${icalConnection.accountLabel ? ` from ${icalConnection.accountLabel}` : ""}.`
            : "Add your private iCal subscription URL to .env.local."}
        </p>
      </div>
      <div className="trust-legend">
        <span><span className="legend-dot legend-work" /> Work vault</span>
        <span><span className="legend-dot legend-personal" /> Personal vault</span>
        <span><span className="legend-dot legend-public" /> Public feed</span>
      </div>
      <div className="connector-list">
        {connectors.map((connector) => {
          const connection = connectionFor(connections, connector.id);
          return (
            <ConnectorCard
              connector={connector}
              connection={connection}
              key={connector.id}
              onNotify={onNotify}
            />
          );
        })}
      </div>
      <div className="security-note">
        <ShieldCheck size={18} />
        <div>
          <strong>Least access by default</strong>
          <p>Daily Briefing reads the private iCal feed on the server, keeps only a short in-memory event cache, and never stores the raw calendar.</p>
        </div>
      </div>
    </div>
  );
}

function ConnectorCard({
  connector,
  connection,
  onNotify,
}: {
  connector: ConnectorDefinition;
  connection?: ConnectionSummary;
  onNotify: (message: string) => void;
}) {
  const Icon = providerIcon[connector.id];
  const state = connection?.state ?? connector.state;
  const statusLabel =
    state === "connected"
      ? "Connected"
      : state === "demo"
      ? "Sample feed"
      : state === "planned"
        ? "Bridge planned"
        : state === "not-configured"
          ? "Setup required"
          : state === "expired"
            ? "Reconnect"
        : state === "error"
          ? "Needs attention"
          : "Not connected";

  function handleConnectorAction() {
    if (connector.id === "ical" || connector.id === "apple-calendar") {
      const isHomeCalendar = connector.id === "apple-calendar";
      if (state === "connected") {
        onNotify(
          isHomeCalendar
            ? "The iCloud feed is supplying today’s home calendar"
            : "The iCal feed is supplying today’s work calendar",
        );
      } else if (state === "not-configured") {
        onNotify(
          `Add ${isHomeCalendar ? "HOME" : "WORK"}_CALENDAR_ICAL_URL to .env.local, then restart Daily Briefing`,
        );
      } else {
        onNotify(connection?.message ?? "The calendar feed could not be refreshed");
      }
      return;
    }

    if (connector.id === "apple-shortcut") {
      if (state === "connected") {
        onNotify("Apple Reminders is supplying a live Shortcut snapshot");
      } else if (state === "not-configured") {
        onNotify("Add APPLE_SHORTCUT_TOKEN to .env.local, then restart Daily Briefing");
      } else {
        onNotify(connection?.message ?? "Run the Apple Reminders Shortcut once");
      }
      return;
    }

    onNotify(
      state === "connected"
        ? `${connector.name} is supplying live data`
        : `${connector.name} remains on the integration roadmap`,
    );
  }

  return (
    <article className="connector-card">
      <div className={`connector-icon connector-${connector.zone}`}><Icon size={21} /></div>
      <div className="connector-main">
        <div className="connector-title">
          <h3>{connector.name}</h3>
          <span className={`connector-state state-${state}`}>{statusLabel}</span>
        </div>
        <p>{connector.description}</p>
        {connection?.accountLabel && <p className="connection-account">{connection.accountLabel}</p>}
        {connection?.message && state === "error" && (
          <p className="connection-message">{connection.message}</p>
        )}
        <div className="capability-list">
          {connector.capabilities.map((capability) => <span key={capability}>{capability}</span>)}
        </div>
        <p className="permission-note"><ShieldCheck size={13} /> {connector.permissionNote}</p>
        <button
          type="button"
          className="connector-action"
          onClick={() => void handleConnectorAction()}
        >
          {connector.id === "ical" || connector.id === "apple-calendar"
            ? state === "connected"
              ? "Live feed active"
              : "Configure iCal feed"
            : connector.id === "apple-shortcut"
              ? state === "connected"
                ? "Live snapshot active"
                : "Configure Shortcut"
            : state === "connected"
              ? "Live data active"
              : "View implementation note"}
          <ChevronRight size={15} />
        </button>
      </div>
    </article>
  );
}

function PreferencesPanel({
  preferences,
  updatePreference,
  onReset,
}: {
  preferences: Preferences;
  updatePreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  onReset: () => void;
}) {
  return (
    <div className="panel-body preferences-body">
      <section className="settings-section">
        <h3>Delivery</h3>
        <label className="field-label">
          Morning briefing time
          <input
            type="time"
            value={preferences.briefingTime}
            onChange={(event) => updatePreference("briefingTime", event.target.value)}
          />
        </label>
        <label className="field-label">
          Time zone
          <select
            value={preferences.timeZone}
            onChange={(event) => updatePreference("timeZone", event.target.value)}
          >
            <option value="America/Chicago">Central Time — Chicago</option>
            <option value="America/New_York">Eastern Time — New York</option>
            <option value="America/Denver">Mountain Time — Denver</option>
            <option value="America/Los_Angeles">Pacific Time — Los Angeles</option>
          </select>
        </label>
        <PreferenceToggle
          label="Email digest"
          description="Send a short, privacy-safe morning summary."
          checked={preferences.emailDigest}
          onChange={(checked) => updatePreference("emailDigest", checked)}
        />
      </section>

      <section className="settings-section">
        <h3>Sections</h3>
        <PreferenceToggle label="Reminders" checked={preferences.showReminders} onChange={(checked) => updatePreference("showReminders", checked)} />
        <PreferenceToggle label="Sports" checked={preferences.showSports} onChange={(checked) => updatePreference("showSports", checked)} />
        <PreferenceToggle label="Headlines" checked={preferences.showNews} onChange={(checked) => updatePreference("showNews", checked)} />
      </section>

      <section className="settings-section">
        <h3>Weather along your day</h3>
        <PreferenceToggle
          label="Event-aware weather alerts"
          description="Flag rain, snow, heat, or wind only when it overlaps an event or travel window."
          checked={preferences.weatherAlerts}
          onChange={(checked) => updatePreference("weatherAlerts", checked)}
        />
        <p className="settings-help">The dashboard always aligns hourly conditions to calendar time; this controls extra alerts.</p>
      </section>

      <section className="settings-section interest-section">
        <div className="settings-title-row">
          <h3>Sports watchlist</h3>
          <span>15 followed</span>
        </div>
        {sportsWatchlist.map((group) => (
          <div className="watchlist-group" key={group.id}>
            <strong>{group.label}</strong>
            <div className="interest-chips">
              {group.items.map((item) => <span key={item}>{item}</span>)}
            </div>
            {"note" in group && group.note && <small>{group.note}</small>}
          </div>
        ))}
        <PreferenceToggle
          label="Hide scores until I reveal them"
          checked={preferences.hideScores}
          onChange={(checked) => updatePreference("hideScores", checked)}
        />
      </section>

      <section className="settings-section interest-section">
        <div className="settings-title-row">
          <h3>News & geek interests</h3>
          <span>{newsInterests.length} topics</span>
        </div>
        <div className="interest-chips interest-chips-accent">
          {newsInterests.map((interest) => <span key={interest}>{interest}</span>)}
        </div>
        <div className="source-stack">
          <strong>Preferred and trusted sources</strong>
          <p>{preferredNewsSources.join(" · ")}</p>
        </div>
        <p>Official sources will drive release dates; rumors stay labeled and de-prioritized.</p>
      </section>

      <button className="reset-button" type="button" onClick={onReset}><RotateCcw size={16} /> Reset prototype preferences</button>
    </div>
  );
}

function PreferenceToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="setting-toggle">
      <span><strong>{label}</strong>{description && <small>{description}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className={`switch ${checked ? "switch-on" : ""}`} aria-hidden="true"><span /></span>
    </label>
  );
}
