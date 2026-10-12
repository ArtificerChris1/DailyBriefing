import "server-only";

import { createHash } from "node:crypto";

import ical, {
  type EventInstance,
  type ParameterValue,
  type VEvent,
} from "node-ical";

import type {
  CalendarItem,
  ProviderId,
  Sensitivity,
  TrustZone,
} from "@/lib/briefing-types";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_CACHE_SECONDS = 5 * 60;
const MAX_FEED_BYTES = 5 * 1024 * 1024;
const MAX_EVENTS_PER_DAY = 250;

export interface IcalCalendarConfiguration {
  configured: boolean;
  connectionId: string;
  label: string;
  provider: ProviderId;
  zone: TrustZone;
  timeoutMs: number;
  cacheSeconds: number;
  url?: string;
}

export type IcalFeedKind = "work" | "home";

interface IcalFeedDefinition {
  cacheEnvironmentName: string;
  connectionId: string;
  defaultLabel: string;
  labelEnvironmentName: string;
  provider: ProviderId;
  timeoutEnvironmentName: string;
  urlEnvironmentName: string;
  zone: TrustZone;
}

export type IcalCalendarResult =
  | {
      ok: true;
      configured: true;
      items: CalendarItem[];
      fetchedAt: string;
      label: string;
      warnings: string[];
    }
  | {
      ok: false;
      configured: boolean;
      items: [];
      fetchedAt: string;
      label: string;
      error: string;
    };

const calendarCache = new Map<
  string,
  { expiresAt: number; result: Extract<IcalCalendarResult, { ok: true }> }
>();

const feedDefinitions: Record<IcalFeedKind, IcalFeedDefinition> = {
  work: {
    cacheEnvironmentName: "WORK_CALENDAR_ICAL_CACHE_SECONDS",
    connectionId: "work-ical-feed",
    defaultLabel: "Work calendar",
    labelEnvironmentName: "WORK_CALENDAR_ICAL_LABEL",
    provider: "ical",
    timeoutEnvironmentName: "WORK_CALENDAR_ICAL_TIMEOUT_MS",
    urlEnvironmentName: "WORK_CALENDAR_ICAL_URL",
    zone: "work",
  },
  home: {
    cacheEnvironmentName: "HOME_CALENDAR_ICAL_CACHE_SECONDS",
    connectionId: "apple-home-ical-feed",
    defaultLabel: "Home calendar",
    labelEnvironmentName: "HOME_CALENDAR_ICAL_LABEL",
    provider: "apple-calendar",
    timeoutEnvironmentName: "HOME_CALENDAR_ICAL_TIMEOUT_MS",
    urlEnvironmentName: "HOME_CALENDAR_ICAL_URL",
    zone: "personal",
  },
};

function environmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function getIcalCalendarConfiguration(
  feed: IcalFeedKind = "work",
): IcalCalendarConfiguration {
  const definition = feedDefinitions[feed];
  const rawUrl = process.env[definition.urlEnvironmentName]?.trim();
  const label =
    process.env[definition.labelEnvironmentName]?.trim() ||
    definition.defaultLabel;
  const timeoutMs = environmentNumber(
    definition.timeoutEnvironmentName,
    DEFAULT_TIMEOUT_MS,
  );
  const cacheSeconds = environmentNumber(
    definition.cacheEnvironmentName,
    DEFAULT_CACHE_SECONDS,
  );
  const baseConfiguration = {
    cacheSeconds,
    connectionId: definition.connectionId,
    label,
    provider: definition.provider,
    timeoutMs,
    zone: definition.zone,
  };

  if (!rawUrl) {
    return { ...baseConfiguration, configured: false };
  }

  try {
    const normalizedUrl = rawUrl.replace(/^webcal:/i, "https:");
    const url = new URL(normalizedUrl);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return { ...baseConfiguration, configured: false };
    }
    return {
      ...baseConfiguration,
      configured: true,
      url: url.toString(),
    };
  } catch {
    return { ...baseConfiguration, configured: false };
  }
}

function parameterText(value: ParameterValue | undefined): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (value && typeof value.val === "string") return value.val.trim() || undefined;
  return undefined;
}

