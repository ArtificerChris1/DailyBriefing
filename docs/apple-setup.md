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

Restart Brief for the token to take effect. Changing this token later makes the prior encrypted snapshot unreadable; delete `.data/apple-reminders.enc` after changing it if you want to start fresh.

### 2. Make Brief reachable from the iPhone

The phone and computer must be on the same trusted Wi-Fi network. Start the LAN-enabled development server:

```powershell
npm.cmd run dev:lan
```

Run `ipconfig` and find the computer's **IPv4 Address** under the active Wi-Fi adapter. The Shortcut endpoint is:

```text
http://YOUR-COMPUTER-IP:3000/api/apple/reminders
```

Allow Node.js on **Private networks** if Windows Firewall asks. This LAN mode makes the dashboard visible to devices on the same network, while Reminder uploads still require the secret token.

### 3. Build the Shortcut

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
