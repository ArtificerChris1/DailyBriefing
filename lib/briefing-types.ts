export type ProviderId =
  | "ical"
  | "apple-calendar"
  | "apple-shortcut"
  | "weather"
  | "sports"
  | "news";

export type TrustZone = "work" | "personal" | "public";
export type Sensitivity = "public" | "private" | "confidential";

export interface SourceRef {
  provider: ProviderId;
  connectionId: string;
  externalId: string;
  fetchedAt: string;
  modifiedAt?: string;
  etag?: string;
  deepLink?: string;
}

export interface BaseItem<K extends string> {
  id: string;
  kind: K;
  source: SourceRef;
  zone: TrustZone;
  sensitivity: Sensitivity;
  title: string;
  importance: "low" | "normal" | "high";
  surfacedBecause: string;
  expiresAt?: string;
}

export type TimeSpan =
  | {
      mode: "timed";
      start: string;
      end?: string;
      originalTimeZone?: string;
    }
  | {
      mode: "all-day";
      startDate: string;
      endDateExclusive: string;
      timeZone: string;
    };

export interface CalendarItem extends BaseItem<"calendar"> {
  time: TimeSpan;
  status: "confirmed" | "tentative" | "cancelled";
  locationLabel?: string;
  sourceLabel: string;
  /** When to leave home to arrive on time; see lib/server/travel.ts. */
  departure?: Departure;
}

/** Estimated drive from home, without live traffic. */
export interface Departure {
  /** ISO instant: start time minus the drive and the preparation buffer. */
  leaveAt: string;
  travelMinutes: number;
  distanceMiles: number;
}

/** A dry, comfortable stretch of the day with nothing scheduled. */
export interface OutdoorWindow {
  /** ISO instants. */
  from: string;
  to: string;
  /** e.g. "Clear, 68–72°". */
  summary: string;
}

export interface ReminderItem extends BaseItem<"reminder"> {
  dueAt?: string;
  dueLabel?: string;
  completed: boolean;
  listLabel?: string;
}

export interface WeatherItem extends BaseItem<"weather"> {
  periodStart: string;
  temperature: number;
  feelsLike: number;
  unit: "C" | "F";
  condition: string;
  precipitationChance?: number;
  high: number;
  low: number;
  location: string;
}

export interface HourlyWeatherPoint {
  id: string;
  startsAt: string;
  temperature: number;
  feelsLike: number;
  unit: "C" | "F";
  condition:
    | "Clear"
    | "Partly cloudy"
    | "Cloudy"
    | "Fog"
    | "Drizzle"
    | "Rain"
    | "Showers"
    | "Snow"
    | "Thunderstorms";
  precipitationChance: number;
  precipitationAmount?: number;
  windMph?: number;
}

export interface SportsItem extends BaseItem<"sports"> {
  team: string;
  logoPath: string;
  opponent: string;
  /** Human-readable start, e.g. "Today · 7:05 PM". Absent once a game is final. */
  startsAt?: string;
  /**
   * When the event actually happens, as an ISO instant, for sorting and for
   * ageing items out of the briefing. Set even for finals, where `startsAt` is
   * not. Absent when a feed gives no usable date.
   */
  occursAt?: string;
  state: "scheduled" | "live" | "final";
  scoreLabel?: string;
  league: string;
  broadcast?: string;
  group?: "local" | "seattle-boston" | "international" | "wisconsin";
  context?: string;
  standingLabel?: string;
}

export interface NewsItem extends BaseItem<"news"> {
  /** One sentence on what the story says; see lib/server/news-summaries.ts. */
  summary?: string;
  /** The publisher's own summary. Used to write `summary`, then dropped. */
  excerpt?: string;
  publisher: string;
  publishedAt: string;
  url: string;
  category?: string;
  lane?: "world" | "geek" | "events";
  interestTag?: string;
  confirmed?: boolean;
}

export interface HotGameItem {
  id: string;
  rank: number;
  /** Places gained (positive) or lost since the previous day's list. */
  movement?: number;
  /** Not on the previous day's list. */
  isNew?: boolean;
  name: string;
  yearPublished?: number;
  thumbnailUrl?: string;
  url: string;
}

export interface HotGamesPanel {
  items: HotGameItem[];
  /** Required by BoardGameGeek's API terms whenever their data is shown. */
  attribution: string;
  /** Set when a token is configured but the list could not be loaded. */
  message?: string;
}

export type ReleaseMedium = "movie" | "tv" | "comic" | "book";

export interface ReleaseItem {
  id: string;
  medium: ReleaseMedium;
  title: string;
  /** `YYYY-MM-DD` in the release's own calendar; these are dates, not instants. */
  releasesOn: string;
  /** Studio, network, publisher, or imprint. */
  by?: string;
  /** Author, series and issue number, or episode label. */
  detail?: string;
  posterUrl?: string;
  url?: string;
  /** Where to watch, e.g. "Streaming on Netflix" or "In theaters Oct 17". */
  availability?: string;
}

export interface UpcomingReleasesPanel {
  items: ReleaseItem[];
  /** Attribution lines for whichever sources actually answered. */
  attribution: string;
  /** Per-source failures. The panel still renders whatever else came back. */
  warnings: string[];
  /** Set only when every configured source failed, so the card can say why. */
  message?: string;
}

