"use client";

import { Check, Gift, Lightbulb, PartyPopper, Plus, X, type LucideIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { Badge, Card, EmptyState } from "@/components/ui";
import type { HeadsUpItem, OccasionItem, ReminderItem } from "@/lib/briefing-types";
import { HEADS_UP_PRIORITY } from "@/lib/heads-up";

/**
 * Today-only cards that look ahead: "you might have forgotten" and occasions
 * to prepare for. Dismissals and "gift sorted" marks are kept on the device,
 * like reminder ticks, and every change can be undone.
 */

/** Name of the one-action Shortcut that adds its text input to Reminders. */
const ADD_REMINDER_SHORTCUT = "Add Briefing Reminder";
const HEADS_UP_LIMIT = 3;
/** Gift suggestions start this many days out and stop the day before. */
const GIFT_WINDOW = { from: 1, to: 14 };

const STORE_EVENT = "brief-stored-list";

function readList(key: string): string[] {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(saved) ? saved.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/**
 * A string list in localStorage, applied after the first render to match the
 * static HTML. Cards sharing a key stay in step through STORE_EVENT. Updates
 * take a function of the stored list, so a later undo cannot clobber it.
 */
function useStoredList(key: string): [string[], (change: (current: string[]) => string[]) => void] {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    const load = () => setItems(readList(key));
    function onStored(event: Event) {
      if ((event as CustomEvent<string>).detail === key) load();
    }
    const timer = window.setTimeout(load, 0);
    window.addEventListener(STORE_EVENT, onStored);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(STORE_EVENT, onStored);
    };
  }, [key]);
  function update(change: (current: string[]) => string[]) {
    const next = change(readList(key));
    setItems(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new CustomEvent(STORE_EVENT, { detail: key }));
    } catch {
      // Storage refused; the change lasts until the page closes.
    }
  }
  return [items, update];
}

function useAppleDevice(): boolean {
  const [apple, setApple] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setApple(/iPhone|iPad|Macintosh/.test(window.navigator.userAgent)),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);
  return apple;
}

