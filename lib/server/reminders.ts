import "server-only";

import { readFile } from "node:fs/promises";

import type { RemindersPanel } from "@/lib/briefing-types";
import { MIN_KEY_LENGTH, openSnapshot } from "@/lib/reminder-snapshot";

export interface ReminderStatus {
  state: "not-configured" | "not-connected" | "connected" | "error";
  panel?: RemindersPanel;
  message?: string;
}

/** Where the workflow puts the snapshot it fetched from `reminders-data`. */
const DEFAULT_SNAPSHOT_PATH = ".data/reminders.enc";

let pending: Promise<ReminderStatus> | undefined;

async function loadReminders(): Promise<ReminderStatus> {
  const key = process.env.REMINDERS_KEY?.trim();
  if (!key || key.length < MIN_KEY_LENGTH) {
    return {
      state: "not-configured",
      message: `Add a REMINDERS_KEY of at least ${MIN_KEY_LENGTH} characters to show Apple Reminders.`,
    };
  }

  let serialized: string;
  try {
    serialized = await readFile(
      process.env.REMINDERS_SNAPSHOT_PATH?.trim() || DEFAULT_SNAPSHOT_PATH,
      "utf8",
    );
  } catch {
    return {
      state: "not-connected",
      message: "Run the Apple Reminders Shortcut once to send its first snapshot.",
    };
  }

  try {
    const snapshot = openSnapshot(serialized, key);
    return {
      state: "connected",
      panel: { items: snapshot.reminders, syncedAt: snapshot.receivedAt },
    };
  } catch {
    return {
      state: "error",
      message: "The saved reminder snapshot could not be decrypted. Check REMINDERS_KEY.",
    };
  }
}

/** Read once per build: every page of the day pager shares one snapshot. */
export function getReminders(): Promise<ReminderStatus> {
  pending ??= loadReminders();
  return pending;
}
