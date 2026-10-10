import "server-only";

import type { ReleaseItem, UpcomingReleasesPanel } from "@/lib/briefing-types";
import { fetchComicReleases } from "./comic-vine";
import { fetchBookReleases } from "./reactor-books";
import {
  DEFAULT_CACHE_SECONDS,
  DEFAULT_HORIZON_DAYS,
  addDays,
  environmentNumber,
} from "./shared";
import { fetchScreenReleases } from "./tmdb-screen";

/** Enough to fill the card without turning it into a catalogue. */
const MAX_ITEMS = 24;
/** Keeps any one medium from crowding out the rest on a heavy week. */
const MAX_PER_MEDIUM = 8;

/**
 * Comics are the one medium reported as already out rather than due, because
 * Comic Vine only records issues once they have shipped. A week reaches the
 * most recent Wednesday from any day the pager lands on.
 */
const COMICS_LOOKBACK_DAYS = 7;
/**
 * Only a few, and only the newest. The card shows eight rows before the reader
 * has to expand it, and past rows earning most of them would bury the upcoming
 * releases the card is named for.
 */
const MAX_JUST_SHIPPED = 3;

/**
 * Keyed by the window start, because the day pager moves it. A single slot
 * would otherwise hand yesterday's window back when the user pages forward.
 */
const cache = new Map<string, { expiresAt: number; panel: UpcomingReleasesPanel }>();
/** The pager spans a few weeks at most, so the map cannot grow without bound. */
const MAX_CACHE_ENTRIES = 16;

const MEDIUM_ORDER: ReleaseItem["medium"][] = ["movie", "tv", "book", "comic"];

/**
 * Keeps only the newest few comics. The list is sorted by date afterwards, so
 * trimming has to happen first: sorting puts the oldest row of the lookback
 * window at the top of the card, which is the opposite of "just shipped".
 */
function newestComics(items: ReleaseItem[]): ReleaseItem[] {
  const comics = items
    .filter((item) => item.medium === "comic")
    .sort((left, right) => {
      if (left.releasesOn !== right.releasesOn) {
        return left.releasesOn > right.releasesOn ? -1 : 1;
      }
      return left.title.localeCompare(right.title);
    })
    .slice(0, MAX_JUST_SHIPPED);
  return [...items.filter((item) => item.medium !== "comic"), ...comics];
}

function balance(items: ReleaseItem[]): ReleaseItem[] {
  const counts = new Map<ReleaseItem["medium"], number>();
  const kept: ReleaseItem[] = [];
  // The per-medium cap exists to stop one source crowding out the others. With
  // only one source configured there is nothing to crowd out, so lift it and
  // let that source fill the card up to MAX_ITEMS.
  const media = new Set(items.map((item) => item.medium));
  const perMedium = media.size > 1 ? MAX_PER_MEDIUM : MAX_ITEMS;
  const sorted = [...items].sort((left, right) => {
    if (left.releasesOn !== right.releasesOn) {
      return left.releasesOn < right.releasesOn ? -1 : 1;
    }
    const byMedium =
      MEDIUM_ORDER.indexOf(left.medium) - MEDIUM_ORDER.indexOf(right.medium);
    return byMedium !== 0 ? byMedium : left.title.localeCompare(right.title);
  });

  for (const item of sorted) {
    const used = counts.get(item.medium) ?? 0;
    if (used >= perMedium) continue;
    counts.set(item.medium, used + 1);
    kept.push(item);
    if (kept.length >= MAX_ITEMS) break;
  }
  return kept;
}

/**
 * Everything landing in the next few weeks across film, television, and SFF
 * novels, plus the comics that shipped in the last week, as one list. Returns
 * undefined when nothing at all is configured
 * or reachable, so the dashboard omits the card rather than showing an empty
 * shell — the same contract the BoardGameGeek card uses.
 *
 * `today` is the briefing's own date key, so the window follows the day pager.
 */
export async function fetchUpcomingReleases(
  today: string,
): Promise<UpcomingReleasesPanel | undefined> {
  const horizonDays = environmentNumber(
    "RELEASES_HORIZON_DAYS",
    DEFAULT_HORIZON_DAYS,
  );
  const cacheSeconds = environmentNumber(
    "RELEASES_CACHE_SECONDS",
    DEFAULT_CACHE_SECONDS,
  );
  const to = addDays(today, horizonDays);

  const now = Date.now();
  const cached = cache.get(today);
  if (cached && cached.expiresAt > now) return cached.panel;

  const shippedFrom = addDays(today, -COMICS_LOOKBACK_DAYS);

  const [screen, books, comics] = await Promise.all([
    fetchScreenReleases(today, to),
    fetchBookReleases(today, to),
    fetchComicReleases(shippedFrom, today),
  ]);

  const warnings = [...screen.warnings, ...books.warnings, ...comics.warnings];
  const inWindow = [...screen.items, ...books.items, ...comics.items].filter(
    (item) =>
      item.medium === "comic"
        ? // Comics look backwards, and only as far as the lookback window.
          item.releasesOn >= shippedFrom && item.releasesOn <= today
        : // A release that already happened is not upcoming, whatever a
          // source claims.
          item.releasesOn >= today && item.releasesOn <= to,
  );
  const items = balance(newestComics(inWindow));

  // Credit only what actually contributed. Naming a source that returned
  // nothing reads as though its releases are covered when they are not.
  const contributed = new Set(items.map((item) => item.medium));
  const attribution =
    [
      contributed.has("movie") || contributed.has("tv") ? "TMDB" : undefined,
      contributed.has("book") ? "Reactor" : undefined,
      contributed.has("comic") ? "Comic Vine" : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || "No sources reporting";

  if (items.length === 0) {
    // Nothing configured and nothing free came back: no card at all.
    if (!screen.configured && !comics.configured && books.items.length === 0) {
      return undefined;
    }
    const panel: UpcomingReleasesPanel = {
      items: [],
      attribution,
      warnings,
      message:
        warnings[0] ?? "No releases are scheduled in the next few weeks.",
    };
    // Do not cache an empty result for long; the next refresh should retry.
    return panel;
  }

  const panel: UpcomingReleasesPanel = { items, attribution, warnings };
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(today, { expiresAt: now + cacheSeconds * 1000, panel });
  return panel;
}
