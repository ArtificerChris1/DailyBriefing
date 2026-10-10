import "server-only";

import type { QuoteOfDay } from "@/lib/briefing-types";

const QUOTE_URL = "https://api.api-ninjas.com/v2/quoteoftheday";
const DEFAULT_TIMEOUT_MS = 6_000;
/** The upstream quote only changes at midnight, so cache generously. */
const DEFAULT_CACHE_SECONDS = 60 * 60;

export interface QuoteOfDayResult {
  ok: boolean;
  quote?: QuoteOfDay;
  configured: boolean;
  error?: string;
}

interface ApiNinjasQuote {
  quote?: unknown;
  author?: unknown;
  work?: unknown;
}

let cache: { expiresAt: number; quote: QuoteOfDay } | undefined;

function environmentNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]?.trim());
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export async function fetchQuoteOfTheDay(): Promise<QuoteOfDayResult> {
  const apiKey = process.env.API_NINJAS_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      configured: false,
      error: "Add API_NINJAS_KEY to .env.local to show the quote of the day.",
    };
  }

  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return { ok: true, quote: cache.quote, configured: true };
  }

  const timeoutMs = environmentNumber("QUOTE_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const cacheSeconds = environmentNumber(
    "QUOTE_CACHE_SECONDS",
    DEFAULT_CACHE_SECONDS,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(QUOTE_URL, {
      headers: { Accept: "application/json", "X-Api-Key": apiKey },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Quote feed returned HTTP ${response.status}.`);
    }
    const body: unknown = await response.json();
    // The endpoint always returns an array, even though it holds one quote.
    const first = Array.isArray(body) ? (body[0] as ApiNinjasQuote) : undefined;
    const quoteText = text(first?.quote);
    if (!quoteText) throw new Error("Quote feed returned no usable quote.");
    const quote: QuoteOfDay = {
      text: quoteText,
      author: text(first?.author) ?? "Unknown",
      work: text(first?.work),
      attribution: "API Ninjas",
    };
    cache = { expiresAt: now + cacheSeconds * 1000, quote };
    return { ok: true, quote, configured: true };
  } catch (error) {
    // A missing quote is cosmetic; keep serving the last good one if we have it.
    if (cache) return { ok: true, quote: cache.quote, configured: true };
    return {
      ok: false,
      configured: true,
      error:
        error instanceof Error
          ? error.message
          : "The quote of the day could not be loaded.",
    };
  } finally {
    clearTimeout(timeout);
  }
}
