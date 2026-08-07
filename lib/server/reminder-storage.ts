import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

/**
 * Where the encrypted Apple Reminder snapshot lives.
 *
 * The snapshot is a single small blob that is overwritten on every sync, so the
 * backends only need get/set. Redis is used when its REST credentials are
 * present — the serverless filesystem on Vercel is read-only apart from an
 * ephemeral /tmp, so a file would either fail to write or vanish between
 * requests. Everywhere else (local development, a self-hosted container) falls
 * back to the encrypted file with no configuration at all.
 *
 * Both backends only ever see ciphertext; encryption stays in
 * apple-reminders-store.ts.
 */
export interface ReminderStorageBackend {
  label: string;
  read(): Promise<string | undefined>;
  write(serialized: string): Promise<void>;
}

const REDIS_KEY = "brief:apple-reminders:v1";
const DEFAULT_TIMEOUT_MS = 8_000;

interface RedisCredentials {
  url: string;
  token: string;
}

function environmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Vercel's Upstash integration injects the KV_* pair; a Redis database created
 * directly with Upstash uses the UPSTASH_* pair. Accept either.
 */
function redisCredentials(): RedisCredentials | undefined {
  const url =
    process.env.KV_REST_API_URL?.trim() ||
    process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token =
    process.env.KV_REST_API_TOKEN?.trim() ||
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token
    ? { url: url.replace(/\/+$/, ""), token }
    : undefined;
}

async function runRedisCommand(
  credentials: RedisCredentials,
  command: string[],
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    environmentNumber("REMINDER_STORAGE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS),
  );
  try {
    const response = await fetch(credentials.url, {
      method: "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
      signal: controller.signal,
    });
    let body: { result?: unknown; error?: unknown } | undefined;
    try {
      body = (await response.json()) as { result?: unknown; error?: unknown };
    } catch {
      body = undefined;
    }
    if (typeof body?.error === "string") {
      throw new Error(`The reminder store rejected the request: ${body.error}`);
    }
    if (!response.ok) {
      throw new Error(`The reminder store returned HTTP ${response.status}.`);
    }
    return body?.result;
  } finally {
    clearTimeout(timeout);
  }
}

function redisBackend(credentials: RedisCredentials): ReminderStorageBackend {
  return {
    label: "redis",
    async read() {
      const result = await runRedisCommand(credentials, ["GET", REDIS_KEY]);
      // A missing key comes back as null, which is not an error here.
      return typeof result === "string" && result ? result : undefined;
    },
    async write(serialized) {
      await runRedisCommand(credentials, ["SET", REDIS_KEY, serialized]);
    },
  };
}

function filePath(): string {
  const directory = process.env.APPLE_REMINDERS_DATA_DIR?.trim()
    ? path.resolve(process.env.APPLE_REMINDERS_DATA_DIR)
    : path.join(process.cwd(), ".data");
  return path.join(directory, "apple-reminders.enc");
}

const fileBackend: ReminderStorageBackend = {
  label: "file",
  async read() {
    try {
      return await readFile(filePath(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  },
  async write(serialized) {
    const destination = filePath();
    const temporary = `${destination}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, destination);
  },
};

export function reminderStorage(): ReminderStorageBackend {
  const credentials = redisCredentials();
  return credentials ? redisBackend(credentials) : fileBackend;
}

/**
 * Explains an unusable storage configuration before anything tries to write.
 * Only Redis survives on Vercel: the deployment filesystem is read-only, and
 * pointing APPLE_REMINDERS_DATA_DIR at /tmp only buys per-instance scratch
 * space that the function rendering the dashboard usually cannot see.
 */
export function reminderStorageProblem(): string | undefined {
  if (redisCredentials()) return undefined;
  if (!process.env.VERCEL) return undefined;
  return "Reminder snapshots need a Redis store on Vercel. Add the Upstash Redis integration so KV_REST_API_URL and KV_REST_API_TOKEN are set.";
}
