import "server-only";

const REVERSE_GEOCODE_URL =
  "https://api.bigdatacloud.net/data/reverse-geocode-client";
const DEFAULT_TIMEOUT_MS = 4_000;
const CACHE_SECONDS = 24 * 60 * 60;
/**
 * ~1km of precision. Coordinates are rounded before they leave the server so a
 * drifting GPS fix cannot turn into a stream of distinct lookups, and so the
 * cache actually hits while you stay in one place.
 */
const COORDINATE_PRECISION = 2;

const cache = new Map<string, { expiresAt: number; label: string }>();

function roundCoordinate(value: number): number {
  const factor = 10 ** COORDINATE_PRECISION;
  return Math.round(value * factor) / factor;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** "US-WI" is the useful half of the code; bare subdivisions stay as-is. */
function subdivision(record: Record<string, unknown>): string | undefined {
  const code = text(record.principalSubdivisionCode);
  const suffix = code?.includes("-") ? code.split("-").pop() : undefined;
  return suffix || text(record.principalSubdivision);
}

/**
 * Best-effort place name for a set of coordinates, e.g. "Madison, WI".
 * Returns undefined rather than throwing: the briefing still works with an
 * unnamed location, so a geocoding outage must not take the weather down.
 */
export async function reverseGeocode(
  latitude: number,
  longitude: number,
): Promise<string | undefined> {
  const lat = roundCoordinate(latitude);
  const lon = roundCoordinate(longitude);
  const key = `${lat},${lon}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.label;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const url = new URL(REVERSE_GEOCODE_URL);
    url.searchParams.set("latitude", String(lat));
    url.searchParams.set("longitude", String(lon));
    url.searchParams.set("localityLanguage", "en");
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
    const record = body as Record<string, unknown>;
    const city = text(record.city) ?? text(record.locality);
    if (!city) return undefined;
    const region = subdivision(record);
    const label = region ? `${city}, ${region}` : city;
    cache.set(key, { expiresAt: now + CACHE_SECONDS * 1000, label });
    return label;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}
