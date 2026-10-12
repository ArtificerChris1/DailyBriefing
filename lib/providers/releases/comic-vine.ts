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

const COMIC_VINE_API = "https://comicvine.gamespot.com/api";
const ATTRIBUTION = "Comics via Comic Vine";

/**
 * Comic Vine records issues after they reach shops, so unlike every other
 * source on this card it cannot answer "what is coming". Measured against the
 * live API: a thirty-day forward window holds four issues, none of them from a
 * publisher anyone here follows, while the preceding thirty days hold 737. The
 * issues it does carry with future cover dates are already out — cover dates
 * run about two months ahead of the shipping date, so `Batman #12` was cover
 * dated October and shipped in August.
 *
 * Comics are therefore reported as what just shipped rather than what is due,
 * and the rows say so. Metron is the source to come back to if it ever becomes
 * reachable: it publishes forward-dated store dates, which is what this card
 * would rather show.
 */
const DEFAULT_PUBLISHERS = ["Marvel", "DC Comics"];

/**
 * The API rejects an unrecognised client with 403 before it ever looks at the
 * key, so a distinct User-Agent is mandatory rather than polite.
 */
const DEFAULT_USER_AGENT = "DailyBriefing/1.0 (personal dashboard)";

/** `limit` is documented as "defaults to 100 and can not exceed this number". */
const PAGE_SIZE = 100;

/**
 * Issues are read newest first, so the first page is already the most recent
 * shipping day or two. More than a handful of pages would only reach further
 * into the past, which is not what this row is for.
 */
const MAX_ISSUE_PAGES = 3;
/** Comfortably more than the card will show; see MAX_JUST_SHIPPED. */
const MAX_MATCHES = 8;

/**
 * Volumes never change publisher, so this survives across refreshes and makes
 * the second and later briefings of a window nearly free. Bounded because the
 * long tail of one-shot volumes would otherwise grow without limit.
 */
const publisherByVolume = new Map<number, string>();
const MAX_VOLUME_CACHE = 4_000;

/**
 * Comic Vine reports failure in the body as often as in the status line:
 * 100 is a bad key, 107 is the hourly rate limit. Both mean stop asking.
 */
const STATUS_OK = 1;
const STATUS_INVALID_KEY = 100;
const STATUS_RATE_LIMITED = 107;

/**
 * A rejected key parks the provider for the rest of the process rather than
 * spending the hourly budget re-asking on every cache miss.
 */
const AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let authRejectedUntil = 0;

export interface ComicReleases {
  items: ReleaseItem[];
  warnings: string[];
  configured: boolean;
}

class ComicVineError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

function publishers(): string[] {
  const configured = process.env.COMICVINE_PUBLISHERS?.trim();
  if (!configured) return DEFAULT_PUBLISHERS;
  const names = configured
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
  return names.length > 0 ? names : DEFAULT_PUBLISHERS;
}

/** `fetchWithLimits` reports failures as `HTTP <status>`; this reads it back. */
function statusOf(error: unknown): number | undefined {
  const match = /^HTTP (\d{3})$/.exec(
    error instanceof Error ? error.message : "",
  );
  return match ? Number(match[1]) : undefined;
}

async function request(
  resource: string,
  params: Record<string, string>,
  key: string,
  timeoutMs: number,
): Promise<Record<string, unknown>[]> {
  const url = new URL(`${COMIC_VINE_API}/${resource}/`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("format", "json");
  for (const [name, value] of Object.entries(params)) {
    url.searchParams.set(name, value);
  }

  const payload = await fetchJson(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": process.env.COMICVINE_USER_AGENT?.trim() || DEFAULT_USER_AGENT,
    },
    timeoutMs,
  });
  if (!isRecord(payload)) return [];

  const status = payload.status_code;
  if (typeof status === "number" && status !== STATUS_OK) {
    throw new ComicVineError(textOf(payload.error) ?? `status ${status}`, status);
  }
  return Array.isArray(payload.results) ? payload.results.filter(isRecord) : [];
}

