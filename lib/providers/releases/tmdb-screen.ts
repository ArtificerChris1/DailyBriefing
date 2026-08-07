import "server-only";

import type { ReleaseItem } from "@/lib/briefing-types";
import {
  DEFAULT_TIMEOUT_MS,
  environmentNumber,
  fetchJson,
  isDateOnly,
  isRecord,
  textOf,
} from "./shared";

const TMDB_BASE = "https://api.themoviedb.org/3";
/** Kept in step with next.config.ts, which must allow the poster host. */
const POSTER_BASE = "https://image.tmdb.org/t/p/w154";

/**
 * Movie and TV genre IDs are different vocabularies on TMDB. Movies keep
 * Science Fiction (878) and Fantasy (14) apart; television collapses both into
 * a single "Sci-Fi & Fantasy" (10765) and has no 878 or 14 at all, so reusing
 * the movie IDs against /discover/tv quietly returns nothing.
 */
const MOVIE_GENRES = "878|14";
const TV_GENRES = "10765";

/** How many returning series to expand into a concrete next episode. */
const MAX_EPISODE_LOOKUPS = 8;

export interface ScreenReleases {
  items: ReleaseItem[];
  warnings: string[];
  configured: boolean;
}

function authHeaders(): Record<string, string> | undefined {
  // A v4 read access token is preferred; a v3 key still works as a query param.
  const bearer = process.env.TMDB_ACCESS_TOKEN?.trim();
  if (bearer) {
    return { Authorization: `Bearer ${bearer}`, Accept: "application/json" };
  }
  return process.env.TMDB_API_KEY?.trim() ? { Accept: "application/json" } : undefined;
}

function withKey(url: URL): URL {
  const key = process.env.TMDB_API_KEY?.trim();
  if (key && !process.env.TMDB_ACCESS_TOKEN?.trim()) {
    url.searchParams.set("api_key", key);
  }
  return url;
}

function posterUrl(value: unknown): string | undefined {
  const path = textOf(value);
  return path && path.startsWith("/") ? `${POSTER_BASE}${path}` : undefined;
}

function resultsOf(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !Array.isArray(payload.results)) return [];
  return payload.results.filter(isRecord);
}

async function discover(
  path: "movie" | "tv",
  params: Record<string, string>,
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  const url = withKey(new URL(`${TMDB_BASE}/discover/${path}`));
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }
  return resultsOf(
    await fetchJson(url.toString(), { headers: authHeaders(), timeoutMs }),
  );
}

/**
 * `/discover/tv` only ever reports a series-level date, so a returning show has
 * to be opened individually to learn which episode is actually next. That is one
 * extra request per series, so the list is capped and the whole result cached.
 */
async function nextEpisodes(
  series: Record<string, unknown>[],
  from: string,
  to: string,
  timeoutMs: number,
): Promise<ReleaseItem[]> {
  const lookups = series.slice(0, MAX_EPISODE_LOOKUPS).map(async (show) => {
    const id = show.id;
    if (typeof id !== "number") return undefined;
    const url = withKey(new URL(`${TMDB_BASE}/tv/${id}`));
    const detail = await fetchJson(url.toString(), {
      headers: authHeaders(),
      timeoutMs,
    });
    if (!isRecord(detail)) return undefined;
    const episode = detail.next_episode_to_air;
    if (!isRecord(episode)) return undefined;
    const airDate = episode.air_date;
    if (!isDateOnly(airDate) || airDate < from || airDate > to) return undefined;

    const showName = textOf(detail.name) ?? textOf(show.name);
    if (!showName) return undefined;
    const season = episode.season_number;
    const number = episode.episode_number;
    const code =
      typeof season === "number" && typeof number === "number"
        ? `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}`
        : undefined;
    const episodeName = textOf(episode.name);
    const networks = Array.isArray(detail.networks)
      ? detail.networks.filter(isRecord).map((network) => textOf(network.name))
      : [];

    return {
      id: `tmdb-episode-${id}-${airDate}`,
      medium: "tv" as const,
      title: showName,
      releasesOn: airDate,
      by: networks.find(Boolean),
      detail: [code, episodeName].filter(Boolean).join(" · ") || undefined,
      posterUrl: posterUrl(detail.poster_path ?? show.poster_path),
      url: `https://www.themoviedb.org/tv/${id}`,
    };
  });

  const settled = await Promise.allSettled(lookups);
  return settled.flatMap((entry) =>
    entry.status === "fulfilled" && entry.value ? [entry.value] : [],
  );
}

