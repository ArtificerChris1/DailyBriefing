import "server-only";

import { createHash } from "node:crypto";

import type { PhotoOfDay } from "@/lib/briefing-types";

/**
 * Photo of the day from an iCloud Shared Album with "Public Website" turned on.
 *
 * Apple publishes no Photos API. A public shared album is served by the same
 * undocumented `sharedstreams` endpoints its web page uses: `webstream` lists
 * the photos, and `webasseturls` exchanges a photo's checksum for a short-lived
 * download URL. The build downloads the chosen image once and publishes it as
 * a static file, since those URLs expire within hours. Any failure hides the
 * card rather than breaking the build.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
/** Largest width worth downloading for a card; derivatives above it are skipped. */
const MAX_WIDTH = 2048;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/** Where the image is published; the route at this path serves the bytes. */
export const PHOTO_PATH = "/photo-of-the-day.jpg";

interface Derivative {
  checksum: string;
  width: number;
  height: number;
}

interface AlbumPhoto {
  photoGuid: string;
  caption?: string;
  takenAt?: string;
  derivative: Derivative;
}

export interface PhotoOfDayResult {
  photo: PhotoOfDay;
  image: ArrayBuffer;
}

function albumToken(): string | undefined {
  const url = process.env.ICLOUD_SHARED_ALBUM_URL?.trim();
  if (!url) return undefined;
  // https://www.icloud.com/sharedalbum/#B0aGWZuqDGKrA9R — the token is the fragment.
  const token = url.includes("#") ? url.slice(url.indexOf("#") + 1) : url;
  return /^[A-Za-z0-9]{10,}$/.test(token) ? token : undefined;
}

/** The token encodes which `pNN-sharedstreams` partition holds the album. */
function partitionHost(token: string): string {
  const digits = token.startsWith("A") ? token.slice(1, 2) : token.slice(1, 3);
  let partition = 0;
  for (const digit of digits) partition = partition * 62 + BASE62.indexOf(digit);
  return `p${String(partition).padStart(2, "0")}-sharedstreams.icloud.com`;
}

function timeoutMs(): number {
  const value = Number(process.env.ICLOUD_SHARED_ALBUM_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs()),
  });
}

/**
 * Calls one album endpoint, following Apple's 330 redirect when the guessed
 * partition is wrong. Returns the host that answered, for the next call.
 */
async function albumRequest(
  host: string,
  token: string,
  endpoint: "webstream" | "webasseturls",
  body: unknown,
): Promise<{ host: string; json: Record<string, unknown> }> {
  let response = await post(`https://${host}/${token}/sharedstreams/${endpoint}`, body);
  if (response.status === 330) {
    const redirect = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const nextHost =
      response.headers.get("X-Apple-MMe-Host") ??
      (typeof redirect["X-Apple-MMe-Host"] === "string" ? redirect["X-Apple-MMe-Host"] : undefined);
    if (!nextHost || !/^[a-z0-9.-]+\.icloud\.com$/.test(nextHost)) {
      throw new Error("The shared album redirected to an unexpected host.");
    }
    host = nextHost;
    response = await post(`https://${host}/${token}/sharedstreams/${endpoint}`, body);
  }
  if (!response.ok) throw new Error(`The shared album returned HTTP ${response.status}.`);
  return { host, json: (await response.json()) as Record<string, unknown> };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** The widest derivative that fits MAX_WIDTH, or the narrowest if none does. */
function pickDerivative(value: unknown): Derivative | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidates = Object.values(value as Record<string, unknown>)
    .map((entry) => {
      const item = entry as Record<string, unknown>;
      return {
        checksum: text(item.checksum) ?? "",
        width: Number(item.width),
        height: Number(item.height),
      };
    })
    .filter((item) => item.checksum && item.width > 0 && item.height > 0)
    .sort((left, right) => left.width - right.width);
  const fitting = candidates.filter((item) => item.width <= MAX_WIDTH);
  return fitting.at(-1) ?? candidates[0];
}

function albumPhotos(json: Record<string, unknown>): AlbumPhoto[] {
  const photos = Array.isArray(json.photos) ? json.photos : [];
  return photos.flatMap((entry) => {
    const item = entry as Record<string, unknown>;
    if (item.mediaAssetType === "video") return [];
    const photoGuid = text(item.photoGuid);
    const derivative = pickDerivative(item.derivatives);
    if (!photoGuid || !derivative) return [];
    const takenAt = text(item.dateCreated);
    return [
      {
        photoGuid,
        caption: text(item.caption),
        takenAt: takenAt && !Number.isNaN(Date.parse(takenAt)) ? takenAt : undefined,
        derivative,
      },
    ];
  });
}

/**
 * The same photo all day, a different one each day. Hashing the date rather
 * than stepping through the album keeps the order unpredictable.
 */
function photoForDate(photos: AlbumPhoto[], date: string): AlbumPhoto {
  const ordered = [...photos].sort((left, right) =>
    left.photoGuid.localeCompare(right.photoGuid),
  );
  const index = createHash("sha256").update(date).digest().readUInt32BE(0) % ordered.length;
  return ordered[index];
}

function downloadUrl(json: Record<string, unknown>, checksum: string): string | undefined {
  const items = json.items as Record<string, Record<string, unknown>> | undefined;
  const item = items?.[checksum];
  const location = text(item?.url_location);
  const path = text(item?.url_path);
  return location && path ? `https://${location}${path}` : undefined;
}

async function loadPhotoOfDay(date: string): Promise<PhotoOfDayResult | undefined> {
  const token = albumToken();
  if (!token) return undefined;
  try {
    const stream = await albumRequest(partitionHost(token), token, "webstream", {
      streamCtag: null,
    });
    const photos = albumPhotos(stream.json);
    if (!photos.length) return undefined;
    const chosen = photoForDate(photos, date);

    const assets = await albumRequest(stream.host, token, "webasseturls", {
      photoGuids: [chosen.photoGuid],
    });
    const url = downloadUrl(assets.json, chosen.derivative.checksum);
    if (!url) return undefined;
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()) });
    if (!response.ok) return undefined;

    return {
      image: await response.arrayBuffer(),
      photo: {
        src: PHOTO_PATH,
        width: chosen.derivative.width,
        height: chosen.derivative.height,
        caption: chosen.caption,
        takenAt: chosen.takenAt,
        albumName: text(stream.json.streamName),
      },
    };
  } catch {
    return undefined;
  }
}

const cache = new Map<string, Promise<PhotoOfDayResult | undefined>>();

/**
 * One album lookup per build, shared by the page that shows the photo and the
 * route that publishes the image, so both always agree on which photo it is.
 */
export function fetchPhotoOfDay(date: string): Promise<PhotoOfDayResult | undefined> {
  let pending = cache.get(date);
  if (!pending) {
    pending = loadPhotoOfDay(date);
    cache.set(date, pending);
  }
  return pending;
}