function sensitivity(value: VEvent["class"]): Sensitivity {
  if (value === "CONFIDENTIAL") return "confidential";
  if (value === "PRIVATE") return "private";
  return "public";
}

function importance(event: VEvent): CalendarItem["importance"] {
  const value = (event as Record<string, unknown>).priority;
  if (typeof value !== "number") return "normal";
  if (value >= 1 && value <= 4) return "high";
  if (value >= 6 && value <= 9) return "low";
  return "normal";
}

function safeDeepLink(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function dateOnly(value: Date, timeZone: string): string {
  const dateWithMetadata = value as Date & { dateOnly?: true; tz?: string };
  if (dateWithMetadata.dateOnly) return value.toISOString().slice(0, 10);

  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: dateWithMetadata.tz ?? timeZone,
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function nextDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1))
    .toISOString()
    .slice(0, 10);
}

function itemId(uid: string, start: Date): string {
  return `ical-${createHash("sha256")
    .update(`${uid}:${start.toISOString()}`, "utf8")
    .digest("base64url")
    .slice(0, 22)}`;
}

function normalizeInstance(
  instance: EventInstance,
  configuration: IcalCalendarConfiguration,
  timeZone: string,
  fetchedAt: string,
): CalendarItem {
  const event = instance.event;
  const title = parameterText(instance.summary) ?? "Busy";
  const locationLabel = parameterText(event.location);
  const startDate = dateOnly(instance.start, timeZone);
  const endDate = dateOnly(instance.end, timeZone);
  const externalId = `${event.uid}:${instance.start.toISOString()}`;
  const modifiedAt = event.lastmodified?.toISOString();

  return {
    id: itemId(event.uid, instance.start),
    kind: "calendar",
    source: {
      provider: configuration.provider,
      connectionId: configuration.connectionId,
      externalId,
      fetchedAt,
      modifiedAt,
      deepLink: safeDeepLink(event.url),
    },
    zone: configuration.zone,
    sensitivity: sensitivity(event.class),
    title,
    importance: importance(event),
    surfacedBecause: `On your subscribed ${configuration.label}`,
    time: instance.isFullDay
      ? {
          mode: "all-day",
          startDate,
          endDateExclusive:
            endDate > startDate ? endDate : nextDate(startDate),
          timeZone,
        }
      : {
          mode: "timed",
          start: instance.start.toISOString(),
          end:
            instance.end > instance.start
              ? instance.end.toISOString()
              : undefined,
          originalTimeZone: instance.start.tz ?? timeZone,
        },
    status:
      event.status === "CANCELLED"
        ? "cancelled"
        : event.status === "TENTATIVE"
          ? "tentative"
          : "confirmed",
    locationLabel,
    sourceLabel: configuration.label,
  };
}

/**
 * A failure whose message is safe to publish. Any other error's message may
 * quote the private feed URL, and the briefing is a public static site, so
 * those are reported generically instead.
 */
class CalendarFeedError extends Error {
  constructor(
    message: string,
    /** Whether trying again soon might succeed (429 and 5xx). */
    readonly retryable = false,
  ) {
    super(message);
  }
}

/** A failure worth one more try: timeouts, network errors, 429 and 5xx. */
function isTransient(error: unknown): boolean {
  if (error instanceof CalendarFeedError) return error.retryable;
  return error instanceof Error;
}

const RETRY_DELAY_MS = 2_000;
/** How long one download serves every page of a build. */
const FEED_REUSE_MS = 10 * 60 * 1000;
const feedBodies = new Map<string, { expiresAt: number; body: Promise<string> }>();

/**
 * The feed's text, downloaded once and shared: a build renders every day of
 * the pager and looks several days ahead, and fetching the same feed two
 * dozen times invites rate limiting. A transient failure is retried once;
 * a failed download is not kept, so the next page tries again.
 */
