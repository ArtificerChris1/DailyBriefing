"use client";

import { Eye, EyeOff, Trophy } from "lucide-react";
import Image from "next/image";
import { useId, useState } from "react";

import { Badge, Card, ShowMore } from "@/components/ui";
import type { SportsItem } from "@/lib/briefing-types";
import { compactGameTime, groupSports } from "@/lib/briefing-view";

/** Upcoming games shown before "Show more". */
const UPCOMING_PREVIEW = 4;

/** League abbreviations spelled out for screen readers and help text (WCAG 3.1.4). */
const LEAGUES: Record<string, string> = {
  NBA: "National Basketball Association",
  NFL: "National Football League",
  NHL: "National Hockey League",
  MLB: "Major League Baseball",
  MLS: "Major League Soccer",
  WNBA: "Women's National Basketball Association",
  USL: "United Soccer League",
};

function stateBadge(game: SportsItem) {
  if (game.state === "live") return <Badge tone="warning">Live</Badge>;
  if (game.state === "final") return <Badge>Final</Badge>;
  return <Badge tone="info">Upcoming</Badge>;
}

/** Yesterday's games, then the day being viewed, then a compact schedule. */
export function SportsCard({
  sports,
  date,
  isToday,
  hideScores,
  onToggleScores,
  timeZone,
}: {
  sports: SportsItem[];
  date: string;
  isToday: boolean;
  hideScores: boolean;
  onToggleScores: () => void;
  timeZone: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const groups = groupSports(sports, date, timeZone);
  const upcoming = showAll ? groups.upcoming : groups.upcoming.slice(0, UPCOMING_PREVIEW);
  const meta = [
    groups.yesterday.length ? `${groups.yesterday.length} ${isToday ? "yesterday" : "the day before"}` : undefined,
    groups.today.length ? `${groups.today.length} ${isToday ? "today" : "that day"}` : undefined,
    groups.upcoming.length ? `${groups.upcoming.length} coming up` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");

  const row = (game: SportsItem) => (
    <li className="game" key={game.id}>
      <Image className="team-logo" src={game.logoPath} alt="" width={36} height={36} />
      <div className="game-copy">
        <p className="game-title">{game.title}</p>
        <p className="game-detail">
          {(game.state === "final"
            ? [hideScores ? "Score hidden" : game.scoreLabel, game.startsAt]
            : [game.startsAt, game.broadcast]
          )
            .filter(Boolean)
            .join(" · ")}
        </p>
        {/* A final's context is its recap, which gives the score away. */}
        {game.context && !(hideScores && game.state === "final") && (
          <p className="game-detail">{game.context}</p>
        )}
        {game.standingLabel && <p className="game-detail">{game.standingLabel}</p>}
      </div>
      <span className="game-badges">
        {stateBadge(game)}
        {LEAGUES[game.league] ? (
          <abbr className="badge badge-neutral" title={LEAGUES[game.league]}>
            {game.league}
            <span className="visually-hidden"> ({LEAGUES[game.league]})</span>
          </abbr>
        ) : (
          game.league && <Badge>{game.league}</Badge>
        )}
      </span>
    </li>
  );

  return (
    <Card
      title="Sports watch"
      icon={Trophy}
      className="sports-card"
      meta={meta || undefined}
      actions={
        <button type="button" className="icon-button" aria-pressed={hideScores} onClick={onToggleScores}>
          {hideScores ? <Eye size={18} aria-hidden="true" /> : <EyeOff size={18} aria-hidden="true" />}
          <span className="visually-hidden">Hide scores</span>
        </button>
      }
      help={
        <p>
          Every tracked team that played the day before comes first, with a recap and any playoff
          series standing, then games on this day, then the next few on the schedule. Use the eye
          button to hide final scores until you are ready to see them.
        </p>
      }
    >
      {[
        { id: "yesterday", title: isToday ? "Yesterday" : "The day before", games: groups.yesterday },
        { id: "today", title: isToday ? "Today" : "That day", games: groups.today },
      ]
        .filter((group) => group.games.length > 0)
        .map((group) => (
          <div className="list-group" key={group.id}>
            <h3 className="list-group-title">{group.title}</h3>
            <ul className="game-list">{group.games.map(row)}</ul>
          </div>
        ))}
      {groups.upcoming.length > 0 && (
        <div className="list-group">
          <h3 className="list-group-title">Coming up</h3>
          <ul className="schedule-compact" id={listId}>
            {upcoming.map((game) => (
              <li key={game.id}>
                <Image src={game.logoPath} alt="" width={24} height={24} />
                <span className="compact-title">{game.title}</span>
                <time dateTime={game.occursAt}>{compactGameTime(game, timeZone)}</time>
              </li>
            ))}
          </ul>
        </div>
      )}
      {groups.upcoming.length > UPCOMING_PREVIEW && (
        <div className="card-footer">
          <ShowMore
            expanded={showAll}
            onToggle={() => setShowAll((value) => !value)}
            moreLabel={`Show ${groups.upcoming.length - UPCOMING_PREVIEW} more games`}
            lessLabel="Show fewer games"
            controls={listId}
          />
        </div>
      )}
    </Card>
  );
}
