"use client";

import { Fingerprint, KeyRound, Lock, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { DashboardShell } from "@/components/dashboard-shell";
import type { BriefingPayload } from "@/lib/briefing-types";
import {
  PasskeyUnsupportedError,
  forgetDataKey,
  importDataKey,
  openBinary,
  openDocument,
  passkeysSupported,
  recallDataKey,
  registerPasskey,
  rememberDataKey,
  unlockWithPasskey,
  unlockWithPassword,
} from "@/lib/vault-client";
import type { Keyring, PasskeyEntry, SealedDocument } from "@/lib/vault-format";

/** The site may be served from a subpath, e.g. a GitHub Pages project URL. */
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** Stamped by next.config.ts; /build.json reports the one currently deployed. */
const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? "";
/** How often an open page asks whether a newer build has been deployed. */
const BUILD_CHECK_MS = 10 * 60 * 1000;
/** "owner/repo", set by the workflow, for the link to data/passkeys.json. */
const REPOSITORY = process.env.NEXT_PUBLIC_GITHUB_REPOSITORY ?? "";

type GateState =
  | { status: "loading" }
  | { status: "failed"; message: string }
  | { status: "locked"; keyring: Extract<Keyring, { encrypted: true }> }
  | {
      status: "open";
      payload: BriefingPayload;
      key: CryptoKey | null;
      /** Raw data key, kept to enrol passkeys; null when unencrypted. */
      rawKey: Uint8Array<ArrayBuffer> | null;
      photoUrl?: string;
      /** Aligned with `briefing.memories`; undefined where one failed. */
      memoryUrls: (string | undefined)[];
    };

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE_PATH}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function loadDay(date: string, key: CryptoKey | null): Promise<BriefingPayload> {
  return openDocument<BriefingPayload>(
    await fetchJson<SealedDocument>(`/briefing/${date}.json`),
    key,
  );
}

/** Fetches and decrypts one published image into an object URL. */
async function loadImage(
  src: string,
  today: string,
  key: CryptoKey | null,
): Promise<string | undefined> {
  try {
    // The files are replaced each day under the same names; the date keeps a
    // cached copy of yesterday's from being reused.
    const response = await fetch(`${BASE_PATH}${src}?d=${today}`);
    if (!response.ok) return undefined;
    const bytes = await openBinary(await response.arrayBuffer(), key);
    if (bytes.byteLength === 0) return undefined;
    return URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" }));
  } catch {
    return undefined;
  }
}

async function loadPhotos(payload: BriefingPayload, key: CryptoKey | null) {
  const { photo, memories = [], today } = payload.briefing;
  const [photoUrl, ...memoryUrls] = await Promise.all([
    photo ? loadImage(photo.src, today, key) : Promise.resolve(undefined),
    ...memories.map((memory) => loadImage(memory.src, today, key)),
  ]);
  return { photoUrl, memoryUrls };
}

/**
 * Login screen in front of the briefing. Every data file is encrypted, so
 * nothing personal exists in the page until the password or a passkey has
 * unwrapped the data key in this browser.
 */
