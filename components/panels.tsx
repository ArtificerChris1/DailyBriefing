"use client";

import {
  Bell,
  CalendarDays,
  ChevronRight,
  CloudSun,
  FileText,
  Newspaper,
  RotateCcw,
  ShieldCheck,
  Trophy,
  X,
} from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Badge, type Tone } from "@/components/ui";
import type { ConnectionSummary, ConnectorDefinition, ProviderId } from "@/lib/briefing-types";
import {
  connectors,
  newsInterests,
  preferredNewsSources,
  sportsWatchlist,
} from "@/lib/demo-data";
import type { Preferences, ThemeChoice } from "@/lib/preferences";

/**
 * A side panel built on the native <dialog> element: showModal() makes the
 * rest of the page inert, traps focus inside, and closes on Escape. Focus
 * returns to whatever opened it.
 */
export function Panel({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      opener.current = document.activeElement;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="panel"
      aria-labelledby={titleId}
      onClose={() => {
        onClose();
        if (opener.current instanceof HTMLElement) opener.current.focus();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself.
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="panel-inner">
        <header className="panel-header">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-button" onClick={() => ref.current?.close()}>
            <X size={20} aria-hidden="true" />
            <span className="visually-hidden">Close {title}</span>
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}

export function PreferenceToggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const descriptionId = useId();
  return (
    <label className="toggle">
      <span className="toggle-copy">
        <span className="toggle-label">{label}</span>
        {description && (
          <span className="toggle-description" id={descriptionId}>
            {description}
          </span>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-describedby={description ? descriptionId : undefined}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch" aria-hidden="true">
        <span />
      </span>
      <span className="switch-state" aria-hidden="true">
        {checked ? "On" : "Off"}
      </span>
    </label>
  );
}

const THEMES: { value: ThemeChoice; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "Match my device" },
];

export function PreferencesPanel({
  preferences,
  updatePreference,
  onReset,
  accountSettings,
}: {
  preferences: Preferences;
  updatePreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
  onReset: () => void;
  accountSettings?: ReactNode;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const themeName = useId();

  return (
    <div className="panel-body">
      {accountSettings}

      <section className="settings-section" aria-labelledby={`${themeName}-heading`}>
        <h3 id={`${themeName}-heading`}>Appearance</h3>
        <fieldset className="choice-group">
          <legend>Colour theme</legend>
          {THEMES.map((theme) => (
            <label className="choice" key={theme.value}>
              <input
                type="radio"
                name={themeName}
                value={theme.value}
                checked={preferences.theme === theme.value}
                onChange={() => updatePreference("theme", theme.value)}
              />
              <span>{theme.label}</span>
            </label>
          ))}
        </fieldset>
        <PreferenceToggle
          label="Reduce motion"
          description="Turns off animations and transitions. Your device's reduced-motion setting is always respected."
          checked={preferences.reduceMotion}
          onChange={(checked) => updatePreference("reduceMotion", checked)}
        />
        <PreferenceToggle
          label="Update automatically"
          description="When a newer briefing has been published, load it as you return to this page. When off, a message offers the update instead."
          checked={preferences.autoReload}
          onChange={(checked) => updatePreference("autoReload", checked)}
        />
      </section>

      <section className="settings-section">
        <h3>Sections</h3>
        <PreferenceToggle label="Reminders" checked={preferences.showReminders} onChange={(checked) => updatePreference("showReminders", checked)} />
        <PreferenceToggle label="Photo of the day" checked={preferences.showPhoto} onChange={(checked) => updatePreference("showPhoto", checked)} />
        <PreferenceToggle label="Sports" checked={preferences.showSports} onChange={(checked) => updatePreference("showSports", checked)} />
        <PreferenceToggle label="News" checked={preferences.showNews} onChange={(checked) => updatePreference("showNews", checked)} />
        <PreferenceToggle
          label="Hide sports scores"
          description="Final scores stay hidden until you show them."
          checked={preferences.hideScores}
          onChange={(checked) => updatePreference("hideScores", checked)}
        />
      </section>

      <section className="settings-section">
        <h3>Time</h3>
        <label className="field">
          <span className="field-label">Time zone</span>
          <select
            value={preferences.timeZone}
            onChange={(event) => updatePreference("timeZone", event.target.value)}
          >
            <option value="America/Chicago">Central Time (Chicago)</option>
            <option value="America/New_York">Eastern Time (New York)</option>
            <option value="America/Denver">Mountain Time (Denver)</option>
            <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
          </select>
        </label>
      </section>

      <section className="settings-section">
        <h3>Sports you follow</h3>
        {sportsWatchlist.map((group) => (
          <div className="watchlist" key={group.id}>
            <p className="watchlist-label">{group.label}</p>
            <ul className="chips">
              {group.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {"note" in group && group.note && <p className="settings-help">{group.note}</p>}
          </div>
        ))}
      </section>

      <section className="settings-section">
        <h3>News interests</h3>
        <ul className="chips">
          {newsInterests.map((interest) => (
            <li key={interest}>{interest}</li>
          ))}
        </ul>
        <p className="settings-help">Preferred sources: {preferredNewsSources.join(", ")}.</p>
      </section>

      <section className="settings-section">
        <h3>Reset</h3>
        <p className="settings-help">
          Clears preferences, ticks, pins, snoozes and your own priorities on this device. Your
          sign-in and passkeys are not affected.
        </p>
        {confirmReset ? (
          <div className="confirm-row" role="group" aria-label="Confirm reset">
            <button
              type="button"
              className="button button-danger"
              onClick={() => {
                onReset();
                setConfirmReset(false);
              }}
            >
              <RotateCcw size={16} aria-hidden="true" /> Yes, reset this device
            </button>
            <button type="button" className="button button-secondary" onClick={() => setConfirmReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="button button-secondary" onClick={() => setConfirmReset(true)}>
            <RotateCcw size={16} aria-hidden="true" /> Reset this device&hellip;
          </button>
        )}
      </section>
    </div>
  );
}

const providerIcon: Record<ProviderId, typeof CalendarDays> = {
  ical: CalendarDays,
  "apple-calendar": CalendarDays,
  "apple-shortcut": Bell,
  weather: CloudSun,
  sports: Trophy,
  news: Newspaper,
};

function stateLabel(state: string): { text: string; tone: Tone } {
  switch (state) {
    case "connected":
      return { text: "Connected", tone: "accent" };
    case "demo":
      return { text: "Sample data", tone: "info" };
    case "not-configured":
      return { text: "Setup required", tone: "warning" };
    case "error":
      return { text: "Needs attention", tone: "danger" };
    case "expired":
      return { text: "Reconnect", tone: "warning" };
    default:
      return { text: "Not connected", tone: "neutral" };
  }
}

export function ConnectionsPanel({
  connections,
  onNotify,
}: {
  connections: ConnectionSummary[];
  onNotify: (message: string) => void;
}) {
  return (
    <div className="panel-body">
      <p className="settings-help">
        <FileText size={16} aria-hidden="true" /> Where each part of the briefing comes from.
      </p>
      <ul className="connector-list">
        {connectors.map((connector) => (
          <ConnectorRow
            key={connector.id}
            connector={connector}
            connection={connections.find((connection) => connection.provider === connector.id)}
            onNotify={onNotify}
          />
        ))}
      </ul>
      <p className="settings-help">
        <ShieldCheck size={16} aria-hidden="true" /> Private feed addresses are read only while
        the site is built and are never published.
      </p>
    </div>
  );
}

function ConnectorRow({
  connector,
  connection,
  onNotify,
}: {
  connector: ConnectorDefinition;
  connection?: ConnectionSummary;
  onNotify: (message: string) => void;
}) {
  const Icon = providerIcon[connector.id];
  const state = stateLabel(connection?.state ?? connector.state);
  return (
    <li className="connector">
      <span className="card-icon" aria-hidden="true">
        <Icon size={18} />
      </span>
      <div className="connector-copy">
        <p className="connector-name">
          {connector.name} <Badge tone={state.tone}>{state.text}</Badge>
        </p>
        <p className="settings-help">{connector.description}</p>
        {connection?.accountLabel && <p className="settings-help">{connection.accountLabel}</p>}
      </div>
      <button
        type="button"
        className="icon-button"
        onClick={() => onNotify(connection?.message ?? `${connector.name}: ${state.text}.`)}
      >
        <ChevronRight size={18} aria-hidden="true" />
        <span className="visually-hidden">Details for {connector.name}</span>
      </button>
    </li>
  );
}
