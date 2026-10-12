/**
 * Viewer preferences, kept in localStorage on each device. The theme and
 * motion settings are also applied by a small script in app/layout.tsx
 * before first paint, so the page never flashes the wrong colours.
 */

export type ThemeChoice = "dark" | "light" | "system";

export interface Preferences {
  briefingTime: string;
  timeZone: string;
  emailDigest: boolean;
  showReminders: boolean;
  showPhoto: boolean;
  showSports: boolean;
  showNews: boolean;
  weatherAlerts: boolean;
  hideScores: boolean;
  /** Colour scheme; WCAG 1.4.8 asks that colours be selectable. */
  theme: ThemeChoice;
  /** Turns off non-essential motion even when the system allows it. */
  reduceMotion: boolean;
  /**
   * Reload by itself when a newer briefing is deployed and you return to the
   * page. WCAG 3.2.5 asks that such changes can be turned off.
   */
  autoReload: boolean;
}

export const PREFERENCES_KEY = "brief-preferences";

export const defaultPreferences: Preferences = {
  briefingTime: "07:00",
  timeZone: "America/Chicago",
  emailDigest: true,
  showReminders: true,
  showPhoto: true,
  showSports: true,
  showNews: true,
  weatherAlerts: true,
  hideScores: false,
  theme: "dark",
  reduceMotion: false,
  autoReload: true,
};

export function readStoredPreferences(): Partial<Preferences> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY) ?? "{}") as Record<
      string,
      unknown
    >;
    return Object.fromEntries(
      Object.keys(defaultPreferences)
        .filter((key) => key in parsed)
        .map((key) => [key, parsed[key]]),
    ) as Partial<Preferences>;
  } catch {
    return {};
  }
}

/** Applies theme and motion to <html>; see the tokens in app/globals.css. */
export function applyAppearance(preferences: Pick<Preferences, "theme" | "reduceMotion">): void {
  const root = document.documentElement;
  const theme =
    preferences.theme === "system"
      ? window.matchMedia("(prefers-color-scheme: light)").matches
        ? "light"
        : "dark"
      : preferences.theme;
  root.dataset.theme = theme;
  root.dataset.motion = preferences.reduceMotion ? "reduce" : "auto";
}

/** Inline script for <head>: the same as applyAppearance, before React loads. */
export const APPEARANCE_SCRIPT = `try{var p=JSON.parse(localStorage.getItem("${PREFERENCES_KEY}")||"{}");var t=p.theme||"dark";if(t==="system")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.dataset.theme=t;document.documentElement.dataset.motion=p.reduceMotion?"reduce":"auto"}catch(e){document.documentElement.dataset.theme="dark"}`;
