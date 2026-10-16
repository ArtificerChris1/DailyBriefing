import "server-only";

import type { SportsItem } from "@/lib/briefing-types";
import { fetchJson, relativeStart, RESULTS_LOOKBACK_MS } from "@/lib/providers/sports/shared";

/**
 * Teams read from each league's own schedule feed, or ESPN's where the league
 * publishes none. TheSportsDB used to serve these and went down for days at a
 * time, taking results with it; these feeds also carry playoff series status.
 */

type Feed =
  | { kind: "mlb"; sportId: number; teamId: number }
  | { kind: "nhl"; abbrev: string }
  | { kind: "espn"; path: string; teamId: string; soccer?: boolean };

interface LeagueTeam {
  name: string;
  /** How a recap names the team: "Brewers won 6–4." */
  short: string;
  logoPath: string;
  league: string;
  group: SportsItem["group"];
  feed: Feed;
}

export const leagueTeams: LeagueTeam[] = [
  {
    name: "Forward Madison FC",
    short: "Forward Madison",
    logoPath: "/team-logos/forward-madison-fc.png",
    league: "USL League One",
    group: "local",
    feed: { kind: "espn", path: "soccer/usa.usl.l1", teamId: "19995", soccer: true },
  },
  {
    name: "Cedar Rapids Kernels",
    short: "Kernels",
    logoPath: "/team-logos/cedar-rapids-kernels.svg",
    league: "MiLB · Midwest League",
    group: "local",
    feed: { kind: "mlb", sportId: 13, teamId: 492 },
  },
  {
    name: "Boston Red Sox",
    short: "Red Sox",
    logoPath: "/team-logos/boston-red-sox.svg",
    league: "MLB",
    group: "seattle-boston",
    feed: { kind: "mlb", sportId: 1, teamId: 111 },
  },
  {
    name: "Seattle Kraken",
    short: "Kraken",
    logoPath: "https://r2.thesportsdb.com/images/media/team/badge/zsx49m1595775836.png",
    league: "NHL",
    group: "seattle-boston",
    feed: { kind: "nhl", abbrev: "SEA" },
  },
  {
    name: "Seattle Sounders FC",
    short: "Sounders",
    logoPath: "/team-logos/seattle-sounders-fc.png",
    league: "MLS",
    group: "seattle-boston",
    feed: { kind: "espn", path: "soccer/usa.1", teamId: "9726", soccer: true },
  },
  {
    name: "São Paulo FC",
    short: "São Paulo",
    logoPath: "/team-logos/sao-paulo-fc.svg",
    league: "Brazilian Série A",
    group: "international",
    feed: { kind: "espn", path: "soccer/bra.1", teamId: "2026", soccer: true },
  },
  {
    name: "Green Bay Packers",
    short: "Packers",
    logoPath: "https://r2.thesportsdb.com/images/media/team/badge/uwbfw01784719173.png",
    league: "NFL",
    group: "wisconsin",
    feed: { kind: "espn", path: "football/nfl", teamId: "9" },
  },
  {
    name: "Milwaukee Bucks",
    short: "Bucks",
    logoPath: "https://r2.thesportsdb.com/images/media/team/badge/olhug01621594702.png",
    league: "NBA",
    group: "wisconsin",
    feed: { kind: "espn", path: "basketball/nba", teamId: "15" },
  },
  {
    name: "Milwaukee Brewers",
    short: "Brewers",
    logoPath: "https://r2.thesportsdb.com/images/media/team/badge/08kh2a1595775193.png",
    league: "MLB",
    group: "wisconsin",
    feed: { kind: "mlb", sportId: 1, teamId: 158 },
  },
];

interface Side {
  name: string;
  score?: number;
  ours: boolean;
}

/** One game, whichever feed it came from. */
interface Game {
  key: string;
  instant: Date;
  state: SportsItem["state"];
  home: Side;
  away: Side;
  /** How it ended or why it did not start: "OT", "SO", "Postponed". */
  note?: string;
  /** The feed has a date but no start time yet; its clock is a placeholder. */
  timeTbd?: boolean;
  /** Playoff round and standing, e.g. "Milwaukee Brewers won the NL Championship Series 4–0". */
  series?: string;
  link: string;
}

