# Connect Apple Calendar, Reminders, and Photos

## Home or family calendar

Apple provides a read-only subscription link for an iCloud calendar:

1. On iPhone, open **Calendar**, tap **Calendars**, then tap the information button beside the home or family iCloud calendar.
2. Turn on **Public Calendar**, tap **Share Link**, and copy the `webcal://` address.
3. Paste it into your local `.env.local` file, and into the `HOME_CALENDAR_ICAL_URL` repository secret for the deployed site (see the README). Do not paste the link into chat or commit it to source control.

```dotenv
HOME_CALENDAR_ICAL_URL=webcal://pXX-caldav.icloud.com/published/...
HOME_CALENDAR_ICAL_LABEL=Home calendar
```

4. Restart Brief and refresh the dashboard. The webcal address is converted to HTTPS automatically.

Apple calls this a public calendar because anyone who has its unguessable link can read it; it is not listed in a searchable directory. Treat the link like a password and disable/re-enable **Public Calendar** if it is exposed. Apple's current instructions are available for [iPhone](https://support.apple.com/guide/iphone/iph7613c4fb/ios) and [iCloud.com](https://support.apple.com/guide/icloud/mm6b1a9479/icloud).

## Apple Reminders

The site has no server, so an iPhone Shortcut sends your open reminders to GitHub instead. GitHub runs the deploy workflow, which encrypts them, saves them on the `reminders-data` branch, and rebuilds the site; the daily build reuses that saved snapshot until the Shortcut runs again. The repository is public, so the branch holds only ciphertext; on the site, reminders are encrypted along with everything else and only appear after login.

### 1. Create the encryption key

Run this in PowerShell and copy the result:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Add it as a `REMINDERS_KEY` secret under **Settings > Environments > github-pages**. The Shortcut never needs it. Changing it later makes the saved snapshot unreadable until the Shortcut runs again.

### 2. Create a GitHub token for the Shortcut

On GitHub, open **Settings > Developer settings > Personal access tokens > Fine-grained tokens** and generate a token:

- **Repository access:** Only select repositories, then `DailyBriefing`.
- **Permissions:** Contents, Read and write. GitHub requires this to start a workflow from outside.

Keep it only in the Shortcut. It can change the repository, so revoke it on GitHub if the phone is lost. Note its expiry date; the Shortcut stops working when it lapses.

### 3. Build the Shortcut

Create a Shortcut named **Update Daily Briefing** with these actions:

1. **Find Reminders** where **Is Completed** is false. Add list filters if only some lists should appear.
2. **Repeat with Each** result. Inside the repeat:
   - If the reminder has a due date, **Format Date** it as **ISO 8601** with the time included.
   - **Dictionary** with `title` = Name, `listLabel` = List, and `due` = the formatted date (leave `due` out when there is none).
   - **Add to Variable** `Reminder Payloads`.
3. **Get Contents of URL**:
   - URL: `https://api.github.com/repos/ArtificerChris1/DailyBriefing/dispatches`
   - Method: `POST`
   - Headers: `Authorization` = `Bearer YOUR-GITHUB-TOKEN`, `Accept` = `application/vnd.github+json`
   - Request Body: **JSON**, with `event_type` (Text) = `reminders` and `client_payload` (Dictionary) containing `reminders` (Array) = `Reminder Payloads`.

GitHub answers with an empty response when it accepts the request. The site updates about four minutes later; follow the run under the repository's **Actions** tab. A Personal Automation that runs the Shortcut each morning before 5am keeps the daily build current.

Ticking a reminder off on the site only hides it on that device until the next snapshot; the site cannot change Apple Reminders.

### 4. Optional: "Add to Reminders" from suggestions

The "You might have forgotten" card can hand a suggestion to Reminders on iPhone, iPad and Mac. Create a second Shortcut named exactly **Add Briefing Reminder** with one action, **Add New Reminder**, whose title is **Shortcut Input**. The card's **Add to Reminders** button runs it with the suggestion's text.

## Photo of the day

The build picks one photo a day from a shared album in iCloud Photos and publishes an encrypted copy of it.

1. In **Photos** on iPhone, create a shared album and add the photos you want to see.
2. Turn on public sharing for the album and copy its link. Current versions of Photos give a link like `https://photos.icloud.com/shared/album/073nu2tgF-A0JjfGnP7bdoRhA`; older shared albums with **Public Website** on give `https://www.icloud.com/sharedalbum/#B0aGWZuqDGKrA9R`. Both work.
3. Add the link as an `ICLOUD_SHARED_ALBUM_URL` secret under **Settings > Environments > github-pages**, and to `.env.local` to try it locally.

Keep the link private. Anyone who has it can see the album, see the owner's name and email address, and, with the current link format, add photos to it.

Videos are skipped. The date each photo was taken appears under it. Apple does not document the services behind these links, so if Apple changes them the card simply disappears until the provider is updated.
