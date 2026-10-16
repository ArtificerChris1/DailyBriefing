import "server-only";

import { createHash } from "node:crypto";

import type { SportsItem } from "@/lib/briefing-types";
import { fetchLeagueTeamItems, leagueTeams } from "@/lib/providers/sports/league-feeds";
import { fetchJson, relativeStart, RESULTS_LOOKBACK_MS } from "@/lib/providers/sports/shared";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CACHE_SECONDS = 15 * 60;
const SPORTSDB_V1_BASE = "https://www.thesportsdb.com/api/v1/json";
const SPORTSDB_V2_BASE = "https://www.thesportsdb.com/api/v2/json";
/** TheSportsDB's documented free key. v2 rejects it, so it pins us to v1. */
const SPORTSDB_FREE_KEY = "123";
const USL_LEAGUE_ONE_ID = "5076";
const FORWARD_MADISON_ID = "142160";
/** Statuses that mean a result counts. `ABD` carries a score but must not. */
const COMPLETED_STATUSES = new Set(["FT", "AET", "AP", "FINAL"]);

interface TeamDefinition {
  id: string;
  name: string;
  logoPath: string;
  league: string;
  group: SportsItem["group"];
}

interface SportsDbEvent {
  idEvent?: string;
  strEvent?: string;
  strLeague?: string;
  strHomeTeam?: string;
  strAwayTeam?: string;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  strStatus?: string;
  dateEvent?: string;
  strTimestamp?: string;
}

interface MlbStanding {
  team?: { id?: number };
  divisionRank?: string;
  gamesBack?: string;
}

interface NhlStanding {
  teamAbbrev?: { default?: string };
  divisionSequence?: number;
  points?: number;
}

interface SportsDbSeasonEvent {
  idHomeTeam?: string;
  idAwayTeam?: string;
  intHomeScore?: string | number | null;
  intAwayScore?: string | number | null;
  strStatus?: string;
}

interface LeagueTableRow {
  teamId: string;
  played: number;
  wins: number;
  draws: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
}

/**
 * v2 authenticates with an `X-API-KEY` header and a premium key; v1 puts the key
 * in the path and accepts the free one. We prefer v2 whenever a key is configured.
 */
interface SportsDbClient {
  apiKey: string;
  premium: boolean;
}

export interface LiveSportsResult {
  ok: boolean;
  items: SportsItem[];
  fetchedAt: string;
  warnings: string[];
  error?: string;
}

/**
 * Teams with no league or ESPN feed. Everyone else is read from
 * league-feeds.ts, which also covers the MLB, NHL and Forward Madison standings
 * teams below.
 */
const teams: TeamDefinition[] = [
  {
    id: "141445",
    name: "Cedar Rapids RoughRiders",
    logoPath: "https://r2.thesportsdb.com/images/media/team/badge/0eatd81756967453.png",
    league: "USHL",
    group: "local",
  },
];

let cache:
  | { expiresAt: number; result: LiveSportsResult }
  | undefined;

function environmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function eventInstant(event: SportsDbEvent): Date | undefined {
  const timestamp = event.strTimestamp?.trim();
  const value = timestamp
    ? /(?:Z|[+-]\d\d:\d\d)$/i.test(timestamp)
      ? timestamp
      : `${timestamp}Z`
    : event.dateEvent
      ? `${event.dateEvent}T12:00:00Z`
      : undefined;
  if (!value || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value);
}

function stateFor(event: SportsDbEvent, startsAt: Date, now: Date): SportsItem["state"] {
  const status = event.strStatus?.toUpperCase();
  if (["FT", "AET", "AP", "FINAL"].includes(status ?? "")) return "final";
  if (status && !["NS", "TBD", "PST", "CANC", "CANCELLED"].includes(status)) {
    return "live";
  }
  return startsAt.getTime() < now.getTime() - 6 * 60 * 60 * 1000
    ? "final"
    : "scheduled";
}

function scoreLabel(event: SportsDbEvent): string | undefined {
  if (event.intHomeScore === null || event.intHomeScore === undefined) return undefined;
  if (event.intAwayScore === null || event.intAwayScore === undefined) return undefined;
  return `${event.strHomeTeam ?? "Home"} ${event.intHomeScore} · ${event.strAwayTeam ?? "Away"} ${event.intAwayScore}`;
}

