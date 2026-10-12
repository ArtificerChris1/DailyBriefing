"use client";

import { Check, Plus, Target, X } from "lucide-react";
import { useState, type FormEvent } from "react";

import type { PriorityEntry } from "@/lib/priorities";

/**
 * The day's top three. Filled from pinned reminders and the viewer's own
 * priorities first, then whatever is overdue or due soonest; see
 * lib/priorities.ts.
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

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim()) return;
    onAddCustom(draft.trim());
    setDraft("");
    setAdding(false);
  }

  return (
    <section className="card priorities-card" aria-labelledby="priorities-title">
      <div className="section-heading">
        <h2 id="priorities-title">
          <Target size={16} aria-hidden="true" /> {title}
        </h2>
        <button
          type="button"
          className="text-action"
          onClick={() => setAdding((value) => !value)}
          aria-expanded={adding}
        >
          <Plus size={14} /> Add
        </button>
      </div>
      {adding && (
        <form className="priority-form" onSubmit={submit}>
          <input
            type="text"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="What matters most today?"
            maxLength={120}
            autoFocus
          />
          <button type="submit" disabled={!draft.trim()}>
            Add
          </button>
        </form>
      )}
      {entries.length === 0 ? (
        <p className="priorities-empty">
          Nothing pressing. Pin a reminder or add your own priority.
        </p>
      ) : (
        <ol className="priorities-list">
          {entries.map((entry, index) => (
            <li key={entry.id}>
              <span className="priority-rank" aria-hidden="true">
                {index + 1}
              </span>
              <span className="priority-copy">
                <strong>{entry.title}</strong>
                <small>
                  <span className={`priority-reason priority-reason-${entry.reason.replace(/\s+/g, "-").toLowerCase()}`}>
                    {entry.reason}
                  </span>
                  {entry.detail}
                </small>
              </span>
              {entry.source === "reminder" ? (
                <button
                  type="button"
                  className="row-action"
                  onClick={() => onComplete(entry.id)}
                  aria-label={`Mark ${entry.title} done on this device`}
                  title="Done (on this device)"
                >
                  <Check size={16} />
                </button>
              ) : (
                <button
                  type="button"
                  className="row-action"
                  onClick={() => onRemoveCustom(entry.id)}
                  aria-label={`Remove ${entry.title}`}
                  title="Remove"
                >
                  <X size={16} />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
