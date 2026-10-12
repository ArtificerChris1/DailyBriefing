"use client";

import { CalendarDays, ListChecks, MapPin, Moon, Umbrella } from "lucide-react";

import type { BriefingPayload, CalendarItem } from "@/lib/briefing-types";

function firstEvent(agenda: CalendarItem[]): CalendarItem | undefined {
  return agenda.find((item) => item.status !== "cancelled" && item.time.mode === "timed")
    ?? agenda.find((item) => item.status !== "cancelled");
}

function clockLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(Date.parse(iso));
}

function startLabel(item: CalendarItem, timeZone: string): string {
  return item.time.mode === "all-day" ? "All day" : clockLabel(item.time.start, timeZone);
}

/**
 * Evening view: what tomorrow holds, so the night before is spent preparing
 * rather than rereading a day that is already over.
 */
export function TomorrowCard({
  tomorrow,
  openReminders,
  timeZone,
}: {
  /** Undefined while tomorrow's file is still loading. */
  tomorrow?: BriefingPayload;
  openReminders: number;
  timeZone: string;
}) {
  const briefing = tomorrow?.briefing;
  const event = briefing ? firstEvent(briefing.agenda) : undefined;
  const timedCount = briefing?.agenda.filter((item) => item.status !== "cancelled").length ?? 0;
  const weather = briefing?.weather;
  const peakRain = briefing?.hourlyWeather.reduce(
    (peak, point) => Math.max(peak, point.precipitationChance),
    0,
  );

  return (
    <section className="card tomorrow-card" aria-labelledby="tomorrow-title">
      <div className="section-heading">
        <h2 id="tomorrow-title">
          <Moon size={16} aria-hidden="true" /> Prepare for tomorrow
        </h2>
      </div>
      {!briefing ? (
        <p className="tomorrow-loading">Loading tomorrow…</p>
      ) : (
        <div className="tomorrow-grid">
          <div className="tomorrow-item">
            <CalendarDays size={18} aria-hidden="true" />
            <div>
              <small>First event</small>
              {event ? (
                <>
                  <strong>
                    {startLabel(event, timeZone)} · {event.title}
                  </strong>
                  <span>
                    {event.locationLabel ? (
                      <>
                        <MapPin size={12} aria-hidden="true" /> {event.locationLabel}
                      </>
                    ) : (
                      "No location"
                    )}
                    {timedCount > 1 && ` · ${timedCount} events in all`}
                  </span>
                  {event.departure && (
                    <span className="leave-by">
                      Leave by {clockLabel(event.departure.leaveAt, timeZone)} ({event.departure.travelMinutes} min drive)
                    </span>
                  )}
                </>
              ) : (
                <strong>Nothing scheduled</strong>
              )}
            </div>
          </div>
          {weather && (
            <div className="tomorrow-item">
              <Umbrella size={18} aria-hidden="true" />
              <div>
                <small>Weather</small>
                <strong>
                  {weather.condition}, {weather.high}° / {weather.low}°
                </strong>
                <span>
                  {peakRain ?? weather.precipitationChance ?? 0}% chance of rain at most
                </span>
                {briefing.outdoorWindow && (
                  <span>
                    Best outside: {clockLabel(briefing.outdoorWindow.from, timeZone)}–
                    {clockLabel(briefing.outdoorWindow.to, timeZone)}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="tomorrow-item">
            <ListChecks size={18} aria-hidden="true" />
            <div>
              <small>Still open</small>
              <strong>
                {openReminders === 0
                  ? "No open reminders"
                  : `${openReminders} reminder${openReminders === 1 ? "" : "s"} to carry over`}
              </strong>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
