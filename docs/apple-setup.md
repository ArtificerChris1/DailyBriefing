# Connect Apple Calendar

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