function opponentFor(event: SportsDbEvent, team: TeamDefinition): string {
  const matchesHome = (event.strHomeTeam ?? "").toLowerCase().includes(
    team.name.replace(/ (fc|football)$/i, "").toLowerCase(),
  );
  return matchesHome
    ? event.strAwayTeam ?? "Opponent TBD"
    : event.strHomeTeam ?? "Opponent TBD";
}

function sportsItem(
  team: TeamDefinition,
  event: SportsDbEvent,
  recent: SportsDbEvent | undefined,
  now: Date,
  timeZone: string,
  fetchedAt: string,
): SportsItem | undefined {
  const instant = eventInstant(event);
  if (!instant) return undefined;
  const state = stateFor(event, instant, now);
  const score = scoreLabel(event);
  const recentScore = recent ? scoreLabel(recent) : undefined;
  const context =
    state === "scheduled" && recentScore
      ? `Last result: ${recentScore}.`
      : state === "scheduled"
        ? `Upcoming ${event.strLeague ?? team.league} matchup.`
      : state === "final"
        ? "Final result from the latest completed game."
        : "Game currently in progress.";
  return {
    id: `sports-${createHash("sha256")
      .update(`${team.id}:${event.idEvent ?? event.strEvent}`, "utf8")
      .digest("base64url")
      .slice(0, 22)}`,
    kind: "sports",
    title: event.strEvent ?? `${team.name} vs ${opponentFor(event, team)}`,
    team: team.name,
    logoPath: team.logoPath,
    opponent: opponentFor(event, team),
    startsAt: relativeStart(instant, now, timeZone),
    occursAt: instant.toISOString(),
    state,
    scoreLabel: score,
    league: event.strLeague ?? team.league,
    group: team.group,
    context,
    zone: "public",
    sensitivity: "public",
    importance:
      state === "live" || Math.abs(instant.getTime() - now.getTime()) < 86_400_000
        ? "high"
        : "normal",
    surfacedBecause:
      state === "final"
        ? "Latest favorite-team result"
        : state === "live"
          ? "Favorite-team game is live"
          : "Upcoming favorite-team game",
    source: {
      provider: "sports",
      connectionId: "thesportsdb",
      externalId: event.idEvent ?? `${team.id}:${instant.toISOString()}`,
      fetchedAt,
      deepLink: event.idEvent
        ? `https://www.thesportsdb.com/event/${event.idEvent}`
        : "https://www.thesportsdb.com/",
    },
  };
}

/**
 * v2 returns both directions under `schedule`; v1 splits them into `events` and
 * `results`. Callers only ever want the list, so normalise here.
 */
async function fetchTeamSchedule(
  client: SportsDbClient,
  direction: "next" | "previous",
  teamId: string,
  timeoutMs: number,
): Promise<SportsDbEvent[]> {
  if (client.premium) {
    const response = await fetchJson<{ schedule?: SportsDbEvent[] | null }>(
      `${SPORTSDB_V2_BASE}/schedule/${direction}/team/${teamId}`,
      timeoutMs,
      { "X-API-KEY": client.apiKey },
    );
    return response.schedule ?? [];
  }
  const endpoint = direction === "next" ? "eventsnext.php" : "eventslast.php";
  const response = await fetchJson<{
    events?: SportsDbEvent[] | null;
    results?: SportsDbEvent[] | null;
  }>(
    `${SPORTSDB_V1_BASE}/${encodeURIComponent(client.apiKey)}/${endpoint}?id=${teamId}`,
    timeoutMs,
  );
  return response.events ?? response.results ?? [];
}

/**
 * A finished game earns its own card only while it is recent enough to land in
 * yesterday or today on the page, and only when the feed carries a real final score: postponed and
 * abandoned fixtures also arrive dated in the past, with the scores left empty.
 */
