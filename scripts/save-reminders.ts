/**
 * Encrypts the reminders the Shortcut sent and writes the snapshot file.
 *
 * Run by the deploy workflow on a `reminders` repository_dispatch event:
 *
 *   node scripts/save-reminders.ts "$GITHUB_EVENT_PATH" .data/reminders.enc
 *
 * The first argument is a JSON file holding the event, whose `client_payload`
 * is the Shortcut's body; a file holding just that body works too, for local
 * testing. The key comes from REMINDERS_KEY. The payload is read from a file
 * rather than an environment variable, and only a count is logged, because
 * workflow logs on a public repository are public.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parseShortcutPayload, sealSnapshot } from "../lib/reminder-snapshot.ts";

const [inputPath, outputPath] = process.argv.slice(2);
const key = process.env.REMINDERS_KEY?.trim() ?? "";
if (!inputPath || !outputPath) {
  console.error("Usage: node scripts/save-reminders.ts <event-file> <output-file>");
  process.exit(1);
}

let payload: unknown;
try {
  const event = JSON.parse(readFileSync(inputPath, "utf8")) as Record<string, unknown>;
  payload = event.client_payload ?? event;
} catch {
  payload = undefined;
}

const receivedAt = new Date().toISOString();
const reminders = parseShortcutPayload(payload, receivedAt);
if (!reminders) {
  console.error(
    "The Shortcut payload was not a valid reminder list; the saved snapshot is unchanged.",
  );
  process.exit(1);
}

try {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, sealSnapshot({ version: 1, receivedAt, reminders }, key));
} catch (error) {
  console.error(error instanceof Error ? error.message : "The snapshot could not be written.");
  process.exit(1);
}
console.log(`Saved ${reminders.length} open reminders.`);
