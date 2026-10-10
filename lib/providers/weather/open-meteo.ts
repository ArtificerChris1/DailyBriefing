import type {
  HourlyWeatherPoint,
  WeatherItem,
} from "@/lib/briefing-types";

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

export type OpenMeteoTemperatureUnit = "fahrenheit" | "celsius";

export interface OpenMeteoConfig {
  latitude: number;
  longitude: number;
  location: string;
  timeZone: string;
  temperatureUnit: OpenMeteoTemperatureUnit;
  forecastDays: number;
  /** Days of history to include, so the day pager can look backwards. */
  pastDays: number;
  requestTimeoutMs: number;
  cacheSeconds: number;
}

export interface FetchOpenMeteoWeatherOptions {
  config?: Partial<OpenMeteoConfig>;
  signal?: AbortSignal;
}

export interface DailyWeatherSummary {
  startsOn: string;
  high: number;
  low: number;
  feelsLikeHigh: number;
  feelsLikeLow: number;
  unit: "C" | "F";
  condition: string;
  precipitationChance: number;
  precipitationAmount: number;
}

export type WeatherProviderErrorCode =
  | "CONFIGURATION"
  | "ABORTED"
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP"
  | "INVALID_RESPONSE";

export interface WeatherProviderError {
  provider: "open-meteo";
  code: WeatherProviderErrorCode;
  message: string;
  retryable: boolean;
  status?: number;
}

export interface OpenMeteoMetadata {
  provider: "open-meteo";
  attribution: "Weather data by Open-Meteo.com";
  fetchedAt: string;
  location: string;
  latitude: number;
  longitude: number;
  timeZone: string;
}

export type OpenMeteoWeatherResult =
  | {
      ok: true;
      weather: WeatherItem;
      hourlyWeather: HourlyWeatherPoint[];
      dailyWeather: DailyWeatherSummary[];
      metadata: OpenMeteoMetadata;
    }
  | {
      ok: false;
      weather: null;
      hourlyWeather: [];
      dailyWeather: [];
      error: WeatherProviderError;
      metadata: OpenMeteoMetadata;
    };

const DEFAULT_CONFIG: OpenMeteoConfig = {
  latitude: 41.8781,
  longitude: -87.6298,
  location: "Chicago, IL",
  timeZone: "America/Chicago",
  temperatureUnit: "fahrenheit",
  forecastDays: 3,
  pastDays: 0,
  requestTimeoutMs: 5_000,
  cacheSeconds: 15 * 60,
};

class InvalidWeatherResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidWeatherResponseError";
  }
}

/**
 * Reads build-time configuration. Every variable is optional; defaults target
 * the Chicago demo profile already used by the briefing. In the browser the
 * variables are absent, so callers there pass a full config instead.
 */
export function getOpenMeteoConfigFromEnv(): OpenMeteoConfig {
  const temperatureUnit = normalizeTemperatureUnit(
    process.env.OPEN_METEO_TEMPERATURE_UNIT,
  );

  return validateConfig({
    latitude: readNumberFromEnv(
      "OPEN_METEO_LATITUDE",
      DEFAULT_CONFIG.latitude,
    ),
    longitude: readNumberFromEnv(
      "OPEN_METEO_LONGITUDE",
      DEFAULT_CONFIG.longitude,
    ),
    location:
      process.env.OPEN_METEO_LOCATION?.trim() || DEFAULT_CONFIG.location,
    timeZone:
      process.env.OPEN_METEO_TIMEZONE?.trim() || DEFAULT_CONFIG.timeZone,
    temperatureUnit,
    forecastDays: readNumberFromEnv(
      "OPEN_METEO_FORECAST_DAYS",
      DEFAULT_CONFIG.forecastDays,
    ),
    pastDays: readNumberFromEnv("OPEN_METEO_PAST_DAYS", DEFAULT_CONFIG.pastDays),
    requestTimeoutMs: readNumberFromEnv(
      "OPEN_METEO_TIMEOUT_MS",
      DEFAULT_CONFIG.requestTimeoutMs,
    ),
    cacheSeconds: readNumberFromEnv(
      "OPEN_METEO_CACHE_SECONDS",
      DEFAULT_CONFIG.cacheSeconds,
    ),
  });
}

