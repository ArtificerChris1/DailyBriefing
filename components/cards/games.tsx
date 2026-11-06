"use client";

import { ExternalLink as ExternalLinkIcon, Puzzle } from "lucide-react";

import { Card, ExternalLink } from "@/components/ui";

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

export function GamesCard() {
  return (
    <Card
      title="Daily games"
      icon={Puzzle}
      className="games-card"
      help={
        <p>
          Today&rsquo;s puzzles from The New York Times and LinkedIn. They open in the NYT Games or
          LinkedIn app on iPhone when it is installed, otherwise in a new browser tab, so your
          streaks stay with your accounts there. The publishers do not allow the games to be
          played inside this page.
        </p>
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
    </Card>
  );
}