export interface BirthdayItem {
  id: string;
  name: string;
  /** `MM-DD`. Recurring dates, not instants. */
  on: string;
  kind: "birthday" | "anniversary";
  /**
   * Days from the day being shown; negative is already past. Bounded by
   * BIRTHDAY_LOOKBACK_DAYS and BIRTHDAY_LOOKAHEAD_DAYS.
   */
  offset: number;
  /** Weekday and date for the occasion itself, e.g. "Sat, Aug 9". */
  dateLabel: string;
  /**
   * Age, years married, or years lived — whatever the source year supports.
   * Absent for the Facebook entries, which carry no year at all.
   */
  detail?: string;
  /** The person has died; the row is a remembrance and shows no age. */
  inMemoriam?: boolean;
  /** Maiden name or other context, when the source list carried one. */
  note?: string;
  profileUrl?: string;
}

export interface BirthdaysPanel {
  /** Chronological: earliest past day first, through the last upcoming day. */
  items: BirthdayItem[];
  /** How many land on the day being shown, so the card can lead with it. */
  onDayCount: number;
}

export interface QuoteOfDay {
  text: string;
  author: string;
  work?: string;
  attribution: string;
}

export type BriefingItem =
  | CalendarItem
  | ReminderItem
  | WeatherItem
  | SportsItem
  | NewsItem;

export type ConnectorState =
  | "connected"
  | "demo"
  | "not-configured"
  | "not-connected"
  | "planned"
  | "expired"
  | "error";

export type LiveSourceState = "live" | "demo" | "not-connected" | "not-configured" | "error";

export interface BriefingSourceStatus {
  provider: ProviderId;
  capability: string;
  label: string;
  state: LiveSourceState;
  lastSyncedAt?: string;
  message?: string;
}

export interface ConnectionSummary {
  provider: ProviderId;
  state: Exclude<ConnectorState, "demo" | "planned">;
  accountLabel?: string;
  connectedAt?: string;
  lastSyncedAt?: string;
  message?: string;
}

export interface RemindersPanel {
  items: ReminderItem[];
  /** When the Shortcut last sent a snapshot. */
  syncedAt: string;
}

export interface PhotoOfDay {
  /** Site-relative path of the image file written by the build. */
  src: string;
  width: number;
  height: number;
  caption?: string;
  takenAt?: string;
  albumName?: string;
  /** The shared album's link, for "Open album"; safe because the page is encrypted. */
  albumUrl?: string;
}

/** A photo taken on this date in an earlier year. */
export interface PhotoMemory {
  /** Site-relative path of the encrypted image the build writes. */
  src: string;
  width: number;
  height: number;
  takenAt: string;
  yearsAgo: number;
}

/** A family occasion or holiday in the next three weeks; see lib/occasions.ts. */
export interface OccasionItem {
  id: string;
  name: string;
  kind: "birthday" | "anniversary" | "holiday";
  /** `YYYY-MM-DD`. */
  date: string;
  /** Days from today. */
  offset: number;
  dateLabel: string;
  detail?: string;
  /** Whether a gift or card is usual, so it is worth tracking as sorted. */
  giftable: boolean;
}

/**
 * Something that may need attention, found by a rule rather than written in
 * Reminders: overlapping events, a missing location, an unusually early
 * start. Always presented as a suggestion, never as a confirmed obligation.
 */
export interface HeadsUpItem {
  id: string;
  kind: "overlap" | "missing-location" | "early-start" | "free-time" | "weather" | "gift";
  title: string;
  detail: string;
  /** Text for a new reminder, when acting on it means remembering to do something. */
  reminderText?: string;
}

/** The AI-written summary at the top of today's page. */
export interface DailyBrief {
  /** Which view it was written for: the day ahead, or tomorrow. */
  mode: "morning" | "evening";
  headline: string;
  points: { label: string; text: string }[];
  generatedAt: string;
}

export interface BriefingSnapshot {
  generatedAt: string;
  /** The day being shown, which the pager can move away from today. */
  date: string;
  /** Today in `timeZone`, so the client can label and bound the pager. */
  today: string;
  timeZone: string;
  mode: "live" | "mixed" | "demo";
  quote?: QuoteOfDay;
  /** Absent entirely when no BGG application token is configured. */
  hotGames?: HotGamesPanel;
  /** Absent entirely when no release source is configured. */
  upcomingReleases?: UpcomingReleasesPanel;
  birthdays: BirthdaysPanel;
  /** Absent until a reminder key is configured and the Shortcut has run. */
  reminders?: RemindersPanel;
  /** Today's page only, and only when a shared album is configured. */
  photo?: PhotoOfDay;
  /** Today's page only: photos from this date in earlier years. */
  memories?: PhotoMemory[];
  /** Today's page only: occasions in the next three weeks. */
  occasions?: OccasionItem[];
  /** Today's page only: rule-based suggestions from the next few days. */
  headsUp?: HeadsUpItem[];
  /** Today's page only, and only when an Anthropic API key is configured. */
  dailyBrief?: DailyBrief;
  /** The best (remaining, on today's page) time that day to be outside, if any. */
  outdoorWindow?: OutdoorWindow;
  agenda: CalendarItem[];
  weather: WeatherItem;
  hourlyWeather: HourlyWeatherPoint[];
  sports: SportsItem[];
  headlines: NewsItem[];
  sources: BriefingSourceStatus[];
}

export interface BriefingPayload {
  briefing: BriefingSnapshot;
  connections: ConnectionSummary[];
}

export interface BriefingRequest {
  /** `YYYY-MM-DD` in the resolved time zone. Defaults to today. */
  date?: string;
}

export interface ConnectorDefinition {
  id: ProviderId;
  name: string;
  description: string;
  state: ConnectorState;
  zone: TrustZone;
  capabilities: string[];
  permissionNote: string;
}
