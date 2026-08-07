import "server-only";

import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";

import type { NewsItem } from "@/lib/briefing-types";
import { recencyCutoff, withinRecencyWindow } from "@/lib/recency";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CACHE_SECONDS = 15 * 60;
const MAX_FEED_BYTES = 2 * 1024 * 1024;
const HEADLINES_PER_LANE = 10;

interface FeedDefinition {
  id: string;
  publisher: string;
  url: string;
  lane: "world" | "geek";
  defaultTag: string;
  importance?: NewsItem["importance"];
}

interface ParsedEntry {
  title?: unknown;
  link?: unknown;
  guid?: unknown;
  id?: unknown;
  pubDate?: unknown;
  published?: unknown;
  updated?: unknown;
  date?: unknown;
  category?: unknown;
}

export interface RssHeadlineResult {
  ok: boolean;
  items: NewsItem[];
  fetchedAt: string;
  warnings: string[];
  error?: string;
}

const feeds: FeedDefinition[] = [
  {
    id: "al-jazeera",
    publisher: "Al Jazeera",
    url: "https://www.aljazeera.com/xml/rss/all.xml",
    lane: "world",
    defaultTag: "Global affairs",
    importance: "high",
  },
  {
    id: "guardian-world",
    publisher: "The Guardian",
    url: "https://www.theguardian.com/world/rss",
    lane: "world",
    defaultTag: "World",
  },
  {
    id: "democracy-now",
    publisher: "Democracy Now!",
    url: "https://www.democracynow.org/democracynow.rss",
    lane: "world",
    defaultTag: "Public interest",
  },
  {
    id: "propublica",
    publisher: "ProPublica",
    url: "https://www.propublica.org/feeds/propublica/main",
    lane: "world",
    defaultTag: "Investigations",
  },
  {
    id: "pbs-newshour",
    publisher: "PBS NewsHour",
    url: "https://www.pbs.org/newshour/feeds/rss/headlines",
    lane: "world",
    defaultTag: "Public service",
  },
  {
    id: "jacobin",
    publisher: "Jacobin",
    url: "https://jacobin.com/feed",
    lane: "world",
    defaultTag: "Politics & labor",
  },
  {
    id: "mother-jones",
    publisher: "Mother Jones",
    url: "https://www.motherjones.com/feed/",
    lane: "world",
    defaultTag: "Investigations",
  },
  {
    id: "vox",
    publisher: "Vox",
    url: "https://www.vox.com/rss/index.xml",
    lane: "world",
    defaultTag: "Explainers",
  },
  {
    id: "comics-beat",
    publisher: "Comics Beat",
    url: "https://www.comicsbeat.com/feed/",
    lane: "geek",
    defaultTag: "Comics",
  },
  {
    id: "dnd-beyond",
    publisher: "D&D Beyond",
    url: "https://www.dndbeyond.com/posts.rss",
    lane: "geek",
    defaultTag: "D&D",
  },
  {
    id: "reactor",
    publisher: "Reactor",
    url: "https://reactormag.com/feed/",
    lane: "geek",
    defaultTag: "Fantasy & science fiction",
  },
  {
    id: "nintendo",
    publisher: "Nintendo",
    // First-party feed named in the source registry; nintendo.com has none.
    url: "https://www.nintendo.co.uk/news.xml",
    lane: "geek",
    defaultTag: "Nintendo",
  },
  {
    id: "macrumors",
    publisher: "MacRumors",
    url: "https://feeds.macrumors.com/MacRumors-All",
    lane: "geek",
    defaultTag: "Apple",
  },
  {
    id: "ars-technica",
    publisher: "Ars Technica",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    lane: "geek",
    defaultTag: "Science & tech",
  },
  {
    id: "cbr",
    publisher: "CBR",
    url: "https://www.cbr.com/feed/",
    lane: "geek",
    defaultTag: "Comics",
  },
  {
    id: "den-of-geek",
    publisher: "Den of Geek",
    url: "https://www.denofgeek.com/feed/",
    lane: "geek",
    defaultTag: "Geek culture",
  },
  {
    id: "sff-world",
    publisher: "SFFWorld",
    url: "https://www.sffworld.com/feed/",
    lane: "geek",
    defaultTag: "Fantasy & science fiction",
  },
];