/**
 * Fetches and normalizes Open-Meteo without allowing provider downtime to throw
 * through the briefing render. Callers can use `ok` to choose live or fallback
 * data and can safely pass the plain error object across a server boundary.
 */
export async function fetchOpenMeteoWeather(
  options: FetchOpenMeteoWeatherOptions = {},
): Promise<OpenMeteoWeatherResult> {
  const fetchedAt = new Date().toISOString();
  let config: OpenMeteoConfig;

  try {
    config = validateConfig({
      ...getOpenMeteoConfigFromEnv(),
      ...options.config,
    });
  } catch (error) {
    return failureResult(
      DEFAULT_CONFIG,
      fetchedAt,
      "CONFIGURATION",
      getErrorMessage(error),
      false,
    );
  }

  const request = createAbortableRequest(
    config.requestTimeoutMs,
    options.signal,
  );

  try {
    const response = await fetch(buildForecastUrl(config), {
      headers: { Accept: "application/json" },
      signal: request.signal,
      next: { revalidate: config.cacheSeconds },
    });

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return failureResult(
        config,
        fetchedAt,
        response.ok ? "INVALID_RESPONSE" : "HTTP",
        response.ok
          ? "Open-Meteo returned a response that was not valid JSON."
          : `Open-Meteo returned HTTP ${response.status}.`,
        response.status >= 500 || response.status === 429,
        response.status,
      );
    }

    if (!response.ok) {
      const providerReason = readProviderReason(body);
      return failureResult(
        config,
        fetchedAt,
        "HTTP",
        providerReason ?? `Open-Meteo returned HTTP ${response.status}.`,
        response.status >= 500 || response.status === 429,
        response.status,
      );
    }

    try {
      const normalized = normalizeResponse(body, config, fetchedAt);
      return {
        ok: true,
        ...normalized,
        metadata: metadataFor(config, fetchedAt, body),
      };
    } catch (error) {
      return failureResult(
        config,
        fetchedAt,
        "INVALID_RESPONSE",
        getErrorMessage(error),
        true,
      );
    }
  } catch (error) {
    if (request.didTimeOut()) {
      return failureResult(
        config,
        fetchedAt,
        "TIMEOUT",
        `Open-Meteo did not respond within ${config.requestTimeoutMs} ms.`,
        true,
      );
    }

    if (options.signal?.aborted) {
      return failureResult(
        config,
        fetchedAt,
        "ABORTED",
        "The Open-Meteo request was cancelled.",
        false,
      );
    }

    return failureResult(
      config,
      fetchedAt,
      "NETWORK",
      `Open-Meteo could not be reached: ${getErrorMessage(error)}`,
      true,
    );
  } finally {
    request.cleanup();
  }
}

function buildForecastUrl(config: OpenMeteoConfig): string {
  const url = new URL(OPEN_METEO_FORECAST_URL);
  url.searchParams.set("latitude", String(config.latitude));
  url.searchParams.set("longitude", String(config.longitude));
  url.searchParams.set(
    "current",
    [
      "temperature_2m",
      "apparent_temperature",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
  );
  url.searchParams.set(
    "hourly",
    [
      "temperature_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
    ].join(","),
  );
  url.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "apparent_temperature_max",
      "apparent_temperature_min",
      "precipitation_probability_max",
      "precipitation_sum",
    ].join(","),
  );
  url.searchParams.set("temperature_unit", config.temperatureUnit);
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timeformat", "unixtime");
  url.searchParams.set("timezone", config.timeZone);
  url.searchParams.set("forecast_days", String(config.forecastDays));
  if (config.pastDays > 0) {
    url.searchParams.set("past_days", String(config.pastDays));
  }
  return url.toString();
}

