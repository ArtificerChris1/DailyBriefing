import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { HotGamesPanel } from "@/lib/briefing-types";
import { shiftDateKey } from "@/lib/briefing-window";

/**
 * Rank movement for the BGG hot list. Each build compares today's list with
 * the latest earlier snapshot, then records today's list once per day. The
 * deploy workflow loads the file from the `history-data` branch before the
 * build and pushes it back afterwards. The hot list is public, so the file is
 * stored as plain JSON.
 */

const DEFAULT_PATH = ".data/history/bgg-history.json";
/** Snapshots older than this are dropped. */
const KEEP_DAYS = 35;

interface History {
  version: 1;
  /** Date key → game ids in rank order. */
  snapshots: Record<string, string[]>;
}

function historyPath(): string {
  return process.env.BGG_HISTORY_PATH?.trim() || DEFAULT_PATH;
}

async function readHistory(): Promise<History> {
  try {
    const parsed = JSON.parse(await readFile(historyPath(), "utf8")) as History;
    if (parsed.version === 1 && parsed.snapshots && typeof parsed.snapshots === "object") {
      return parsed;
    }
  } catch {
    // No history yet, or unreadable: start again.
  }
  return { version: 1, snapshots: {} };
}

const pending = new Map<string, Promise<HotGamesPanel>>();

async function apply(panel: HotGamesPanel, today: string): Promise<HotGamesPanel> {
  const history = await readHistory();
  const earlier = Object.keys(history.snapshots)
    .filter((date) => date < today)
    .sort();
  const previous = earlier.length ? history.snapshots[earlier[earlier.length - 1]] : undefined;

  const items = previous
    ? panel.items.map((item) => {
        const before = previous.indexOf(item.id);
        return before < 0
          ? { ...item, isNew: true }
          : { ...item, movement: before + 1 - item.rank };
      })
    : panel.items;

  if (!history.snapshots[today] && panel.items.length) {
    history.snapshots[today] = panel.items.map((item) => item.id);
    const oldest = shiftDateKey(today, -KEEP_DAYS);
    for (const date of Object.keys(history.snapshots)) {
      if (date < oldest) delete history.snapshots[date];
    }
    try {
      await mkdir(dirname(historyPath()), { recursive: true });
      await writeFile(historyPath(), JSON.stringify(history));
    } catch {
      // Read-only or missing directory: movement still shows, history just doesn't grow.
    }
  }
  return { ...panel, items };
}

/** Adds movement since the previous snapshot; once per build per day. */
export function withRankMovement(panel: HotGamesPanel, today: string): Promise<HotGamesPanel> {
  if (!panel.items.length) return Promise.resolve(panel);
  let result = pending.get(today);
  if (!result) {
    result = apply(panel, today);
    pending.set(today, result);
  }
  return result;
}
