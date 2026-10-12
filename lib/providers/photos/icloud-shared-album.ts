import "server-only";

import { createHash } from "node:crypto";

import type { PhotoOfDay } from "@/lib/briefing-types";

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

/** One photo the album offers, however its download URL is obtained. */
interface Candidate {
  id: string;
  width: number;
  height: number;
  caption?: string;
  takenAt?: string;
  downloadUrl: () => Promise<string | undefined>;
}

interface Album {
  name?: string;
  photos: Candidate[];
}

export interface PhotoOfDayResult {
  photo: PhotoOfDay;
  image: ArrayBuffer;
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

  // The medium JPEG is 2048 pixels on the long side; tiny originals may lack one.
  const prefix = field(fields, "resJPEGMedRes")
    ? "resJPEGMed"
    : text(field(fields, "resOriginalFileType")) === "public.jpeg"
      ? "resOriginal"
      : undefined;
  if (!prefix) return undefined;
  const downloadUrl = text(record(field(fields, `${prefix}Res`)).downloadURL);
  const width = Number(field(fields, `${prefix}Width`));
  const height = Number(field(fields, `${prefix}Height`));
  const id = text(master.recordName);
  if (!downloadUrl || !id || !(width > 0) || !(height > 0)) return undefined;

  return {
    id,
    ...orientedSize(width, height, field(fields, "originalOrientation")),
    takenAt: isoFromMillis(field(fields, "originalCreationDate")),
    downloadUrl: async () => downloadUrl.replace("${f}", "photo.jpg"),
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
  const photos = ((stream.json.photos as unknown[] | undefined) ?? []).flatMap(
    (entry): Candidate[] => {
      const item = record(entry);
      if (item.mediaAssetType === "video") return [];
      const photoGuid = text(item.photoGuid);
      const derivative = pickDerivative(item.derivatives);
      if (!photoGuid || !derivative) return [];
      const takenAt = text(item.dateCreated);
      return [
        {
          id: photoGuid,
          width: derivative.width,
          height: derivative.height,
          caption: text(item.caption),
          takenAt: takenAt && !Number.isNaN(Date.parse(takenAt)) ? takenAt : undefined,
          downloadUrl: async () => {
            const assets = await streamRequest(stream.host, token, "webasseturls", {
              photoGuids: [photoGuid],
            });
            const asset = record(record(assets.json.items)[derivative.checksum]);
            const location = text(asset.url_location);
            const path = text(asset.url_path);
            return location && path ? `https://${location}${path}` : undefined;
          },
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

async function loadPhotoOfDay(date: string): Promise<PhotoOfDayResult | undefined> {
  const link = albumLink();
  if (!link) return undefined;
  try {
    const album =
      link.kind === "cloudkit"
        ? await loadCloudKitAlbum(link.shortGuid)
        : await loadStreamAlbum(link.token);
    if (!album?.photos.length) return undefined;
    const chosen = photoForDate(album.photos, date);
    const url = await chosen.downloadUrl();
    if (!url) return undefined;
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs()) });
    if (!response.ok) return undefined;

    return {
      image: await response.arrayBuffer(),
      photo: {
        src: PHOTO_PATH,
        width: chosen.width,
        height: chosen.height,
        caption: chosen.caption,
        takenAt: chosen.takenAt,
        albumName: album.name,
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
