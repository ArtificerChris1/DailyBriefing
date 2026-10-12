"use client";

import {
  AlertTriangle,
  CalendarClock,
  CalendarDays,
  CloudSun,
  Gift,
  Lightbulb,
  ListChecks,
  Moon,
  Navigation,
  Sparkles,
  Trophy,
  type LucideIcon,
} from "lucide-react";

import { CalendarNotice, Card, WeatherGlyph } from "@/components/ui";
import type {
  BriefingSnapshot,
  CalendarItem,
  DailyBrief,
  OccasionItem,
  ReminderItem,
} from "@/lib/briefing-types";
import { clockLabel, plural } from "@/lib/format";
import { dueLabel } from "@/lib/priorities";

/**
 * The page's lead card: "Today at a glance" in the morning view and
 * "Tomorrow at a glance" in the evening. Claude's summary when there is one,
 * then four insight tiles derived from data already on the page.
 */

const briefIcon: Record<string, LucideIcon> = {
  "Coming up": CalendarClock,
  Reminders: ListChecks,
  Weather: CloudSun,
  "Heads-up": AlertTriangle,
  Occasions: Gift,
  Opportunity: Lightbulb,
  Sports: Trophy,
};

function dateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(Date.parse(iso));
}

/** Calendars whose feed failed for this day's briefing, by everyday name. */
export function missingCalendars(day: Pick<BriefingSnapshot, "sources">): string[] {
  return day.sources
    .filter((source) => source.state === "error" && (source.provider === "ical" || source.provider === "apple-calendar"))
    .map((source) => (source.provider === "ical" ? "work" : "home"));
}

/** Holds ("Check with me before scheduling") are placeholders, not plans. */
function plans(agenda: CalendarItem[]): CalendarItem[] {
  return agenda.filter((item) => item.status !== "cancelled" && !item.hold);
}

