# Login: password and passkeys

The site is public static files, so a login screen on its own would hide nothing: anyone could download the data files directly. Instead, the build encrypts every personal file, and the browser decrypts them after you sign in.

- **What is encrypted:** every day of the briefing (`/briefing/*.json`) and the photo of the day (`/photo-of-the-day.bin`). The page itself is published with no briefing in it.
- **The data key:** `BRIEFING_DATA_KEY` encrypts those files. It never leaves GitHub's secrets.
- **The keyring:** `/keyring.json` publishes the data key twice over, locked once by your password and once by each registered passkey. Either one unlocks it in your browser. Without one of them, the keyring and the data files are unreadable.
- **Staying signed in:** after you unlock, the key is kept only for that browser tab or app session. Closing it, or **Preferences > Sign-in > Lock now**, signs you out.
- **A missing key fails the build:** if `BRIEFING_DATA_KEY` or `BRIEFING_PASSWORD` is missing, the GitHub build stops rather than publish anything unencrypted.

## 1. Add the secrets

Under **Settings > Environments > github-pages**, add two secrets.

**`BRIEFING_DATA_KEY`**, 32 random bytes. Generate it in PowerShell:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

**`BRIEFING_PASSWORD`**, the password you will type to sign in. Make it long: the keyring is public, so a short password could be guessed offline. Four or more random words works well.

Changing the password only needs a rebuild. Changing the data key makes every registered passkey stop working, so they would need to be added again.

## 2. Add a passkey on each device

Passkeys let you unlock with Face ID, Touch ID, Windows Hello, or a device PIN.

1. Sign in with the password on the device.
2. Open **Preferences**. Under **Sign-in**, enter a device name and choose **Add a passkey**.
3. The page shows a short entry. Add it to [`data/passkeys.json`](../data/passkeys.json) on GitHub: use the **edit it on GitHub** link, paste the entry inside the square brackets (separate it from any existing entry with a comma), and commit.
4. The site rebuilds in about four minutes. After that, **Unlock with passkey** appears on the sign-in screen.

The entry is safe to publish: it is useless without the passkey that created it.

Passkeys saved to iCloud Keychain or Google Password Manager sync to your other devices, so one entry can cover an iPhone and a Mac.

Unlocking with a passkey relies on the WebAuthn **PRF** extension. Current Safari on iOS and macOS supports it, as do Chrome and Edge with iCloud Keychain, Google Password Manager, or most security keys. Where it isn't supported, **Add a passkey** says so; keep using the password on that device.

To remove a passkey, delete its entry from `data/passkeys.json` and commit. It can't unlock the site after the next build. To be safe, also delete the passkey itself from the device's password manager.

## What stays public

- This repository, including its code and git history. The birthday list in `lib/data/birthdays.ts` is part of the code, so it is still readable on GitHub even though the site now encrypts it.
- That the site exists, and roughly how large each day's data is.