function isFreshResult(event: SportsDbEvent, now: Date): boolean {
  if (!COMPLETED_STATUSES.has((event.strStatus ?? "").toUpperCase())) return false;
  if (!scoreLabel(event)) return false;
  const instant = eventInstant(event);
  return Boolean(instant && instant.getTime() >= now.getTime() - RESULTS_LOOKBACK_MS);
}

/**
 * Yesterday's result and the next game are two separate cards, so both feeds are
 * always read. Choosing between them here would hide a score the moment the team
 * had another game on the calendar, which for an in-season team is every day.
 */
async function fetchTeamItems(
  team: TeamDefinition,
  client: SportsDbClient,
  now: Date,
  timeZone: string,
  fetchedAt: string,
  timeoutMs: number,
): Promise<SportsItem[]> {
  const upcoming = await fetchTeamSchedule(client, "next", team.id, timeoutMs);
  const next = upcoming.find((event) => {
    const instant = eventInstant(event);
    return instant && instant.getTime() >= now.getTime() - 6 * 60 * 60 * 1000;
  });
  const completed = await fetchTeamSchedule(client, "previous", team.id, timeoutMs);
  const recent = completed.find((event) => eventInstant(event));
  const results = completed.filter((event) => isFreshResult(event, now));
  // A game that kicked off in the last few hours can sit in both feeds, and two
  // cards for one event would collide on the id derived from it.
  const scheduled =
    next && next.idEvent && results.some((event) => event.idEvent === next.idEvent)
      ? undefined
      : next;
  const items: SportsItem[] = [];
  for (const result of results) {
    const item = sportsItem(team, result, undefined, now, timeZone, fetchedAt);
    if (item) items.push(item);
  }
  if (scheduled) {
    // The upcoming card only restates the last score when no result card carries
    // it — that is the older-than-a-day case, where the context is all there is.
    const item = sportsItem(
      team,
      scheduled,
      results.length ? undefined : recent,
      now,
      timeZone,
      fetchedAt,
    );
    if (item) items.push(item);
  }
  return items;
}

interface IowaStateScheduleDefinition {
  name: string;
  sportLabel: string;
  url: string;
  league: string;
}

const iowaStateSchedules: IowaStateScheduleDefinition[] = [
  {
    name: "Iowa State football",
    sportLabel: "Football",
    url: "https://cyclones.com/sports/football/schedule/2026",
    league: "NCAA football",
  },
  {
    name: "Iowa State men's basketball",
    sportLabel: "Men's Basketball",
    url: "https://cyclones.com/sports/mens-basketball/schedule/",
    league: "NCAA men's basketball",
  },
];

function decodeHtml(value: string): string {
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

async function downloadHtml(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html",
        "User-Agent": "Brief-Daily-Sports/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Iowa State schedule returned HTTP ${response.status}.`);
    const html = await response.text();
    if (Buffer.byteLength(html, "utf8") > 2 * 1024 * 1024) {
      throw new Error("Iowa State schedule exceeded the size limit.");
    }
    return html;
  } finally {
    clearTimeout(timeout);
  }
}

