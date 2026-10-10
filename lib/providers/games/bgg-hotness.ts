import "server-only";

import { XMLParser } from "fast-xml-parser";

import type { HotGameItem, HotGamesPanel } from "@/lib/briefing-types";

/**
 * The bare domain matters: www.boardgamegeek.com answers 301, and following
 * that redirect drops the Authorization header, which reads as a plain 401.
 */
const BGG_HOT_URL = "https://boardgamegeek.com/xmlapi2/hot?type=boardgame";
const DEFAULT_TIMEOUT_MS = 8_000;
/** The hotness list turns over slowly; an hour is plenty. */
const DEFAULT_CACHE_SECONDS = 60 * 60;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_ITEMS = 10;
/** Hosts allowed in next.config.ts. Anything else renders without an image. */
const THUMBNAIL_HOSTS = new Set([
  "cf.geekdo-images.com",
  "cf.geekdo-static.com",
]);
const ATTRIBUTION = "Powered by BGG";

let cache: { expiresAt: number; items: HotGameItem[] } | undefined;

function environmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** BGG nests every field as `<name value="..."/>` rather than as text. */
function attributeValue(node: unknown): string | undefined {
  if (!isRecord(node)) return undefined;
  const value = node["@_value"];
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number") return String(value);
  return undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function safeThumbnail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value, "https://boardgamegeek.com");
    if (url.protocol !== "https:") return undefined;
    return THUMBNAIL_HOSTS.has(url.hostname) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parseHotItems(xml: string): HotGameItem[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    trimValues: true,
  });
  const document: unknown = parser.parse(xml);
  if (!isRecord(document)) return [];
  const container = document.items;
  if (!isRecord(container)) return [];
  const raw = container.item;
  const entries = Array.isArray(raw) ? raw : raw ? [raw] : [];

  const items = entries.flatMap((entry): HotGameItem[] => {
    if (!isRecord(entry)) return [];
    const id = entry["@_id"];
    const rank = positiveInteger(entry["@_rank"]);
    const name = attributeValue(entry.name);
    if ((typeof id !== "string" && typeof id !== "number") || !rank || !name) {
      return [];
    }
    const gameId = String(id);
    return [
      {
        id: gameId,
        rank,
        name,
        yearPublished: positiveInteger(attributeValue(entry.yearpublished)),
        thumbnailUrl: safeThumbnail(attributeValue(entry.thumbnail)),
        url: `https://boardgamegeek.com/boardgame/${encodeURIComponent(gameId)}`,
      },
    ];
  });

  return items.sort((left, right) => left.rank - right.rank).slice(0, MAX_ITEMS);
}

/**
 * BoardGameGeek's hot list. Returns undefined when no token is configured, so
 * the dashboard can omit the card entirely rather than showing an empty shell.
 * Getting a token means registering a (free, non-commercial) application at
 * https://boardgamegeek.com/applications — a BGG login alone will not do.
 */
export async function fetchBggHotness(): Promise<HotGamesPanel | undefined> {
  const token = process.env.BGG_API_TOKEN?.trim();
  if (!token) return undefined;

  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return { items: cache.items, attribution: ATTRIBUTION };
  }

  const timeoutMs = environmentNumber("BGG_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const cacheSeconds = environmentNumber(
    "BGG_CACHE_SECONDS",
    DEFAULT_CACHE_SECONDS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(BGG_HOT_URL, {
      headers: {
        Accept: "application/xml, text/xml",
        Authorization: `Bearer ${token}`,
        "User-Agent": "Brief-Daily-Games/1.0",
      },
      // Never follow a redirect: it would strip the Authorization header.
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        "BoardGameGeek rejected the application token. Check BGG_API_TOKEN and that the application is approved.",
      );
    }
    if (!response.ok) {
      throw new Error(`BoardGameGeek returned HTTP ${response.status}.`);
    }
    const xml = await response.text();
    if (Buffer.byteLength(xml, "utf8") > MAX_BODY_BYTES) {
      throw new Error("The BoardGameGeek hot list exceeded the size limit.");
    }
    const items = parseHotItems(xml);
    if (items.length === 0) {
      throw new Error("BoardGameGeek returned no usable hot-list entries.");
    }
    cache = { expiresAt: now + cacheSeconds * 1000, items };
    return { items, attribution: ATTRIBUTION };
  } catch (error) {
    // Keep the last good list rather than blanking the card on a blip.
    if (cache) return { items: cache.items, attribution: ATTRIBUTION };
    return {
      items: [],
      attribution: ATTRIBUTION,
      message:
        error instanceof Error
          ? error.message
          : "The BoardGameGeek hot list could not be loaded.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