function score(value: unknown): number | undefined {
  const raw =
    value && typeof value === "object"
      ? ((value as { displayValue?: unknown; value?: unknown }).displayValue ??
        (value as { value?: unknown }).value)
      : value;
  if (raw === null || raw === undefined || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

// MLB Stats API: the league's own feed, minor leagues included.

interface MlbSeriesStatus {
  isOver?: boolean;
  isTied?: boolean;
  wins?: number;
  losses?: number;
  description?: string;
  result?: string;
  winningTeam?: { name?: string };
}

interface MlbGame {
  gamePk?: number;
  gameDate?: string;
  gameType?: string;
  status?: { detailedState?: string; abstractGameState?: string; startTimeTBD?: boolean };
  seriesStatus?: MlbSeriesStatus;
  teams?: {
    away?: { score?: number; team?: { id?: number; name?: string } };
    home?: { score?: number; team?: { id?: number; name?: string } };
  };
}

/** Regular season, spring training, exhibitions and the All-Star Game have no series worth naming. */
const MLB_NON_SERIES_TYPES = new Set(["R", "S", "E", "A"]);

function mlbSeries(game: MlbGame): string | undefined {
  const status = game.seriesStatus;
  if (!status?.description || MLB_NON_SERIES_TYPES.has(game.gameType ?? "R")) return undefined;
  const wins = status.wins ?? 0;
  const losses = status.losses ?? 0;
  if (status.isOver && status.winningTeam?.name) {
    return `${status.winningTeam.name} won the ${status.description} ${Math.max(wins, losses)}–${Math.min(wins, losses)}`;
  }
  // Before Game 1 the round is all there is to say.
  if (wins + losses === 0) return status.description;
  if (status.isTied) return `${status.description} tied ${wins}–${losses}`;
  return status.result ? `${status.description}: ${status.result}` : status.description;
}

async function mlbGames(feed: Extract<Feed, { kind: "mlb" }>, now: Date, timeoutMs: number): Promise<Game[]> {
  const start = isoDate(new Date(now.getTime() - RESULTS_LOOKBACK_MS));
  const end = isoDate(new Date(now.getTime() + 14 * 86_400_000));
  const response = await fetchJson<{ dates?: Array<{ games?: MlbGame[] }> }>(
    `https://statsapi.mlb.com/api/v1/schedule?sportId=${feed.sportId}&teamId=${feed.teamId}&startDate=${start}&endDate=${end}&hydrate=seriesStatus`,
    timeoutMs,
  );
  // A suspended game is listed under both its original and its resumption date
  // with one `gamePk`; the later entry is the one that actually finished.
  const byPk = new Map<number, MlbGame>();
  for (const game of (response.dates ?? []).flatMap((date) => date.games ?? [])) {
    if (!game.gamePk || !game.gameDate) continue;
    const previous = byPk.get(game.gamePk);
    if (!previous || Date.parse(previous.gameDate ?? "") < Date.parse(game.gameDate)) {
      byPk.set(game.gamePk, game);
    }
  }
  const host = feed.sportId === 1 ? "www.mlb.com" : "www.milb.com";
  return [...byPk.values()].map((game) => {
    const abstract = game.status?.abstractGameState;
    const detailed = game.status?.detailedState;
    const side = (entry: NonNullable<MlbGame["teams"]>["home"]): Side => ({
      name: entry?.team?.name ?? "TBD",
      score: entry?.score,
      ours: entry?.team?.id === feed.teamId,
    });
    return {
      key: String(game.gamePk),
      instant: new Date(game.gameDate as string),
      state:
        abstract === "Final" ? "final" : abstract === "Live" && detailed !== "Suspended" ? "live" : "scheduled",
      home: side(game.teams?.home),
      away: side(game.teams?.away),
      note: detailed && /Postponed|Suspended|Cancelled|Delayed/.test(detailed) ? detailed : undefined,
      series: mlbSeries(game),
      timeTbd: game.status?.startTimeTBD,
      link: `https://${host}/gameday/${game.gamePk}`,
    };
  });
}

// NHL: the league's own web API.

interface NhlTeam {
  abbrev?: string;
  placeName?: { default?: string };
  commonName?: { default?: string };
  score?: number;
}

interface NhlGame {
  id?: number;
  startTimeUTC?: string;
  gameState?: string;
  gameCenterLink?: string;
  gameOutcome?: { lastPeriodType?: string };
  awayTeam?: NhlTeam;
  homeTeam?: NhlTeam;
  seriesStatus?: {
    seriesTitle?: string;
    topSeedTeamAbbrev?: string;
    topSeedWins?: number;
    bottomSeedTeamAbbrev?: string;
    bottomSeedWins?: number;
  };
}

function nhlSeries(game: NhlGame): string | undefined {
  const status = game.seriesStatus;
  if (!status?.seriesTitle) return undefined;
  const top = { team: status.topSeedTeamAbbrev, wins: status.topSeedWins ?? 0 };
  const bottom = { team: status.bottomSeedTeamAbbrev, wins: status.bottomSeedWins ?? 0 };
  if (top.wins === bottom.wins) return `${status.seriesTitle} tied ${top.wins}–${bottom.wins}`;
  const [leader, trailer] = top.wins > bottom.wins ? [top, bottom] : [bottom, top];
  return leader.wins >= 4
    ? `${leader.team} won the ${status.seriesTitle} ${leader.wins}–${trailer.wins}`
    : `${status.seriesTitle}: ${leader.team} leads ${leader.wins}–${trailer.wins}`;
}

async function nhlGames(feed: Extract<Feed, { kind: "nhl" }>, timeoutMs: number): Promise<Game[]> {
  const response = await fetchJson<{ games?: NhlGame[] }>(
    `https://api-web.nhle.com/v1/club-schedule-season/${feed.abbrev}/now`,
    timeoutMs,
  );
  const side = (team: NhlTeam | undefined): Side => ({
    name: [team?.placeName?.default, team?.commonName?.default].filter(Boolean).join(" ") || "TBD",
    score: team?.score,
    ours: team?.abbrev === feed.abbrev,
  });
  return (response.games ?? [])
    .filter((game) => game.id && game.startTimeUTC)
    .map((game) => {
      const period = game.gameOutcome?.lastPeriodType;
      return {
        key: String(game.id),
        instant: new Date(game.startTimeUTC as string),
        state: ["OFF", "FINAL"].includes(game.gameState ?? "")
          ? "final"
          : ["LIVE", "CRIT"].includes(game.gameState ?? "")
            ? "live"
            : "scheduled",
        home: side(game.homeTeam),
        away: side(game.awayTeam),
        note: period && period !== "REG" ? period : undefined,
        series: nhlSeries(game),
        link: game.gameCenterLink
          ? `https://www.nhl.com${game.gameCenterLink}`
          : `https://www.nhl.com/gamecenter/${game.id}`,
      };
    });
}

// ESPN: NFL, NBA and soccer, whose leagues publish no open feed.

interface EspnCompetitor {
  homeAway?: "home" | "away";
  score?: unknown;
  team?: { id?: string; displayName?: string };
}

interface EspnEvent {
  id?: string;
  date?: string;
  links?: Array<{ href?: string }>;
  competitions?: Array<{
    status?: {
      type?: { state?: string; completed?: boolean; description?: string; shortDetail?: string };
    };
    competitors?: EspnCompetitor[];
    notes?: Array<{ headline?: string }>;
    series?: { summary?: string };
  }>;
}

async function espnGames(feed: Extract<Feed, { kind: "espn" }>, timeoutMs: number): Promise<Game[]> {
  const base = `https://site.api.espn.com/apis/site/v2/sports/${feed.path}/teams/${feed.teamId}/schedule`;
  // The plain schedule covers only results for soccer and only the current
  // season phase elsewhere, so fixtures, the regular season and the
  // postseason are asked for separately and merged.
  const queries = feed.soccer ? ["", "?fixture=true"] : ["", "?seasontype=2", "?seasontype=3"];
  const responses = await Promise.all(
    queries.map((query) => fetchJson<{ events?: EspnEvent[] }>(`${base}${query}`, timeoutMs)),
  );
  const events = new Map<string, EspnEvent>();
  for (const event of responses.flatMap((response) => response.events ?? [])) {
    if (event.id && event.date) events.set(event.id, event);
  }
  return [...events.values()].flatMap((event): Game[] => {
    const competition = event.competitions?.[0];
    const type = competition?.status?.type;
    const find = (homeAway: "home" | "away"): Side => {
      const competitor = competition?.competitors?.find((entry) => entry.homeAway === homeAway);
      return {
        name: competitor?.team?.displayName ?? "TBD",
        score: score(competitor?.score),
        ours: competitor?.team?.id === feed.teamId,
      };
    };
    const state: SportsItem["state"] = type?.completed
      ? "final"
      : type?.state === "in"
        ? "live"
        : "scheduled";
    // "Final/OT" → "OT"; a postponed or cancelled game says so in its description.
    const note = type?.completed
      ? /\/(\w+)$/.exec(type.shortDetail ?? "")?.[1]
      : type?.state === "post"
        ? type.description
        : undefined;
    const series = [competition?.notes?.[0]?.headline, competition?.series?.summary]
      .filter(Boolean)
      .join(" · ");
    return [
      {
        key: event.id as string,
        instant: new Date(event.date as string),
        state,
        home: find("home"),
        away: find("away"),
        note,
        series: series || undefined,
        link: event.links?.[0]?.href ?? `https://www.espn.com/${feed.path.split("/")[1]}/`,
      },
    ];
  });
}

// Shared: choosing a team's games and turning each into a card.

const NOTE_PHRASES: Record<string, string> = {
  OT: "in overtime",
  SO: "in a shootout",
  AET: "after extra time",
};

function recap(team: LeagueTeam, game: Game, soccer: boolean): string | undefined {
  const ours = game.home.ours ? game.home : game.away;
  const theirs = game.home.ours ? game.away : game.home;
  if (ours.score === undefined || theirs.score === undefined) return undefined;
  const verb =
    ours.score > theirs.score ? "won" : ours.score < theirs.score ? "lost" : soccer ? "drew" : "tied";
  const how = game.note ? ` ${NOTE_PHRASES[game.note] ?? `(${game.note})`}` : "";
  return `${team.short} ${verb} ${ours.score}–${theirs.score}${how}.`;
}

function toItem(team: LeagueTeam, game: Game, now: Date, timeZone: string, fetchedAt: string): SportsItem {
  const ours = game.home.ours ? game.home : game.away;
  const theirs = game.home.ours ? game.away : game.home;
  const soccer = team.feed.kind === "espn" && Boolean(team.feed.soccer);
  const hasScore = game.home.score !== undefined && game.away.score !== undefined;
  const series = game.series ? `${game.series}.` : undefined;
  const context =
    game.state === "final"
      ? [recap(team, game, soccer), series].filter(Boolean).join(" ")
      : game.state === "live"
        ? (series ?? "Game in progress.")
        : [game.note, series ?? `Upcoming ${team.league} game.`].filter(Boolean).join(" · ");
  return {
    id: `sports-${team.feed.kind}-${game.key}-${team.short.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    kind: "sports",
    title: `${game.away.name} at ${game.home.name}`,
    team: team.name,
    logoPath: team.logoPath,
    opponent: theirs.name,
    startsAt: game.timeTbd
      ? relativeStart(game.instant, now, timeZone).replace(/ · .*$/, " · Time TBD")
      : relativeStart(game.instant, now, timeZone),
    occursAt: game.instant.toISOString(),
    state: game.state,
    scoreLabel: hasScore
      ? `${game.away.name} ${game.away.score} · ${game.home.name} ${game.home.score}${game.note && game.state === "final" ? ` (${game.note})` : ""}`
      : undefined,
    league: team.league,
    group: team.group,
    context: context || undefined,
    zone: "public",
    sensitivity: "public",
    importance:
      game.state === "live" || Math.abs(game.instant.getTime() - now.getTime()) < 86_400_000
        ? "high"
        : "normal",
    surfacedBecause:
      game.state === "final"
        ? `${ours.name} result`
        : game.state === "live"
          ? "Favorite-team game is live"
          : "Upcoming favorite-team game",
    source: {
      provider: "sports",
      connectionId: team.feed.kind === "mlb" ? "mlb-stats" : team.feed.kind === "nhl" ? "nhl-api" : "espn",
      externalId: game.key,
      fetchedAt,
      deepLink: game.link,
    },
  };
}

/**
 * Every finished game from the last two days (the page keeps yesterday's and
 * today's), anything in progress, and the next game on the schedule.
 */
export async function fetchLeagueTeamItems(
  team: LeagueTeam,
  now: Date,
  timeZone: string,
  fetchedAt: string,
  timeoutMs: number,
): Promise<SportsItem[]> {
  const games =
    team.feed.kind === "mlb"
      ? await mlbGames(team.feed, now, timeoutMs)
      : team.feed.kind === "nhl"
        ? await nhlGames(team.feed, timeoutMs)
        : await espnGames(team.feed, timeoutMs);
  games.sort((left, right) => left.instant.getTime() - right.instant.getTime());
  const since = now.getTime() - RESULTS_LOOKBACK_MS;
  const selected = games.filter(
    (game) =>
      game.state === "live" ||
      (game.state === "final" &&
        game.instant.getTime() >= since &&
        game.home.score !== undefined &&
        game.away.score !== undefined),
  );
  const next = games.find(
    (game) => game.state === "scheduled" && game.instant.getTime() >= now.getTime() - 6 * 60 * 60 * 1000,
  );
  if (next) selected.push(next);
  return selected.map((game) => toItem(team, game, now, timeZone, fetchedAt));
}