let cache: { expiresAt: number; result: RssHeadlineResult } | undefined;

function environmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function scalar(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    return scalar(record["#text"] ?? record["@_href"] ?? record["@_url"]);
  }
  return undefined;
}

function linkFrom(value: unknown): string | undefined {
  const values = Array.isArray(value) ? value : [value];
  for (const candidate of values) {
    const link = scalar(candidate);
    if (!link) continue;
    try {
      const url = new URL(link);
      if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
    } catch {
      continue;
    }
  }
  return undefined;
}

function asEntries(document: unknown): ParsedEntry[] {
  if (!document || typeof document !== "object") return [];
  const root = document as Record<string, unknown>;
  const rss = root.rss as Record<string, unknown> | undefined;
  const channel = rss?.channel as Record<string, unknown> | undefined;
  const rssItems = channel?.item;
  if (rssItems) return (Array.isArray(rssItems) ? rssItems : [rssItems]) as ParsedEntry[];
  const feed = root.feed as Record<string, unknown> | undefined;
  const atomEntries = feed?.entry;
  return atomEntries
    ? ((Array.isArray(atomEntries) ? atomEntries : [atomEntries]) as ParsedEntry[])
    : [];
}

async function downloadFeed(feed: FeedDefinition, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(feed.url, {
      cache: "no-store",
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml",
        "User-Agent": "Brief-Daily-News/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${feed.publisher} returned HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
      throw new Error(`${feed.publisher} feed exceeded the size limit.`);
    }
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_FEED_BYTES) {
      throw new Error(`${feed.publisher} feed exceeded the size limit.`);
    }
    return text;
  } finally {
    clearTimeout(timeout);
  }
}

function topicTag(title: string, fallback: string): string {
  const lower = title.toLowerCase();
  const topics: Array<[RegExp, string]> = [
    [/marvel|dc comics|comic/, "Marvel & DC"],
    [/star wars/, "Star Wars"],
    [/star trek/, "Star Trek"],
    [/dungeons?\s*&\s*dragons|\bd&d\b/, "D&D"],
    [/mario|zelda|metroid|nintendo|switch 2/, "Nintendo"],
    [/\bapple\b|iphone|ipad|\bmacos\b|\bmac\b|airpods|vision pro/, "Apple"],
    [/board game|tabletop/, "Board games"],
    [/cozy fantasy/, "Cozy fantasy"],
    [/fantasy|science fiction|\bsci-fi\b/, "Fantasy & SF"],
    [/climate|environment/, "Climate"],
    [/investigat|accountability/, "Investigations"],
  ];
  return topics.find(([pattern]) => pattern.test(lower))?.[1] ?? fallback;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi,
    (entity, decimal: string | undefined, hexadecimal: string | undefined, name: string | undefined) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hexadecimal) return String.fromCodePoint(Number.parseInt(hexadecimal, 16));
      return named[name?.toLowerCase() ?? ""] ?? entity;
    },
  );
}

function relativePublished(value: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - value.getTime()) / 60_000));
  if (minutes < 60) return minutes <= 1 ? "Just now" : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(value);
}

async function readFeed(
  feed: FeedDefinition,
  fetchedAt: string,
  now: Date,
  timeoutMs: number,
): Promise<NewsItem[]> {
  const xml = await downloadFeed(feed, timeoutMs);
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: true,
    trimValues: true,
  });
  const entries = asEntries(parser.parse(xml));
  return entries.flatMap((entry): NewsItem[] => {
    const title = scalar(entry.title);
    // Atom feeds may carry no <link> at all and put the canonical URL in <id>
    // instead, which is how Jacobin publishes. Without this fallback every one
    // of its entries is silently discarded for having no link.
    const url =
      linkFrom(entry.link) ?? linkFrom(entry.guid) ?? linkFrom(entry.id);
    const publishedText =
      scalar(entry.pubDate) ??
      scalar(entry.published) ??
      scalar(entry.updated) ??
      scalar(entry.date);
    const published = publishedText ? new Date(publishedText) : now;
    if (!title || !url || Number.isNaN(published.getTime())) return [];
    return [
      {
        id: `news-${createHash("sha256")
          .update(url, "utf8")
          .digest("base64url")
          .slice(0, 22)}`,
        kind: "news",
        title: decodeEntities(title),
        publisher: feed.publisher,
        publishedAt: relativePublished(published, now),
        url,
        category: scalar(entry.category),
        lane: feed.lane,
        interestTag: topicTag(decodeEntities(title), feed.defaultTag),
        zone: "public",
        sensitivity: "public",
        importance: feed.importance ?? "normal",
        surfacedBecause:
          feed.lane === "world"
            ? "Selected reputable public-interest source"
            : "Matches your saved geek-culture interests",
        source: {
          provider: "news",
          connectionId: feed.id,
          externalId: url,
          fetchedAt,
          modifiedAt: published.toISOString(),
          deepLink: url,
        },
      },
    ];
  });
}

