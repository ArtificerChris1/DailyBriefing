import "server-only";

import { createHash } from "node:crypto";

import type { PhotoMemory, PhotoOfDay } from "@/lib/briefing-types";

/**
 * Photo of the day from an iCloud shared album with public sharing on.
 *
 * Apple publishes no Photos API, so this uses the same undocumented services
 * Apple's own web pages do. Two link formats exist:
 *
 * - `https://photos.icloud.com/shared/album/<id>` (current). CloudKit's public
 *   `records/resolve` turns the id into a zone and an anonymous access token;
 *   `records/query` on that zone lists the photos, each with a direct download
 *   URL for a JPEG rendition.
 * - `https://www.icloud.com/sharedalbum/#<token>` (older albums). The
 *   `sharedstreams` service: `webstream` lists the photos and `webasseturls`
 *   exchanges a checksum for a download URL.
 *
 * Download URLs expire within hours, so the build copies the chosen image into
 * the site. Any failure hides the card rather than breaking the build.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
/** Largest width worth downloading for a card; derivatives above it are skipped. */
const MAX_WIDTH = 2048;
/** Pages of 100 records each; an album larger than this samples its newest photos. */
const MAX_QUERY_PAGES = 20;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CLOUDKIT_HOST = "https://ckdatabasews.icloud.com";
const CLOUDKIT_DATABASE = "database/1/com.apple.photos.cloud/production";

/** Where the encrypted image is published; the route at this path writes it. */
export const PHOTO_PATH = "/photo-of-the-day.bin";

interface Rendition {
  width: number;
  height: number;
  url: () => Promise<string | undefined>;
}

/** One photo the album offers, however its download URLs are obtained. */
interface Candidate {
  id: string;
  caption?: string;
  takenAt?: string;
  /** About 2048 pixels on the long side, for the photo of the day. */
  large: Rendition;
  /** A thumbnail, for "on this day". */
  small: Rendition;
}

interface Album {
  name?: string;
  photos: Candidate[];
}

export interface PhotoOfDayResult {
  photo: PhotoOfDay;
  image: ArrayBuffer;
}

export interface MemoryResult {
  memory: Omit<PhotoMemory, "src">;
  image: ArrayBuffer;
}

/** Photos from this date in earlier years, at most this many. */
export const MAX_MEMORIES = 3;

/** Published as `/memories/0.bin`, `/memories/1.bin`, …, encrypted. */
export function memoryPath(index: number): string {
  return `/memories/${index}.bin`;
}

type AlbumLink =
  | { kind: "cloudkit"; shortGuid: string }
  | { kind: "sharedstreams"; token: string };

function albumLink(): AlbumLink | undefined {
  const url = process.env.ICLOUD_SHARED_ALBUM_URL?.trim();
  if (!url) return undefined;
  // https://photos.icloud.com/shared/album/073nu2tgF-A0JjfGnP7bdoRhA
  const current = /\/shared\/album\/([A-Za-z0-9_-]{10,})/.exec(url);
  if (current) return { kind: "cloudkit", shortGuid: current[1] };
  // https://www.icloud.com/sharedalbum/#B0aGWZuqDGKrA9R — the token is the fragment.
  const token = url.includes("#") ? url.slice(url.indexOf("#") + 1) : url;
  return /^[A-Za-z0-9]{10,}$/.test(token) ? { kind: "sharedstreams", token } : undefined;
}

function timeoutMs(): number {
  const value = Number(process.env.ICLOUD_SHARED_ALBUM_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_TIMEOUT_MS;
}

async function postJson(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs()),
  });
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function isoFromMillis(value: unknown): string | undefined {
  const millis = Number(value);
  return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : undefined;
}

// ---------------------------------------------------------------------------
// Current links: CloudKit

/** A CloudKit field's value, e.g. `fields.resJPEGMedWidth.value`. */
function field(fields: Record<string, unknown>, name: string): unknown {
  return record(fields[name]).value;
}

/** EXIF orientations 5–8 are rotated a quarter turn, so width and height swap. */
function orientedSize(width: number, height: number, orientation: unknown) {
  return Number(orientation) >= 5 ? { width: height, height: width } : { width, height };
}

function cloudKitCandidate(master: Record<string, unknown>): Candidate | undefined {
  const fields = record(master.fields);
  const itemType = text(field(fields, "itemType")) ?? "";
  if (/movie|mpeg|video|avi/i.test(itemType)) return undefined;

  const id = text(master.recordName);
  const orientation = field(fields, "originalOrientation");
  const rendition = (prefix: string): Rendition | undefined => {
    const url = text(record(field(fields, `${prefix}Res`)).downloadURL);
    const width = Number(field(fields, `${prefix}Width`));
    const height = Number(field(fields, `${prefix}Height`));
    if (!url || !(width > 0) || !(height > 0)) return undefined;
    return {
      ...orientedSize(width, height, orientation),
      url: async () => url.replace("${f}", "photo.jpg"),
    };
  };
  // The medium JPEG is 2048 pixels on the long side; tiny originals may lack
  // one, and then a JPEG original stands in.
  const large =
    rendition("resJPEGMed") ??
    (text(field(fields, "resOriginalFileType")) === "public.jpeg"
      ? rendition("resOriginal")
      : undefined);
  if (!id || !large) return undefined;

  return {
    id,
    takenAt: isoFromMillis(field(fields, "originalCreationDate")),
    large,
    small: rendition("resJPEGThumb") ?? large,
  };
}

