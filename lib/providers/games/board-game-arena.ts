import "server-only";

import type { BgaPanel, BgaTable } from "@/lib/briefing-types";

/**
 * Your Board Game Arena tables and whose turn it is at each.
 *
 * BGA has no public API and answers every request about a player's tables
 * with "Invalid session" unless the request carries a signed-in session. The
 * build therefore sends the browser session cookie in BGA_SESSION_COOKIE:
 *
 * 1. GET /gameinprogress, the page that lists your tables. A signed-out
 *    session is redirected to /account; a signed-in one gets a page holding
 *    your player id, a per-session request token, and every game's name.
 * 2. GET the table list the page itself loads, with that token.
 *
 * Nothing is cached across a failure: a cookie BGA stops accepting reads as
 * "signed-out" and an outage as "unavailable", never as the last good list.
 */

const ORIGIN = "https://boardgamearena.com";
const DEFAULT_TIMEOUT_MS = 10_000;
/** Long enough to share one read between the two builds of today's page. */
const CACHE_MS = 5 * 60 * 1000;
const MAX_PAGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 3;
/** Statuses of tables that have started and not finished. */
const PLAYING = new Set(["play", "asyncplay"]);
/** BGA's "Invalid session information" error. */
const INVALID_SESSION_CODE = 806;

let cache: { expiresAt: number; panel: Promise<BgaPanel> } | undefined;

class SignedOut extends Error {}

function environmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

/** Only BGA's own hosts, over HTTPS, so the cookie never leaves BGA. */
function isBgaUrl(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "boardgamearena.com" || url.hostname.endsWith(".boardgamearena.com"))
  );
}

/**
 * Follows redirects by hand: fetch drops the Cookie header when a redirect
 * changes host (boardgamearena.com sends visitors on to en.boardgamearena.com).
 */
async function bgaFetch(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<{ response: Response; url: URL }> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const response = await fetch(current, { headers, redirect: "manual", signal });
    if (response.status < 300 || response.status >= 400) return { response, url: current };
    const location = response.headers.get("location");
    if (!location) return { response, url: current };
    const next = new URL(location, current);
    if (!isBgaUrl(next)) throw new Error("Board Game Arena redirected somewhere unexpected.");
    // Signed-out sessions are sent to the login page.
    if (next.pathname.startsWith("/account")) throw new SignedOut();
    current = next;
  }
  throw new Error("Board Game Arena redirected too many times.");
}

/** Game slug ("seasaltpaper") to English name ("Sea Salt & Paper"). */
function gameNames(html: string): Map<string, string> {
  const names = new Map<string, string>();
  for (const match of html.matchAll(/"name":"([a-z0-9_]+)","display_name_en":"((?:[^"\\]|\\.)*)"/g)) {
    try {
      names.set(match[1], JSON.parse(`"${match[2]}"`) as string);
    } catch {
      // Leave it to the slug fallback.
    }
  }
  return names;
}

/** "Sevenwondersduel" for "sevenwondersduel", when BGA's page did not name the game. */
function fallbackName(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

export function parseTables(body: unknown, playerId: string, names: Map<string, string>): BgaTable[] {
  if (!isRecord(body) || !isRecord(body.data) || !isRecord(body.data.tables)) return [];
  const tables = Object.values(body.data.tables).flatMap((table): BgaTable[] => {
    if (!isRecord(table) || !isRecord(table.players)) return [];
    const id = text(table.id);
    const slug = text(table.game_name);
    const status = text(table.status);
    if (!id || !/^\d+$/.test(id) || !slug || !status || !PLAYING.has(status)) return [];
    const players = Object.values(table.players).filter(isRecord);
    const seated = players.some((player) => text(player.id) === playerId);
    if (!seated) return [];
    const toMove = players.filter((player) => text(player.myturn) === "1");
    const progress = Number(text(table.progression));
    return [
      {
        id,
        game: names.get(slug) ?? fallbackName(slug),
        url: `${ORIGIN}/table?table=${id}`,
        progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, Math.round(progress))) : 0,
        turn: toMove
          .filter((player) => text(player.id) !== playerId)
          .map((player) => text(player.fullname) ?? "Someone"),
        isMyTurn: toMove.some((player) => text(player.id) === playerId),
        playerCount: players.length,
      },
    ];
  });
  // Your turn first, then the game furthest along.
  return tables.sort(
    (left, right) => Number(right.isMyTurn) - Number(left.isMyTurn) || right.progress - left.progress,
  );
}

