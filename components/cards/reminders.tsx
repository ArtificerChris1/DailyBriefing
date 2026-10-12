"use client";

import { AlarmClock, Bell, Check, ListChecks, Pin, PinOff } from "lucide-react";
import { useId, useState } from "react";

import { Badge, Card, EmptyState, ShowMore } from "@/components/ui";
import type { ReminderItem } from "@/lib/briefing-types";
import { plural } from "@/lib/format";
import { dueLabel, groupReminders } from "@/lib/priorities";

/** Reminders listed before "Show all". */
const PREVIEW = 6;

/**
 * Apple Reminders from the last Shortcut snapshot, grouped by when they are
 * due. Ticks, pins and snoozes are kept on this device only: the site cannot
 * write back to Reminders.
 */
export function RemindersCard({
  reminders,
  completed,
  pinned,
  today,
  timeZone,
  onToggleComplete,
  onTogglePin,
  onSnooze,
}: {
  /** Reminders not snoozed on this device. */
  reminders: ReminderItem[];
  completed: string[];
  pinned: string[];
  today: string;
  timeZone: string;
  onToggleComplete: (id: string) => void;
  onTogglePin: (id: string) => void;
  onSnooze: (item: ReminderItem) => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const groups = groupReminders(reminders, today, timeZone);
  const ordered = [
    { id: "overdue", title: "Overdue, carried over", items: groups.overdue },
    { id: "today", title: "Due today", items: groups.today },
    { id: "upcoming", title: "Upcoming", items: groups.upcoming },
    { id: "undated", title: "No due date", items: groups.undated },
  ].filter((group) => group.items.length > 0);
  const open = reminders.filter((item) => !completed.includes(item.id)).length;

  // Cap the total shown across groups, keeping their order.
  let budget = showAll ? Number.POSITIVE_INFINITY : PREVIEW;
  const shownGroups = ordered
    .map((group) => {
      const items = group.items.slice(0, Math.max(0, budget));
      budget -= items.length;
      return { ...group, items };
    })
    .filter((group) => group.items.length > 0);

  return (
    <Card
      title="Reminders"
      icon={ListChecks}
      className="reminders-card"
      meta={open ? `${plural(open, "open reminder")}` : "All done"}
      help={
        <p>
          These come from Apple Reminders each time the iPhone Shortcut runs. Ticking one off,
          pinning it to the top three, or snoozing it until tomorrow is remembered on this device
          only; Apple Reminders itself is not changed. Untick to undo.
        </p>
      }
    >
      {reminders.length === 0 ? (
        <EmptyState icon={Bell} title="Nothing open in Apple Reminders" />
      ) : (
        <>
          <div id={listId}>
            {shownGroups.map((group) => (
              <div className="list-group" key={group.id}>
                <h3 className="list-group-title">{group.title}</h3>
                <ul className="reminder-list">
                  {group.items.map((item) => {
                    const isComplete = completed.includes(item.id);
                    const isPinned = pinned.includes(item.id);
                    return (
                      <li className={`reminder${isComplete ? " is-complete" : ""}`} key={item.id}>
                        <label className="reminder-check">
                          <input
                            type="checkbox"
                            checked={isComplete}
                            onChange={() => onToggleComplete(item.id)}
                          />
                          <span className="checkmark" aria-hidden="true">
                            <Check size={16} />
                          </span>
                          <span className="reminder-copy">
                            <span className="reminder-title">{item.title}</span>
                            <span className="reminder-meta">
                              {group.id === "overdue" && !isComplete && <Badge tone="danger">Overdue</Badge>}
                              {isComplete && <Badge tone="accent">Done</Badge>}
                              {dueLabel(item, today, timeZone)}
                              {item.listLabel ? ` · ${item.listLabel}` : ""}
                            </span>
                          </span>
                        </label>
                        <span className="row-actions">
                          <button
                            type="button"
                            className="icon-button"
                            aria-pressed={isPinned}
                            onClick={() => onTogglePin(item.id)}
                          >
                            {isPinned ? <PinOff size={17} aria-hidden="true" /> : <Pin size={17} aria-hidden="true" />}
                            <span className="visually-hidden">Pin {item.title} to the top three</span>
                          </button>
                          {!isComplete && (
                            <button type="button" className="icon-button" onClick={() => onSnooze(item)}>
                              <AlarmClock size={17} aria-hidden="true" />
                              <span className="visually-hidden">Snooze {item.title} until tomorrow</span>
                            </button>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          {reminders.length > PREVIEW && (
            <div className="card-footer">
              <ShowMore
                expanded={showAll}
                onToggle={() => setShowAll((value) => !value)}
                moreLabel={`Show all ${reminders.length} reminders`}
                controls={listId}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
