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
  publisher: string;
  publishedAt: string;
  url: string;
  category?: string;
  lane?: "world" | "geek" | "events";
  interestTag?: string;
  confirmed?: boolean;
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

export interface BriefingSnapshot {
  generatedAt: string;
  /** The day being shown, which the pager can move away from today. */
  date: string;
  /** Today in `timeZone`, so the client can label and bound the pager. */
  today: string;
  timeZone: string;
  mode: "live" | "mixed" | "demo";
  quote?: QuoteOfDay;
  agenda: CalendarItem[];
  reminders: ReminderItem[];
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

export interface CurrentLocationInput {
  latitude?: number;
  longitude?: number;
  timeZone?: string;
}

export interface BriefingRequest {
  location?: CurrentLocationInput;
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