function addReminderUrl(text: string): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(ADD_REMINDER_SHORTCUT)}&input=text&text=${encodeURIComponent(text)}`;
}

export type Notify = (message: string, undo?: () => void) => void;

export function HeadsUpCard({
  items,
  occasions,
  reminders,
  onNotify,
}: {
  items: HeadsUpItem[];
  occasions: OccasionItem[];
  reminders: ReminderItem[];
  onNotify: Notify;
}) {
  const [dismissed, setDismissed] = useStoredList("brief-dismissed-heads-up");
  const [giftsSorted, setGiftsSorted] = useStoredList("brief-gifts-sorted");
  const apple = useAppleDevice();

  // A gift reminder is only suggested when nothing in Reminders already
  // mentions the person (or the holiday) by name.
  const reminderText = reminders.map((item) => item.title.toLowerCase()).join("\n");
  const giftItems: HeadsUpItem[] = occasions
    .filter(
      (occasion) =>
        occasion.giftable &&
        occasion.offset >= GIFT_WINDOW.from &&
        occasion.offset <= GIFT_WINDOW.to &&
        !giftsSorted.includes(occasion.id) &&
        !reminderText.includes(occasion.name.split(" ")[0].toLowerCase()),
    )
    .map((occasion) => ({
      id: `gift-${occasion.id}`,
      kind: "gift",
      title:
        occasion.kind === "holiday"
          ? `${occasion.name} in ${occasion.offset} day${occasion.offset === 1 ? "" : "s"}`
          : `${occasion.name}’s ${occasion.kind} in ${occasion.offset} day${occasion.offset === 1 ? "" : "s"}`,
      detail: "No gift or card is marked as sorted.",
      reminderText:
        occasion.kind === "holiday"
          ? `Gift or card for ${occasion.name}`
          : `Gift or card for ${occasion.name} (${occasion.dateLabel})`,
    }));

  const shown = [...items, ...giftItems]
    .filter((item) => !dismissed.includes(item.id))
    .sort((a, b) => HEADS_UP_PRIORITY[a.kind] - HEADS_UP_PRIORITY[b.kind])
    .slice(0, HEADS_UP_LIMIT);
  if (shown.length === 0) return null;

  function dismiss(item: HeadsUpItem) {
    setDismissed((current) => [...current, item.id]);
    onNotify(`Dismissed “${item.title}”.`, () =>
      setDismissed((current) => current.filter((id) => id !== item.id)),
    );
  }

  function markGiftSorted(item: HeadsUpItem) {
    const occasionId = item.id.replace(/^gift-/, "");
    setGiftsSorted((current) => [...current, occasionId]);
    onNotify("Marked the gift as sorted.", () =>
      setGiftsSorted((current) => current.filter((id) => id !== occasionId)),
    );
  }

  return (
    <Card
      title="You might have forgotten"
      icon={Lightbulb}
      className="heads-up-card"
      help={
        <p>
          Suggestions worked out from your calendar, weather and occasions: overlapping events, an
          early start, a missing location, rain during plans, or a gift not yet sorted. They are
          suggestions, not confirmed tasks. Dismissing one hides it on this device, and can be
          undone.
        </p>
      }
    >
      <ul className="suggestion-list">
        {shown.map((item) => (
          <li key={item.id}>
            <Badge tone="warning">Suggestion</Badge>
            <p className="suggestion-title">{item.title}</p>
            <p className="suggestion-detail">{item.detail}</p>
            <div className="suggestion-actions">
              {item.reminderText && apple && (
                <a className="button button-secondary" href={addReminderUrl(item.reminderText)}>
                  <Plus size={16} aria-hidden="true" /> Add to Reminders
                </a>
              )}
              {item.kind === "gift" && (
                <button type="button" className="button button-secondary" onClick={() => markGiftSorted(item)}>
                  <Check size={16} aria-hidden="true" /> Gift sorted
                </button>
              )}
              <button type="button" className="button button-ghost" onClick={() => dismiss(item)}>
                <X size={16} aria-hidden="true" /> Dismiss
                <span className="visually-hidden">: {item.title}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

const occasionIcon: Record<OccasionItem["kind"], LucideIcon> = {
  birthday: Gift,
  anniversary: Gift,
  holiday: PartyPopper,
};

export function OccasionsCard({ occasions }: { occasions: OccasionItem[] }) {
  const [giftsSorted, setGiftsSorted] = useStoredList("brief-gifts-sorted");
  return (
    <Card
      title="Occasions"
      icon={Gift}
      className="occasions-card"
      meta="Next three weeks"
      help={
        <p>
          Family birthdays and anniversaries, and holidays, coming up in the next three weeks.
          Mark a gift as sorted to stop the reminder suggestion; press again to undo.
        </p>
      }
    >
      {occasions.length === 0 ? (
        <EmptyState icon={Gift} title="Nothing in the next three weeks" />
      ) : (
        <ul className="occasion-list">
          {occasions.map((occasion) => {
            const Icon = occasionIcon[occasion.kind];
            const sorted = giftsSorted.includes(occasion.id);
            const kind =
              occasion.kind === "holiday" ? "Holiday" : occasion.kind === "anniversary" ? "Anniversary" : "Birthday";
            return (
              <li key={occasion.id}>
                <p className="when">
                  <span className="when-relative">
                    {occasion.offset === 0 ? "Today" : occasion.offset === 1 ? "Tomorrow" : `In ${occasion.offset} days`}
                  </span>
                  <span className="when-date">{occasion.dateLabel}</span>
                </p>
                <Icon size={16} aria-hidden="true" className="people-icon" />
                <div className="media-copy">
                  <p className="media-title">{occasion.name}</p>
                  <p className="media-detail">{[kind, occasion.detail].filter(Boolean).join(" · ")}</p>
                </div>
                {occasion.giftable && (
                  <button
                    type="button"
                    className={`button button-toggle${sorted ? " is-on" : ""}`}
                    aria-pressed={sorted}
                    onClick={() =>
                      setGiftsSorted((current) =>
                        sorted ? current.filter((id) => id !== occasion.id) : [...current, occasion.id],
                      )
                    }
                  >
                    {sorted ? <Check size={16} aria-hidden="true" /> : <Gift size={16} aria-hidden="true" />}
                    Gift sorted
                    <span className="visually-hidden"> for {occasion.name}</span>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
