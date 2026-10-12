"use client";

import { CalendarCheck, Clock, MapPin, Navigation } from "lucide-react";

import { Card, EmptyState, SourceBadge } from "@/components/ui";
import type { CalendarItem } from "@/lib/briefing-types";
import { clockLabel, eventDuration, eventStartParts } from "@/lib/format";

/** The next thing on the calendar, with when to leave for it. */
export function UpNextCard({
  agenda,
  isToday,
  nowMs,
  timeZone,
}: {
  agenda: CalendarItem[];
  isToday: boolean;
  nowMs: number;
  timeZone: string;
}) {
  const plans = agenda.filter((item) => item.status !== "cancelled" && !item.hold);
  const upcoming = isToday
    ? plans.filter(
        (item) =>
          item.time.mode === "all-day" || Date.parse(item.time.end ?? item.time.start) >= nowMs,
      )
    : plans;
  const next = upcoming[0];
  const later = upcoming.filter((item) => item !== next && item.time.mode === "timed").slice(0, 3);
  const parts = next ? eventStartParts(next, timeZone) : undefined;
  const duration = next ? eventDuration(next) : null;

  return (
    <Card
      title={isToday ? "Up next" : "First event"}
      icon={CalendarCheck}
      className="up-next-card"
      actions={
        <a className="text-link" href="#schedule">
          Full schedule
        </a>
      }
    >
      {next && parts ? (
        <div className="up-next">
          <p className="up-next-time">
            <time dateTime={next.time.mode === "timed" ? next.time.start : undefined}>
              {parts.clock}
              <span className="up-next-period">{parts.meridiem}</span>
            </time>
          </p>
          <div className="up-next-details">
            <SourceBadge zone={next.zone} label={next.sourceLabel} />
            <h3 className="up-next-title">{next.title}</h3>
            <ul className="up-next-facts">
              <li>
                <MapPin size={16} aria-hidden="true" />
                {next.locationLabel ?? "No location"}
              </li>
              {duration && (
                <li>
                  <Clock size={16} aria-hidden="true" />
                  {duration}
                </li>
              )}
            </ul>
            {next.departure && (
              <p className="leave-by">
                <Navigation size={16} aria-hidden="true" />
                Leave by {clockLabel(next.departure.leaveAt, timeZone)}: about{" "}
                {next.departure.travelMinutes} minutes&rsquo; drive in typical traffic
              </p>
            )}
          </div>
        </div>
      ) : null}
      {next && later.length > 0 && (
        <div className="list-group up-next-later">
          <h3 className="list-group-title">Later {isToday ? "today" : "that day"}</h3>
          <ul className="schedule-compact">
            {later.map((item) => (
              <li key={item.id}>
                <time dateTime={item.time.mode === "timed" ? item.time.start : undefined}>
                  {item.time.mode === "timed" ? clockLabel(item.time.start, timeZone) : "All day"}
                </time>
                <span className="compact-title">{item.title}</span>
                {item.departure && (
                  <span className="compact-meta">Leave {clockLabel(item.departure.leaveAt, timeZone)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {next ? null : (
        <EmptyState
          icon={CalendarCheck}
          title={isToday && plans.length > 0 ? "That’s everything for today" : "Your calendar is clear"}
        >
          {isToday ? "No more events are scheduled today." : "Nothing is scheduled on this day."}
        </EmptyState>
      )}
    </Card>
  );
}
