"use client";

import { CalendarDays, ListChecks, MapPin, Moon, Umbrella } from "lucide-react";

import { BriefBody } from "@/components/plan-ahead";
import type { BriefingPayload, CalendarItem, DailyBrief, ReminderItem } from "@/lib/briefing-types";
import { shiftDateKey } from "@/lib/briefing-window";
import { dueLabel } from "@/lib/priorities";

/** Holds ("Check with me before scheduling") are placeholders, not plans. */
function firstEvent(agenda: CalendarItem[]): CalendarItem | undefined {
  const plans = agenda.filter((item) => item.status !== "cancelled" && !item.hold);
  return plans.find((item) => item.time.mode === "timed") ?? plans[0];
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

function dueDateKey(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(Date.parse(iso));
}

/**
 * The evening view's one look-ahead card: Claude's summary of tomorrow when
 * there is one (otherwise tomorrow's first event), tomorrow's weather, and
 * the reminders due by the end of tomorrow that are still open.
 */
export function TomorrowCard({
  tomorrow,
  brief,
  reminders,
  today,
  timeZone,
}: {
  /** Undefined while tomorrow's file is still loading. */
  tomorrow?: BriefingPayload;
  /** The evening summary, when one was written. */
  brief?: DailyBrief;
  /** Open reminders, already without ones ticked off or snoozed. */
  reminders: ReminderItem[];
  today: string;
  timeZone: string;
}) {
  const briefing = tomorrow?.briefing;
  const event = briefing ? firstEvent(briefing.agenda) : undefined;
  const planCount =
    briefing?.agenda.filter((item) => item.status !== "cancelled" && !item.hold).length ?? 0;
  const weather = briefing?.weather;
  const peakRain = briefing?.hourlyWeather.reduce(
    (peak, point) => Math.max(peak, point.precipitationChance),
    0,
  );
  const endOfTomorrow = shiftDateKey(today, 1);
  const due = reminders
    .filter((item) => item.dueAt && dueDateKey(item.dueAt, timeZone) <= endOfTomorrow)
    .sort((a, b) => Date.parse(a.dueAt!) - Date.parse(b.dueAt!));

  return (
    <section className="card tomorrow-card" aria-labelledby="tomorrow-title">
      <div className="section-heading">
        <h2 id="tomorrow-title">
          <Moon size={16} aria-hidden="true" /> Tomorrow at a glance
        </h2>
      </div>
      {brief && <BriefBody brief={brief} />}
      {!briefing ? (
        <p className="tomorrow-loading">Loading tomorrow…</p>
      ) : (
        <div className="tomorrow-grid">
          {!brief && (
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
                      {planCount > 1 && ` · ${planCount} events in all`}
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
          )}
          {weather && (
            <div className="tomorrow-item">
              <Umbrella size={18} aria-hidden="true" />
              <div>
                <small>Weather</small>
                <strong>
                  {weather.condition}, {weather.high}° / {weather.low}°
                </strong>
                <span>{peakRain ?? weather.precipitationChance ?? 0}% chance of rain at most</span>
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
              <small>Reminders due</small>
              {due.length === 0 ? (
                <strong>Nothing due by tomorrow</strong>
              ) : (
                <ul className="tomorrow-reminders">
                  {due.map((item) => (
                    <li key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{dueLabel(item, today, timeZone)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