/**
 * Upcoming science-fiction and fantasy films, series premieres, and the next
 * episode of returning series, from TMDB. Returns `configured: false` when no
 * credential is set, so the card can omit the whole medium rather than showing
 * an error the user cannot act on.
 *
 * The user asked for "IMDB"; IMDb publishes no free release-calendar API. The
 * /discover endpoints described are TMDB's, which is what this uses.
 */
export async function fetchScreenReleases(
  from: string,
  to: string,
): Promise<ScreenReleases> {
  if (!authHeaders()) {
    return { items: [], warnings: [], configured: false };
  }
  const timeoutMs = environmentNumber("TMDB_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const region = process.env.TMDB_REGION?.trim() || "US";
  const warnings: string[] = [];

  const [movies, premieres, returning] = await Promise.allSettled([
    discover(
      "movie",
      {
        with_genres: MOVIE_GENRES,
        "primary_release_date.gte": from,
        "primary_release_date.lte": to,
        sort_by: "primary_release_date.asc",
        include_adult: "false",
        region,
        language: "en-US",
      },
      timeoutMs,
    ),
    discover(
      "tv",
      {
        with_genres: TV_GENRES,
        "first_air_date.gte": from,
        "first_air_date.lte": to,
        sort_by: "first_air_date.asc",
        include_adult: "false",
        language: "en-US",
      },
      timeoutMs,
    ),
    discover(
      "tv",
      {
        with_genres: TV_GENRES,
        "air_date.gte": from,
        "air_date.lte": to,
        sort_by: "popularity.desc",
        include_adult: "false",
        language: "en-US",
      },
      timeoutMs,
    ),
  ]);

  const items: ReleaseItem[] = [];

  if (movies.status === "fulfilled") {
    for (const movie of movies.value) {
      const id = movie.id;
      const title = textOf(movie.title);
      const date = movie.release_date;
      if (typeof id !== "number" || !title || !isDateOnly(date)) continue;
      items.push({
        id: `tmdb-movie-${id}`,
        medium: "movie",
        title,
        releasesOn: date,
        detail: "Theatrical release",
        posterUrl: posterUrl(movie.poster_path),
        url: `https://www.themoviedb.org/movie/${id}`,
      });
    }
  } else {
    warnings.push("TMDB film releases were unavailable.");
  }

  if (premieres.status === "fulfilled") {
    for (const show of premieres.value) {
      const id = show.id;
      const title = textOf(show.name);
      const date = show.first_air_date;
      if (typeof id !== "number" || !title || !isDateOnly(date)) continue;
      items.push({
        id: `tmdb-tv-${id}`,
        medium: "tv",
        title,
        releasesOn: date,
        detail: "Series premiere",
        posterUrl: posterUrl(show.poster_path),
        url: `https://www.themoviedb.org/tv/${id}`,
      });
    }
  } else {
    warnings.push("TMDB series premieres were unavailable.");
  }

  if (returning.status === "fulfilled") {
    try {
      items.push(...(await nextEpisodes(returning.value, from, to, timeoutMs)));
    } catch {
      warnings.push("TMDB episode air dates were unavailable.");
    }
  }

  // A premiere and a "next episode" can describe the same series; the premiere
  // is the better card, so it wins.
  const premiereIds = new Set(
    items.filter((item) => item.detail === "Series premiere").map((item) => item.url),
  );
  const deduped = items.filter(
    (item) => item.detail === "Series premiere" || !premiereIds.has(item.url),
  );

  return { items: deduped, warnings, configured: true };
}
