import "server-only";

/** How far ahead the card looks, in days, unless overridden. */
export const DEFAULT_HORIZON_DAYS = 30;
export const DEFAULT_TIMEOUT_MS = 8_000;
/** Release calendars move slowly; six hours keeps every source well inside its quota. */
export const DEFAULT_CACHE_SECONDS = 6 * 60 * 60;
export const MAX_BODY_BYTES = 4 * 1024 * 1024;

export function environmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function textOf(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** `YYYY-MM-DD` only. Anything else is dropped rather than guessed at. */
export function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * A single fetch with a timeout and a size ceiling. Every release source is a
 * third party we do not control, so neither a hang nor a huge body should be
 * able to stall the briefing.
 */
export async function fetchWithLimits(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<string> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      cache: "no-store",
      ...rest,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.text();
    if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
      throw new Error("response exceeded the size limit");
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchJson(
  url: string,
  init: RequestInit & { timeoutMs?: number },
): Promise<unknown> {
  return JSON.parse(await fetchWithLimits(url, init));
}

/** Decodes the numeric and named entities WordPress puts in rendered titles. */
export function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    hellip: "…",
    mdash: "—",
    ndash: "–",
    rsquo: "’",
    lsquo: "‘",
    rdquo: "”",
    ldquo: "“",
  };
  return value
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name] ?? match);
}

export function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}
