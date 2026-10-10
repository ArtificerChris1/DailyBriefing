import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

import type { ReminderItem } from "@/lib/briefing-types";

/**
 * The Apple Reminders snapshot, from Shortcut payload to encrypted file.
 *
 * The Shortcut sends reminders to GitHub as a `repository_dispatch` event.
 * The deploy workflow passes the payload to `scripts/save-reminders.ts`, which
 * validates and encrypts it here and saves the result on the `reminders-data`
 * branch; every build then decrypts the latest one. The repository is public,
 * so the branch only ever holds ciphertext.
 *
 * This file is run directly by Node in the workflow as well as bundled by
 * Next, so its only runtime imports are Node built-ins.
 */

export interface ReminderSnapshot {
  version: 1;
  receivedAt: string;
  reminders: ReminderItem[];
}

interface EncryptedEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
}

const ALGORITHM = "aes-256-gcm";
const ASSOCIATED_DATA = Buffer.from("brief:apple-reminders:v2", "utf8");
const MAX_REMINDERS = 500;

/** A key shorter than this is treated as unset. */
export const MIN_KEY_LENGTH = 32;

function encryptionKey(secret: string): Buffer {
  if (secret.length < MIN_KEY_LENGTH) {
    throw new Error(`REMINDERS_KEY must contain at least ${MIN_KEY_LENGTH} characters.`);
  }
  return createHash("sha256")
    .update("brief:apple-reminders:key:v2\0", "utf8")
    .update(secret, "utf8")
    .digest();
}

export function sealSnapshot(snapshot: ReminderSnapshot, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(secret), iv);
  cipher.setAAD(ASSOCIATED_DATA);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(snapshot), "utf8"),
    cipher.final(),
  ]);
  const envelope: EncryptedEnvelope = {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
  return JSON.stringify(envelope);
}

export function openSnapshot(serialized: string, secret: string): ReminderSnapshot {
  const envelope = JSON.parse(serialized) as EncryptedEnvelope;
  if (envelope.version !== 1 || envelope.algorithm !== ALGORITHM) {
    throw new Error("The reminder snapshot uses an unsupported format.");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(secret),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(ASSOCIATED_DATA);
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  const snapshot = JSON.parse(plaintext.toString("utf8")) as ReminderSnapshot;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.reminders)) {
    throw new Error("The reminder snapshot is invalid.");
  }
  return snapshot;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function boundedString(value: unknown, maximumLength: number): string | undefined {
  return typeof value === "string" && value.trim() && value.length <= maximumLength
    ? value.trim()
    : undefined;
}

function isoDate(value: unknown): string | undefined {
  const text = boundedString(value, 100);
  return text && !Number.isNaN(Date.parse(text))
    ? new Date(text).toISOString()
    : undefined;
}

function reminderId(listLabel: string, title: string, due: string, index: number): string {
  return `apple-reminder-${createHash("sha256")
    .update(`${listLabel}\0${title}\0${due}\0${index}`, "utf8")
    .digest("base64url")
    .slice(0, 22)}`;
}

/**
 * Validates the Shortcut's `client_payload` and turns it into reminder items.
 * Returns undefined for anything malformed, so a broken Shortcut never
 * replaces a good snapshot.
 */
export function parseShortcutPayload(
  value: unknown,
  receivedAt: string,
): ReminderItem[] | undefined {
  const body = record(value);
  if (!body) return undefined;
  // Shortcuts collapses a single-element list into the element itself, so a
  // one-reminder export arrives as a bare object rather than an array. An
  // empty list may arrive as no value at all.
  const rawReminders = Array.isArray(body.reminders)
    ? body.reminders
    : record(body.reminders)
      ? [body.reminders]
      : body.reminders === undefined || body.reminders === null || body.reminders === ""
        ? []
        : undefined;
  if (!rawReminders || rawReminders.length > MAX_REMINDERS) return undefined;

  const reminders: ReminderItem[] = [];
  for (const [index, value] of rawReminders.entries()) {
    const item = record(value);
    const title = boundedString(item?.title, 500);
    if (!item || !title) return undefined;
    const due = isoDate(item.due);
    const listLabel = boundedString(item.listLabel, 200) ?? "Reminders";
    const completed = item.completed === true;
    if (completed) continue;
    reminders.push({
      id: reminderId(listLabel, title, due ?? "", index),
      kind: "reminder",
      source: {
        provider: "apple-shortcut",
        connectionId: "apple-reminders-shortcut",
        externalId: `${listLabel}:${index}`,
        fetchedAt: receivedAt,
      },
      zone: "personal",
      sensitivity: "private",
      title,
      importance: "normal",
      surfacedBecause: due ? "Scheduled in Apple Reminders" : "Open in Apple Reminders",
      dueAt: due,
      completed: false,
      listLabel,
    });
  }
  return reminders;
}