export function GlanceHero({
  mode,
  day,
  brief,
  briefNote,
  reminders,
  occasions,
  timeZone,
  nowMs,
}: {
  /** Which day the card is about. */
  mode: "today" | "tomorrow";
  /** That day's briefing; undefined while tomorrow's file loads. */
  day?: BriefingSnapshot;
  brief?: DailyBrief;
  /** Shown when the summary was written for the other view. */
  briefNote?: string;
  /** Open reminders: not ticked off or snoozed on this device. */
  reminders: ReminderItem[];
  occasions: OccasionItem[];
  timeZone: string;
  nowMs: number;
}) {
  const title = mode === "today" ? "Today at a glance" : "Tomorrow at a glance";
  const events = day ? plans(day.agenda) : [];
  const timed = events.filter((item) => item.time.mode === "timed");
  const focus =
    mode === "today"
      ? timed.find((item) => Date.parse(item.time.mode === "timed" ? item.time.end ?? item.time.start : "") >= nowMs)
      : timed[0] ?? events[0];

  const targetDate = day?.date;
  const due = targetDate
    ? reminders
        .filter((item) => item.dueAt && dateKey(item.dueAt, timeZone) <= targetDate)
        .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!))
    : [];
  const overdue = day ? due.filter((item) => dateKey(item.dueAt!, timeZone) < day.today) : [];

  const weather = day?.weather;
  const wettest = day?.hourlyWeather.reduce<number>(
    (peak, point) => Math.max(peak, point.precipitationChance),
    0,
  );

  // Occasions are offset from today; the evening view looks a day further on.
  const shift = mode === "tomorrow" ? 1 : 0;
  const nextOccasion = occasions.find((item) => item.offset >= shift && item.offset - shift <= 7);
  const occasionWhen = (item: OccasionItem) => {
    const days = item.offset - shift;
    return days === 0 ? (mode === "today" ? "today" : "tomorrow") : `in ${plural(days, "day")}`;
  };

  const fallbackHeadline = !day
    ? "Loading tomorrow’s details…"
    : events.length === 0
      ? `Nothing on the calendar${weather ? `, and ${weather.condition.toLowerCase()} with a high of ${weather.high}°` : ""}.`
      : `${plural(events.length, "event")}${focus && focus.time.mode === "timed" ? `, starting with ${focus.title} at ${clockLabel(focus.time.start, timeZone)}` : ""}${weather ? `. ${weather.condition}, high of ${weather.high}°` : ""}.`;

  return (
    <Card
      title={title}
      icon={mode === "today" ? Sparkles : Moon}
      className="hero-card"
      meta={brief ? "Summary written by Claude" : undefined}
      help={
        <p>
          {brief
            ? "The summary is written by Claude, an AI model, from the calendar, reminders, weather and occasions on this page when the site is built. It is told not to add anything else, but check details that matter. "
            : "Without an AI summary, this card lists the key facts for the day. "}
          The tiles below are worked out directly from your data. Placeholder holds such as
          &ldquo;Check with me before scheduling&rdquo; are left out.
        </p>
      }
    >
      <div className="hero-body" aria-busy={!day}>
        {day && <CalendarNotice missing={missingCalendars(day)} />}
        {brief ? (
          <>
            <p className="hero-headline">{brief.headline}</p>
            {briefNote && <p className="hero-note">{briefNote}</p>}
            {brief.points.length > 0 && (
              <ul className="hero-points">
                {brief.points.map((point, index) => {
                  const Icon = briefIcon[point.label] ?? Sparkles;
                  return (
                    <li key={`${point.label}-${index}`}>
                      <Icon size={18} aria-hidden="true" />
                      <div>
                        <p className="hero-point-label">{point.label}</p>
                        <p>{point.text}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        ) : (
          <p className="hero-headline">{fallbackHeadline}</p>
        )}

        {day && (
          <ul className="insights" aria-label={`${title}: key details`}>
            <li className="insight">
              <span className="insight-icon" aria-hidden="true">
                <CalendarDays size={20} />
              </span>
              <div>
                <p className="insight-title">
                  {events.length ? plural(events.length, "calendar event") : "No calendar events"}
                </p>
                <p className="insight-text">
                  {focus
                    ? `${mode === "today" ? "Next" : "First"}: ${focus.title}${focus.time.mode === "timed" ? ` at ${clockLabel(focus.time.start, timeZone)}` : ", all day"}`
                    : mode === "today" && events.length
                      ? "Everything today is done."
                      : "A clear calendar."}
                </p>
                {focus?.departure && (
                  <p className="insight-text insight-accent">
                    <Navigation size={14} aria-hidden="true" /> Leave by{" "}
                    {clockLabel(focus.departure.leaveAt, timeZone)} ({focus.departure.travelMinutes} min drive)
                  </p>
                )}
              </div>
            </li>
            <li className="insight">
              <span className="insight-icon" aria-hidden="true">
                <ListChecks size={20} />
              </span>
              <div>
                <p className="insight-title">
                  {due.length ? plural(due.length, "reminder") + " due" : "No reminders due"}
                </p>
                <p className="insight-text">
                  {due.length
                    ? `${due[0].title}, ${dueLabel(due[0], day.today, timeZone).toLowerCase()}`
                    : mode === "today"
                      ? "Nothing due today."
                      : "Nothing due by tomorrow."}
                </p>
                {overdue.length > 0 && (
                  <p className="insight-text">{plural(overdue.length, "is", "are")} overdue.</p>
                )}
              </div>
            </li>
            {weather && (
              <li className="insight">
                <span className="insight-icon" aria-hidden="true">
                  <WeatherGlyph condition={weather.condition} size={20} />
                </span>
                <div>
                  <p className="insight-title">
                    {weather.high}° / {weather.low}°
                    <span className="visually-hidden"> high and low</span>
                  </p>
                  <p className="insight-text">
                    {weather.condition}, {wettest ?? weather.precipitationChance ?? 0}% chance of rain
                  </p>
                  {day.outdoorWindow && (
                    <p className="insight-text">
                      Best outside {clockLabel(day.outdoorWindow.from, timeZone)}–
                      {clockLabel(day.outdoorWindow.to, timeZone)}
                    </p>
                  )}
                </div>
              </li>
            )}
            <li className="insight">
              <span className="insight-icon" aria-hidden="true">
                <Gift size={20} />
              </span>
              <div>
                <p className="insight-title">
                  {nextOccasion ? nextOccasion.name : "No occasions this week"}
                </p>
                <p className="insight-text">
                  {nextOccasion
                    ? `${nextOccasion.kind === "holiday" ? "Holiday" : nextOccasion.kind === "anniversary" ? "Anniversary" : "Birthday"} ${occasionWhen(nextOccasion)}`
                    : "Nothing to prepare for in the next week."}
                </p>
              </div>
            </li>
          </ul>
        )}
      </div>
    </Card>
  );
}
