"use client";

import { BookOpen, Clapperboard, Film, Sparkles, Tv } from "lucide-react";
import Image from "next/image";
import { useId, useState } from "react";

import { Badge, Card, EmptyState, ExternalLink, ShowMore, type Tone } from "@/components/ui";
import type { ReleaseItem, ReleaseMedium, UpcomingReleasesPanel } from "@/lib/briefing-types";
import { groupReleases } from "@/lib/briefing-view";
import { dateKeyParts } from "@/lib/format";

/** Releases per date group before "Show more". */
const PER_GROUP = 3;

const medium: Record<ReleaseMedium, { label: string; icon: typeof Film; tone: Tone }> = {
  movie: { label: "Film", icon: Film, tone: "info" },
  tv: { label: "TV", icon: Tv, tone: "accent" },
  comic: { label: "Comic", icon: Sparkles, tone: "warning" },
  book: { label: "Book", icon: BookOpen, tone: "neutral" },
};

/** Films, shows, comics and books, grouped by how soon they arrive. */
export function ReleasesCard({
  panel,
  date,
  isToday,
}: {
  panel: UpcomingReleasesPanel;
  date: string;
  isToday: boolean;
}) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const groups = groupReleases(panel.items, date);
  const ordered = [
    { id: "just-out", title: "Just out", items: groups.justOut },
    { id: "today", title: isToday ? "Out today" : "That day", items: groups.today },
    { id: "week", title: "Next 7 days", items: groups.nextWeek },
    { id: "later", title: "Later", items: groups.later },
  ];
  const hidden =
    groups.later.length +
    [groups.justOut, groups.today, groups.nextWeek].reduce(
      (total, items) => total + Math.max(0, items.length - PER_GROUP),
      0,
    );

  const row = (release: ReleaseItem) => {
    const kind = medium[release.medium];
    const Icon = kind.icon;
    const when = dateKeyParts(release.releasesOn);
    const detail =
      release.availability &&
      (release.detail === "Theatrical release" || release.detail === "Series premiere")
        ? undefined
        : release.detail;
    return (
      <li className="media-row" key={release.id}>
        <p className="date-chip" aria-hidden="true">
          <span>{when.month}</span>
          <span className="date-chip-day">{when.day}</span>
        </p>
        <span className={`thumb thumb-${release.medium}`}>
          {release.posterUrl ? (
            <Image src={release.posterUrl} alt="" width={36} height={52} unoptimized />
          ) : (
            <Icon size={18} aria-hidden="true" />
          )}
        </span>
        <div className="media-copy">
          <p className="media-title">
            <span className="visually-hidden">{`${when.month} ${when.day}: `}</span>
            {release.title}
          </p>
          {(detail || release.by) && (
            <p className="media-detail">{[detail, release.by].filter(Boolean).join(" · ")}</p>
          )}
          {release.availability && <p className="media-detail media-accent">{release.availability}</p>}
        </div>
        <Badge tone={kind.tone}>{kind.label}</Badge>
        {release.url && (
          <ExternalLink href={release.url} label={`Open ${release.title}`} />
        )}
      </li>
    );
  };

  return (
    <Card
      title="Upcoming releases"
      icon={Clapperboard}
      className="releases-card"
      meta={panel.attribution}
      help={
        <p>
          Science fiction and fantasy films and television from TMDB (The Movie Database), with
          where to watch them from JustWatch; book releases from Reactor; and comics that have
          just shipped, from Comic Vine.
        </p>
      }
    >
      {panel.message ? (
        <EmptyState icon={Clapperboard} title="No releases to show">
          {panel.message}
        </EmptyState>
      ) : (
        <>
          <div id={listId}>
            {ordered
              .filter((group) => group.items.length > 0 && (showAll || group.id !== "later"))
              .map((group) => (
                <div className="list-group" key={group.id}>
                  <h3 className="list-group-title">{group.title}</h3>
                  <ul className="media-list">
                    {(showAll ? group.items : group.items.slice(0, PER_GROUP)).map(row)}
                  </ul>
                </div>
              ))}
          </div>
          {panel.warnings.length > 0 && <p className="card-note">{panel.warnings.join(" ")}</p>}
          {hidden > 0 && (
            <div className="card-footer">
              <ShowMore
                expanded={showAll}
                onToggle={() => setShowAll((value) => !value)}
                moreLabel={`Show ${hidden} more releases`}
                controls={listId}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
