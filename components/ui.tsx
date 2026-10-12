"use client";

import {
  ChevronDown,
  CircleHelp,
  Cloud,
  CloudRain,
  CloudSun,
  ExternalLink as ExternalLinkIcon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import type { TrustZone } from "@/lib/briefing-types";

/**
 * The dashboard's shared building blocks. Every card is a `Card`, so new
 * widgets inherit the layout, heading structure, help pattern and states;
 * see the "Card system" section of app/globals.css for the matching styles.
 */

export type Tone = "neutral" | "accent" | "info" | "warning" | "danger";

/**
 * A titled dashboard card: a landmark-free `section` named by its heading,
 * an icon chip, optional meta text and actions, and optional help that
 * explains how the card works (WCAG 3.3.5).
 */
export function Card({
  title,
  icon: Icon,
  meta,
  actions,
  help,
  className = "",
  id,
  children,
}: {
  title: ReactNode;
  icon: LucideIcon;
  /** Short status beside the title, e.g. "3 results · 9 coming up". */
  meta?: ReactNode;
  /** Buttons or links in the header, each at least 44×44px. */
  actions?: ReactNode;
  /** Plain-language explanation, revealed by the header's help button. */
  help?: ReactNode;
  className?: string;
  /** Fragment target, e.g. for "View full schedule" links. */
  id?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  const helpId = useId();
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <section className={`card ${className}`} aria-labelledby={headingId} id={id}>
      <header className="card-header">
        <span className="card-icon" aria-hidden="true">
          <Icon size={18} />
        </span>
        <div className="card-heading">
          <h2 id={headingId}>{title}</h2>
          {meta && <p className="card-meta">{meta}</p>}
        </div>
        {(actions || help) && (
          <div className="card-actions">
            {actions}
            {help && (
              <button
                type="button"
                className="icon-button"
                aria-expanded={helpOpen}
                aria-controls={helpId}
                onClick={() => setHelpOpen((open) => !open)}
              >
                <CircleHelp size={18} aria-hidden="true" />
                <span className="visually-hidden">About this card</span>
              </button>
            )}
          </div>
        )}
      </header>
      {help && (
        <div className="card-help" id={helpId} hidden={!helpOpen}>
          {help}
        </div>
      )}
      {children}
    </section>
  );
}

/** A status label. Tone adds colour; the text always carries the meaning. */
export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

/** Expands or collapses a list; announces its state through aria-expanded. */
export function ShowMore({
  expanded,
  onToggle,
  moreLabel,
  lessLabel = "Show fewer",
  controls,
}: {
  expanded: boolean;
  onToggle: () => void;
  moreLabel: string;
  lessLabel?: string;
  /** Id of the list it expands. */
  controls?: string;
}) {
  return (
    <button
      type="button"
      className="show-more"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      {expanded ? lessLabel : moreLabel}
      <ChevronDown size={16} aria-hidden="true" className={expanded ? "flip" : ""} />
    </button>
  );
}

/**
 * A link that opens in a new tab and says so, both visibly (icon) and to
 * assistive technology (WCAG 3.2.5 asks that new windows be announced).
 */
export function ExternalLink({
  href,
  label,
  className = "icon-button",
  children,
}: {
  href: string;
  /** Full accessible name, e.g. "Open Rebirth on BoardGameGeek". */
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children ?? <ExternalLinkIcon size={17} aria-hidden="true" />}
      <span className="visually-hidden">{`${label} (opens in a new tab)`}</span>
    </a>
  );
}

export function WeatherGlyph({ condition, size = 18 }: { condition: string; size?: number }) {
  if (["Drizzle", "Rain", "Showers", "Snow", "Thunderstorms"].includes(condition)) {
    return <CloudRain size={size} aria-hidden="true" />;
  }
  if (condition === "Clear") return <Sun size={size} aria-hidden="true" />;
  if (condition === "Cloudy" || condition === "Fog") return <Cloud size={size} aria-hidden="true" />;
  return <CloudSun size={size} aria-hidden="true" />;
}

const zoneLabel: Record<TrustZone, string> = {
  work: "Work",
  personal: "Personal",
  public: "Public",
};

/** Which calendar an event came from, as text with a matching marker. */
export function SourceBadge({ zone, label }: { zone: TrustZone; label: string }) {
  return (
    <span className={`source-badge source-${zone}`}>
      <span className="source-dot" aria-hidden="true" />
      <span className="visually-hidden">{zoneLabel[zone]} calendar: </span>
      {label}
    </span>
  );
}

/** A compact empty state with an icon and a useful next step. */
export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon size={20} aria-hidden="true" />
      <div>
        <p className="empty-title">{title}</p>
        {children && <p className="empty-text">{children}</p>}
      </div>
    </div>
  );
}
