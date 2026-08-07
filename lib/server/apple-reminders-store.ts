import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ReminderItem } from "@/lib/briefing-types";
import type { AppleReminderEnvelope } from "@/lib/providers/contracts";

const ALGORITHM = "aes-256-gcm";
const ASSOCIATED_DATA = Buffer.from("brief:apple-reminders:v1", "utf8");
const MAX_NONCES = 100;

interface StoredReminderSnapshot {
  version: 1;
  deviceId: string;
  exportedAt: string;
  receivedAt: string;
  recentNonces: string[];
  reminders: ReminderItem[];
}

interface EncryptedEnvelope {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
}

export interface AppleReminderStoreStatus {
  configured: boolean;
  connected: boolean;
  state: "not-configured" | "not-connected" | "connected" | "error";
  items: ReminderItem[];
  lastSyncedAt?: string;
  message?: string;
}

let operationQueue: Promise<void> = Promise.resolve();

function runExclusively<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationQueue.then(operation, operation);
  operationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function configuredToken(): string | undefined {
  const token = process.env.APPLE_SHORTCUT_TOKEN?.trim();
  return token && token.length >= 32 ? token : undefined;
}

export function appleReminderBridgeConfigured(): boolean {
  return Boolean(configuredToken());
}

export function verifyAppleShortcutToken(candidate: string | undefined): boolean {
  const expected = configuredToken();
  if (!expected || !candidate) return false;
  const expectedDigest = createHash("sha256").update(expected).digest();
  const candidateDigest = createHash("sha256").update(candidate).digest();
  return timingSafeEqual(expectedDigest, candidateDigest);
}

function encryptionKey(): Buffer {
  const token = configuredToken();
  if (!token) {
    throw new Error("APPLE_SHORTCUT_TOKEN must contain at least 32 characters.");
  }
  return createHash("sha256")
    .update("brief:apple-reminders:key:v1\0", "utf8")
    .update(token, "utf8")
    .digest();
}

function storePath(): string {
  const directory = process.env.APPLE_REMINDERS_DATA_DIR?.trim()
    ? path.resolve(process.env.APPLE_REMINDERS_DATA_DIR)
    : path.join(process.cwd(), ".data");
  return path.join(directory, "apple-reminders.enc");
}

function encrypt(snapshot: StoredReminderSnapshot): EncryptedEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  cipher.setAAD(ASSOCIATED_DATA);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(snapshot), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    algorithm: ALGORITHM,
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(envelope: EncryptedEnvelope): StoredReminderSnapshot {
  if (envelope.version !== 1 || envelope.algorithm !== ALGORITHM) {
    throw new Error("The Apple reminder store uses an unsupported format.");
  }
  const decipher = createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(envelope.iv, "base64"),
  );
  decipher.setAAD(ASSOCIATED_DATA);
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  const snapshot = JSON.parse(plaintext.toString("utf8")) as StoredReminderSnapshot;
  if (snapshot.version !== 1 || !Array.isArray(snapshot.reminders)) {
    throw new Error("The Apple reminder store is invalid.");
  }
  return snapshot;
}

async function readSnapshot(): Promise<StoredReminderSnapshot | undefined> {
  try {
    const serialized = await readFile(storePath(), "utf8");
    return decrypt(JSON.parse(serialized) as EncryptedEnvelope);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeSnapshot(snapshot: StoredReminderSnapshot): Promise<void> {
  const destination = storePath();
  const directory = path.dirname(destination);
  const temporary = `${destination}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, JSON.stringify(encrypt(snapshot)), {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, destination);
}

function reminderId(externalId: string): string {
  return `apple-reminder-${createHash("sha256")
    .update(externalId, "utf8")
    .digest("base64url")
    .slice(0, 22)}`;
}

function normalizeReminder(
  reminder: AppleReminderEnvelope["reminders"][number],
  receivedAt: string,
): ReminderItem {
  return {
    id: reminderId(reminder.externalId),
    kind: "reminder",
    source: {
      provider: "apple-shortcut",
      connectionId: "apple-reminders-shortcut",
      externalId: reminder.externalId,
      fetchedAt: receivedAt,
      modifiedAt: reminder.modifiedAt,
    },
    zone: "personal",
    sensitivity: "private",
    title: reminder.title,
    importance: "normal",
    surfacedBecause: reminder.due ? "Scheduled in Apple Reminders" : "Selected Apple reminder",
    dueAt: reminder.due,
    dueLabel: reminder.due ? "Scheduled" : "No due date",
    completed: reminder.completed,
    listLabel: reminder.listLabel || "Apple Reminders",
  };
}

export function saveAppleReminderEnvelope(
  envelope: AppleReminderEnvelope,
): Promise<{ count: number; receivedAt: string }> {
  return runExclusively(async () => {
    const existing = await readSnapshot();
    if (existing?.recentNonces.includes(envelope.nonce)) {
      throw new Error("This Apple Reminder export was already received.");
    }

    const receivedAt = new Date().toISOString();
    const recentNonces = [
      envelope.nonce,
      ...(existing?.recentNonces ?? []),
    ].slice(0, MAX_NONCES);
    const reminders = envelope.reminders.map((reminder) =>
      normalizeReminder(reminder, receivedAt),
    );
    await writeSnapshot({
      version: 1,
      deviceId: envelope.deviceId,
      exportedAt: envelope.exportedAt,
      receivedAt,
      recentNonces,
      reminders,
    });
    return { count: reminders.length, receivedAt };
  });
}

export function getAppleReminderStoreStatus(): Promise<AppleReminderStoreStatus> {
  if (!appleReminderBridgeConfigured()) {
    return Promise.resolve({
      configured: false,
      connected: false,
      state: "not-configured",
      items: [],
      message: "Add APPLE_SHORTCUT_TOKEN before configuring the iPhone Shortcut.",
    });
  }

  return runExclusively(async () => {
    try {
      const snapshot = await readSnapshot();
      if (!snapshot) {
        return {
          configured: true,
          connected: false,
          state: "not-connected",
          items: [],
          message: "Run the Apple Reminders Shortcut once to send its first snapshot.",
        };
      }
      return {
        configured: true,
        connected: true,
        state: "connected",
        items: snapshot.reminders,
        lastSyncedAt: snapshot.receivedAt,
      };
    } catch {
      return {
        configured: true,
        connected: false,
        state: "error",
        items: [],
        message: "The encrypted Apple reminder snapshot could not be read.",
      };
    }
  });
}
