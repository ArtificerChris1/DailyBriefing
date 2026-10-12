"use client";

import { CalendarDays, Newspaper } from "lucide-react";
import { useId, useState } from "react";

import { Card, ShowMore } from "@/components/ui";
import type { NewsItem } from "@/lib/briefing-types";
import { dedupeHeadlines } from "@/lib/briefing-view";

const PER_LANE = 3;
const LANES = [
  { id: "world", title: "World" },
  { id: "geek", title: "Geek culture" },
] as const;

/** Headlines by category, each with a one-sentence summary. */
export function NewsCard({ headlines }: { headlines: NewsItem[] }) {
  const [showAll, setShowAll] = useState(false);
  const listId = useId();
  const stories = dedupeHeadlines(headlines);
  const hidden = LANES.reduce(
    (total, lane) => total + Math.max(0, stories.filter((story) => story.lane === lane.id).length - PER_LANE),
    0,
  );
  const events = headlines.find((story) => story.lane === "events");

  return (
    <Card
      title="News"
      icon={Newspaper}
      className="news-card"
      meta="Your sources, Al Jazeera first"
      help={
        <p>
          Headlines from your chosen publishers, with stories that cover the same event combined.
          Each summary is one sentence condensed by Claude, an AI model, from the
          publisher&rsquo;s own summary; open the story for the full article.
        </p>
      }
    >
      <div id={listId} className="news-lanes">
        {LANES.map((lane) => {
          const inLane = stories.filter((story) => story.lane === lane.id);
          if (!inLane.length) return null;
          return (
            <div className="list-group" key={lane.id}>
              <h3 className="list-group-title">{lane.title}</h3>
              <ul className="story-list">
                {(showAll ? inLane : inLane.slice(0, PER_LANE)).map((story) => {
                  const href = story.url !== "#" ? story.url : story.source.deepLink;
                  return (
                    <li key={story.id}>
                      <p className="story-meta">
                        {story.interestTag && <span className="story-tag">{story.interestTag}</span>}
                        {story.publisher} · {story.publishedAt}
                      </p>
                      <h4 className="story-title">
                        {href ? (
                          <a href={href} target="_blank" rel="noreferrer">
                            {story.title}
                            <span className="visually-hidden"> ({story.publisher}, opens in a new tab)</span>
                          </a>
                        ) : (
                          story.title
                        )}
                      </h4>
                      {story.summary && <p className="story-summary">{story.summary}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      {events && (
        <p className="card-note">
          <CalendarDays size={15} aria-hidden="true" /> {events.title}
        </p>
      )}
      {hidden > 0 && (
        <div className="card-footer">
          <ShowMore
            expanded={showAll}
            onToggle={() => setShowAll((value) => !value)}
            moreLabel={`Show ${hidden} more headlines`}
            lessLabel="Show top stories only"
            controls={listId}
          />
        </div>
      )}
    </Card>
  );
}
