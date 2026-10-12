"use client";

import { CalendarDays, CalendarRange, MapPin, Navigation, Umbrella } from "lucide-react";
import { useState } from "react";

import { Badge, CalendarNotice, Card, EmptyState, SourceBadge, WeatherGlyph } from "@/components/ui";
import type { CalendarItem, HourlyWeatherPoint } from "@/lib/briefing-types";
import {
  clockLabel,
  eventEndMs,
  eventForecast,
  eventStartMs,
  eventStartParts,
  plural,
  timeRange,
} from "@/lib/format";

/**
 * The day's calendar. Wide screens get a timeline: blocks sized by time,
 * overlapping events in separate lanes, and the selected block's full
 * details below it, so nothing is lost to truncation. Narrow screens (and
 * high zoom, since the breakpoint is in em) get a chronological agenda.
 * Both are rendered; CSS shows one, and the hidden one is display:none, so
 * assistive technology meets only one copy.
 */

function localHour(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return value("hour") + value("minute") / 60;
}

/**
 * Narrowest a block is drawn, as a share of the timeline, so a 15-minute
 * meeting still shows its time and the start of its title.
 */
const MIN_BLOCK_PERCENT = 9;

interface Placed {
  item: CalendarItem;
  left: number;
  width: number;
  lane: number;
}

/**
 * Greedy lane assignment on the blocks as drawn, not as scheduled: a short
 * meeting widened to MIN_BLOCK_PERCENT can cover the next one, so it moves
 * to another lane instead of hiding it.
 */
function placeBlocks(
  events: CalendarItem[],
  position: (instant: number) => number,
): Placed[] {
  const laneEnds: number[] = [];
  return events.map((item) => {
    const start = position(eventStartMs(item));
    // An event ending at midnight reads as 0:00; run it to the edge.
    const rawEnd = position(eventEndMs(item));
    const end = rawEnd <= start ? 100 : rawEnd;
    const width = Math.max(end - start, MIN_BLOCK_PERCENT);
    const left = Math.min(start, 100 - width);
    let lane = laneEnds.findIndex((laneEnd) => laneEnd <= left + 0.01);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = left + width;
    return { item, left, width, lane };
  });
}

function describe(
  item: CalendarItem,
  timeZone: string,
  forecast: HourlyWeatherPoint | null,
  isPast: boolean,
): string {
  return [
    timeRange(item, timeZone),
    item.title,
    item.hold ? "placeholder hold" : undefined,
    item.locationLabel,
    item.departure ? `leave by ${clockLabel(item.departure.leaveAt, timeZone)}` : undefined,
    forecast ? `${forecast.condition}, ${forecast.temperature} degrees, ${forecast.precipitationChance}% chance of rain` : undefined,
    isPast ? "finished" : undefined,
  ]
    .filter(Boolean)
    .join(", ");
}

function EventDetails({
  item,
  forecast,
  timeZone,
}: {
  item: CalendarItem;
  forecast: HourlyWeatherPoint | null;
  timeZone: string;
}) {
  return (
    <>
      <div className="event-context">
        <SourceBadge zone={item.zone} label={item.sourceLabel} />
        {item.hold && <Badge>Hold</Badge>}
        {item.status === "tentative" && <Badge tone="info">Tentative</Badge>}
      </div>
      <h3 className="event-title">{item.title}</h3>
      <p className="event-time">{timeRange(item, timeZone)}</p>
      {item.locationLabel && (
        <p className="event-fact">
          <MapPin size={15} aria-hidden="true" /> {item.locationLabel}
        </p>
      )}
      {item.departure && (
        <p className="event-fact leave-by">
          <Navigation size={15} aria-hidden="true" /> Leave by{" "}
          {clockLabel(item.departure.leaveAt, timeZone)} ({item.departure.travelMinutes} min drive)
        </p>
      )}
      {forecast && (
        <p className={`event-fact ${forecast.precipitationChance >= 50 ? "event-wet" : ""}`}>
          <WeatherGlyph condition={forecast.condition} size={15} /> {forecast.condition},{" "}
          {forecast.temperature}° <Umbrella size={14} aria-hidden="true" /> {forecast.precipitationChance}%
          <span className="visually-hidden"> chance of rain</span>
        </p>
      )}
    </>
  );
}

