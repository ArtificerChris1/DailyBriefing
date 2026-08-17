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

const METRON_ISSUES = "https://metron.cloud/api/issue/";
const METRON_SITE = "https://metron.cloud";
const ATTRIBUTION = "Comics via Metron";

/**
 * Metron carries every publisher it can catalogue, which is far more comics per
 * month than this card has room for. Narrowing to the Marvel and DC watchlist
 * keeps the rows relevant and, because the query names the publisher, also
 * supplies the label the list payload itself omits.
 */
const DEFAULT_PUBLISHERS = ["Marvel", "DC Comics"];

/**
 * Issues come back ordered by series name, not by date (`ordering` on the Issue
 * model is `series__sort_name, cover_date, store_date, number`, and the API
 * enables no OrderingFilter). So the whole window has to be read before it can
 * be sorted by release date. At 100 rows a page this covers ~300 issues per
 * publisher per window, comfortably more than Marvel or DC ship in a month.
 */
const MAX_PAGES_PER_PUBLISHER = 3;

/**
 * Metron's nginx bans an IP for 24 hours after three 401s inside five minutes
 * (`fail2ban/jail.d/metron.conf` in Metron-Project/metron). A wrong credential
 * retried on every briefing refresh would therefore lock this host out of the
 * whole site, not just the API, so a rejected credential parks the provider
 * instead of trying again.
 */
const AUTH_COOLDOWN_MS = 6 * 60 * 60 * 1000;
let authRejectedUntil = 0;

export interface ComicReleases {
  items: ReleaseItem[];
  warnings: string[];
  configured: boolean;
}

/**
 * A Metron API token is preferred: it never expires (`TOKEN_TTL: None`) and a
 * stale one cannot spend the account's password-failure budget above. Basic
 * auth with the site login is the documented fallback.
 */