async function loadCloudKitAlbum(shortGuid: string): Promise<Album | undefined> {
  const resolveResponse = await postJson(
    `${CLOUDKIT_HOST}/${CLOUDKIT_DATABASE}/public/records/resolve?remapEnums=true`,
    { shortGUIDs: [{ value: shortGuid }] },
  );
  if (!resolveResponse.ok) throw new Error(`Album lookup returned HTTP ${resolveResponse.status}.`);
  const resolved = record(
    (record(await resolveResponse.json()).results as unknown[] | undefined)?.[0],
  );
  const access = record(resolved.anonymousPublicAccess);
  const token = text(access.token);
  const partition = text(access.databasePartition)?.replace(/:443$/, "");
  const zoneID = resolved.zoneID;
  if (!token || !partition || !zoneID) throw new Error("The album is not publicly shared.");
  if (!/^https:\/\/[a-z0-9.-]+\.icloud\.com$/.test(partition)) {
    throw new Error("The album lookup named an unexpected host.");
  }

  const queryUrl = `${partition}/${CLOUDKIT_DATABASE}/shared/records/query?${new URLSearchParams({
    remapEnums: "true",
    publicAccessAuthToken: token,
  })}`;
  const photos: Candidate[] = [];
  let continuationMarker: string | undefined;
  for (let page = 0; page < MAX_QUERY_PAGES; page += 1) {
    const response = await postJson(queryUrl, {
      query: {
        recordType: "CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted",
        filterBy: [
          {
            fieldName: "direction",
            comparator: "EQUALS",
            fieldValue: { value: "DESCENDING", type: "STRING" },
          },
        ],
      },
      zoneID,
      resultsLimit: 100,
      ...(continuationMarker ? { continuationMarker } : {}),
    });
    if (!response.ok) throw new Error(`Album query returned HTTP ${response.status}.`);
    const body = record(await response.json());
    for (const entry of (body.records as unknown[] | undefined) ?? []) {
      const item = record(entry);
      if (item.recordType !== "CPLMaster") continue;
      const candidate = cloudKitCandidate(item);
      if (candidate) photos.push(candidate);
    }
    continuationMarker = text(body.continuationMarker);
    if (!continuationMarker) break;
  }

  const shareFields = record(record(resolved.share).fields);
  return { name: text(field(shareFields, "cloudkit.title")), photos };
}

// ---------------------------------------------------------------------------
// Older links: sharedstreams

/** The token encodes which `pNN-sharedstreams` partition holds the album. */
function partitionHost(token: string): string {
  const digits = token.startsWith("A") ? token.slice(1, 2) : token.slice(1, 3);
  let partition = 0;
  for (const digit of digits) partition = partition * 62 + BASE62.indexOf(digit);
  return `p${String(partition).padStart(2, "0")}-sharedstreams.icloud.com`;
}

/**
 * Calls one album endpoint, following Apple's 330 redirect when the guessed
 * partition is wrong. Returns the host that answered, for the next call.
 */
async function streamRequest(
  host: string,
  token: string,
  endpoint: "webstream" | "webasseturls",
  body: unknown,
): Promise<{ host: string; json: Record<string, unknown> }> {
  let response = await postJson(`https://${host}/${token}/sharedstreams/${endpoint}`, body);
  if (response.status === 330) {
    const redirect = record(await response.json().catch(() => ({})));
    const nextHost =
      response.headers.get("X-Apple-MMe-Host") ?? text(redirect["X-Apple-MMe-Host"]);
    if (!nextHost || !/^[a-z0-9.-]+\.icloud\.com$/.test(nextHost)) {
      throw new Error("The shared album redirected to an unexpected host.");
    }
    host = nextHost;
    response = await postJson(`https://${host}/${token}/sharedstreams/${endpoint}`, body);
  }
  if (!response.ok) throw new Error(`The shared album returned HTTP ${response.status}.`);
  return { host, json: record(await response.json()) };
}

