"use client";

import {
  AlertTriangle,
  CalendarClock,
  Check,
  CloudSun,
  Gift,
  Lightbulb,
  ListChecks,
  PartyPopper,
  Plus,
  Sparkles,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { DailyBrief, HeadsUpItem, OccasionItem, ReminderItem } from "@/lib/briefing-types";
import { HEADS_UP_PRIORITY } from "@/lib/heads-up";

/**
 * Today-only cards that look ahead: the AI summary, "things you might have
 * forgotten", and occasions to prepare for. Dismissals and "gift sorted"
 * marks are kept on the device, like reminder ticks.
 */

/** Name of the one-action Shortcut that adds its text input to Reminders. */
const ADD_REMINDER_SHORTCUT = "Add Briefing Reminder";
const HEADS_UP_LIMIT = 3;
/** Gift suggestions start this many days out and stop the day before. */
const GIFT_WINDOW = { from: 1, to: 14 };

const STORE_EVENT = "brief-stored-list";

/**
 * A string list in localStorage, applied after the first render to match the
 * static HTML. Cards sharing a key stay in step through STORE_EVENT.
 */
function useStoredList(key: string): [string[], (next: string[]) => void] {
  const [items, setItems] = useState<string[]>([]);
  useEffect(() => {
    function load() {
      try {
        const saved = JSON.parse(window.localStorage.getItem(key) ?? "[]");
        if (Array.isArray(saved)) setItems(saved.filter((item) => typeof item === "string"));
      } catch {
        window.localStorage.removeItem(key);
      }
    }
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
  function update(next: string[]) {
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

const briefIcon: Record<string, LucideIcon> = {
  "Coming up": CalendarClock,
  Reminders: ListChecks,
  Weather: CloudSun,
  "Heads-up": AlertTriangle,
  Occasions: Gift,
  Opportunity: Lightbulb,
  Sports: Trophy,
};

export function DailyBriefCard({ brief, viewMode }: { brief: DailyBrief; viewMode: "morning" | "evening" }) {
  return (
    <section className="card brief-card" aria-labelledby="brief-title">
      <div className="section-heading">
        <h2 id="brief-title">
          <Sparkles size={16} aria-hidden="true" />
          {brief.mode === "evening" ? "Tomorrow at a glance" : "Your day at a glance"}
        </h2>
        {brief.mode !== viewMode && (
          <span className="watch-count">
            Written for the {brief.mode} view
          </span>
        )}
      </div>
      <p className="brief-headline">{brief.headline}</p>
      {brief.points.length > 0 && (
        <ul className="brief-points">
          {brief.points.map((point, index) => {
            const Icon = briefIcon[point.label] ?? Sparkles;
            return (
              <li key={`${point.label}-${index}`}>
                <Icon size={16} aria-hidden="true" />
                <div>
                  <small>{point.label}</small>
                  <span>{point.text}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="brief-note">Written by Claude from the facts on this page. Check anything important.</p>
    </section>
  );
}

export function HeadsUpCard({
  items,
  occasions,
  reminders,
}: {
  items: HeadsUpItem[];
  occasions: OccasionItem[];
  reminders: ReminderItem[];
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

  return (
    <section className="card heads-up-card" aria-labelledby="heads-up-title">
      <div className="section-heading">
        <h2 id="heads-up-title">
          <Lightbulb size={16} aria-hidden="true" /> You might have forgotten
        </h2>
      </div>
      <ul className="heads-up-list">
        {shown.map((item) => (
          <li key={item.id}>
            <span className="suggestion-badge">Suggestion</span>
            <strong>{item.title}</strong>
            <span>{item.detail}</span>
            <div className="heads-up-actions">
              {item.reminderText && apple && (
                <a className="text-action" href={addReminderUrl(item.reminderText)}>
                  <Plus size={13} /> Add to Reminders
                </a>
              )}
              {item.kind === "gift" && (
                <button
                  type="button"
                  className="text-action"
                  onClick={() => setGiftsSorted([...giftsSorted, item.id.replace(/^gift-/, "")])}
                >
                  <Check size={13} /> Gift sorted
                </button>
              )}
              <button
                type="button"
                className="text-action"
                onClick={() => setDismissed([...dismissed, item.id])}
              >
                <X size={13} /> Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const occasionIcon: Record<OccasionItem["kind"], LucideIcon> = {
  birthday: Gift,
  anniversary: Gift,
  holiday: PartyPopper,
};

export function OccasionsCard({ occasions }: { occasions: OccasionItem[] }) {
  const [giftsSorted, setGiftsSorted] = useStoredList("brief-gifts-sorted");
  if (occasions.length === 0) return null;
  return (
    <section className="card occasions-card" aria-labelledby="occasions-title">
      <div className="section-heading">
        <h2 id="occasions-title">Occasions</h2>
        <span className="watch-count">Next 3 weeks</span>
      </div>
      <ul className="occasions-list">
        {occasions.map((occasion) => {
          const Icon = occasionIcon[occasion.kind];
          const sorted = giftsSorted.includes(occasion.id);
          return (
            <li key={occasion.id}>
              <span className="occasion-when">
                <strong>{occasion.offset === 0 ? "Today" : `${occasion.offset}d`}</strong>
                <small>{occasion.dateLabel}</small>
              </span>
              <span className="occasion-copy">
                <strong>
                  <Icon size={13} aria-hidden="true" /> {occasion.name}
                </strong>
                <small>
                  {[
                    occasion.kind === "holiday" ? "Holiday" : occasion.kind === "anniversary" ? "Anniversary" : "Birthday",
                    occasion.detail,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </small>
              </span>
              {occasion.giftable && (
                <button
                  type="button"
                  className={`gift-toggle ${sorted ? "gift-sorted" : ""}`}
                  aria-pressed={sorted}
                  onClick={() =>
                    setGiftsSorted(
                      sorted
                        ? giftsSorted.filter((id) => id !== occasion.id)
                        : [...giftsSorted, occasion.id],
                    )
                  }
                >
                  {sorted ? <Check size={13} /> : <Gift size={13} />}
                  {sorted ? "Sorted" : "Gift?"}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
