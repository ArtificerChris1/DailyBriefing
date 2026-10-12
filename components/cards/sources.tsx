"use client";

import { CircleAlert, CircleCheck, CircleMinus, CircleX, Database, type LucideIcon } from "lucide-react";
import { useId, useState } from "react";

import type { BriefingSnapshot, BriefingSourceStatus } from "@/lib/briefing-types";

/**
 * A compact line at the foot of the page saying how each source fared in the
 * build, so a missing calendar or failed feed is visible at a glance rather
 * than mistaken for a quiet day. Every status is spelled out in words; the
 * icon and colour only repeat it.
 */

type Health = "ok" | "partial" | "failed" | "off";

interface Entry {
  name: string;
  health: Health;
  /** Short status, e.g. "9:05 AM" or "unavailable". */
  status: string;
  /** Longer explanation, shown under "Details". */
  detail?: string;
}

const healthIcon: Record<Health, LucideIcon> = {
  ok: CircleCheck,
  partial: CircleAlert,
  failed: CircleX,
  off: CircleMinus,
};

const healthWord: Record<Health, string> = {
  ok: "Working",
  partial: "Partly working",
  failed: "Failed",
  off: "Off",
};

const NAMES: Partial<Record<BriefingSourceStatus["provider"], string>> = {
  ical: "Work calendar",
  "apple-calendar": "Home calendar",
  "apple-shortcut": "Reminders",
  weather: "Weather",
  sports: "Sports",
  news: "News",
};

export function SourcesStatus({
  briefing,
  isToday,
  timeZone,
}: {
  briefing: BriefingSnapshot;
  isToday: boolean;
  timeZone: string;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const headingId = useId();

  const when = (iso: string | undefined) => {
    if (!iso) return "";
    const instant = Date.parse(iso);
    const day = new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant);
    const clock = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(instant);
    if (day === briefing.today) return clock;
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(instant);
    return `${weekday} ${clock}`;
  };

  const entries: Entry[] = briefing.sources.flatMap((source): Entry[] => {
    const name = NAMES[source.provider];
    if (!name) return [];
    switch (source.state) {
      case "live":
        return [
          {
            name,
            health: "ok",
            status: source.provider === "apple-shortcut" ? `synced ${when(source.lastSyncedAt)}` : when(source.lastSyncedAt) || "updated",
          },
        ];
      case "error":
        return [{ name, health: "failed", status: "couldn’t load", detail: source.message }];
      case "demo":
        return [{ name, health: "partial", status: "sample data", detail: source.message }];
      case "not-configured":
        return [{ name, health: "off", status: "not set up", detail: source.message }];
      default:
        return [{ name, health: "off", status: "not connected", detail: source.message }];
    }
  });

  const releases = briefing.upcomingReleases;
  entries.push(
    !releases
      ? { name: "Releases", health: "off", status: "not set up" }
      : releases.message
        ? { name: "Releases", health: "failed", status: "couldn’t load", detail: releases.message }
        : releases.warnings.length
          ? { name: "Releases", health: "partial", status: "partly loaded", detail: releases.warnings.join(" ") }
          : { name: "Releases", health: "ok", status: "loaded" },
  );
  entries.push(
    !briefing.hotGames
      ? { name: "BoardGameGeek", health: "off", status: "not set up" }
      : briefing.hotGames.message
        ? { name: "BoardGameGeek", health: "failed", status: "couldn’t load", detail: briefing.hotGames.message }
        : { name: "BoardGameGeek", health: "ok", status: "loaded" },
  );
  if (isToday) {
    entries.push(
      briefing.dailyBrief
        ? { name: "AI summary", health: "ok", status: `written ${when(briefing.dailyBrief.generatedAt)}` }
        : {
            name: "AI summary",
            health: "off",
            status: "not available",
            detail: "No summary was written for this build. It needs ANTHROPIC_API_KEY, and is skipped if the request fails.",
          },
      briefing.photo
        ? { name: "Photo", health: "ok", status: "loaded" }
        : { name: "Photo", health: "off", status: "none today", detail: "The shared album link is not set, or the album could not be read." },
    );
  }

  const problems = entries.filter((entry) => entry.health !== "ok" && entry.detail);
  const failing = entries.filter((entry) => entry.health === "failed" || entry.health === "partial").length;

  return (
    <section className="sources" aria-labelledby={headingId}>
      <div className="sources-header">
        <h2 id={headingId}>
          <Database size={16} aria-hidden="true" /> Sources
        </h2>
        <p className="sources-built">
          Briefing built {when(briefing.generatedAt)}
          {failing > 0 ? ` · ${failing} ${failing === 1 ? "problem" : "problems"}` : " · all working"}
        </p>
        {problems.length > 0 && (
          <button
            type="button"
            className="button button-ghost"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide details" : "Details"}
          </button>
        )}
      </div>
      <ul className="sources-list">
        {entries.map((entry) => {
          const Icon = healthIcon[entry.health];
          return (
            <li key={entry.name} className={`source-${entry.health}`}>
              <Icon size={16} aria-hidden="true" />
              <span className="source-name">{entry.name}</span>
              <span className="visually-hidden">{healthWord[entry.health]}:</span>
              <span className="source-status">{entry.status}</span>
            </li>
          );
        })}
      </ul>
      {problems.length > 0 && (
        <ul className="sources-details" id={detailsId} hidden={!open}>
          {problems.map((entry) => (
            <li key={entry.name}>
              <strong>{entry.name}:</strong> {entry.detail}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
