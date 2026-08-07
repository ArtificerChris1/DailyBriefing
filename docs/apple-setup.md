# Connect Apple Calendar and Reminders

## Home or family calendar

Apple provides a read-only subscription link for an iCloud calendar:

1. On iPhone, open **Calendar**, tap **Calendars**, then tap the information button beside the home or family iCloud calendar.
2. Turn on **Public Calendar**, tap **Share Link**, and copy the `webcal://` address.
3. Paste it into your local `.env.local` file. Do not paste the link into chat or commit it to source control.

```dotenv
HOME_CALENDAR_ICAL_URL=webcal://pXX-caldav.icloud.com/published/...
HOME_CALENDAR_ICAL_LABEL=Home calendar
```

4. Restart Brief and refresh the dashboard. The webcal address is converted to HTTPS automatically.

Apple calls this a public calendar because anyone who has its unguessable link can read it; it is not listed in a searchable directory. Treat the link like a password and disable/re-enable **Public Calendar** if it is exposed. Apple's current instructions are available for [iPhone](https://support.apple.com/guide/iphone/iph7613c4fb/ios) and [iCloud.com](https://support.apple.com/guide/icloud/mm6b1a9479/icloud).

## Apple Reminders

Brief receives selected reminders from an iPhone Shortcut. The request needs a secret token, and the resulting local snapshot is encrypted with that same token.

### 1. Create the secret token

Run this in PowerShell yourself:

```powershell
$tokenBytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($tokenBytes)
[Convert]::ToBase64String($tokenBytes)
```

Copy the result into `.env.local` without sharing it:

```dotenv
APPLE_SHORTCUT_TOKEN=your-generated-token
```

Restart Brief for the token to take effect. On a deployment, add the same value as an environment variable in the hosting project rather than in a file. Changing this token later makes the prior encrypted snapshot unreadable; clear the stored snapshot after changing it if you want to start fresh.

### 2. Give the snapshot somewhere to live

The snapshot is encrypted before it is stored, so the store only ever holds ciphertext. Where it goes depends on where Brief runs.

**Running locally:** nothing to do. Brief writes `.data/apple-reminders.enc` beside the project, or to `APPLE_REMINDERS_DATA_DIR` if that is set.

**Deployed to Vercel:** the filesystem is read-only, so a file cannot be used. `/tmp` does not work either — it is scratch space for one function instance, and the instance that renders the dashboard is usually not the one that received the upload. Add a Redis store instead:

1. In the Vercel project, open **Storage**, choose **Upstash for Redis** from the Marketplace, and connect it to the project.
2. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. A database created directly at upstash.com sets `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`; either pair works.
3. Redeploy so the new variables are picked up.

Until this is done, **Connections** shows the Apple Reminders row in an error state, and Shortcut uploads are refused with HTTP 503 rather than failing silently.

### 3. Find the Shortcut endpoint

The endpoint is `/api/apple/reminders` on whichever address serves Brief:

```text
https://your-deployment.example.com/api/apple/reminders
```

For a local-only setup, run `npm.cmd run dev:lan`, keep the phone and computer on the same trusted Wi-Fi network, and use the computer's **IPv4 Address** from `ipconfig`:

```text
http://YOUR-COMPUTER-IP:3000/api/apple/reminders
```

Allow Node.js on **Private networks** if Windows Firewall asks. LAN mode makes the dashboard visible to every device on the network, while Reminder uploads still require the secret token.

### 4. Build the Shortcut

Create a new Shortcut named **Update Daily Briefing**, then add these actions in order:

1. **Find Reminders** where **Is Completed** is false. Add list filters if only selected lists should appear.
2. Add an empty **List** action and name its magic variable `Reminder Payloads`.
3. **Repeat with Each** result. Inside the repeat:
   - Get the reminder's **Name**, **List**, and **Due Date**.
   - If a due date exists, use **Format Date** with **ISO 8601**.
   - Create a **Dictionary** with `title` = Name, `listLabel` = List name, `due` = formatted due date, and `completed` = false. Omit `due` when there is no date.
   - Use **Add to Variable** to append the Dictionary to `Reminder Payloads`.
4. Add **Generate UUID** and use its result as `nonce`.
5. Create a final **Dictionary** with `schemaVersion` = number `1`, `nonce` = generated UUID, and `reminders` = `Reminder Payloads`.
6. Add **Get Contents of URL** using the endpoint above. Choose `POST`, request body `JSON`, and the final Dictionary. Add the header `Authorization` with the value `Bearer YOUR-GENERATED-TOKEN`.
7. Run the Shortcut once, refresh Brief, and confirm **Apple Reminders — Connected** in Connections.

The upload endpoint accepts at most 500 reminders, never returns reminder text, rejects repeated upload nonces, and replaces the previous snapshot. For regular updates, add a personal automation that runs this Shortcut at a chosen time or when Brief should refresh.
