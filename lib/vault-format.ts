/**
 * File formats shared by the build, which encrypts, and the browser, which
 * decrypts.
 *
 * The site is public static files, so a login screen alone would hide nothing:
 * anyone could fetch the data files directly. Instead every personal file is
 * encrypted at build time with one data key (BRIEFING_DATA_KEY). The keyring
 * publishes that data key wrapped twice over — by a key derived from the
 * password, and by a key each registered passkey derives through the WebAuthn
 * PRF extension — so either one can unwrap it in the browser. Nothing here
 * depends on a server checking anything.
 *
 * All ciphers are AES-256-GCM with the 16-byte tag appended to the ciphertext,
 * which is the layout WebCrypto expects. Binary values are base64.
 */

export const VAULT_VERSION = 1;

/** PBKDF2-SHA256 work factor for the password; OWASP's 2023 guidance. */
export const PASSWORD_ITERATIONS = 600_000;

/** HKDF `info` for turning a passkey's PRF output into a wrapping key. */
export const PASSKEY_HKDF_INFO = "daily-briefing:passkey-wrap:v1";

/** A day's briefing, or any other JSON document, as published. */
export type SealedDocument =
  | { v: 1; encrypted: true; iv: string; data: string }
  /** Local development without a data key only; the build refuses this. */
  | { v: 1; encrypted: false; payload: unknown };

export interface WrappedKey {
  iv: string;
  wrapped: string;
}

export interface PasswordEntry extends WrappedKey {
  salt: string;
  iterations: number;
}

/** One registered passkey, as stored in data/passkeys.json. */
export interface PasskeyEntry extends WrappedKey {
  /** base64url credential ID, as WebAuthn reports it. */
  id: string;
  /** PRF input this credential was enrolled with. */
  prfSalt: string;
  label?: string;
}

export type Keyring =
  | {
      v: 1;
      encrypted: true;
      password?: PasswordEntry;
      passkeys: PasskeyEntry[];
    }
  | { v: 1; encrypted: false };

export function isPasskeyEntry(value: unknown): value is PasskeyEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.prfSalt === "string" &&
    typeof entry.iv === "string" &&
    typeof entry.wrapped === "string" &&
    (entry.label === undefined || typeof entry.label === "string")
  );
}