function feedBody(url: string, timeoutMs: number): Promise<string> {
  const cached = feedBodies.get(url);
  if (cached && cached.expiresAt > Date.now()) return cached.body;
  const body = downloadFeed(url, timeoutMs).catch(async (error: unknown) => {
    if (!isTransient(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return downloadFeed(url, timeoutMs);
  });
  feedBodies.set(url, { expiresAt: Date.now() + FEED_REUSE_MS, body });
  body.catch(() => feedBodies.delete(url));
  return body;
}

async function downloadFeed(
  url: string,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/calendar, text/plain;q=0.9, */*;q=0.1",
        "User-Agent": "Brief-Daily-Calendar/1.0",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new CalendarFeedError(
        `The calendar feed returned HTTP ${response.status}.`,
        response.status === 429 || response.status >= 500,
      );
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_FEED_BYTES) {
      throw new CalendarFeedError("The calendar feed is larger than the 5 MB safety limit.");
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_FEED_BYTES) {
      throw new CalendarFeedError("The calendar feed is larger than the 5 MB safety limit.");
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchIcalCalendar(input: {
  feed?: IcalFeedKind;
  from: string;
  to: string;
  timeZone: string;
}): Promise<IcalCalendarResult> {
  const fetchedAt = new Date().toISOString();
  const configuration = getIcalCalendarConfiguration(input.feed);
  if (!configuration.configured || !configuration.url) {
    return {
      ok: false,
      configured: false,
      items: [],
      fetchedAt,
      label: configuration.label,
      error:
        configuration.provider === "apple-calendar"
          ? "Add HOME_CALENDAR_ICAL_URL to enable the Apple home calendar feed."
          : "Add WORK_CALENDAR_ICAL_URL to enable the work calendar feed.",
    };
  }

  const cacheKey = createHash("sha256")
    .update(
      `${configuration.url}\n${input.from}\n${input.to}\n${input.timeZone}`,
      "utf8",
    )
    .digest("base64url");
  const cached = calendarCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const body = await feedBody(configuration.url, configuration.timeoutMs);
    const calendar = await ical.async.parseICS(body);
    const rangeStart = new Date(input.from);
    const rangeEnd = new Date(input.to);
    const warnings: string[] = [];
    const items: CalendarItem[] = [];

    for (const component of Object.values(calendar)) {
      if (
        !component ||
        component.type !== "VEVENT" ||
        component.recurrenceid
      ) {
        continue;
      }

      try {
        const instances = ical.expandRecurringEvent(component, {
          from: rangeStart,
          to: rangeEnd,
          expandOngoing: true,
          excludeExdates: true,
          includeOverrides: true,
        });
        for (const instance of instances) {
          if (instance.end > rangeStart && instance.start < rangeEnd) {
            items.push(
              normalizeInstance(
                instance,
                configuration,
                input.timeZone,
                fetchedAt,
              ),
            );
          }
        }
      } catch {
        warnings.push("One calendar event was skipped because it could not be expanded.");
      }
    }

    items.sort((left, right) => {
      const leftStart =
        left.time.mode === "timed"
          ? Date.parse(left.time.start)
          : Date.parse(`${left.time.startDate}T00:00:00Z`);
      const rightStart =
        right.time.mode === "timed"
          ? Date.parse(right.time.start)
          : Date.parse(`${right.time.startDate}T00:00:00Z`);
      return leftStart - rightStart;
    });

    if (items.length > MAX_EVENTS_PER_DAY) {
      items.length = MAX_EVENTS_PER_DAY;
      warnings.push("The calendar feed was limited to 250 events for this day.");
    }

    const result: Extract<IcalCalendarResult, { ok: true }> = {
      ok: true,
      configured: true,
      items,
      fetchedAt,
      label: configuration.label,
      warnings: [...new Set(warnings)],
    };
    calendarCache.set(cacheKey, {
      expiresAt: Date.now() + configuration.cacheSeconds * 1000,
      result,
    });
    return result;
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? `The calendar feed did not respond within ${configuration.timeoutMs} ms.`
        : error instanceof CalendarFeedError
          ? error.message
          : "The calendar feed could not be read.";
    return {
      ok: false,
      configured: true,
      items: [],
      fetchedAt,
      label: configuration.label,
      error: message,
    };
  }
}
