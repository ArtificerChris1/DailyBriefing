import "server-only";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import type { NewsItem } from "@/lib/briefing-types";
import { shiftDateKey } from "@/lib/briefing-window";

/**
 * One-sentence summaries under each headline. Claude condenses the headline
 * and the publisher's own summary, adding nothing; without ANTHROPIC_API_KEY
 * the first sentence of the publisher's summary stands in.
 *
 * Summaries are kept by story URL in .data/history/news-summaries.json, which
 * the workflow carries between builds on the history-data branch, so each
 * build only summarises stories it has not seen. Headlines are public, so the
 * file is plain JSON.
 */

const DEFAULT_MODEL = "claude-opus-5-5";
const DEFAULT_PATH = ".data/history/news-summaries.json";
/** Summaries for stories not seen for this long are dropped. */
const KEEP_DAYS = 14;
/** Stories per request. */
const BATCH_SIZE = 30;
const FALLBACK_MIN_CHARS = 40;
const FALLBACK_MAX_CHARS = 220;

interface Store {
  version: 1;
  /** Story URL → summary ("" when there was nothing to summarise) and last day seen. */
  items: Record<string, { summary: string; seen: string }>;
}

const SummarySchema = z.object({
  summaries: z.array(z.object({ id: z.string(), summary: z.string() })),
});

const SYSTEM = `You write the one-line summaries under headlines on a personal news dashboard.

For each story you receive a headline and, when the publisher provided one, the publisher's own summary. Write one plain sentence of at most 25 words saying what the story reports. Use only what the headline and summary say: no added facts, background, numbers, or opinion, and no "This article…" framing. Don't just repeat the headline; draw on the publisher's summary. If there is no publisher summary, or it adds nothing to the headline, return an empty string for that story.

Return every story's id exactly as given.`;

function storePath(): string {
  return process.env.NEWS_SUMMARY_PATH?.trim() || DEFAULT_PATH;
}

async function readStore(): Promise<Store> {
  try {
    const parsed = JSON.parse(await readFile(storePath(), "utf8")) as Store;
    if (parsed.version === 1 && parsed.items && typeof parsed.items === "object") return parsed;
  } catch {
    // Nothing saved yet.
  }
  return { version: 1, items: {} };
}

/**
 * The publisher's first sentence, for stories Claude has not summarised. Only
 * a complete sentence of a sensible length counts: greetings ("Hi readers!")
 * and run-on live-blog teasers are left out rather than shown half-cut.
 */
function firstSentence(excerpt: string | undefined): string {
  const sentence = excerpt ? /^.+?[.!?](?=\s|$)/.exec(excerpt)?.[0] : undefined;
  return sentence && sentence.length >= FALLBACK_MIN_CHARS && sentence.length <= FALLBACK_MAX_CHARS
    ? sentence
    : "";
}

/**
 * Claude's summaries by story URL. Only these are saved: a fallback stored
 * as a summary would never be replaced once a key is added or a failed
 * request succeeds.
 */
async function summarise(stories: NewsItem[]): Promise<Map<string, string>> {
  const summaries = new Map<string, string>();
  if (!process.env.ANTHROPIC_API_KEY?.trim() || stories.length === 0) return summaries;
  const model = process.env.BRIEF_MODEL?.trim() || DEFAULT_MODEL;
  const client = new Anthropic();
  for (let start = 0; start < stories.length; start += BATCH_SIZE) {
    const batch = stories.slice(start, start + BATCH_SIZE);
    try {
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        output_config: { effort: "low", format: zodOutputFormat(SummarySchema) },
        ...(/^claude-(opus|fable|sonnet-5-5)/.test(model)
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
        system: SYSTEM,
        messages: [
          {
            role: "user",
            content: JSON.stringify(
              batch.map((story, index) => ({
                id: String(index),
                headline: story.title,
                ...(story.excerpt ? { publisherSummary: story.excerpt } : {}),
              })),
            ),
          },
        ],
      });
      const parsed = response.stop_reason === "refusal" ? null : response.parsed_output;
      for (const entry of parsed?.summaries ?? []) {
        const story = batch[Number(entry.id)];
        if (story) summaries.set(story.url, entry.summary.trim());
      }
    } catch (error) {
      // Build logs are public; report the failure only. These stories fall
      // back to the publisher's first sentence and are retried next build.
      const status = error instanceof Anthropic.APIError ? ` (HTTP ${error.status})` : "";
      console.warn(`News summaries skipped for ${batch.length} stories: the Claude request failed${status}.`);
    }
  }
  return summaries;
}

async function apply(items: NewsItem[], today: string): Promise<NewsItem[]> {
  const store = await readStore();
  const missing = items.filter((item) => !(item.url in store.items));
  const fresh = await summarise(missing);

  for (const item of items) {
    const summary = fresh.get(item.url);
    if (summary !== undefined) store.items[item.url] = { summary, seen: today };
    else if (store.items[item.url]) store.items[item.url].seen = today;
  }
  const oldest = shiftDateKey(today, -KEEP_DAYS);
  for (const [url, entry] of Object.entries(store.items)) {
    if (entry.seen < oldest) delete store.items[url];
  }
  try {
    await mkdir(dirname(storePath()), { recursive: true });
    await writeFile(storePath(), JSON.stringify(store));
  } catch {
    // Not writable: summaries still show, they just are not carried over.
  }

  return items.map(({ excerpt, ...item }) => {
    // A saved empty summary means Claude found nothing to add; respect it.
    const saved = store.items[item.url];
    const summary = saved ? saved.summary : firstSentence(excerpt);
    return summary ? { ...item, summary } : item;
  });
}

const pending = new Map<string, Promise<NewsItem[]>>();

/**
 * Adds a summary to each story and drops the raw excerpt. Every page of a
 * build shows the same headlines, so the work happens once per build.
 */
export function withNewsSummaries(items: NewsItem[], today: string): Promise<NewsItem[]> {
  let result = pending.get(today);
  if (!result) {
    result = apply(items, today);
    pending.set(today, result);
  }
  return result;
}