export function BriefingGate() {
  const [state, setState] = useState<GateState>({ status: "loading" });
  const [updateReady, setUpdateReady] = useState(false);
  const openKey = state.status === "open" ? state.key : null;
  const isOpen = state.status === "open";
  const loadForShell = useCallback((date: string) => loadDay(date, openKey), [openKey]);

  // The site rebuilds through the day. Coming back to the page picks up a
  // newer build straight away (the session key unlocks it again without a
  // prompt); while it stays open, a banner offers the reload instead of
  // swapping the page out mid-read.
  useEffect(() => {
    if (!isOpen || !BUILD_ID) return;
    async function check(reloadIfNewer: boolean) {
      try {
        const { buildId } = await fetchJson<{ buildId?: string }>("/build.json");
        if (!buildId || buildId === BUILD_ID) return;
        if (reloadIfNewer) window.location.reload();
        else setUpdateReady(true);
      } catch {
        // Offline or mid-deploy; the next check will try again.
      }
    }
    function onVisibilityChange() {
      if (document.visibilityState === "visible") void check(true);
    }
    const timer = window.setInterval(() => void check(false), BUILD_CHECK_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [isOpen]);

  const open = useCallback(async (rawKey: Uint8Array<ArrayBuffer> | null) => {
    const key = rawKey ? await importDataKey(rawKey) : null;
    const payload = await loadDay("today", key);
    if (rawKey) rememberDataKey(rawKey);
    setState({ status: "open", payload, key, rawKey, ...(await loadPhotos(payload, key)) });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let keyring: Keyring;
      try {
        keyring = await fetchJson<Keyring>("/keyring.json");
      } catch {
        if (!cancelled) setState({ status: "failed", message: "The briefing could not be loaded." });
        return;
      }
      if (!keyring.encrypted) {
        await open(null);
        return;
      }
      const remembered = recallDataKey();
      if (remembered) {
        try {
          await open(remembered);
          return;
        } catch {
          // The key changed since this tab unlocked; ask again.
          forgetDataKey();
        }
      }
      if (!cancelled) setState({ status: "locked", keyring });
    })().catch(() => {
      if (!cancelled) setState({ status: "failed", message: "The briefing could not be loaded." });
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function lock() {
    forgetDataKey();
    if (state.status === "open") {
      for (const url of [state.photoUrl, ...state.memoryUrls]) if (url) URL.revokeObjectURL(url);
    }
    window.location.reload();
  }

  if (state.status === "open") {
    const { rawKey } = state;
    return (
      <>
        {updateReady && (
          <div className="update-banner" role="status">
            <span>A newer briefing is ready.</span>
            <button type="button" onClick={() => window.location.reload()}>
              <RefreshCw size={14} /> Reload
            </button>
          </div>
        )}
        <DashboardShell
          initialPayload={state.payload}
          loadDay={loadForShell}
          photoUrl={state.photoUrl}
          memoryUrls={state.memoryUrls}
          accountSettings={
            rawKey ? <AccountSettings rawKey={rawKey} onLock={lock} /> : undefined
          }
        />
      </>
    );
  }

  return (
    <main className="lock-screen">
      <div className="lock-card">
        <span className="brand-mark" aria-hidden="true" />
        <h1>Daily Briefing</h1>
        {state.status === "loading" && <p className="lock-note">Loading…</p>}
        {state.status === "failed" && <p className="lock-error" role="alert">{state.message}</p>}
        {state.status === "locked" && <UnlockForm keyring={state.keyring} onUnlock={open} />}
      </div>
    </main>
  );
}

function UnlockForm({
  keyring,
  onUnlock,
}: {
  keyring: Extract<Keyring, { encrypted: true }>;
  onUnlock: (rawKey: Uint8Array<ArrayBuffer>) => Promise<void>;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const canUsePasskey = keyring.passkeys.length > 0 && passkeysSupported();

  async function attempt(unlock: () => Promise<Uint8Array<ArrayBuffer>>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      await onUnlock(await unlock());
    } catch (caught) {
      setError(caught instanceof PasskeyUnsupportedError ? caught.message : failure);
      setBusy(false);
    }
  }

  function submitPassword(event: FormEvent) {
    event.preventDefault();
    if (!keyring.password || !password) return;
    const entry = keyring.password;
    void attempt(() => unlockWithPassword(entry, password), "That password is not right.").then(
      () => passwordRef.current?.select(),
    );
  }

  return (
    <>
      <p className="lock-note">Unlock to see today’s briefing.</p>
      {canUsePasskey && (
        <button
          type="button"
          className="lock-primary"
          disabled={busy}
          onClick={() =>
            void attempt(
              () => unlockWithPasskey(keyring.passkeys),
              "The passkey did not unlock the briefing. Try again or use the password.",
            )
          }
        >
          <Fingerprint size={18} /> Unlock with passkey
        </button>
      )}
      {keyring.password && (
        <form className="lock-form" onSubmit={submitPassword}>
          <label className="field-label">
            Password
            <input
              ref={passwordRef}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
          </label>
          <button type="submit" className={canUsePasskey ? "lock-secondary" : "lock-primary"} disabled={busy || !password}>
            <KeyRound size={16} /> {busy ? "Unlocking…" : "Unlock"}
          </button>
        </form>
      )}
      {error && <p className="lock-error" role="alert">{error}</p>}
    </>
  );
}

/** Lock button and passkey enrolment, shown in the Preferences panel. */
function AccountSettings({
  rawKey,
  onLock,
}: {
  rawKey: Uint8Array<ArrayBuffer>;
  onLock: () => void;
}) {
  const [label, setLabel] = useState("");
  const [entry, setEntry] = useState<PasskeyEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const entryText = entry ? JSON.stringify(entry, null, 2) : "";
  const editUrl = REPOSITORY
    ? `https://github.com/${REPOSITORY}/edit/main/data/passkeys.json`
    : undefined;

  async function enrol() {
    setBusy(true);
    setMessage(null);
    try {
      setEntry(await registerPasskey(rawKey, label));
    } catch (caught) {
      setMessage(
        caught instanceof PasskeyUnsupportedError
          ? caught.message
          : "No passkey was added. Try again, or check this browser supports passkeys.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-section">
      <h3>Sign-in</h3>
      <button type="button" className="secondary-action" onClick={onLock}>
        <Lock size={15} /> Lock now
      </button>
      {passkeysSupported() && (
        <>
          <p className="settings-help">
            Add a passkey to unlock with Face ID, Touch ID, Windows Hello, or a PIN on
            this device. Passkeys saved to iCloud Keychain or Google Password Manager
            also work on your other devices.
          </p>
          <label className="field-label">
            Device name
            <input
              type="text"
              placeholder="e.g. iPhone"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </label>
          <button type="button" className="secondary-action" disabled={busy} onClick={() => void enrol()}>
            <Fingerprint size={15} /> {busy ? "Waiting for the device…" : "Add a passkey"}
          </button>
        </>
      )}
      {message && <p className="settings-help" role="alert">{message}</p>}
      {entry && (
        <div className="passkey-entry">
          <p className="settings-help">
            Passkey created. Add this entry to <code>data/passkeys.json</code>
            {editUrl ? (
              <>
                {" "}
                (<a href={editUrl} target="_blank" rel="noreferrer">edit it on GitHub</a>)
              </>
            ) : null}
            , inside the square brackets and separated from any other entry by a comma,
            then commit. It works once the site rebuilds, in about four minutes. The entry
            is safe to publish: it is locked by the passkey itself.
          </p>
          <textarea readOnly rows={8} value={entryText} onFocus={(event) => event.target.select()} />
          <button
            type="button"
            className="secondary-action"
            onClick={() => void navigator.clipboard?.writeText(entryText).then(() => setMessage("Copied."))}
          >
            Copy entry
          </button>
        </div>
      )}
    </section>
  );
}
