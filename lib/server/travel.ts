import "server-only";

import type { CalendarItem, Departure } from "@/lib/briefing-types";

/**
 * Leave-by times: the drive from home to an event's location, from
 * OpenRouteService (free key at openrouteservice.org). ORS has no live
 * traffic, so times are typical driving times; the preparation buffer covers
 * some slack. Only events with a real-looking address get a departure.
 *
 * Needs ORS_API_KEY and HOME_ADDRESS (both secrets: the address is personal
 * and is never logged or published). TRAVEL_BUFFER_MINUTES adds time to get
 * out of the door; it defaults to 10.
 */

const ORS = "https://api.openrouteservice.org";
const TIMEOUT_MS = 8_000;
const DEFAULT_BUFFER_MINUTES = 10;
/** Locations that are calls or links, not places. */
const VIRTUAL = /teams|zoom|meet\.|google meet|webex|skype|https?:|\bcall\b|online|virtual|phone/i;
/** Below this a result is likely the wrong place. Pelias confidence is 0–1. */
const MIN_CONFIDENCE = 0.6;
/** Further than this is a trip, not a drive to an appointment. */
const MAX_TRAVEL_MINUTES = 4 * 60;

type Point = [longitude: number, latitude: number];

function apiKey(): string | undefined {
  return process.env.ORS_API_KEY?.trim() || undefined;
}

function bufferMinutes(): number {
  const value = Number(process.env.TRAVEL_BUFFER_MINUTES);
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_BUFFER_MINUTES;
}

const geocodeCache = new Map<string, Promise<Point | undefined>>();
const routeCache = new Map<string, Promise<{ minutes: number; miles: number } | undefined>>();

function geocode(text: string, near?: Point): Promise<Point | undefined> {
  const key = apiKey();
  if (!key) return Promise.resolve(undefined);
  const cacheKey = `${text}|${near?.join(",") ?? ""}`;
  let pending = geocodeCache.get(cacheKey);
  if (!pending) {
    const url = new URL(`${ORS}/geocode/search`);
    url.searchParams.set("api_key", key);
    url.searchParams.set("text", text);
    url.searchParams.set("size", "1");
    if (near) {
      url.searchParams.set("focus.point.lon", String(near[0]));
      url.searchParams.set("focus.point.lat", String(near[1]));
    }
    pending = fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then(async (response) => {
        if (!response.ok) return undefined;
        const body = (await response.json()) as {
          features?: { geometry?: { coordinates?: number[] }; properties?: { confidence?: number } }[];
        };
        const feature = body.features?.[0];
        const coordinates = feature?.geometry?.coordinates;
        if (!coordinates || coordinates.length < 2) return undefined;
        if ((feature?.properties?.confidence ?? 0) < MIN_CONFIDENCE) return undefined;
        return [coordinates[0], coordinates[1]] as Point;
      })
      .catch(() => undefined);
    geocodeCache.set(cacheKey, pending);
  }
  return pending;
}

function drive(from: Point, to: Point) {
  const key = apiKey();
  if (!key) return Promise.resolve(undefined);
  const cacheKey = `${from.join(",")}>${to.join(",")}`;
  let pending = routeCache.get(cacheKey);
  if (!pending) {
    pending = fetch(`${ORS}/v2/directions/driving-car`, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: [from, to] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
      .then(async (response) => {
        if (!response.ok) return undefined;
        const body = (await response.json()) as {
          routes?: { summary?: { duration?: number; distance?: number } }[];
        };
        const summary = body.routes?.[0]?.summary;
        if (summary?.duration === undefined || summary.distance === undefined) return undefined;
        return { minutes: Math.ceil(summary.duration / 60), miles: summary.distance / 1609.344 };
      })
      .catch(() => undefined);
    routeCache.set(cacheKey, pending);
  }
  return pending;
}

let homePoint: Promise<Point | undefined> | undefined;

function home(): Promise<Point | undefined> {
  const address = process.env.HOME_ADDRESS?.trim();
  if (!address) return Promise.resolve(undefined);
  homePoint ??= geocode(address);
  return homePoint;
}

async function departureFor(item: CalendarItem): Promise<Departure | undefined> {
  if (item.time.mode !== "timed" || item.status === "cancelled") return undefined;
  const location = item.locationLabel?.trim();
  if (!location || VIRTUAL.test(location)) return undefined;
  const origin = await home();
  if (!origin) return undefined;
  const destination = await geocode(location, origin);
  if (!destination) return undefined;
  const route = await drive(origin, destination);
  // A few minutes away is the same building or a bad match; not worth a time.
  if (!route || route.minutes < 3 || route.minutes > MAX_TRAVEL_MINUTES) return undefined;
  const leaveAt = Date.parse(item.time.start) - (route.minutes + bufferMinutes()) * 60_000;
  return {
    leaveAt: new Date(leaveAt).toISOString(),
    travelMinutes: route.minutes,
    distanceMiles: Math.round(route.miles * 10) / 10,
  };
}

/** Adds a departure to each event that has a reachable address. */
export async function withDepartures(agenda: CalendarItem[]): Promise<CalendarItem[]> {
  if (!apiKey() || !process.env.HOME_ADDRESS?.trim()) return agenda;
  return Promise.all(
    agenda.map(async (item) => {
      const departure = await departureFor(item);
      return departure ? { ...item, departure } : item;
    }),
  );
}
