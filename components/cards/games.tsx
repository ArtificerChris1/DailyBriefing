"use client";

import { ExternalLink as ExternalLinkIcon, Puzzle } from "lucide-react";

import { Badge, Card, ExternalLink } from "@/components/ui";
import type { BgaPanel, BgaTable } from "@/lib/briefing-types";
import { clockLabel, plural } from "@/lib/format";

/**
 * Links to today's daily puzzles. Neither publisher allows its games to be
 * shown inside another site, so these open the game itself. On iPhone each
 * address is claimed by the publisher's app (NYT Games, LinkedIn), so a tap
 * opens the app when it is installed and the browser when it is not.
 */

interface Game {
  name: string;
  href: string;
}

const PUBLISHERS: { name: string; games: Game[] }[] = [
  {
    name: "New York Times",
    games: [
      { name: "Wordle", href: "https://www.nytimes.com/games/wordle/index.html" },
      { name: "Mini", href: "https://www.nytimes.com/crosswords/game/mini" },
      { name: "Connections", href: "https://www.nytimes.com/games/connections" },
      { name: "Strands", href: "https://www.nytimes.com/games/strands" },
    ],
  },
  {
    name: "LinkedIn",
    games: [
      { name: "Zip", href: "https://www.linkedin.com/games/zip/" },
      { name: "Wend", href: "https://www.linkedin.com/games/wend/" },
      { name: "Patches", href: "https://www.linkedin.com/games/patches/" },
      { name: "Queens", href: "https://www.linkedin.com/games/queens/" },
    ],
  },
];

/** "duncanid's turn", "Your turn", "Your turn, and duncanid's". */
function whoseTurn(table: BgaTable): string {
  const names = table.turn;
  const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  if (table.isMyTurn) return list ? `Your turn, and ${list}’s` : "Your turn";
  if (!list) return "Waiting to continue";
  return names.length === 1 ? `${list}’s turn` : `${list} to move`;
}

/**
 * Board Game Arena tables, as read by the build. Signed out or unreachable,
 * it says so in one line and shows no tables, so old turns never pass as now.
 */
function BoardGameArena({ panel, timeZone }: { panel: BgaPanel; timeZone: string }) {
  if (panel.state !== "ok") {
    return (
      <div className="bga-section">
        <p className="bga-status">
          {panel.state === "signed-out"
            ? "Board Game Arena: not signed in"
            : "Board Game Arena: couldn’t be reached"}
        </p>
      </div>
    );
  }

  const mine = panel.tables.filter((table) => table.isMyTurn);
  return (
    <div className="bga-section">
      <div className="bga-heading">
        <h3 className="games-publisher">Board Game Arena</h3>
        <p className="bga-checked">As of {clockLabel(panel.checkedAt, timeZone)}</p>
      </div>
      <p className={`bga-flag${mine.length ? " bga-flag-mine" : ""}`}>
        {mine.length
          ? `Your turn at ${plural(mine.length, "table")}: ${mine.map((table) => table.game).join(", ")}`
          : panel.tables.length
            ? "Not your turn at any table"
            : "No games in progress"}
      </p>
      {panel.tables.length > 0 && (
        <ul className="bga-list">
          {panel.tables.map((table) => (
            <li key={table.id} className={table.isMyTurn ? "is-mine" : undefined}>
              <div className="media-copy">
                <p className="media-title">{table.game}</p>
                <p className="media-detail">
                  {`${table.progress}% done · ${whoseTurn(table)} · ${plural(table.playerCount, "player")}`}
                </p>
              </div>
              {table.isMyTurn && <Badge tone="accent">Your turn</Badge>}
              <ExternalLink href={table.url} label={`Open ${table.game} on Board Game Arena`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GamesCard({ bga, timeZone }: { bga?: BgaPanel; timeZone: string }) {
  return (
    <Card
      title="Daily games"
      icon={Puzzle}
      className="games-card"
      help={
        <>
          <p>
            Today&rsquo;s puzzles from The New York Times and LinkedIn. They open in the NYT Games
            or LinkedIn app on iPhone when it is installed, otherwise in a new browser tab, so your
            streaks stay with your accounts there. The publishers do not allow the games to be
            played inside this page.
          </p>
          <p>
            Board Game Arena tables are read when the briefing is built, so turns are as of the
            time shown. Your-turn tables come first. If the build is not signed in to Board Game
            Arena, or cannot reach it, the card says so instead of showing tables.
          </p>
        </>
      }
    >
      <div className="games-groups">
        {PUBLISHERS.map((publisher) => (
          <div className="games-group" key={publisher.name}>
            <h3 className="games-publisher">{publisher.name}</h3>
            <ul className="games-list">
              {publisher.games.map((game) => (
                <li key={game.name}>
                  <ExternalLink
                    href={game.href}
                    label={`Play ${game.name} from ${publisher.name}`}
                    className="button button-secondary games-link"
                  >
                    <span aria-hidden="true">{game.name}</span>
                    <ExternalLinkIcon size={15} aria-hidden="true" />
                  </ExternalLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {bga && <BoardGameArena panel={bga} timeZone={timeZone} />}
    </Card>
  );
}