function normalizeResponse(
  body: unknown,
  config: OpenMeteoConfig,
  fetchedAt: string,
): {
  weather: WeatherItem;
  hourlyWeather: HourlyWeatherPoint[];
  dailyWeather: DailyWeatherSummary[];
} {
  const response = requireRecord(body, "Open-Meteo response");
  const current = requireRecord(response.current, "current weather");
  const hourly = requireRecord(response.hourly, "hourly weather");
  const daily = requireRecord(response.daily, "daily weather");
  const unit = config.temperatureUnit === "fahrenheit" ? "F" : "C";

  const hourlyTimes = requireNumberArray(hourly, "time");
  const hourlyTemperatures = requireNullableNumberArray(
    hourly,
    "temperature_2m",
    hourlyTimes.length,
  );
  const hourlyFeelsLike = requireNullableNumberArray(
    hourly,
    "apparent_temperature",
    hourlyTimes.length,
  );
  const hourlyPrecipitationChance = requireNullableNumberArray(
    hourly,
    "precipitation_probability",
    hourlyTimes.length,
  );
  const hourlyPrecipitation = requireNullableNumberArray(
    hourly,
    "precipitation",
    hourlyTimes.length,
  );
  const hourlyCodes = requireNullableNumberArray(
    hourly,
    "weather_code",
    hourlyTimes.length,
  );
  const hourlyWind = requireNullableNumberArray(
    hourly,
    "wind_speed_10m",
    hourlyTimes.length,
  );

  const hourlyWeather = hourlyTimes.flatMap((time, index) => {
    const temperature = hourlyTemperatures[index];
    const feelsLike = hourlyFeelsLike[index];
    const weatherCode = hourlyCodes[index];

    if (temperature === null || feelsLike === null || weatherCode === null) {
      return [];
    }

    const precipitationChance = hourlyPrecipitationChance[index] ?? 0;
    const precipitationAmount = hourlyPrecipitation[index];
    const windMph = hourlyWind[index];
    const point: HourlyWeatherPoint = {
      id: `open-meteo-hour-${time}`,
      startsAt: unixSecondsToIso(time),
      temperature: roundTemperature(temperature),
      feelsLike: roundTemperature(feelsLike),
      unit,
      condition: hourlyConditionForCode(weatherCode),
      precipitationChance: roundPercentage(precipitationChance),
      ...(precipitationAmount === null
        ? {}
        : { precipitationAmount: roundTo(precipitationAmount, 2) }),
      ...(windMph === null ? {} : { windMph: roundTo(windMph, 1) }),
    };
    return [point];
  });

  if (hourlyWeather.length === 0) {
    throw new InvalidWeatherResponseError(
      "Open-Meteo returned no usable hourly forecast points.",
    );
  }

  const responseTimeZone =
    typeof response.timezone === "string" ? response.timezone : config.timeZone;
  const dailyWeather = normalizeDailyWeather(daily, responseTimeZone, unit);
  if (dailyWeather.length === 0) {
    throw new InvalidWeatherResponseError(
      "Open-Meteo returned no usable daily forecast points.",
    );
  }

  const currentTime = requireFiniteNumber(current, "time");
  const currentTemperature = requireFiniteNumber(current, "temperature_2m");
  const currentFeelsLike = requireFiniteNumber(
    current,
    "apparent_temperature",
  );
  const currentWeatherCode = requireFiniteNumber(current, "weather_code");
  const nearestHour = nearestHourlyPoint(hourlyWeather, currentTime);
  // With past_days requested, index 0 is the oldest day in the window rather
  // than today, so match on the current observation's own date instead.
  const currentDate = dateInTimeZone(currentTime, responseTimeZone);
  const today =
    dailyWeather.find((day) => day.startsOn === currentDate) ?? dailyWeather[0];
  const precipitationChance =
    nearestHour?.precipitationChance ?? today.precipitationChance;
  const condition = weatherLabelForCode(currentWeatherCode);
  const currentStartsAt = unixSecondsToIso(currentTime);

  const weather: WeatherItem = {
    id: `open-meteo-weather-${today.startsOn}`,
    kind: "weather",
    title: `${condition} in ${config.location}`,
    zone: "public",
    sensitivity: "public",
    importance:
      hourlyConditionForCode(currentWeatherCode) === "Thunderstorms" ||
      precipitationChance >= 70
        ? "high"
        : "normal",
    surfacedBecause:
      precipitationChance >= 50
        ? `${precipitationChance}% precipitation chance in the live forecast`
        : "Current conditions and today's forecast",
    periodStart: currentStartsAt,
    temperature: roundTemperature(currentTemperature),
    feelsLike: roundTemperature(currentFeelsLike),
    unit,
    condition,
    precipitationChance,
    high: today.high,
    low: today.low,
    location: config.location,
    source: {
      provider: "weather",
      connectionId: "open-meteo-public",
      externalId: `open-meteo:${today.startsOn}`,
      fetchedAt,
      modifiedAt: currentStartsAt,
    },
  };

  return { weather, hourlyWeather, dailyWeather };
}

