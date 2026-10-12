"use client";

import { Cake, Heart, PartyPopper } from "lucide-react";
import { useId, useState } from "react";

import { Badge, Card, EmptyState, ExternalLink, ShowMore } from "@/components/ui";
import type { BirthdaysPanel } from "@/lib/briefing-types";
import { relativeDayLabel } from "@/lib/format";

const PREVIEW = 6;

/** Birthdays and anniversaries from three days back to a week ahead. */
export function BirthdaysCard({ panel, dayOffset }: { panel: BirthdaysPanel; dayOffset: number }) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  // Upcoming first: the ones still worth acting on lead.
  const items = [...panel.items].sort((a, b) => {
    const left = dayOffset + a.offset;
    const right = dayOffset + b.offset;
    if ((left >= 0) !== (right >= 0)) return left >= 0 ? -1 : 1;
    return Math.abs(left) - Math.abs(right);
  });
  const shown = showAll ? items : items.slice(0, PREVIEW);
  const today = items.filter((person) => dayOffset + person.offset === 0 && !person.inMemoriam).length;

  return (
    <Card
      title="Birthdays & anniversaries"
      icon={PartyPopper}
      className="birthdays-card"
      meta={today ? `${today} today` : `${items.length} nearby`}
    >
      {items.length === 0 ? (
        <EmptyState icon={Cake} title="None nearby">
          Nothing from the last three days or the coming week.
        </EmptyState>
      ) : (
        <>
          <ul className="people-list" id={listId}>
            {shown.map((person) => {
              const offset = dayOffset + person.offset;
              const Icon = person.kind === "anniversary" ? Heart : Cake;
              return (
                <li key={person.id} className={offset === 0 ? "is-today" : undefined}>
                  <p className="when">
                    <span className="when-relative">{relativeDayLabel(offset)}</span>
                    <span className="when-date">{person.dateLabel}</span>
                  </p>
                  <Icon size={16} aria-hidden="true" className="people-icon" />
                  <div className="media-copy">
                    <p className="media-title">
                      {person.name}
                      <span className="visually-hidden">
                        {person.kind === "anniversary" ? ", anniversary" : ", birthday"}
                      </span>
                    </p>
                    {(person.detail || person.note) && (
                      <p className="media-detail">{[person.detail, person.note].filter(Boolean).join(" · ")}</p>
                    )}
                  </div>
                  {offset === 0 && !person.inMemoriam && <Badge tone="accent">Today</Badge>}
                  {person.profileUrl && (
                    <ExternalLink href={person.profileUrl} label={`Open ${person.name} on Facebook`} />
                  )}
                </li>
              );
            })}
          </ul>
          {items.length > PREVIEW && (
            <div className="card-footer">
              <ShowMore
                expanded={showAll}
                onToggle={() => setShowAll((value) => !value)}
                moreLabel={`Show all ${items.length}`}
                controls={listId}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
