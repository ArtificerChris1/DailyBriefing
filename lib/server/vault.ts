import "server-only";

import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  PASSWORD_ITERATIONS,
  VAULT_VERSION,
  isPasskeyEntry,
  type Keyring,
  type PasskeyEntry,
  type PasswordEntry,
  type SealedDocument,
  type WrappedKey,
} from "@/lib/vault-format";

/** Registered passkeys; edited by hand on GitHub, see docs/login-setup.md. */
const PASSKEYS_PATH = "data/passkeys.json";

/**
 * The data key, or undefined in local development without one. A build on
 * GitHub Actions without a valid key fails outright: publishing the briefing
 * unencrypted by accident must not be possible.
 */
function dataKey(): Buffer | undefined {
  const encoded = process.env.BRIEFING_DATA_KEY?.trim();
  const key = encoded ? Buffer.from(encoded, "base64") : undefined;
  if (key?.length === 32) return key;
  if (process.env.GITHUB_ACTIONS === "true") {
    throw new Error("BRIEFING_DATA_KEY must be 32 random bytes, base64-encoded.");
  }
  if (encoded) throw new Error("BRIEFING_DATA_KEY is not 32 bytes of base64.");
  return undefined;
}

function seal(key: Buffer, plaintext: Buffer): { iv: Buffer; data: Buffer } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { iv, data };
}

/** A JSON document as the browser will fetch it. */
export function sealDocument(payload: unknown): SealedDocument {
  const key = dataKey();
  if (!key) return { v: VAULT_VERSION, encrypted: false, payload };
  const { iv, data } = seal(key, Buffer.from(JSON.stringify(payload), "utf8"));
  return {
    v: VAULT_VERSION,
    encrypted: true,
    iv: iv.toString("base64"),
    data: data.toString("base64"),
  };
}

/**
 * A binary file, such as the photo, as `iv || ciphertext || tag`. Without a
 * data key (local development only) the bytes pass through unchanged.
 */
export function sealBinary(bytes: ArrayBuffer): { body: Buffer; encrypted: boolean } {
  const key = dataKey();
  if (!key) return { body: Buffer.from(bytes), encrypted: false };
  const { iv, data } = seal(key, Buffer.from(bytes));
  return { body: Buffer.concat([iv, data]), encrypted: true };
}

function wrapWith(wrappingKey: Buffer, key: Buffer): WrappedKey {
  const { iv, data } = seal(wrappingKey, key);
  return { iv: iv.toString("base64"), wrapped: data.toString("base64") };
}

async function registeredPasskeys(): Promise<PasskeyEntry[]> {
  try {
    const parsed: unknown = JSON.parse(await readFile(PASSKEYS_PATH, "utf8"));
    return Array.isArray(parsed) ? parsed.filter(isPasskeyEntry) : [];
  } catch {
    return [];
  }
}

export async function buildKeyring(): Promise<Keyring> {
  const key = dataKey();
  if (!key) return { v: VAULT_VERSION, encrypted: false };

  const password = process.env.BRIEFING_PASSWORD;
  // Without a password, a site with no passkeys registered yet cannot be
  // opened at all, so a deployed build insists on one.
  if (!password && process.env.GITHUB_ACTIONS === "true") {
    throw new Error("BRIEFING_PASSWORD must be set.");
  }
  let passwordEntry: PasswordEntry | undefined;
  if (password) {
    const salt = randomBytes(16);
    const wrappingKey = pbkdf2Sync(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
    passwordEntry = {
      salt: salt.toString("base64"),
      iterations: PASSWORD_ITERATIONS,
      ...wrapWith(wrappingKey, key),
    };
  }
  return {
    v: VAULT_VERSION,
    encrypted: true,
    password: passwordEntry,
    passkeys: await registeredPasskeys(),
  };
}
