# Brief

A private, mobile-first daily briefing that combines work and home calendars, Apple Reminders, a photo of the day, hourly weather, sports, and headlines in one focused view. It is a static site: a scheduled GitHub Actions job rebuilds it each morning and publishes it to GitHub Pages, so there is no server to run or pay for. 

## What is live now

- Open-Meteo supplies current conditions, feels-like temperature, and hourly weather aligned to the calendar timeline.
- Private iCal subscriptions can supply today's work calendar and Apple home/family calendar, including recurring events and exceptions.
- TheSportsDB, MLB Stats, NHL, Iowa State Athletics, FIFA, and LA28 sources supply favorite-team schedules, results, tournament dates, and available standings.
- Selected publisher RSS feeds supply current, attributed progressive/global and geek-culture headlines.
- Outlook email and Teams messages are out of scope because organizational approval is unavailable.
- If a live provider is unavailable, the dashboard continues with its sample fallback instead of failing.

No notification delivery is enabled yet.

## Run locally

```powershell
npm.cmd install
if (!(Test-Path .env.local)) { Copy-Item .env.example .env.local }
npm.cmd run dev
```

Open `http://localhost:3000`. After any `.env.local` change, stop the development server with `Ctrl+C` and start it again.

Weather works without an API key. See [Apple setup](docs/apple-setup.md) to connect the home calendar, Reminders, and the photo of the day.

## Connect the work calendar with iCal

1. In Outlook on the web, open **Settings > Calendar > Shared calendars** and look for **Publish a calendar**.
2. Select the work calendar and the option that includes event details, then copy the **ICS** link, not the HTML link.
3. Add the private subscription address to `.env.local`:

```dotenv
WORK_CALENDAR_ICAL_URL=https://your-private-calendar-subscription.ics
WORK_CALENDAR_ICAL_LABEL=Work calendar
WORK_CALENDAR_ICAL_CACHE_SECONDS=300
```

4. Restart the development server and refresh the dashboard. **Connections** should show **Work calendar (iCal) — Connected**.

Treat every iCal URL like a password. Brief fetches it only during the build, never ships the address to the browser, does not persist the raw feed, and caches only normalized events overlapping the current day. Revoke and republish a feed if its URL is exposed.

## Weather configuration

The build bakes in the forecast for the configured location below. When the browser grants location permission, it asks Open-Meteo directly for the forecast at your current coordinates (rounded to about 1 km for the place-name lookup) and swaps it in. Coordinates stay in browser memory for the open page and are never published.

If location permission is unavailable, the default is Chicago, Illinois. Override the fallback in `.env.local`:

```dotenv
OPEN_METEO_LATITUDE=41.8781
OPEN_METEO_LONGITUDE=-87.6298
OPEN_METEO_LOCATION=Chicago, IL
OPEN_METEO_TIMEZONE=America/Chicago
OPEN_METEO_TEMPERATURE_UNIT=fahrenheit
OPEN_METEO_FORECAST_DAYS=3
OPEN_METEO_TIMEOUT_MS=5000
OPEN_METEO_CACHE_SECONDS=900
```

Use an IANA time-zone name such as `America/Chicago`. Forecast days can be 1–16, and temperature can be `fahrenheit` or `celsius`.

## Deploy to GitHub Pages

[.github/workflows/deploy.yml](.github/workflows/deploy.yml) builds the site with `next build` and publishes the `out/` folder. It runs daily at 10:00 UTC (5am Central in summer, 4am in winter), on every push to `main`, and on demand from the **Actions** tab.

Every provider runs during that build, so the briefing is a snapshot: scores, calendars, and headlines are as fresh as the last run. Each page of the day pager is a static file, `/briefing/YYYY-MM-DD.json`, covering a week back and two weeks ahead. Weather is the one live part: when the browser allows location access, it fetches the forecast for where you are straight from Open-Meteo.

One-time setup:

1. In the repository, open **Settings > Pages** and set **Source** to **GitHub Actions**.
2. Under **Settings > Environments > github-pages**, add each credential you use as an environment **secret**: `WORK_CALENDAR_ICAL_URL`, `HOME_CALENDAR_ICAL_URL`, `API_NINJAS_KEY`, `BGG_API_TOKEN`, `TMDB_ACCESS_TOKEN` or `TMDB_API_KEY`, `COMICVINE_API_KEY`, `THESPORTSDB_API_KEY`, `REMINDERS_KEY`, `ICLOUD_SHARED_ALBUM_URL`, and the two login secrets `BRIEFING_DATA_KEY` and `BRIEFING_PASSWORD`. See [Apple setup](docs/apple-setup.md) for the last two and for the Reminders Shortcut.
3. Optionally add repository **variables** for `OPEN_METEO_LATITUDE`, `OPEN_METEO_LONGITUDE`, `OPEN_METEO_LOCATION`, `OPEN_METEO_TIMEZONE`, `OPEN_METEO_TEMPERATURE_UNIT`, `TMDB_REGION`, and `COMICVINE_PUBLISHERS`.
4. Run the workflow once from the **Actions** tab.

GitHub Pages sites are public, so the build encrypts everything personal and the site asks for a password or passkey before decrypting it in the browser. See [Login setup](docs/login-setup.md). The repository and its history stay public; on GitHub's free plan, Pages requires that.

GitHub disables scheduled workflows after 60 days without repository activity; re-enable it from the **Actions** tab if the briefing stops updating.

## Local data and security

Private feed addresses live only in Git-ignored `.env.local` locally and in repository secrets for the deployed build. Raw calendars are not persisted, and calendar errors are reported without the feed address.

Sports and headline feeds need no private credentials. Brief uses TheSportsDB's documented free key against their v1 API unless `THESPORTSDB_API_KEY` is set, in which case team schedules come from the premium v2 API. It combines either with official MLB/NHL data and caches public results for 15 minutes. Headlines contain publisher-provided titles, dates, attribution, and canonical links—not copied article bodies.

## Quality checks

```powershell
npm.cmd run lint
npm.cmd run build
npm.cmd run preview
```

`preview` serves the built `out/` folder at `http://localhost:3000`.

## Next integrations

1. Add live match-by-match and medal-table coverage when World Cups or Olympics are active.
2. Expand standings coverage and replace supporting sports data with licensed feeds before public distribution.
3. Send a privacy-safe daily notification or email from the scheduled build.

Raw provider responses and private content sent to external AI services remain excluded by default.
