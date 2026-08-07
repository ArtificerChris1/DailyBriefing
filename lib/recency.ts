/**
 * Nothing older than a rolling day belongs in a daily briefing. Sports, calendar
 * events, and headlines all measure staleness against this one window so a card
 * cannot linger in one section after it has aged out of another.
 */
export const RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function recencyCutoff(now: number = Date.now()): number {
  return now - RECENCY_WINDOW_MS;
}

/**
 * True when the instant is recent enough to show. Missing and unparseable
 * timestamps are kept: a feed that omits a date is not evidence the item is
 * stale, and dropping it would silently hide otherwise good content.
 */
export function withinRecencyWindow(
  value: string | undefined,
  cutoff: number,
): boolean {
  if (!value) return true;
  const instant = Date.parse(value);
  return Number.isNaN(instant) || instant >= cutoff;
}