/**
 * Publishers for a page's worth of volumes in one request. /issues/ cannot
 * filter on publisher — that field lives on the volume — and the `|` separator
 * documented for date ranges also reads as OR on an id filter, which turns what
 * would be a hundred detail lookups into a single call.
 */
async function resolvePublishers(
  volumeIds: number[],
  key: string,
  timeoutMs: number,
): Promise<void> {
  const unknown = volumeIds.filter((id) => !publisherByVolume.has(id));
  if (unknown.length === 0) return;

  const volumes = await request(
    "volumes",
    {
      filter: `id:${unknown.join("|")}`,
      field_list: "id,publisher",
      limit: String(PAGE_SIZE),
    },
    key,
    timeoutMs,
  );

  for (const volume of volumes) {
    const id = volume.id;
    if (typeof id !== "number") continue;
    const publisher = isRecord(volume.publisher)
      ? textOf(volume.publisher.name)
      : undefined;
    if (!publisher) continue;
    if (publisherByVolume.size >= MAX_VOLUME_CACHE) {
      const oldest = publisherByVolume.keys().next();
      if (!oldest.done) publisherByVolume.delete(oldest.value);
    }
    publisherByVolume.set(id, publisher);
  }
}

/** Substring and case insensitive, so "Marvel" also matches "Marvel Comics". */
function matchedPublisher(volumeId: number, wanted: string[]): string | undefined {
  const publisher = publisherByVolume.get(volumeId);
  if (!publisher) return undefined;
  const haystack = publisher.toLowerCase();
  return wanted.some((name) => haystack.includes(name.toLowerCase()))
    ? publisher
    : undefined;
}

/**
 * Covers are served from Comic Vine's own CDN hosts, which must also be allowed
 * in next.config.ts for next/image to load them. A cover from anywhere else is
 * dropped so the row falls back to its medium icon rather than rendering a
 * blocked image. COMICVINE_IMAGE_HOSTS adds hosts if the CDN ever moves.
 */
