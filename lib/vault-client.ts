import {
  PASSKEY_HKDF_INFO,
  type PasskeyEntry,
  type PasswordEntry,
  type SealedDocument,
  type WrappedKey,
} from "@/lib/vault-format";

/**
 * Browser half of the vault: unlocks the data key with the password or a
 * passkey, then decrypts what the build published. See lib/vault-format.ts.
 */

const encoder = new TextEncoder();

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function toBase64Url(bytes: ArrayBuffer): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function unwrap(wrappingKey: CryptoKey, entry: WrappedKey): Promise<Uint8Array<ArrayBuffer>> {
  const raw = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(entry.iv) },
    wrappingKey,
    fromBase64(entry.wrapped),
  );
  return new Uint8Array(raw);
}

/** Rejects with an OperationError when the password is wrong. */
export async function unlockWithPassword(
  entry: PasswordEntry,
  password: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const base = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const wrappingKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromBase64(entry.salt),
      iterations: entry.iterations,
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  return unwrap(wrappingKey, entry);
}

/** The PRF output is high-entropy already; HKDF just binds it to its purpose. */
async function passkeyWrappingKey(
  prfOutput: BufferSource,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", prfOutput, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: encoder.encode(PASSKEY_HKDF_INFO),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && "PublicKeyCredential" in window;
}

export class PasskeyUnsupportedError extends Error {}

/**
 * Asks the device for any registered passkey (Face ID, Touch ID, Windows
 * Hello, or a PIN) and unwraps the data key with its PRF output.
 */
export async function unlockWithPasskey(
  entries: PasskeyEntry[],
): Promise<Uint8Array<ArrayBuffer>> {
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: location.hostname,
      allowCredentials: entries.map((entry) => ({
        type: "public-key" as const,
        id: fromBase64(entry.id),
      })),
      userVerification: "required",
      extensions: {
        prf: {
          evalByCredential: Object.fromEntries(
            entries.map((entry) => [entry.id, { first: fromBase64(entry.prfSalt) }]),
          ),
        },
      },
    },
  })) as PublicKeyCredential | null;
  const entry = entries.find((candidate) => candidate.id === credential?.id);
  const output = credential?.getClientExtensionResults().prf?.results?.first;
  if (!entry || !output) {
    throw new PasskeyUnsupportedError(
      "This passkey could not unlock the briefing here. Use the password instead.",
    );
  }
  return unwrap(await passkeyWrappingKey(output, "decrypt"), entry);
}

/**
 * Creates a passkey on this device and returns the entry to add to
 * data/passkeys.json. Some authenticators only evaluate PRF when signing in,
 * not when the passkey is created, so that case asks once more.
 */
export async function registerPasskey(
  dataKey: Uint8Array<ArrayBuffer>,
  label: string,
): Promise<PasskeyEntry> {
  const prfSalt = randomBytes(32);
  const created = (await navigator.credentials.create({
    publicKey: {
      rp: { name: "Daily Briefing", id: location.hostname },
      user: { id: randomBytes(16), name: "Daily Briefing", displayName: "Daily Briefing" },
      challenge: randomBytes(32),
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 },
      ],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      extensions: { prf: { eval: { first: prfSalt } } },
    },
  })) as PublicKeyCredential | null;
  if (!created) throw new Error("No passkey was created.");

  const createdPrf = created.getClientExtensionResults().prf;
  if (createdPrf?.enabled === false) {
    throw new PasskeyUnsupportedError(
      "This device's passkeys cannot unlock encrypted data. Keep using the password here.",
    );
  }
  let output = createdPrf?.results?.first;
  if (!output) {
    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: randomBytes(32),
        rpId: location.hostname,
        allowCredentials: [{ type: "public-key", id: created.rawId }],
        userVerification: "required",
        extensions: { prf: { eval: { first: prfSalt } } },
      },
    })) as PublicKeyCredential | null;
    output = assertion?.getClientExtensionResults().prf?.results?.first;
  }
  if (!output) {
    throw new PasskeyUnsupportedError(
      "This device's passkeys cannot unlock encrypted data. Keep using the password here.",
    );
  }

  const iv = randomBytes(12);
  const wrapped = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await passkeyWrappingKey(output, "encrypt"),
    dataKey,
  );
  return {
    id: toBase64Url(created.rawId),
    prfSalt: toBase64(prfSalt),
    iv: toBase64(iv),
    wrapped: toBase64(wrapped),
    ...(label.trim() ? { label: label.trim() } : {}),
  };
}

export function importDataKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
}

/** `key` is null only when the build published without encryption (local development). */
export async function openDocument<T>(document: SealedDocument, key: CryptoKey | null): Promise<T> {
  if (!document.encrypted) return document.payload as T;
  if (!key) throw new Error("The briefing is locked.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(document.iv) },
    key,
    fromBase64(document.data),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/** Decrypts `iv || ciphertext || tag`, as written by sealBinary. */
export async function openBinary(bytes: ArrayBuffer, key: CryptoKey | null): Promise<ArrayBuffer> {
  if (!key) return bytes;
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(bytes, 0, 12) },
    key,
    new Uint8Array(bytes, 12),
  );
}

const SESSION_KEY = "brief-session-key";

/**
 * Remembers the data key until the tab or app is closed, so moving around the
 * site does not ask for Face ID again. Never written to localStorage.
 */
export function rememberDataKey(raw: Uint8Array<ArrayBuffer>): void {
  try {
    sessionStorage.setItem(SESSION_KEY, toBase64(raw));
  } catch {
    // Private browsing can refuse storage; the user just unlocks again.
  }
}

export function recallDataKey(): Uint8Array<ArrayBuffer> | undefined {
  try {
    const stored = sessionStorage.getItem(SESSION_KEY);
    return stored ? fromBase64(stored) : undefined;
  } catch {
    return undefined;
  }
}

export function forgetDataKey(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing stored, nothing to forget.
  }
}
