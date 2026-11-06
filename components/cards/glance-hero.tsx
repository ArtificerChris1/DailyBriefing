"use client";

import { Moon, Sparkles } from "lucide-react";

import { Card } from "@/components/ui";
import type { BriefingSnapshot, CalendarItem, DailyBrief } from "@/lib/briefing-types";
import { clockLabel, plural } from "@/lib/format";

/**
 * The page's lead card: "Today at a glance" in the morning view and
 * "Tomorrow at a glance" in the evening. One sentence: Claude's headline when
 * there is one, otherwise a plain summary worked out from the calendar and
 * weather. Everything else lives in the cards below it.
 */

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
  timeZone,
  nowMs,
}: {
  /** Which day the card is about. */
  mode: "today" | "tomorrow";
  /** That day's briefing; undefined while tomorrow's file loads. */
  day?: BriefingSnapshot;
  brief?: DailyBrief;
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
  const weather = day?.weather;

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
      help={
        <p>
          {brief
            ? "This sentence is written by Claude, an AI model, from the calendar, reminders, weather and occasions on this page when the site is built. It is told not to add anything else, but check details that matter."
            : "Without an AI summary, this card gives the key facts for the day from your calendar and weather."}
        </p>
      }
    >
      <p className="hero-headline" aria-busy={!day}>
        {brief?.headline ?? fallbackHeadline}
      </p>
    </Card>
  );
}