function authHeader(): string | undefined {
  const token = process.env.METRON_API_TOKEN?.trim();
  if (token) return `Bearer ${token}`;
  const username = process.env.METRON_USERNAME?.trim();
  const password = process.env.METRON_PASSWORD?.trim();
  if (!username || !password) return undefined;
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

function publishers(): string[] {
  const configured = process.env.METRON_PUBLISHERS?.trim();
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

/**
 * Covers sit on a DigitalOcean Spaces custom domain that Metron configures per
 * deployment, so the exact host is not knowable from their source. Anything
 * under metron.cloud is allowed — matching the patterns in next.config.ts — and
 * a cover from anywhere else is dropped so the row falls back to its medium
 * icon rather than rendering a blocked image. METRON_IMAGE_HOSTS adds hosts if
 * the covers turn out to be served from somewhere else entirely.
 */
function coverUrl(value: unknown): string | undefined {
  const raw = textOf(value);
  if (!raw) return undefined;
  const extra = new Set(
    (process.env.METRON_IMAGE_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean),
  );
  try {
    // Resolved against the site so a relative /media/... path still works.
    const url = new URL(raw, METRON_SITE);
    if (url.protocol !== "https:") return undefined;
    const host = url.hostname.toLowerCase();
    const allowed =
      host === "metron.cloud" || host.endsWith(".metron.cloud") || extra.has(host);
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

  const series = isRecord(issue.series) ? issue.series : undefined;
  // `issue` is the model's own display string, e.g. "Batman (2016) #12", and is
  // the only title left if the series object is somehow absent.
  const title = textOf(series?.name) ?? textOf(issue.issue);
  if (!title) return undefined;

  const number = textOf(issue.number);
  const volume = typeof series?.volume === "number" ? series.volume : undefined;

  return {
    id: `metron-issue-${id}`,
    medium: "comic",
    title,
    releasesOn: storeDate,
    by: publisher,
    detail:
      [number ? `#${number}` : undefined, volume && volume > 1 ? `Vol. ${volume}` : undefined]
        .filter(Boolean)
        .join(" · ") || undefined,
    posterUrl: coverUrl(issue.image),
    // /issue/<id>/ is a redirect view onto the slug page, so the numeric id in
    // the list payload is enough to link without a second lookup.
    url: `${METRON_SITE}/issue/${id}/`,
  };
}

async function fetchPage(
  publisher: string,
  page: number,
  from: string,
  to: string,
  header: string,
  timeoutMs: number,
): Promise<{ issues: Record<string, unknown>[]; hasNext: boolean }> {
  const url = new URL(METRON_ISSUES);
  // `store_date_range` is a DateFromToRangeFilter, which exposes exactly these
  // two bounds. Store date is when an issue reaches shops, which is the date
  // this card means by "released" — cover dates run months ahead of it.
  url.searchParams.set("store_date_range_after", from);
  url.searchParams.set("store_date_range_before", to);
  url.searchParams.set("publisher_name", publisher);
  if (page > 1) url.searchParams.set("page", String(page));

  const payload = await fetchJson(url.toString(), {
    headers: { Accept: "application/json", Authorization: header },
    timeoutMs,
  });
  if (!isRecord(payload) || !Array.isArray(payload.results)) {
    return { issues: [], hasNext: false };
  }
  return {
    issues: payload.results.filter(isRecord),
    // Paged by page number rather than by following `next`, so a proxied
    // absolute URL in the payload cannot redirect these requests off-host.
    hasNext: typeof payload.next === "string" && payload.next.length > 0,
  };
}

async function fetchPublisher(
  publisher: string,
  from: string,
  to: string,
  header: string,
  timeoutMs: number,
): Promise<{ items: ReleaseItem[]; truncated: boolean }> {
  const items: ReleaseItem[] = [];
  let hasNext = true;
  let page = 1;

  while (hasNext && page <= MAX_PAGES_PER_PUBLISHER) {
    const result = await fetchPage(publisher, page, from, to, header, timeoutMs);
    for (const issue of result.issues) {
      const item = toReleaseItem(issue, publisher);
      if (item) items.push(item);
    }
    hasNext = result.hasNext;
    page += 1;
  }

  return { items, truncated: hasNext };
}

/**
 * Comic issues reaching shops inside the window, from Metron. Returns
 * `configured: false` when no credential is set, so the card omits the medium
 * rather than showing an error the reader cannot act on — the same contract the
 * TMDB provider uses.
 */
export async function fetchComicReleases(
  from: string,
  to: string,
): Promise<ComicReleases> {
  const header = authHeader();
  if (!header) return { items: [], warnings: [], configured: false };

  if (Date.now() < authRejectedUntil) {
    return {
      items: [],
      warnings: [
        "Metron rejected the configured credential; comics are paused until it is fixed.",
      ],
      configured: true,
    };
  }

  const timeoutMs = environmentNumber("METRON_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const warnings: string[] = [];
  const items: ReleaseItem[] = [];

  // Publishers are read one after another rather than concurrently so that a
  // rejected credential costs exactly one failed request per process: firing
  // them in parallel would spend two of the three failures that earn a
  // 24-hour ban, and two dev-server restarts inside five minutes would then be
  // enough to trigger it. The whole list is cached for hours, so the extra
  // round trip on a cache miss is cheap insurance.
  for (const publisher of publishers()) {
    if (Date.now() < authRejectedUntil) break;
    try {
      const result = await fetchPublisher(publisher, from, to, header, timeoutMs);
      items.push(...result.items);
      if (result.truncated) {
        warnings.push(
          `More ${publisher} issues were listed than this card reads; the latest dates may be missing.`,
        );
      }
    } catch (error) {
      const status = statusOf(error);
      if (status === 401 || status === 403) {
        authRejectedUntil = Date.now() + AUTH_COOLDOWN_MS;
        warnings.push(
          status === 401
            ? "Metron rejected the configured credential (401); comics are paused so the API does not ban this host."
            : "The Metron account is authenticated but lacks API read permission (403).",
        );
        continue;
      }
      warnings.push(
        `Metron ${publisher} releases were unavailable${status ? ` (HTTP ${status})` : ""}.`,
      );
    }
  }

  // A publisher term that overlaps another ("DC" alongside "DC Comics") would
  // otherwise list the same issue twice.
  const seen = new Set<string>();
  const deduped = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });

  return { items: deduped, warnings: [...new Set(warnings)], configured: true };
}

export const METRON_ATTRIBUTION = ATTRIBUTION;