/** The scraped schedule gives a date but no zone, so anchor it at midday UTC. */
function scheduleInstant(dateText: string): Date | undefined {
  const date = new Date(`${dateText} 12:00:00 UTC`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function scheduleLabel(dateText: string, timeText: string): string {
  const date = scheduleInstant(dateText);
  const label = date
    ? new Intl.DateTimeFormat("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
      }).format(date)
    : dateText;
  return `${label} · ${timeText === "Noon" ? "12:00 PM" : timeText}`;
}

async function fetchIowaStateItem(
  definition: IowaStateScheduleDefinition,
  fetchedAt: string,
  timeoutMs: number,
): Promise<SportsItem | undefined> {
  const html = await downloadHtml(definition.url, timeoutMs);
  const escapedSport = definition.sportLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const searchableText = decodeHtml(html)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
  const pattern = new RegExp(
    `Upcoming Event:\\s*${escapedSport}\\s+(?:versus|at)\\s+(.+?)\\s+on\\s+([A-Z][a-z]+\\s+\\d{1,2},\\s+\\d{4})\\s+at\\s+(.+?)(?=\\s+(?:Upcoming Event:|Buy Tickets|Live Stats|[A-Z][a-z]{2}\\s+\\d{1,2})|$)`,
    "gi",
  );
  const match = pattern.exec(searchableText);
  if (!match) return undefined;
  const opponent = decodeHtml(match[1].trim());
  const dateText = decodeHtml(match[2].trim());
  const timeText = decodeHtml(match[3].trim());
  return {
    id: `sports-iowa-${createHash("sha256")
      .update(`${definition.name}:${dateText}:${opponent}`, "utf8")
      .digest("base64url")
      .slice(0, 22)}`,
    kind: "sports",
    title: `${definition.name} vs ${opponent}`,
    team: definition.name,
    logoPath: "https://r2.thesportsdb.com/images/media/team/badge/4jixla1564336059.png",
    opponent,
    startsAt: scheduleLabel(dateText, timeText),
    occursAt: scheduleInstant(dateText)?.toISOString(),
    state: "scheduled",
    league: definition.league,
    group: "local",
    context: "Next game on the official Iowa State schedule.",
    standingLabel: "2026 season · 0–0",
    zone: "public",
    sensitivity: "public",
    importance: "normal",
    surfacedBecause: "Upcoming Iowa State game",
    source: {
      provider: "sports",
      connectionId: "iowa-state-athletics",
      externalId: `${definition.name}:${dateText}:${opponent}`,
      fetchedAt,
      deepLink: definition.url,
    },
  };
}

function tournamentItems(fetchedAt: string): SportsItem[] {
  return [
    {
      id: "sports-world-cup-2026-recap",
      kind: "sports",
      title: "Spain are FIFA World Cup 2026 champions",
      team: "FIFA World Cup",
      logoPath: "/team-logos/world-cup.svg",
      opponent: "Argentina",
      startsAt: "Jul 19, 2026 · 3:00 PM",
      occursAt: "2026-07-19T19:00:00Z",
      state: "final",
      scoreLabel: "Champion · Spain",
      league: "FIFA World Cup 2026",
      group: "international",
      context: "Spain won the final in New York New Jersey on July 19.",
      standingLabel: "Tournament complete · 48 teams",
      zone: "public",
      sensitivity: "public",
      importance: "normal",
      surfacedBecause: "Latest men's World Cup recap",
      source: {
        provider: "sports",
        connectionId: "fifa-official-calendar",
        externalId: "fifa-world-cup-2026-champion",
        fetchedAt,
        deepLink:
          "https://www.fifa.com/en/tournaments/mens/worldcup/canadamexicousa2026/articles/spain-men-women-first-simultaneous-champions",
      },
    },
    {
      id: "sports-womens-world-cup-2027",
      kind: "sports",
      title: "FIFA Women's World Cup Brazil 2027",
      team: "Women's World Cup",
      logoPath: "/team-logos/world-cup.svg",
      opponent: "32-team tournament",
      startsAt: "Jun 24–Jul 25, 2027",
      occursAt: "2027-06-24T12:00:00Z",
      state: "scheduled",
      league: "FIFA Women's World Cup",
      group: "international",
      context: "Brazil hosts across eight cities; the match schedule is still to come.",
      standingLabel: "14 of 32 teams qualified",
      zone: "public",
      sensitivity: "public",
      importance: "normal",
      surfacedBecause: "Followed global tournament",
      source: {
        provider: "sports",
        connectionId: "fifa-official-calendar",
        externalId: "fifa-womens-world-cup-2027",
        fetchedAt,
        deepLink:
          "https://www.fifa.com/en/tournaments/womens/womensworldcup/brazil-2027",
      },
    },
    {
      id: "sports-olympics-la28",
      kind: "sports",
      title: "LA28 Olympic Games",
      team: "Olympic Games",
      logoPath: "/team-logos/olympics.svg",
      opponent: "Los Angeles 2028",
      startsAt: "Jul 14–30, 2028",
      occursAt: "2028-07-14T12:00:00Z",
      state: "scheduled",
      league: "Summer Olympics",
      group: "international",
      context: "Opening Ceremony is scheduled for July 14, 2028.",
      standingLabel: "Official competition schedule available",
      zone: "public",
      sensitivity: "public",
      importance: "normal",
      surfacedBecause: "Followed Olympic event",
      source: {
        provider: "sports",
        connectionId: "la28-official-calendar",
        externalId: "la28-olympic-games",
        fetchedAt,
        deepLink: "https://la28.org/en.html",
      },
    },
  ];
}

/** Undated items sort last rather than jumbling the chronology at the top. */
function itemInstant(item: SportsItem): number {
  const instant = item.occursAt ? Date.parse(item.occursAt) : Number.NaN;
  return Number.isNaN(instant) ? Number.POSITIVE_INFINITY : instant;
}

function ordinal(value: string | number | undefined): string | undefined {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return undefined;
  const remainder = number % 100;
  const suffix =
    remainder >= 11 && remainder <= 13
      ? "th"
      : number % 10 === 1
        ? "st"
        : number % 10 === 2
          ? "nd"
          : number % 10 === 3
            ? "rd"
            : "th";
  return `${number}${suffix}`;
}

function numericScore(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Derives the league table from match results rather than reading TheSportsDB's
 * published one, which for USL League One can sit unrefreshed for months while
 * the fixture results stay current.
 *
 * Ranked on points, then wins, then goal difference, then goals scored. Note
 * this counts every completed fixture the season feed returns, so once playoff
 * matches appear they will be folded in alongside the regular season.
 */
function computeLeagueTable(events: SportsDbSeasonEvent[]): LeagueTableRow[] {
  const rows = new Map<string, LeagueTableRow>();
  const rowFor = (teamId: string): LeagueTableRow => {
    const existing = rows.get(teamId);
    if (existing) return existing;
    const created: LeagueTableRow = {
      teamId,
      played: 0,
      wins: 0,
      draws: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      points: 0,
    };
    rows.set(teamId, created);
    return created;
  };
  const record = (row: LeagueTableRow, scored: number, conceded: number) => {
    row.played += 1;
    row.goalsFor += scored;
    row.goalsAgainst += conceded;
    if (scored > conceded) {
      row.wins += 1;
      row.points += 3;
    } else if (scored === conceded) {
      row.draws += 1;
      row.points += 1;
    }
  };

  for (const event of events) {
    if (!COMPLETED_STATUSES.has((event.strStatus ?? "").toUpperCase())) continue;
    const home = event.idHomeTeam;
    const away = event.idAwayTeam;
    const homeScore = numericScore(event.intHomeScore);
    const awayScore = numericScore(event.intAwayScore);
    if (!home || !away || homeScore === undefined || awayScore === undefined) {
      continue;
    }
    record(rowFor(home), homeScore, awayScore);
    record(rowFor(away), awayScore, homeScore);
  }

  return [...rows.values()].sort(
    (left, right) =>
      right.points - left.points ||
      right.wins - left.wins ||
      right.goalsFor -
        right.goalsAgainst -
        (left.goalsFor - left.goalsAgainst) ||
      right.goalsFor - left.goalsFor,
  );
}

/**
 * v2 publishes no league-table endpoint, so the USL standings stay on v1.
 * A premium key works there too.
 */
async function fetchStandingLabels(
  client: SportsDbClient,
  year: number,
  timeoutMs: number,
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const [mlb, nhl, usl] = await Promise.allSettled([
    fetchJson<{ records?: Array<{ teamRecords?: MlbStanding[] }> }>(
      `https://statsapi.mlb.com/api/v1/standings?leagueId=103,104&season=${year}&standingsTypes=regularSeason`,
      timeoutMs,
    ),
    fetchJson<{ standings?: NhlStanding[] }>(
      "https://api-web.nhle.com/v1/standings/now",
      timeoutMs,
    ),
    fetchJson<{ events?: SportsDbSeasonEvent[] | null }>(
      `${SPORTSDB_V1_BASE}/${encodeURIComponent(client.apiKey)}/eventsseason.php?id=${USL_LEAGUE_ONE_ID}&s=${year}`,
      timeoutMs,
    ),
  ]);
  if (mlb.status === "fulfilled") {
    const records = (mlb.value.records ?? []).flatMap(
      (record) => record.teamRecords ?? [],
    );
    for (const record of records) {
      const rank = ordinal(record.divisionRank);
      if (record.team?.id === 111 && rank) {
        labels.set(
          "Boston Red Sox",
          `${rank} · AL East${record.gamesBack && record.gamesBack !== "-" ? ` · ${record.gamesBack} GB` : ""}`,
        );
      }
      if (record.team?.id === 158 && rank) {
        labels.set(
          "Milwaukee Brewers",
          `${rank} · NL Central${record.gamesBack && record.gamesBack !== "-" ? ` · ${record.gamesBack} GB` : ""}`,
        );
      }
    }
  }
  if (nhl.status === "fulfilled") {
    const kraken = nhl.value.standings?.find(
      (standing) => standing.teamAbbrev?.default === "SEA",
    );
    const rank = ordinal(kraken?.divisionSequence);
    if (kraken && rank) {
      labels.set("Seattle Kraken", `${rank} · Pacific · ${kraken.points ?? 0} pts`);
    }
  }
  if (usl.status === "fulfilled") {
    const table = computeLeagueTable(usl.value.events ?? []);
    const position = table.findIndex((row) => row.teamId === FORWARD_MADISON_ID);
    const madison = table[position];
    const rank = ordinal(position + 1);
    if (madison && rank) {
      labels.set("Forward Madison FC", `${rank} · USL1 · ${madison.points} pts`);
    }
  }
  return labels;
}

export async function fetchLiveSports(timeZone: string): Promise<LiveSportsResult> {
  const now = new Date();
  if (cache && cache.expiresAt > now.getTime()) return cache.result;

  const fetchedAt = now.toISOString();
  const timeoutMs = environmentNumber("SPORTS_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const cacheSeconds = environmentNumber("SPORTS_CACHE_SECONDS", DEFAULT_CACHE_SECONDS);
  const configuredKey = process.env.THESPORTSDB_API_KEY?.trim();
  const client: SportsDbClient = configuredKey
    ? { apiKey: configuredKey, premium: true }
    : { apiKey: SPORTSDB_FREE_KEY, premium: false };
  const items: SportsItem[] = [];
  let failures = 0;
  const standingLabels = await fetchStandingLabels(
    client,
    now.getUTCFullYear(),
    timeoutMs,
  );
  for (const team of teams) {
    try {
      items.push(
        ...(await fetchTeamItems(
          team,
          client,
          now,
          timeZone,
          fetchedAt,
          timeoutMs,
        )),
      );
    } catch {
      failures += 1;
    }
    await pause(150);
  }
  const leagueResults = await Promise.allSettled(
    leagueTeams.map((team) => fetchLeagueTeamItems(team, now, timeZone, fetchedAt, timeoutMs)),
  );
  for (const outcome of leagueResults) {
    if (outcome.status === "fulfilled") items.push(...outcome.value);
    else failures += 1;
  }
  for (const definition of iowaStateSchedules) {
    try {
      const item = await fetchIowaStateItem(definition, fetchedAt, timeoutMs);
      if (item) items.push(item);
    } catch {
      failures += 1;
    }
  }
  items.push(...tournamentItems(fetchedAt));
  for (const item of items) {
    const standingLabel = standingLabels.get(item.team);
    if (standingLabel) item.standingLabel = standingLabel;
  }
  items.sort((left, right) => {
    const leftInstant = itemInstant(left);
    const rightInstant = itemInstant(right);
    // Both undated compare as Infinity; subtracting would yield NaN.
    return leftInstant === rightInstant ? 0 : leftInstant - rightInstant;
  });
  const result: LiveSportsResult = {
    ok: items.length > 0,
    items,
    fetchedAt,
    warnings: failures ? [`${failures} sports feeds were temporarily unavailable.`] : [],
    error: items.length ? undefined : "Live sports feeds could not be reached.",
  };
  if (result.ok && failures === 0) {
    cache = { expiresAt: now.getTime() + cacheSeconds * 1000, result };
  } else if (cache) {
    return {
      ...cache.result,
      warnings: [...cache.result.warnings, "Showing the last successful sports snapshot."],
    };
  }
  return result;
}
