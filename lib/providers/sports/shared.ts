import "server-only";

/** How far back a finished game is kept, so yesterday is whole whenever the build runs. */
export const RESULTS_LOOKBACK_MS = 48 * 60 * 60 * 1000;

export async function fetchJson<T>(
  url: string,
  timeoutMs: number,
  headers?: Record<string, string>,
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "Brief-Daily-Sports/1.0",
        ...headers,
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Sports feed returned HTTP ${response.status}.`);
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function dateKey(value: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(value);
}

/** "Today · 7:05 PM", "Yesterday · 6:40 PM", or "Sat, Oct 17 · 1:10 PM". */
export function relativeStart(value: Date, now: Date, timeZone: string): string {
  const date = dateKey(value, timeZone);
  const clock = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(value);
  if (date === dateKey(now, timeZone)) return `Today · ${clock}`;
  if (date === dateKey(new Date(now.getTime() + 86_400_000), timeZone)) return `Tomorrow · ${clock}`;
  if (date === dateKey(new Date(now.getTime() - 86_400_000), timeZone)) return `Yesterday · ${clock}`;
  return `${new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(value)} · ${clock}`;
}
