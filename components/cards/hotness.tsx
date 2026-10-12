"use client";

import { ArrowDown, ArrowUp, Dice5, Flame, Minus } from "lucide-react";
import Image from "next/image";
import { useId, useState } from "react";

import { Badge, Card, EmptyState, ExternalLink, ShowMore } from "@/components/ui";
import type { HotGameItem, HotGamesPanel } from "@/lib/briefing-types";

const PREVIEW = 5;

/** Rank change since yesterday, in words as well as an arrow. */
function Movement({ game }: { game: HotGameItem }) {
  if (game.isNew) return <Badge tone="info">New</Badge>;
  if (!game.movement) {
    return (
      <span className="movement">
        <Minus size={14} aria-hidden="true" />
        <span className="visually-hidden">No change</span>
      </span>
    );
  }
  const up = game.movement > 0;
  const places = Math.abs(game.movement);
  return (
    <span className={`movement ${up ? "movement-up" : "movement-down"}`}>
      {up ? <ArrowUp size={14} aria-hidden="true" /> : <ArrowDown size={14} aria-hidden="true" />}
      {places}
      <span className="visually-hidden">
        {` ${places === 1 ? "place" : "places"} ${up ? "up" : "down"} since yesterday`}
      </span>
    </span>
  );
}

/** BoardGameGeek's "hotness" list, with movement since yesterday. */
export function HotnessCard({ panel }: { panel: HotGamesPanel }) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const games = showAll ? panel.items : panel.items.slice(0, PREVIEW);

  return (
    <Card
      title="BoardGameGeek hotness"
      icon={Flame}
      className="hotness-card"
      meta={panel.attribution}
      help={
        <p>
          The ten board games getting the most attention on BoardGameGeek (BGG) right now. Arrows
          show how many places a game moved since yesterday&rsquo;s list; &ldquo;New&rdquo; means
          it was not on it.
        </p>
      }
    >
      {panel.message ? (
        <EmptyState icon={Dice5} title="The hot list is unavailable">
          {panel.message}
        </EmptyState>
      ) : (
        <>
          <ol className="rank-list" id={listId}>
            {games.map((game) => (
              <li key={game.id}>
                <span className="rank" aria-hidden="true">
                  {game.rank}
                </span>
                <span className="thumb">
                  {game.thumbnailUrl ? (
                    <Image src={game.thumbnailUrl} alt="" width={40} height={40} unoptimized />
                  ) : (
                    <Dice5 size={18} aria-hidden="true" />
                  )}
                </span>
                <div className="media-copy">
                  <p className="media-title">
                    <span className="visually-hidden">{`Rank ${game.rank}: `}</span>
                    {game.name}
                  </p>
                  {game.yearPublished && <p className="media-detail">{game.yearPublished}</p>}
                </div>
                <Movement game={game} />
                <ExternalLink href={game.url} label={`Open ${game.name} on BoardGameGeek`} />
              </li>
            ))}
          </ol>
          {panel.items.length > PREVIEW && (
            <div className="card-footer">
              <ShowMore
                expanded={showAll}
                onToggle={() => setShowAll((value) => !value)}
                moreLabel={`Show all ${panel.items.length}`}
                lessLabel="Show top 5"
                controls={listId}
              />
            </div>
          )}
        </>
      )}
    </Card>
  );
}