function normalizeDailyWeather(
  daily: Record<string, unknown>,
  timeZone: string,
  unit: "C" | "F",
): DailyWeatherSummary[] {
  const times = requireNumberArray(daily, "time");
  const codes = requireNullableNumberArray(daily, "weather_code", times.length);
  const highs = requireNullableNumberArray(
    daily,
    "temperature_2m_max",
    times.length,
  );
  const lows = requireNullableNumberArray(
    daily,
    "temperature_2m_min",
    times.length,
  );
  const feelsLikeHighs = requireNullableNumberArray(
    daily,
    "apparent_temperature_max",
    times.length,
  );
  const feelsLikeLows = requireNullableNumberArray(
    daily,
    "apparent_temperature_min",
    times.length,
  );
  const precipitationChances = requireNullableNumberArray(
    daily,
    "precipitation_probability_max",
    times.length,
  );
  const precipitationAmounts = requireNullableNumberArray(
    daily,
    "precipitation_sum",
    times.length,
  );

  return times.flatMap((time, index) => {
    const code = codes[index];
    const high = highs[index];
    const low = lows[index];
    const feelsLikeHigh = feelsLikeHighs[index];
    const feelsLikeLow = feelsLikeLows[index];

    if (
      code === null ||
      high === null ||
      low === null ||
      feelsLikeHigh === null ||
      feelsLikeLow === null
    ) {
      return [];
    }

    return [
      {
        startsOn: dateInTimeZone(time, timeZone),
        high: roundTemperature(high),
        low: roundTemperature(low),
        feelsLikeHigh: roundTemperature(feelsLikeHigh),
        feelsLikeLow: roundTemperature(feelsLikeLow),
        unit,
        condition: weatherLabelForCode(code),
        precipitationChance: roundPercentage(
          precipitationChances[index] ?? 0,
        ),
        precipitationAmount: roundTo(precipitationAmounts[index] ?? 0, 2),
      },
    ];
  });
}

export function weatherLabelForCode(code: number): string {
  const normalizedCode = Math.round(code);
  if (normalizedCode === 0) return "Clear";
  if (normalizedCode === 1) return "Mainly clear";
  if (normalizedCode === 2) return "Partly cloudy";
  if (normalizedCode === 3) return "Overcast";
  if (normalizedCode === 45 || normalizedCode === 48) return "Fog";
  if (normalizedCode >= 51 && normalizedCode <= 55) return "Drizzle";
  if (normalizedCode === 56 || normalizedCode === 57)
    return "Freezing drizzle";
  if (normalizedCode >= 61 && normalizedCode <= 65) return "Rain";
  if (normalizedCode === 66 || normalizedCode === 67) return "Freezing rain";
  if (normalizedCode >= 71 && normalizedCode <= 75) return "Snow";
  if (normalizedCode === 77) return "Snow grains";
  if (normalizedCode >= 80 && normalizedCode <= 82) return "Rain showers";
  if (normalizedCode === 85 || normalizedCode === 86) return "Snow showers";
  if (normalizedCode === 95) return "Thunderstorms";
  if (normalizedCode === 96 || normalizedCode === 99)
    return "Thunderstorms with hail";
  return "Unknown conditions";
}

