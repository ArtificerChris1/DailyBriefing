import type { NewsItem, ReleaseItem, SportsItem } from "@/lib/briefing-types";
import { dayOffsetBetween } from "@/lib/briefing-window";

/**
 * How the dashboard arranges what it already has: the time-of-day mode and the
 * grouping of the longer lists. Pure functions, so the rules sit in one place.
 */

export type DayMode = "morning" | "evening";
export type DayModeSetting = "auto" | DayMode;

function hourIn(nowMs: number, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(
      nowMs,
    ),
  );
}

/** Evening runs from 5pm until 4am, when the next morning's view takes over. */
export function dayModeAt(nowMs: number, timeZone: string): DayMode {
  const hour = hourIn(nowMs, timeZone);
  return hour >= 17 || hour < 4 ? "evening" : "morning";
}

export function greetingAt(nowMs: number, timeZone: string): string {
  const hour = hourIn(nowMs, timeZone);
  if (hour >= 4 && hour < 12) return "Good morning";
  if (hour >= 12 && hour < 17) return "Good afternoon";
  return "Good evening";
}

function dateKeyIn(instant: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(instant);
}

export interface SportsGroups {
  /** Finished in roughly the last day and a half: the overnight results. */
  results: SportsItem[];
  /** Live now, or scheduled on the day being viewed. */
  today: SportsItem[];
  /** Everything later, for a compact schedule. */
  upcoming: SportsItem[];
}

const RESULTS_WINDOW_MS = 36 * 60 * 60 * 1000;

export function groupSports(
  items: SportsItem[],
  date: string,
  nowMs: number,
  timeZone: string,
): SportsGroups {
  const groups: SportsGroups = { results: [], today: [], upcoming: [] };
  for (const item of items) {
    const at = item.occursAt ? Date.parse(item.occursAt) : Number.NaN;
    if (item.state === "final") {
      if (Number.isNaN(at) || nowMs - at <= RESULTS_WINDOW_MS) groups.results.push(item);
    } else if (item.state === "live" || (!Number.isNaN(at) && dateKeyIn(at, timeZone) === date)) {
      groups.today.push(item);
    } else {
      groups.upcoming.push(item);
    }
  }
  const byTime = (left: SportsItem, right: SportsItem) =>
    Date.parse(left.occursAt ?? "") - Date.parse(right.occursAt ?? "");
  groups.results.sort((left, right) => byTime(right, left));
  groups.today.sort(byTime);
  groups.upcoming.sort(byTime);
  return groups;
}

/** "Sat 7:05 PM", for the compact upcoming schedule. */
export function compactGameTime(item: SportsItem, timeZone: string): string {
  if (!item.occursAt) return item.startsAt ?? "";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(Date.parse(item.occursAt));
}

export interface ReleaseGroups {
  /** Already out, which is how comics arrive. */
  justOut: ReleaseItem[];
  today: ReleaseItem[];
  nextWeek: ReleaseItem[];
  later: ReleaseItem[];
}

export function groupReleases(items: ReleaseItem[], date: string): ReleaseGroups {
  const groups: ReleaseGroups = { justOut: [], today: [], nextWeek: [], later: [] };
  for (const item of items) {
    const offset = dayOffsetBetween(date, item.releasesOn);
    if (offset < 0) groups.justOut.push(item);
    else if (offset === 0) groups.today.push(item);
    else if (offset <= 7) groups.nextWeek.push(item);
    else groups.later.push(item);
  }
  return groups;
}

const STOP_WORDS = new Set(
  "a an and are as at be by for from has have in is it its of on or says the to was were will with after over new".split(
    " ",
  ),
);

function significantWords(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word)),
  );
}

/**
 * Drops headlines that cover the same story as one already kept, judged by how
 * many significant words two titles share. Keeps the first of each, so the
 * feed's own order (newest first) decides which publisher's version shows.
 */
export function dedupeHeadlines(items: NewsItem[]): NewsItem[] {
  const kept: { item: NewsItem; words: Set<string> }[] = [];
  for (const item of items) {
    const words = significantWords(item.title);
    const duplicate = kept.some((other) => {
      let shared = 0;
      for (const word of words) if (other.words.has(word)) shared += 1;
      const smaller = Math.min(words.size, other.words.size);
      return smaller > 0 && shared >= 3 && shared / smaller >= 0.5;
    });
    if (!duplicate) kept.push({ item, words });
  }
  return kept.map((entry) => entry.item);
}