export function ScheduleCard({
  agenda,
  hourly,
  isToday,
  nowMs,
  timeZone,
  missingCalendars = [],
}: {
  /** Calendars that failed to load, e.g. ["work"]. */
  missingCalendars?: string[];
  agenda: CalendarItem[];
  hourly: HourlyWeatherPoint[];
  isToday: boolean;
  nowMs: number;
  timeZone: string;
}) {
  const visible = agenda.filter((item) => item.status !== "cancelled");
  const allDay = visible.filter((item) => item.time.mode === "all-day");
  const timed = visible
    .filter((item) => item.time.mode === "timed")
    .sort((a, b) => eventStartMs(a) - eventStartMs(b));
  const nextUp = timed.find((item) => eventEndMs(item) >= nowMs && !item.hold) ?? timed[0];
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const selected = timed.find((item) => item.id === selectedId) ?? nextUp;

  // Holds ("Check with me before scheduling") are shaded behind the day
  // rather than drawn as events, and do not stretch the hours shown.
  const plans = timed.filter((item) => !item.hold);
  const holds = timed.filter((item) => item.hold);
  const sized = plans.length ? plans : timed;
  // Window: 8 AM–6 PM at least, widened to fit every planned event.
  const startHour = Math.min(8, ...sized.map((item) => Math.floor(localHour(eventStartMs(item), timeZone))));
  const endHour = Math.max(
    18,
    ...sized.map((item) => {
      const end = localHour(eventEndMs(item), timeZone);
      // An event ending at midnight reads as hour 0.
      return end === 0 ? 24 : Math.ceil(end);
    }),
  );
  const span = Math.max(1, endHour - startHour);
  const position = (instant: number) =>
    Math.min(100, Math.max(0, ((localHour(instant, timeZone) - startHour) / span) * 100));
  const laid = placeBlocks(plans, position);
  const lanes = Math.max(1, ...laid.map(({ lane }) => lane + 1));
  const showNow = isToday && localHour(nowMs, timeZone) >= startHour && localHour(nowMs, timeZone) <= endHour;
  const hours = Array.from({ length: Math.floor(span / 2) + 1 }, (_, index) => startHour + index * 2);
  const hourText = (hour: number) =>
    hour === 0 || hour === 24 ? "12 AM" : hour === 12 ? "12 PM" : hour < 12 ? `${hour} AM` : `${hour - 12} PM`;
  const nowLabel = clockLabel(new Date(nowMs).toISOString(), timeZone);

  return (
    <Card
      title={isToday ? "Today’s schedule" : "Schedule"}
      icon={CalendarRange}
      className="schedule-card"
      id="schedule"
      meta={visible.length ? plural(visible.length, "event") : undefined}
    >
      <CalendarNotice missing={missingCalendars} />
      {visible.length === 0 ? (
        <EmptyState icon={CalendarDays} title={isToday ? "Nothing on the calendar today" : "Nothing on the calendar"}>
          The hourly forecast is in the weather card.
        </EmptyState>
      ) : (
        <>
          {allDay.length > 0 && (
            <ul className="all-day" aria-label="All-day events">
              {allDay.map((item) => (
                <li key={item.id}>
                  <Badge>All day</Badge> {item.title}
                </li>
              ))}
            </ul>
          )}

          {timed.length > 0 && (
            <div className="timeline-view">
              <div className="timeline" style={{ ["--lanes" as string]: lanes }}>
                <div className="timeline-axis" aria-hidden="true">
                  {hours.map((hour) => (
                    <span key={hour} style={{ left: `${((hour - startHour) / span) * 100}%` }}>
                      {hourText(hour)}
                    </span>
                  ))}
                </div>
                {holds.map((item) => {
                  const start = position(eventStartMs(item));
                  const rawEnd = position(eventEndMs(item));
                  const end = rawEnd <= start ? 100 : rawEnd;
                  return end > start ? (
                    <div
                      key={item.id}
                      className="timeline-hold"
                      style={{ left: `${start}%`, width: `${end - start}%` }}
                      aria-hidden="true"
                    >
                      <span>Hold</span>
                    </div>
                  ) : null;
                })}
                <ul className="timeline-track" aria-label="Timed events; choose one to see its details">
                  {laid.map(({ item, left, width, lane }) => {
                    const isPast = isToday && eventEndMs(item) < nowMs;
                    const forecast = eventForecast(item, hourly);
                    const isSelected = selected?.id === item.id;
                    return (
                      <li
                        key={item.id}
                        style={{
                          left: `${left}%`,
                          width: `${width}%`,
                          top: `calc(${lane} * var(--lane-height))`,
                        }}
                      >
                        <button
                          type="button"
                          className={`timeline-block zone-${item.zone}${item.hold ? " is-hold" : ""}${isPast ? " is-past" : ""}`}
                          aria-pressed={isSelected}
                          aria-label={describe(item, timeZone, forecast, isPast)}
                          onClick={() => setSelectedId(item.id)}
                        >
                          <span className="timeline-time" aria-hidden="true">
                            {eventStartParts(item, timeZone).clock}
                          </span>
                          <span className="timeline-title" aria-hidden="true">
                            {item.title}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {showNow && (
                  <div
                    className={`timeline-now${position(nowMs) > 75 ? " is-late" : ""}`}
                    style={{ left: `${position(nowMs)}%` }}
                  >
                    <span>Now, {nowLabel}</span>
                  </div>
                )}
              </div>
              {holds.length > 0 && (
                <p className="timeline-holds">
                  <Badge>Hold</Badge>{" "}
                  {holds.map((item) => `${timeRange(item, timeZone)}: ${item.title}`).join("; ")}
                </p>
              )}
              {selected && (
                <div className="timeline-details" aria-live="polite">
                  <EventDetails
                    item={selected}
                    forecast={eventForecast(selected, hourly)}
                    timeZone={timeZone}
                  />
                </div>
              )}
            </div>
          )}

          <ol className="agenda-view" aria-label="Events in order">
            {timed.map((item) => {
              const isPast = isToday && eventEndMs(item) < nowMs;
              const parts = eventStartParts(item, timeZone);
              return (
                <li
                  key={item.id}
                  className={`agenda-item zone-${item.zone}${item.hold ? " is-hold" : ""}${isPast ? " is-past" : ""}`}
                >
                  <p className="agenda-time">
                    <time dateTime={item.time.mode === "timed" ? item.time.start : undefined}>
                      {parts.clock} <span>{parts.meridiem}</span>
                    </time>
                    {isPast && <span className="agenda-past">Finished</span>}
                  </p>
                  <div className="agenda-copy">
                    <EventDetails item={item} forecast={eventForecast(item, hourly)} timeZone={timeZone} />
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </Card>
  );
}
