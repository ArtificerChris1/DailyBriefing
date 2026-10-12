import "server-only";

import { createHash } from "node:crypto";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import type { DailyBrief } from "@/lib/briefing-types";

/**
 * The AI-written summary at the top of today's page, generated at build time
 * from facts the briefing has already gathered. Claude sees only those facts
 * and is told not to add any; the result is encrypted with the rest of the
 * page. Without ANTHROPIC_API_KEY, or on any failure, the page simply has no
 * summary.
 */

const DEFAULT_MODEL = "claude-opus-5-5";

/** Summary sections the model may use; the page gives each its own icon. */
export const BRIEF_LABELS = [
  "Coming up",
  "Reminders",
  "Weather",
  "Heads-up",
  "Occasions",
  "Opportunity",
  "Sports",
] as const;

const BriefSchema = z.object({
  headline: z.string(),
  points: z.array(z.object({ label: z.enum(BRIEF_LABELS), text: z.string() })),
});

const SYSTEM = `You write the short summary at the top of a personal daily briefing dashboard.

You receive the facts the dashboard has gathered as JSON. Use only those facts. Never invent events, times, places, people, numbers or advice that the facts do not support, and never guess at what an event is about beyond its title. If there is little to say, say little.

The facts give "today" and "tomorrow" separately, each with its weekday and date, and "planningFor" says which day this summary is about: today in morning mode, tomorrow in evening mode. Keep every event on the day it is listed under. In evening mode, call tomorrow's events "tomorrow" or use the weekday, never "today"; mention what is left of today only if it still matters.

Write:
- headline: one or two friendly sentences characterising the day (or tomorrow, in evening mode). Plain prose, no greeting, no emoji.
- points: two to four items, the most useful first, each one or two short sentences. Use the label that fits: "Coming up" for the next event or tomorrow's first event; "Reminders" for overdue or due-today reminders; "Weather" only when the weather affects plans; "Heads-up" for the dashboard's own suggestions; "Occasions" for birthdays, anniversaries and holidays worth preparing for; "Opportunity" for free time that suits something in the facts (for example good weather and an open afternoon); "Sports" only for a notable result or a game today.

Times are already local; repeat them as given. A "leaveBy" time is when to set off for that event.

Write only the finished text. Do not ask yourself questions, correct yourself, or explain your reasoning in the output.`;

const cache = new Map<string, Promise<DailyBrief | undefined>>();

/** The model ids that accept the server-side refusal fallback. */
function supportsFallbacks(model: string): boolean {
  return /^claude-(opus|fable|sonnet-5-5)/.test(model);
}

async function generate(
  facts: Record<string, unknown>,
  mode: DailyBrief["mode"],
): Promise<DailyBrief | undefined> {
  const model = process.env.BRIEF_MODEL?.trim() || DEFAULT_MODEL;
  const client = new Anthropic();
  try {
    const response = await client.beta.messages.parse({
      model,
      max_tokens: 16000,
      output_config: { effort: "low", format: zodOutputFormat(BriefSchema) },
      ...(supportsFallbacks(model)
        ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
        : {}),
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ mode, ...facts }) }],
    });
    const parsed = response.parsed_output;
    if (response.stop_reason === "refusal" || !parsed) return undefined;
    return {
      mode,
      headline: parsed.headline,
      points: parsed.points.slice(0, 4),
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    // Build logs are public: report the failure, never the facts.
    const status = error instanceof Anthropic.APIError ? ` (HTTP ${error.status})` : "";
    console.warn(`Daily brief skipped: the Claude request failed${status}.`);
    return undefined;
  }
}

/**
 * One request per distinct set of facts per build. Today's page is rendered
 * twice (as its date and as today.json), and both share the result.
 */
export function dailyBrief(
  facts: Record<string, unknown>,
  mode: DailyBrief["mode"],
): Promise<DailyBrief | undefined> {
  if (!process.env.ANTHROPIC_API_KEY?.trim()) return Promise.resolve(undefined);
  const key = createHash("sha256").update(JSON.stringify({ mode, facts })).digest("hex");
  let pending = cache.get(key);
  if (!pending) {
    pending = generate(facts, mode);
    cache.set(key, pending);
  }
  return pending;
}
