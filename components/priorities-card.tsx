"use client";

import { Check, CornerDownRight, Plus, Target, X } from "lucide-react";
import { useId, useState, type FormEvent } from "react";

import { Badge, Card, type Tone } from "@/components/ui";
import type { PriorityEntry } from "@/lib/priorities";

const reasonTone: Record<PriorityEntry["reason"], Tone> = {
  Pinned: "accent",
  "Your priority": "accent",
  Overdue: "danger",
  "Due today": "warning",
  "Coming up": "neutral",
};

/**
 * "Top 3 today", or "Carry forward" in the evening: pinned reminders and
 * priorities typed in by hand, then whatever is overdue or due soonest; see
 * lib/priorities.ts. Compact when there is nothing to show.
 */
export function PrioritiesCard({
  title,
  entries,
  onComplete,
  onRemoveCustom,
  onAddCustom,
}: {
  title: string;
  entries: PriorityEntry[];
  onComplete: (id: string) => void;
  onRemoveCustom: (id: string) => void;
  onAddCustom: (title: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  const inputId = useId();
  const errorId = useId();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) {
      setError("Type a priority first, for example “Call the plumber”.");
      return;
    }
    onAddCustom(draft.trim());
    setDraft("");
    setError(null);
    setAdding(false);
  }

  return (
    <Card
      title={title}
      icon={title === "Carry forward" ? CornerDownRight : Target}
      className={`priorities-card${entries.length === 0 ? " is-compact" : ""}`}
      meta={entries.length === 0 ? "Nothing pending. You’re caught up." : undefined}
      actions={
        <button
          type="button"
          className="button button-secondary"
          aria-expanded={adding}
          aria-controls={formId}
          onClick={() => setAdding((value) => !value)}
        >
          <Plus size={17} aria-hidden="true" /> Add<span className="hide-narrow"> priority</span>
          <span className="visually-hidden show-narrow-sr"> priority</span>
        </button>
      }
      help={
        <p>
          Pinned reminders and priorities you add come first, then overdue reminders, then those
          due soonest. Everything here is kept on this device. Marking a reminder done can be
          undone from the Reminders card.
        </p>
      }
    >
      <form className="priority-form" id={formId} hidden={!adding} onSubmit={submit} noValidate>
        <label htmlFor={inputId}>Your priority</label>
        <div className="field-row">
          <input
            id={inputId}
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={120}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          />
          <button type="submit" className="button button-primary">
            Add
          </button>
        </div>
        {error && (
          <p className="field-error" id={errorId} role="alert">
            {error}
          </p>
        )}
      </form>
      {entries.length > 0 && (
        <ol className="priority-list">
          {entries.map((entry, index) => (
            <li key={entry.id}>
              <span className="priority-rank" aria-hidden="true">
                {index + 1}
              </span>
              <div className="priority-copy">
                <p className="priority-title">{entry.title}</p>
                <p className="priority-detail">
                  <Badge tone={reasonTone[entry.reason]}>{entry.reason}</Badge> {entry.detail}
                </p>
              </div>
              {entry.source === "reminder" ? (
                <button type="button" className="icon-button" onClick={() => onComplete(entry.id)}>
                  <Check size={18} aria-hidden="true" />
                  <span className="visually-hidden">Mark {entry.title} done on this device</span>
                </button>
              ) : (
                <button type="button" className="icon-button" onClick={() => onRemoveCustom(entry.id)}>
                  <X size={18} aria-hidden="true" />
                  <span className="visually-hidden">Remove {entry.title}</span>
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
