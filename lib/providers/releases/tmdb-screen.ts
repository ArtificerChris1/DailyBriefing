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

// ---------------------------------------------------------------------------
// Where to watch

/** TMDB release types: 2 limited theatrical, 3 theatrical, 4 digital. */
const THEATRICAL_TYPES = new Set([2, 3]);
const DIGITAL_TYPE = 4;
/** Provider names listed before "and more". */
const MAX_PROVIDERS = 2;

const detailCache = new Map<string, Promise<Record<string, unknown> | undefined>>();

function details(kind: "movie" | "tv", id: string): Promise<Record<string, unknown> | undefined> {
  const key = `${kind}:${id}`;
  let pending = detailCache.get(key);
  if (!pending) {
    const url = withKey(new URL(`${TMDB_BASE}/${kind}/${id}`));
    url.searchParams.set(
      "append_to_response",
      kind === "movie" ? "release_dates,watch/providers" : "watch/providers",
    );
    pending = fetchJson(url.toString(), {
      headers: authHeaders(),
      timeoutMs: environmentNumber("TMDB_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
    })
      .then((body) => (isRecord(body) ? body : undefined))
      .catch(() => undefined);
    detailCache.set(key, pending);
  }
  return pending;
}

function providerNames(body: Record<string, unknown>, region: string, kind: string): string[] {
  const providers = isRecord(body["watch/providers"]) ? body["watch/providers"] : {};
  const results = isRecord(providers.results) ? providers.results : {};
  const local = isRecord(results[region]) ? results[region] : {};
  const list = Array.isArray(local[kind]) ? local[kind] : [];
  return [
    ...new Set(
      list.filter(isRecord).flatMap((entry) => {
        const name = textOf(entry.provider_name);
        return name ? [name] : [];
      }),
    ),
  ];
}

function listed(names: string[]): string {
  return names.length > MAX_PROVIDERS
    ? `${names.slice(0, MAX_PROVIDERS).join(", ")} and more`
    : names.join(" and ");
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
    Date.parse(`${date}T12:00:00Z`),
  );
}

function movieAvailability(body: Record<string, unknown>, region: string, today: string) {
  const streaming = providerNames(body, region, "flatrate");
  if (streaming.length) return `Streaming on ${listed(streaming)}`;
  const rentOrBuy = providerNames(body, region, "rent").concat(providerNames(body, region, "buy"));

  const releaseDates = isRecord(body.release_dates) && Array.isArray(body.release_dates.results)
    ? body.release_dates.results.filter(isRecord)
    : [];
  const local = releaseDates.find((entry) => entry.iso_3166_1 === region);
  const dates = (Array.isArray(local?.release_dates) ? local.release_dates : [])
    .filter(isRecord)
    .flatMap((entry) => {
      const date = textOf(entry.release_date)?.slice(0, 10);
      return date && typeof entry.type === "number" ? [{ type: entry.type, date }] : [];
    })
    .sort((a, b) => a.date.localeCompare(b.date));
  const theatrical = dates.find((entry) => THEATRICAL_TYPES.has(entry.type));
  const digital = dates.find((entry) => entry.type === DIGITAL_TYPE);

  if (rentOrBuy.length && (!digital || digital.date <= today)) {
    return `Rent or buy on ${listed([...new Set(rentOrBuy)])}`;
  }
  if (digital && digital.date <= today) return "On digital";
  if (theatrical) {
    const inTheaters = theatrical.date <= today ? "In theaters" : `In theaters ${shortDate(theatrical.date)}`;
    return digital ? `${inTheaters} · digital ${shortDate(digital.date)}` : inTheaters;
  }
  return digital ? `Digital ${shortDate(digital.date)}` : undefined;
}

function tvAvailability(body: Record<string, unknown>, region: string) {
  const streaming = providerNames(body, region, "flatrate");
  if (streaming.length) return `Streaming on ${listed(streaming)}`;
  const network = Array.isArray(body.networks)
    ? body.networks.filter(isRecord).map((entry) => textOf(entry.name)).find(Boolean)
    : undefined;
  return network ? `On ${network}` : undefined;
}

/**
 * Adds where to watch each film and show: streaming services, rent or buy,
 * or theatrical and digital dates, for TMDB_REGION. Provider data is
 * JustWatch's, which TMDB requires to be credited; `credited` reports
 * whether any of it was used.
 */
export async function withScreenAvailability(
  items: ReleaseItem[],
  today: string,
): Promise<{ items: ReleaseItem[]; credited: boolean }> {
  if (!authHeaders()) return { items, credited: false };
  const region = process.env.TMDB_REGION?.trim() || "US";
  let credited = false;
  const enriched = await Promise.all(
    items.map(async (item) => {
      const match = /^tmdb-(movie|tv|episode)-(\d+)/.exec(item.id);
      if (!match) return item;
      const kind = match[1] === "movie" ? "movie" : "tv";
      const body = await details(kind, match[2]);
      if (!body) return item;
      const availability =
        kind === "movie" ? movieAvailability(body, region, today) : tvAvailability(body, region);
      if (!availability) return item;
      if (/^(Streaming|Rent)/.test(availability)) credited = true;
      return { ...item, availability };
    }),
  );
  return { items: enriched, credited };
}