function hourlyConditionForCode(
  code: number,
): HourlyWeatherPoint["condition"] {
  const normalizedCode = Math.round(code);
  if (normalizedCode === 0 || normalizedCode === 1) return "Clear";
  if (normalizedCode === 2) return "Partly cloudy";
  if (normalizedCode === 95 || normalizedCode === 96 || normalizedCode === 99)
    return "Thunderstorms";
  if (
    (normalizedCode >= 51 && normalizedCode <= 77) ||
    (normalizedCode >= 80 && normalizedCode <= 86)
  ) {
    return "Rain";
  }
  return "Cloudy";
}

function nearestHourlyPoint(
  hourlyWeather: HourlyWeatherPoint[],
  currentTime: number,
): HourlyWeatherPoint | undefined {
  const currentMilliseconds = currentTime * 1_000;
  return hourlyWeather.reduce<HourlyWeatherPoint | undefined>(
    (nearest, point) => {
      if (!nearest) return point;
      const pointDistance = Math.abs(
        new Date(point.startsAt).getTime() - currentMilliseconds,
      );
      const nearestDistance = Math.abs(
        new Date(nearest.startsAt).getTime() - currentMilliseconds,
      );
      return pointDistance < nearestDistance ? point : nearest;
    },
    undefined,
  );
}

function validateConfig(config: OpenMeteoConfig): OpenMeteoConfig {
  if (!Number.isFinite(config.latitude) || config.latitude < -90 || config.latitude > 90) {
    throw new Error("OPEN_METEO_LATITUDE must be a number from -90 to 90.");
  }
  if (
    !Number.isFinite(config.longitude) ||
    config.longitude < -180 ||
    config.longitude > 180
  ) {
    throw new Error("OPEN_METEO_LONGITUDE must be a number from -180 to 180.");
  }
  if (!config.location.trim()) {
    throw new Error("OPEN_METEO_LOCATION cannot be empty.");
  }
  if (config.timeZone !== "auto") {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: config.timeZone }).format();
    } catch {
      throw new Error("OPEN_METEO_TIMEZONE must be a valid IANA time zone.");
    }
  }
  if (!Number.isInteger(config.forecastDays) || config.forecastDays < 1 || config.forecastDays > 16) {
    throw new Error("OPEN_METEO_FORECAST_DAYS must be an integer from 1 to 16.");
  }
  if (!Number.isInteger(config.pastDays) || config.pastDays < 0 || config.pastDays > 92) {
    throw new Error("OPEN_METEO_PAST_DAYS must be an integer from 0 to 92.");
  }
  if (
    !Number.isInteger(config.requestTimeoutMs) ||
    config.requestTimeoutMs < 250 ||
    config.requestTimeoutMs > 60_000
  ) {
    throw new Error("OPEN_METEO_TIMEOUT_MS must be an integer from 250 to 60000.");
  }
  if (!Number.isInteger(config.cacheSeconds) || config.cacheSeconds < 0) {
    throw new Error("OPEN_METEO_CACHE_SECONDS must be a non-negative integer.");
  }
  if (
    config.temperatureUnit !== "fahrenheit" &&
    config.temperatureUnit !== "celsius"
  ) {
    throw new Error(
      'OPEN_METEO_TEMPERATURE_UNIT must be "fahrenheit" or "celsius".',
    );
  }
  return config;
}