async function readTables(cookie: string): Promise<BgaPanel> {
  const checkedAt = new Date().toISOString();
  const timeoutMs = environmentNumber("BGA_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const headers: Record<string, string> = {
    Cookie: cookie,
    "User-Agent": process.env.BGA_USER_AGENT?.trim() || "Brief-Daily-Games/1.0",
    "Accept-Language": "en",
  };
  try {
    const page = await bgaFetch(new URL("/gameinprogress", ORIGIN), { ...headers, Accept: "text/html" }, controller.signal);
    if (!page.response.ok) throw new Error(`Board Game Arena returned HTTP ${page.response.status}.`);
    const html = await page.response.text();
    if (html.length > MAX_PAGE_BYTES) throw new Error("The Board Game Arena page exceeded the size limit.");

    const playerId = html.match(/globalUserInfos=\{"id":"(\d+)"/)?.[1];
    const token = html.match(/requestToken:\s*'([A-Za-z0-9]+)'/)?.[1];
    if (!playerId || playerId === "0") throw new SignedOut();
    if (!token) throw new Error("Board Game Arena changed its page; the request token is missing.");

    const listUrl = new URL("/tablemanager/tablemanager/tableinfos.html", page.url.origin);
    listUrl.searchParams.set("playerfilter", playerId);
    listUrl.searchParams.set("turninfo", "true");
    listUrl.searchParams.set("matchmakingtables", "true");
    const list = await bgaFetch(
      listUrl,
      { ...headers, Accept: "application/json", "X-Request-Token": token, "X-Requested-With": "XMLHttpRequest" },
      controller.signal,
    );
    if (!list.response.ok) throw new Error(`Board Game Arena returned HTTP ${list.response.status}.`);
    const body: unknown = await list.response.json();
    if (!isRecord(body) || String(body.status) !== "1") {
      if (isRecord(body) && Number(body.code) === INVALID_SESSION_CODE) throw new SignedOut();
      throw new Error("Board Game Arena did not return your tables.");
    }
    return { state: "ok", tables: parseTables(body, playerId, gameNames(html)), checkedAt };
  } catch (error) {
    if (error instanceof SignedOut) {
      return {
        state: "signed-out",
        tables: [],
        checkedAt,
        message: "Board Game Arena no longer accepts BGA_SESSION_COOKIE. Sign in again and copy a fresh cookie.",
      };
    }
    // Never echo the cookie: only our own messages or a timeout reach the page.
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      state: "unavailable",
      tables: [],
      checkedAt,
      message: timedOut
        ? "Board Game Arena did not answer in time."
        : error instanceof Error && error.message.startsWith("Board Game Arena")
          ? error.message
          : "Board Game Arena could not be reached.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchBoardGameArena(): Promise<BgaPanel> {
  const cookie = process.env.BGA_SESSION_COOKIE?.trim();
  if (!cookie) {
    return {
      state: "signed-out",
      tables: [],
      checkedAt: new Date().toISOString(),
      message: "BGA_SESSION_COOKIE is not set.",
    };
  }
  const now = Date.now();
  if (!cache || cache.expiresAt <= now) {
    cache = { expiresAt: now + CACHE_MS, panel: readTables(cookie) };
  }
  const panel = await cache.panel;
  // Only a good read is worth sharing; try again next time after a failure.
  if (panel.state !== "ok") cache = undefined;
  return panel;
}
