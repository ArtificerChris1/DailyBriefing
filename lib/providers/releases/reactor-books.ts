import "server-only";

import type { ReleaseItem } from "@/lib/briefing-types";
import {
  DEFAULT_TIMEOUT_MS,
  environmentNumber,
  fetchJson,
  isRecord,
  stripTags,
  textOf,
} from "./shared";

/**
 * Reactor's own WordPress REST API, not a scrape. Their rendered HTML pages sit
 * behind Cloudflare and answer 403 to a server-side fetch, so cheerio against
 * reactormag.com would fail outright — but /wp-json returns the same posts as
 * JSON and answers normally. The single-post route (/posts/<id>) is also
 * blocked, so posts are read through the list route filtered by slug.
 */
const REACTOR_POSTS = "https://reactormag.com/wp-json/wp/v2/posts";
const ATTRIBUTION = "Book listings via Reactor";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** Reactor publishes one roundup per genre per month, on a stable slug. */
const GENRES = ["new-science-fiction-books", "new-fantasy-books"];

export interface BookReleases {
  items: ReleaseItem[];
  warnings: string[];
}

function slugsFor(from: string, to: string): string[] {
  const months = new Set<string>();
  for (const key of [from, to]) {
    const [year, month] = key.split("-").map(Number);
    months.add(`${MONTHS[month - 1]}-${year}`);
  }
  return GENRES.flatMap((genre) =>
    [...months].map((month) => `${genre}-${month}`),
  );
}

/**
 * Each roundup is a flat run of blocks: an `<h3>` naming a release day, then one
 * `<p>` per book until the next `<h3>`. Inside a book paragraph the first
 * `<strong>` is the title and the `<strong>` that follows carries
 * "(Series #N) — Author (Publisher)".
 */
export function parseRoundup(
  html: string,
  postUrl: string,
  postDate: string,
): ReleaseItem[] {
  const [year] = postDate.split("-").map(Number);
  const items: ReleaseItem[] = [];
  let currentDate: string | undefined;
  let index = 0;

  const blocks = html.matchAll(
    /<h3[^>]*>([\s\S]*?)<\/h3>|<p[^>]*>([\s\S]*?)<\/p>/g,
  );

  for (const block of blocks) {
    const heading = block[1];
    if (heading !== undefined) {
      // "August 4" — the year comes from the post itself.
      const label = stripTags(heading);
      const match = /^([A-Za-z]+)\s+(\d{1,2})$/.exec(label);
      if (!match) {
        currentDate = undefined;
        continue;
      }
      const month = MONTHS.indexOf(match[1].toLowerCase());
      if (month < 0) {
        currentDate = undefined;
        continue;
      }
      // A December roundup can list early-January titles; roll the year over.
      const day = Number(match[2]);
      const postMonth = Number(postDate.split("-")[1]) - 1;
      const rollover = postMonth === 11 && month === 0 ? 1 : 0;
      currentDate = `${year + rollover}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      continue;
    }

    const paragraph = block[2];
    if (!currentDate || paragraph === undefined) continue;

    const strongs = [...paragraph.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/g)];
    if (strongs.length === 0) continue;
    const title = stripTags(strongs[0][1]);
    if (!title) continue;

    // "(Flesh & False Gods #3) — Chloe Gong (Saga Press)". Reactor sometimes
    // splits one credit over several <strong> runs, so join them all back up.
    const credit = strongs
      .slice(1)
      .map((match) => stripTags(match[1]))
      .join(" ")
      .trim();
    const creditMatch = /^(?:\((.+?)\)\s*)?[—–-]\s*(.+?)(?:\s*\((.+)\))?$/.exec(
      credit,
    );
    const series = creditMatch?.[1];
    const author = creditMatch?.[2];
    const publisher = creditMatch?.[3];

    items.push({
      id: `reactor-${currentDate}-${index++}`,
      medium: "book",
      title,
      releasesOn: currentDate,
      by: publisher,
      detail: [author, series].filter(Boolean).join(" · ") || undefined,
      url: postUrl,
    });
  }

  return items;
}

/**
 * Upcoming science-fiction and fantasy novels from Reactor's monthly roundups.
 * Needs no credential, so it is the one release source that always works.
 */
export async function fetchBookReleases(
  from: string,
  to: string,
): Promise<BookReleases> {
  const timeoutMs = environmentNumber("REACTOR_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
  const url = new URL(REACTOR_POSTS);
  url.searchParams.set("slug", slugsFor(from, to).join(","));
  url.searchParams.set("per_page", "12");
  url.searchParams.set("_fields", "id,date,link,title,content");

  try {
    const payload = await fetchJson(url.toString(), {
      headers: {
        Accept: "application/json",
        // WordPress behind Cloudflare refuses an unfamiliar agent.
        "User-Agent":
          "Mozilla/5.0 (compatible; Brief-Daily-Releases/1.0; +https://reactormag.com)",
      },
      timeoutMs,
    });
    if (!Array.isArray(payload)) {
      return { items: [], warnings: ["Reactor returned an unexpected response."] };
    }

    const items = payload.filter(isRecord).flatMap((post): ReleaseItem[] => {
      const content = isRecord(post.content)
        ? textOf(post.content.rendered)
        : undefined;
      const link = textOf(post.link);
      const date = textOf(post.date);
      if (!content || !link || !date) return [];
      return parseRoundup(content, link, date.slice(0, 10));
    });

    return items.length > 0
      ? { items, warnings: [] }
      : {
          items: [],
          // Expected in the first days of a month, before that month's post lands.
          warnings: ["Reactor has not posted a roundup for this window yet."],
        };
  } catch (error) {
    return {
      items: [],
      warnings: [
        error instanceof Error
          ? `Reactor book roundups were unavailable (${error.message}).`
          : "Reactor book roundups were unavailable.",
      ],
    };
  }
}

export const REACTOR_ATTRIBUTION = ATTRIBUTION;