/**
 * Fills a lane by round: every publisher contributes its best headline before
 * any contributes a second. A hard one-per-publisher cap cannot reach ten from
 * five feeds, and taking each feed's top ten in turn would let the loudest
 * publisher dominate — this spreads as widely as the available feeds allow.
 */
function selectDiverse(items: NewsItem[], lane: "world" | "geek", limit: number): NewsItem[] {
  const candidates = items
    .filter((item) => item.lane === lane)
    .sort(
      (left, right) =>
        (right.importance === "high" ? 1 : 0) -
          (left.importance === "high" ? 1 : 0) ||
        Date.parse(right.source.modifiedAt ?? "") -
          Date.parse(left.source.modifiedAt ?? ""),
    );
  const byPublisher = new Map<string, NewsItem[]>();
  for (const item of candidates) {
    const queue = byPublisher.get(item.publisher);
    if (queue) queue.push(item);
    else byPublisher.set(item.publisher, [item]);
  }
  const queues = [...byPublisher.values()];
  const selected: NewsItem[] = [];
  for (let round = 0; selected.length < limit; round += 1) {
    const roundItems = queues
      .map((queue) => queue[round])
      .filter((item): item is NewsItem => Boolean(item));
    if (roundItems.length === 0) break;
    for (const item of roundItems) {
      selected.push(item);
      if (selected.length === limit) break;
    }
  }
  return selected;
}

export async function fetchRssHeadlines(): Promise<RssHeadlineResult> {
  const now = new Date();
  if (cache && cache.expiresAt > now.getTime()) return cache.result;
  const fetchedAt = now.toISOString();
  const timeoutMs = environmentNumber("NEWS_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const cacheSeconds = environmentNumber("NEWS_CACHE_SECONDS", DEFAULT_CACHE_SECONDS);
  const settled = await Promise.allSettled(
    feeds.map((feed) => readFeed(feed, fetchedAt, now, timeoutMs)),
  );
  const allItems = settled
    .filter((result): result is PromiseFulfilledResult<NewsItem[]> => result.status === "fulfilled")
    .flatMap((result) => result.value);
  const failures = settled.filter((result) => result.status === "rejected").length;
  // Age out before selecting, so each lane still fills up with four fresh
  // headlines instead of losing slots to entries that are about to be dropped.
  const cutoff = recencyCutoff(now.getTime());
  const recentItems = allItems.filter((item) =>
    withinRecencyWindow(item.source.modifiedAt, cutoff),
  );
  const items = [
    ...selectDiverse(recentItems, "world", HEADLINES_PER_LANE),
    ...selectDiverse(recentItems, "geek", HEADLINES_PER_LANE),
  ];
  const result: RssHeadlineResult = {
    ok: items.length > 0,
    items,
    fetchedAt,
    warnings: failures ? [`${failures} headline feeds were temporarily unavailable.`] : [],
    error: items.length
      ? undefined
      : allItems.length
        ? "No headlines were published in the last day."
        : "Live headline feeds could not be reached.",
  };
  if (result.ok) {
    cache = { expiresAt: now.getTime() + cacheSeconds * 1000, result };
  } else if (cache) {
    return {
      ...cache.result,
      warnings: [...cache.result.warnings, "Showing the last successful headline snapshot."],
    };
  }
  return result;
}