function coverUrl(image: unknown): string | undefined {
  if (!isRecord(image)) return undefined;
  // Rows render the cover at 32x44, so the smallest usable size is plenty.
  const raw =
    textOf(image.small_url) ?? textOf(image.thumb_url) ?? textOf(image.icon_url);
  if (!raw) return undefined;

  const extra = new Set(
    (process.env.COMICVINE_IMAGE_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return undefined;
    const host = url.hostname.toLowerCase();
    const allowed =
      host === "comicvine.gamespot.com" ||
      host.endsWith(".gamespot.com") ||
      host.endsWith(".cbsistatic.com") ||
      extra.has(host);
    return allowed ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function toReleaseItem(
  issue: Record<string, unknown>,
  publisher: string,
): ReleaseItem | undefined {
  const id = issue.id;
  const storeDate = issue.store_date;
  if (typeof id !== "number" || !isDateOnly(storeDate)) return undefined;

  const volume = isRecord(issue.volume) ? issue.volume : undefined;
  // The series name is the title a reader recognises; `name` is the story title
  // of the single issue and is null on most rows.
  const title = textOf(volume?.name);
  if (!title) return undefined;

  const number = textOf(issue.issue_number);

  return {
    id: `comicvine-issue-${id}`,
    medium: "comic",
    title,
    releasesOn: storeDate,
    by: publisher,
    // "Out now" is what keeps a past date honest on a card of future ones, in
    // the same slot where a film says "Theatrical release".
    detail: [number ? `#${number}` : undefined, "Out now"].filter(Boolean).join(" · "),
    posterUrl: coverUrl(issue.image),
    url: textOf(issue.site_detail_url) ?? `${COMIC_VINE_API}/issue/4000-${id}/`,
  };
}

/**
 * Comic issues that reached shops in the window, newest first, from Comic Vine.
 * `from`/`to` are expected to be a short lookback ending today rather than the
 * forward window the other providers take — see the note at the top of the file
 * for why this source can only look backwards.
 *
 * Returns `configured: false` when no key is set, so the card omits the medium
 * rather than showing an error the reader cannot act on — the same contract the
 * TMDB provider uses.
 */
export async function fetchComicReleases(
  from: string,
  to: string,
  /** Raised for the build-wide fetch, which serves every page of the pager. */
  limits: { maxPages?: number; maxMatches?: number } = {},
): Promise<ComicReleases> {
  const maxPages = limits.maxPages ?? MAX_ISSUE_PAGES;
  const maxMatches = limits.maxMatches ?? MAX_MATCHES;
  const key = process.env.COMICVINE_API_KEY?.trim();
  if (!key) return { items: [], warnings: [], configured: false };

  if (Date.now() < authRejectedUntil) {
    return {
      items: [],
      warnings: [
        "Comic Vine rejected the configured API key; comics are paused until it is fixed.",
      ],
      configured: true,
    };
  }

  const timeoutMs = environmentNumber("COMICVINE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const wanted = publishers();
  const warnings: string[] = [];
  const items: ReleaseItem[] = [];

  try {
    for (let page = 0; page < maxPages; page += 1) {
      const issues = await request(
        "issues",
        {
          // store_date is the day an issue reached shops. A `|` pair is the
          // documented form of a range filter, and descending order puts the
          // most recent shipping day first.
          filter: `store_date:${from}|${to}`,
          sort: "store_date:desc",
          field_list: "id,issue_number,store_date,image,site_detail_url,volume",
          limit: String(PAGE_SIZE),
          offset: String(page * PAGE_SIZE),
        },
        key,
        timeoutMs,
      );
      if (issues.length === 0) break;

      const volumeIds = [
        ...new Set(
          issues
            .map((issue) => (isRecord(issue.volume) ? issue.volume.id : undefined))
            .filter((id): id is number => typeof id === "number"),
        ),
      ];
      await resolvePublishers(volumeIds, key, timeoutMs);

      for (const issue of issues) {
        const volumeId = isRecord(issue.volume) ? issue.volume.id : undefined;
        if (typeof volumeId !== "number") continue;
        const publisher = matchedPublisher(volumeId, wanted);
        if (!publisher) continue;
        const item = toReleaseItem(issue, publisher);
        if (item) items.push(item);
      }

      if (items.length >= maxMatches) break;
      if (issues.length < PAGE_SIZE) break;
    }
  } catch (error) {
    // A later page failing after earlier ones succeeded still leaves plenty
    // to show; only an empty result is worth a warning.
    if (items.length > 0 && !(error instanceof ComicVineError && error.statusCode === STATUS_INVALID_KEY)) {
      return { items: items.slice(0, maxMatches), warnings, configured: true };
    }
    if (error instanceof ComicVineError) {
      if (error.statusCode === STATUS_INVALID_KEY) {
        authRejectedUntil = Date.now() + AUTH_COOLDOWN_MS;
        warnings.push(
          "Comic Vine rejected the configured API key (100); comics are paused until it is fixed.",
        );
      } else if (error.statusCode === STATUS_RATE_LIMITED) {
        warnings.push(
          "Comic Vine's hourly request limit was reached; comics will return on the next refresh.",
        );
      } else {
        warnings.push(`Comic Vine issues were unavailable (${error.message}).`);
      }
    } else {
      const status = statusOf(error);
      if (status === 401 || status === 403) {
        authRejectedUntil = Date.now() + AUTH_COOLDOWN_MS;
        warnings.push(
          status === 401
            ? "Comic Vine rejected the configured API key (401); comics are paused until it is fixed."
            : "Comic Vine refused the request (403); COMICVINE_USER_AGENT may need to be set.",
        );
      } else {
        warnings.push(
          `Comic Vine issues were unavailable${status ? ` (HTTP ${status})` : ""}.`,
        );
      }
    }
  }

  return { items: items.slice(0, maxMatches), warnings, configured: true };
}

export const COMIC_VINE_ATTRIBUTION = ATTRIBUTION;