/** The widest derivative that fits MAX_WIDTH, or the narrowest if none does. */
function pickDerivative(value: unknown) {
  const candidates = Object.values(record(value))
    .map((entry) => {
      const item = record(entry);
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

async function loadStreamAlbum(token: string): Promise<Album | undefined> {
  const stream = await streamRequest(partitionHost(token), token, "webstream", {
    streamCtag: null,
  });
  const assetUrl = async (photoGuid: string, checksum: string) => {
    const assets = await streamRequest(stream.host, token, "webasseturls", {
      photoGuids: [photoGuid],
    });
    const asset = record(record(assets.json.items)[checksum]);
    const location = text(asset.url_location);
    const path = text(asset.url_path);
    return location && path ? `https://${location}${path}` : undefined;
  };
  const photos = ((stream.json.photos as unknown[] | undefined) ?? []).flatMap(
    (entry): Candidate[] => {
      const item = record(entry);
      if (item.mediaAssetType === "video") return [];
      const photoGuid = text(item.photoGuid);
      const large = pickDerivative(item.derivatives);
      const small = Object.values(record(item.derivatives))
        .map((value) => {
          const derivative = record(value);
          return {
            checksum: text(derivative.checksum) ?? "",
            width: Number(derivative.width),
            height: Number(derivative.height),
          };
        })
        .filter((derivative) => derivative.checksum && derivative.width > 0)
        .sort((left, right) => left.width - right.width)[0];
      if (!photoGuid || !large) return [];
      const rendition = (derivative: typeof large): Rendition => ({
        width: derivative.width,
        height: derivative.height,
        url: () => assetUrl(photoGuid, derivative.checksum),
      });
      const takenAt = text(item.dateCreated);
      return [
        {
          id: photoGuid,
          caption: text(item.caption),
          takenAt: takenAt && !Number.isNaN(Date.parse(takenAt)) ? takenAt : undefined,
          large: rendition(large),
          small: rendition(small ?? large),
        },
      ];
    },
  );
  return { name: text(stream.json.streamName), photos };
}

// ---------------------------------------------------------------------------

/**
 * The same photo all day, a different one each day. Hashing the date rather
 * than stepping through the album keeps the order unpredictable.
 */
function photoForDate(photos: Candidate[], date: string): Candidate {
  const ordered = [...photos].sort((left, right) => left.id.localeCompare(right.id));
  const index = createHash("sha256").update(date).digest().readUInt32BE(0) % ordered.length;
  return ordered[index];
}

let albumPromise: Promise<Album | undefined> | undefined;

/** The album, listed once per build. */
function loadAlbum(): Promise<Album | undefined> {
  albumPromise ??= (async () => {
    const link = albumLink();
    if (!link) return undefined;
    try {
      return link.kind === "cloudkit"
        ? await loadCloudKitAlbum(link.shortGuid)
        : await loadStreamAlbum(link.token);
    } catch {
      return undefined;
    }
  })();
  return albumPromise;
}

async function download(rendition: Rendition): Promise<ArrayBuffer | undefined> {
  try {
    const url = await rendition.url();
    if (!url) return undefined;
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()) });
    return response.ok ? await response.arrayBuffer() : undefined;
  } catch {
    return undefined;
  }
}

async function loadPhotoOfDay(date: string): Promise<PhotoOfDayResult | undefined> {
  const album = await loadAlbum();
  if (!album?.photos.length) return undefined;
  const chosen = photoForDate(album.photos, date);
  const image = await download(chosen.large);
  if (!image) return undefined;
  return {
    image,
    photo: {
      src: PHOTO_PATH,
      width: chosen.large.width,
      height: chosen.large.height,
      caption: chosen.caption,
      takenAt: chosen.takenAt,
      albumName: album.name,
      // The page is encrypted, so the private link can ride along for "Open album".
      albumUrl: process.env.ICLOUD_SHARED_ALBUM_URL?.trim() || undefined,
    },
  };
}

function yearAndMonthDay(iso: string, timeZone: string) {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  })
    .format(Date.parse(iso))
    .split("-");
  return { year: Number(year), monthDay: `${month}-${day}` };
}

async function loadMemories(date: string, timeZone: string): Promise<MemoryResult[]> {
  const album = await loadAlbum();
  if (!album) return [];
  const year = Number(date.slice(0, 4));
  const dated = album.photos.flatMap((photo) =>
    photo.takenAt ? [{ photo, taken: yearAndMonthDay(photo.takenAt, timeZone) }] : [],
  );
  const matches = dated
    .filter(({ taken }) => taken.monthDay === date.slice(5) && taken.year < year)
    // Newest first, so the strip reads "1 year ago, 3 years ago…".
    .sort((left, right) => right.taken.year - left.taken.year)
    .slice(0, MAX_MEMORIES);
  const results = await Promise.all(
    matches.map(async ({ photo, taken }): Promise<MemoryResult | undefined> => {
      const image = await download(photo.small);
      if (!image) return undefined;
      return {
        image,
        memory: {
          width: photo.small.width,
          height: photo.small.height,
          takenAt: photo.takenAt!,
          yearsAgo: year - taken.year,
        },
      };
    }),
  );
  return results.filter((result): result is MemoryResult => result !== undefined);
}

const memoryCache = new Map<string, Promise<MemoryResult[]>>();

/** Photos taken on this date in earlier years, shared by the page and its image routes. */
export function fetchMemories(date: string, timeZone: string): Promise<MemoryResult[]> {
  const key = `${date}|${timeZone}`;
  let pending = memoryCache.get(key);
  if (!pending) {
    pending = loadMemories(date, timeZone);
    memoryCache.set(key, pending);
  }
  return pending;
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