function normalizeTemperatureUnit(
  value: string | undefined,
): OpenMeteoTemperatureUnit {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_CONFIG.temperatureUnit;
  if (normalized === "f" || normalized === "fahrenheit") return "fahrenheit";
  if (normalized === "c" || normalized === "celsius") return "celsius";
  throw new Error(
    'OPEN_METEO_TEMPERATURE_UNIT must be "fahrenheit" or "celsius".',
  );
}

function readNumberFromEnv(name: string, fallback: number): number {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  return Number(value);
}

function metadataFor(
  config: OpenMeteoConfig,
  fetchedAt: string,
  body?: unknown,
): OpenMeteoMetadata {
  const response = isRecord(body) ? body : undefined;
  return {
    provider: "open-meteo",
    attribution: "Weather data by Open-Meteo.com",
    fetchedAt,
    location: config.location,
    latitude: readOptionalFiniteNumber(response?.latitude) ?? config.latitude,
    longitude: readOptionalFiniteNumber(response?.longitude) ?? config.longitude,
    timeZone:
      typeof response?.timezone === "string"
        ? response.timezone
        : config.timeZone,
  };
}

function failureResult(
  config: OpenMeteoConfig,
  fetchedAt: string,
  code: WeatherProviderErrorCode,
  message: string,
  retryable: boolean,
  status?: number,
): OpenMeteoWeatherResult {
  return {
    ok: false,
    weather: null,
    hourlyWeather: [],
    dailyWeather: [],
    error: {
      provider: "open-meteo",
      code,
      message,
      retryable,
      ...(status === undefined ? {} : { status }),
    },
    metadata: metadataFor(config, fetchedAt),
  };
}

function createAbortableRequest(
  timeoutMs: number,
  externalSignal?: AbortSignal,
): {
  signal: AbortSignal;
  didTimeOut(): boolean;
  cleanup(): void;
} {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = () => controller.abort(externalSignal?.reason);
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  if (externalSignal?.aborted) {
    onExternalAbort();
  } else {
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new InvalidWeatherResponseError(
      `Open-Meteo did not include valid ${label}.`,
    );
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number {
  const value = record[key];
  if (!isFiniteNumber(value)) {
    throw new InvalidWeatherResponseError(
      `Open-Meteo returned an invalid ${key} value.`,
    );
  }
  return value;
}

function requireNumberArray(
  record: Record<string, unknown>,
  key: string,
): number[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every(isFiniteNumber)) {
    throw new InvalidWeatherResponseError(
      `Open-Meteo returned an invalid ${key} array.`,
    );
  }
  return value;
}

function requireNullableNumberArray(
  record: Record<string, unknown>,
  key: string,
  expectedLength: number,
): Array<number | null> {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length !== expectedLength ||
    !value.every((entry) => entry === null || isFiniteNumber(entry))
  ) {
    throw new InvalidWeatherResponseError(
      `Open-Meteo returned an invalid ${key} array.`,
    );
  }
  return value;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readOptionalFiniteNumber(value: unknown): number | undefined {
  return isFiniteNumber(value) ? value : undefined;
}

function readProviderReason(body: unknown): string | undefined {
  if (!isRecord(body)) return undefined;
  return typeof body.reason === "string" ? body.reason : undefined;
}

function unixSecondsToIso(value: number): string {
  const date = new Date(value * 1_000);
  if (Number.isNaN(date.getTime())) {
    throw new InvalidWeatherResponseError(
      "Open-Meteo returned an invalid forecast timestamp.",
    );
  }
  return date.toISOString();
}

function dateInTimeZone(value: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value * 1_000));
  const part = (type: "year" | "month" | "day") =>
    parts.find((candidate) => candidate.type === type)?.value;
  const year = part("year");
  const month = part("month");
  const day = part("day");
  if (!year || !month || !day) {
    throw new InvalidWeatherResponseError(
      "Open-Meteo returned an invalid daily forecast timestamp.",
    );
  }
  return `${year}-${month}-${day}`;
}

function roundTemperature(value: number): number {
  return Math.round(value);
}

function roundPercentage(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown weather provider error.";
}
