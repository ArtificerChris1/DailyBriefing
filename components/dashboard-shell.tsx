"use client";

import {
  ChevronLeft,
  ChevronRight,
  Link2,
  Moon,
  RefreshCw,
  Settings2,
  SunMedium,
  Sunrise,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { BirthdaysCard } from "@/components/cards/birthdays";
import { GlanceHero } from "@/components/cards/glance-hero";
import { HotnessCard } from "@/components/cards/hotness";
import { NewsCard } from "@/components/cards/news";
import { PhotoCard } from "@/components/cards/photo";
import { ReleasesCard } from "@/components/cards/releases";
import { RemindersCard } from "@/components/cards/reminders";
import { ScheduleCard } from "@/components/cards/schedule";
import { SportsCard } from "@/components/cards/sports";
import { UpNextCard } from "@/components/cards/up-next";
import { WeatherCard } from "@/components/cards/weather";
import { ConnectionsPanel, Panel, PreferencesPanel } from "@/components/panels";
import { HeadsUpCard, OccasionsCard } from "@/components/plan-ahead";
import { PrioritiesCard } from "@/components/priorities-card";
import type { BriefingPayload, ReminderItem } from "@/lib/briefing-types";
import { dayModeAt, greetingAt, type DayMode } from "@/lib/briefing-view";
import { MAX_DAY_OFFSET, MIN_DAY_OFFSET, dayOffsetBetween, shiftDateKey } from "@/lib/briefing-window";
import { longDateLabel, relativeDayLabel } from "@/lib/format";
import { fetchLocalWeather, withLocalWeather, type LiveWeather } from "@/lib/live-weather";
import {
  PREFERENCES_KEY,
  applyAppearance,
  defaultPreferences,
  readStoredPreferences,
  type Preferences,
} from "@/lib/preferences";
import { topPriorities, groupReminders, type CustomPriority } from "@/lib/priorities";

type Panel = "connections" | "preferences" | null;
type ModeChoice = "auto" | DayMode;

/**
 * Hides the Connections entry point in the top bar. The panel and everything
 * behind it stay in place; flip this back to true to surface it again.
 */
const SHOW_CONNECTIONS_ENTRY = false;
const DAY_MODE_KEY = "brief-day-mode";
const CLOCK_TICK_MS = 30_000;

/** Cached so getSnapshot stays referentially stable between ticks. */
let clockNow = 0;

function subscribeToClock(onStoreChange: () => void) {
  clockNow = Date.now();
  const timer = window.setInterval(() => {
    clockNow = Date.now();
    onStoreChange();
  }, CLOCK_TICK_MS);
  return () => window.clearInterval(timer);
}

function readClock() {
  if (clockNow === 0) clockNow = Date.now();
  return clockNow;
}

/**
 * Wall-clock time that advances on its own. Before hydration it reports the
 * briefing's own timestamp, so the first paint matches the static markup.
 */
function useNow(serverNow: number) {
  return useSyncExternalStore(subscribeToClock, readClock, () => serverNow);
}

interface Toast {
  id: number;
  message: string;
  undo?: () => void;
}

/** The decorative mountains behind the header. Purely visual. */
function HeaderScene() {
  return (
    <svg className="header-scene" viewBox="0 0 1200 260" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false">
      <circle className="scene-moon" cx="1020" cy="64" r="20" />
      <path className="scene-far" d="M0 220 L180 120 L300 170 L460 70 L620 160 L760 90 L900 150 L1040 60 L1200 140 L1200 260 L0 260 Z" />
      <path className="scene-near" d="M0 250 L140 190 L260 220 L420 150 L560 210 L700 160 L860 215 L980 170 L1200 220 L1200 260 L0 260 Z" />
    </svg>
  );
}

export function DashboardShell({
  initialPayload,
  loadDay,
  photoUrl,
  memoryUrls = [],
  accountSettings,
}: {
  initialPayload: BriefingPayload;
  /** Fetches and decrypts one day's briefing; see components/briefing-gate.tsx. */
  loadDay: (date: string) => Promise<BriefingPayload>;
  /** Decrypted photo of the day, as an object URL. */
  photoUrl?: string;
  /** Decrypted "on this day" photos, aligned with `briefing.memories`. */
  memoryUrls?: (string | undefined)[];
  /** Lock and passkey controls, shown at the top of Preferences. */
  accountSettings?: React.ReactNode;
}) {
  const [payload, setPayload] = useState(initialPayload);
  const [panel, setPanel] = useState<Panel>(null);
  const [preferences, setPreferences] = useState<Preferences>({
    ...defaultPreferences,
    timeZone: initialPayload.briefing.timeZone,
  });
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [changingDay, setChangingDay] = useState(false);
  // A manual morning/evening choice lasts for this session; a new visit
  // goes back to following the clock.
  const [modeOverride, setModeOverride] = useState<DayMode | null>(null);
  const [tomorrowPayload, setTomorrowPayload] = useState<BriefingPayload>();
  const [completedReminders, setCompletedReminders] = useState<string[]>([]);
  // Device-local, like completedReminders: the site cannot write to Reminders.
  const [pinnedReminders, setPinnedReminders] = useState<string[]>([]);
  const [customPriorities, setCustomPriorities] = useState<CustomPriority[]>([]);
  /** Reminder id → the first day it shows again. */
  const [snoozedReminders, setSnoozedReminders] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<Toast | null>(null);
  const nowMs = useNow(Date.parse(initialPayload.briefing.generatedAt));
  const localWeatherRef = useRef<LiveWeather | undefined>(undefined);

  const { briefing, connections } = payload;
  const timeZone = preferences.timeZone || briefing.timeZone;
  const dayOffset = dayOffsetBetween(briefing.today, briefing.date);
  const isToday = dayOffset === 0;
  const autoMode = dayModeAt(nowMs, timeZone);
  const dayMode: DayMode = modeOverride ?? autoMode;
  const showEvening = isToday && dayMode === "evening";
  const tomorrowDate = shiftDateKey(briefing.today, 1);

  const lastUpdated = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone }).format(
        Date.parse(briefing.generatedAt),
      ),
    [briefing.generatedAt, timeZone],
  );

  /** Status messages stay until dismissed or replaced (WCAG 2.2.3, no timing). */
  function notify(message: string, undo?: () => void) {
    setToast({ id: Date.now(), message, undo });
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.sessionStorage.getItem(DAY_MODE_KEY);
        if (saved === "morning" || saved === "evening") setModeOverride(saved);
      } catch {
        // No session storage: follow the clock.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  function chooseMode(choice: ModeChoice) {
    const override = choice === "auto" ? null : choice;
    setModeOverride(override);
    try {
      if (override) window.sessionStorage.setItem(DAY_MODE_KEY, override);
      else window.sessionStorage.removeItem(DAY_MODE_KEY);
    } catch {
      // Storage refused; the choice still holds until the page closes.
    }
  }

  useEffect(() => {
    if (!showEvening) return;
    let cancelled = false;
    loadDay(tomorrowDate)
      .then((loaded) => {
        if (cancelled) return;
        setTomorrowPayload(localWeatherRef.current ? withLocalWeather(loaded, localWeatherRef.current) : loaded);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [showEvening, tomorrowDate, loadDay]);

  useEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      setPreferences((current) => ({ ...current, ...readStoredPreferences() }));
      for (const [key, apply] of [
        ["brief-completed-reminders", (value: unknown) => Array.isArray(value) && setCompletedReminders(value as string[])],
        ["brief-pinned-reminders", (value: unknown) => Array.isArray(value) && setPinnedReminders(value as string[])],
        ["brief-custom-priorities", (value: unknown) => Array.isArray(value) && setCustomPriorities(value as CustomPriority[])],
        ["brief-snoozed-reminders", (value: unknown) => value && typeof value === "object" && setSnoozedReminders(value as Record<string, string>)],
      ] as const) {
        const saved = window.localStorage.getItem(key);
        if (!saved) continue;
        try {
          apply(JSON.parse(saved));
        } catch {
          window.localStorage.removeItem(key);
        }
      }
      setPreferencesReady(true);
    }, 0);
    return () => window.clearTimeout(hydrateTimer);
  }, []);

  useEffect(() => {
    if (!preferencesReady) return;
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    applyAppearance(preferences);
    if (preferences.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => applyAppearance(preferences);
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [preferences, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    window.localStorage.setItem("brief-completed-reminders", JSON.stringify(completedReminders));
    window.localStorage.setItem("brief-pinned-reminders", JSON.stringify(pinnedReminders));
    window.localStorage.setItem("brief-custom-priorities", JSON.stringify(customPriorities));
    window.localStorage.setItem("brief-snoozed-reminders", JSON.stringify(snoozedReminders));
  }, [completedReminders, pinnedReminders, customPriorities, snoozedReminders, preferencesReady]);

  // The baked-in weather is for the configured location. Where the browser
  // allows it, fetch the forecast for wherever the viewer actually is.
  useEffect(() => {
    let disposed = false;
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const local = await fetchLocalWeather(position.coords.latitude, position.coords.longitude);
        if (disposed) return;
        if (!local) {
          notify("Weather for your current location could not be loaded, so the usual location is shown.");
          return;
        }
        localWeatherRef.current = local;
        setPayload((current) => withLocalWeather(current, local));
      },
      () => undefined,
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10_000 },
    );
    return () => {
      disposed = true;
    };
  }, []);

  function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  async function loadBriefing(date: string): Promise<BriefingPayload> {
    const loaded = await loadDay(date);
    return localWeatherRef.current ? withLocalWeather(loaded, localWeatherRef.current) : loaded;
  }

  async function refreshBriefing() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      setPayload(await loadBriefing(briefing.date));
      notify("Briefing reloaded.");
    } catch {
      notify("The briefing could not be reloaded, so the last one is still shown. Check your connection and try again.");
    } finally {
      setRefreshing(false);
    }
  }

  async function goToDay(date: string) {
    if (changingDay || date === briefing.date) return;
    setChangingDay(true);
    try {
      setPayload(await loadBriefing(date));
    } catch {
      notify("That day could not be loaded, so the current day is still shown. Try again in a moment.");
    } finally {
      setChangingDay(false);
    }
  }

  function toggleReminder(id: string) {
    setCompletedReminders((current) =>
      current.includes(id) ? current.filter((reminderId) => reminderId !== id) : [...current, id],
    );
  }

  function completeFromPriorities(id: string) {
    toggleReminder(id);
    notify("Marked done on this device.", () => toggleReminder(id));
  }

  function togglePin(id: string) {
    setPinnedReminders((current) =>
      current.includes(id) ? current.filter((pinnedId) => pinnedId !== id) : [...current, id],
    );
  }

  function snoozeReminder(item: ReminderItem) {
    setSnoozedReminders((current) => ({ ...current, [item.id]: shiftDateKey(briefing.today, 1) }));
    notify(`Snoozed “${item.title}” until tomorrow on this device.`, () =>
      setSnoozedReminders((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      }),
    );
  }

  function addCustomPriority(title: string) {
    setCustomPriorities((current) => [...current, { id: `custom-${Date.now()}`, title }]);
  }

  function removeCustomPriority(id: string) {
    const removed = customPriorities.find((priority) => priority.id === id);
    setCustomPriorities((current) => current.filter((priority) => priority.id !== id));
    if (removed) {
      notify(`Removed “${removed.title}”.`, () =>
        setCustomPriorities((current) => [...current, removed]),
      );
    }
  }

  function resetDevice() {
    setPreferences(defaultPreferences);
    setCompletedReminders([]);
    setPinnedReminders([]);
    setCustomPriorities([]);
    setSnoozedReminders({});
    for (const key of [
      PREFERENCES_KEY,
      "brief-completed-reminders",
      "brief-pinned-reminders",
      "brief-custom-priorities",
      "brief-snoozed-reminders",
      "brief-dismissed-heads-up",
      "brief-gifts-sorted",
    ]) {
      window.localStorage.removeItem(key);
    }
    notify("This device has been reset.");
  }

  // Snoozed reminders stay hidden until the day they were snoozed to.
  const shownReminders = (briefing.reminders?.items ?? []).filter(
    (item) => !(snoozedReminders[item.id] && snoozedReminders[item.id] > briefing.today),
  );
  const openReminders = shownReminders.filter((item) => !completedReminders.includes(item.id));
  const priorities = topPriorities({
    groups: groupReminders(openReminders, briefing.today, timeZone),
    pinned: pinnedReminders,
    custom: customPriorities,
    today: briefing.today,
    timeZone,
  });

  // The hero summary: a morning summary describes today, an evening one
  // tomorrow. Show the one that fits the view, noting when it is older.
  const brief = briefing.dailyBrief;
  const heroBrief = showEvening ? (brief?.mode === "evening" ? brief : undefined) : brief;
  const heroNote =
    !showEvening && brief?.mode === "evening" ? "Written last night, looking ahead to today." : undefined;

  const greeting = isToday
    ? `${greetingAt(nowMs, timeZone)}. ${showEvening ? "Here’s what tomorrow holds." : "Here’s your day."}`
    : "A look at another day.";
  const modeChoice: ModeChoice = modeOverride ?? "auto";

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Skip to the briefing
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <p className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Daily Briefing
          </p>
          <div className="topbar-actions">
            {SHOW_CONNECTIONS_ENTRY && (
              <button type="button" className="button button-secondary" onClick={() => setPanel("connections")}>
                <Link2 size={17} aria-hidden="true" /> Connections
              </button>
            )}
            <button type="button" className="button button-secondary" onClick={() => setPanel("preferences")}>
              <Settings2 size={17} aria-hidden="true" /> Preferences
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="page" tabIndex={-1}>
        <div className="page-header">
          <HeaderScene />
          <div className="page-title">
            <p className="eyebrow">{relativeDayLabel(dayOffset)}</p>
            <h1>{longDateLabel(briefing.date)}</h1>
            <p className="greeting">{greeting}</p>
          </div>
          {briefing.quote && (
            <figure className="quote">
              <blockquote>
                <p>{briefing.quote.text}</p>
              </blockquote>
              <figcaption>
                {briefing.quote.author}
                {briefing.quote.work && <cite>, {briefing.quote.work}</cite>}
                <span className="quote-label"> · Quote of the day</span>
              </figcaption>
            </figure>
          )}
          <div className="page-controls">
            {isToday && (
              <div className="segmented" role="group" aria-label="View">
                {(
                  [
                    { value: "auto", label: "Auto", detail: ` (${autoMode})`, icon: SunMedium },
                    { value: "morning", label: "Morning", detail: "", icon: Sunrise },
                    { value: "evening", label: "Evening", detail: "", icon: Moon },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={modeChoice === option.value}
                    onClick={() => chooseMode(option.value)}
                  >
                    <option.icon size={16} aria-hidden="true" />
                    {option.label}
                    {option.detail && <span className="segmented-detail">{option.detail}</span>}
                  </button>
                ))}
              </div>
            )}
            <nav className="day-pager" aria-label="Day">
              <button
                type="button"
                className="icon-button"
                onClick={() => void goToDay(shiftDateKey(briefing.date, -1))}
                disabled={changingDay || dayOffset <= MIN_DAY_OFFSET}
              >
                <ChevronLeft size={18} aria-hidden="true" />
                <span className="visually-hidden">Previous day</span>
              </button>
              <button
                type="button"
                className="button button-secondary"
                onClick={() => void goToDay(briefing.today)}
                disabled={changingDay || isToday}
              >
                Today
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => void goToDay(shiftDateKey(briefing.date, 1))}
                disabled={changingDay || dayOffset >= MAX_DAY_OFFSET}
              >
                <ChevronRight size={18} aria-hidden="true" />
                <span className="visually-hidden">Next day</span>
              </button>
            </nav>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => void refreshBriefing()}
              aria-busy={refreshing}
            >
              <RefreshCw size={16} aria-hidden="true" className={refreshing ? "spin" : undefined} />
              {refreshing ? "Reloading…" : `Updated ${lastUpdated}`}
              <span className="visually-hidden">. Reload the briefing.</span>
            </button>
          </div>
        </div>

        <div className="dashboard" aria-busy={changingDay}>
          {isToday && (
            <GlanceHero
              mode={showEvening ? "tomorrow" : "today"}
              day={
                showEvening
                  ? tomorrowPayload?.briefing.date === tomorrowDate
                    ? tomorrowPayload.briefing
                    : undefined
                  : briefing
              }
              brief={heroBrief}
              briefNote={heroNote}
              reminders={openReminders}
              occasions={briefing.occasions ?? []}
              timeZone={timeZone}
              nowMs={nowMs}
            />
          )}

          {isToday && preferences.showReminders && briefing.reminders && (
            <PrioritiesCard
              title={showEvening ? "Carry forward" : "Top 3 today"}
              entries={priorities}
              onComplete={completeFromPriorities}
              onRemoveCustom={removeCustomPriority}
              onAddCustom={addCustomPriority}
            />
          )}

          {isToday && (
            <HeadsUpCard
              items={briefing.headsUp ?? []}
              occasions={briefing.occasions ?? []}
              reminders={shownReminders}
              onNotify={notify}
            />
          )}

          <div className="row row-split">
            <UpNextCard agenda={briefing.agenda} isToday={isToday} nowMs={nowMs} timeZone={timeZone} />
            <WeatherCard
              weather={briefing.weather}
              hourly={briefing.hourlyWeather}
              agenda={briefing.agenda}
              outdoorWindow={briefing.outdoorWindow}
              isToday={isToday}
              nowMs={nowMs}
              timeZone={timeZone}
            />
          </div>

          <ScheduleCard
            agenda={briefing.agenda}
            hourly={briefing.hourlyWeather}
            isToday={isToday}
            nowMs={nowMs}
            timeZone={timeZone}
          />

          <div className="row row-thirds">
            {preferences.showReminders && briefing.reminders && (
              <RemindersCard
                reminders={shownReminders}
                completed={completedReminders}
                pinned={pinnedReminders}
                today={briefing.today}
                timeZone={timeZone}
                onToggleComplete={toggleReminder}
                onTogglePin={togglePin}
                onSnooze={snoozeReminder}
              />
            )}
            {preferences.showPhoto && isToday && (photoUrl || memoryUrls.some(Boolean)) && (
              <PhotoCard
                photo={briefing.photo}
                photoUrl={photoUrl}
                memories={briefing.memories}
                memoryUrls={memoryUrls}
                timeZone={timeZone}
              />
            )}
            {preferences.showSports && briefing.sports.length > 0 && (
              <SportsCard
                sports={briefing.sports}
                date={briefing.date}
                isToday={isToday}
                evening={showEvening}
                hideScores={preferences.hideScores}
                onToggleScores={() => updatePreference("hideScores", !preferences.hideScores)}
                nowMs={nowMs}
                timeZone={timeZone}
              />
            )}
          </div>

          <div className="row row-halves">
            {briefing.upcomingReleases && (
              <ReleasesCard panel={briefing.upcomingReleases} date={briefing.date} isToday={isToday} />
            )}
            {briefing.hotGames && <HotnessCard panel={briefing.hotGames} />}
          </div>

          <div className="row row-halves">
            {isToday && briefing.occasions && <OccasionsCard occasions={briefing.occasions} />}
            {briefing.birthdays && <BirthdaysCard panel={briefing.birthdays} dayOffset={dayOffset} />}
          </div>

          {preferences.showNews && briefing.headlines.length > 0 && <NewsCard headlines={briefing.headlines} />}
        </div>
      </main>

      <Panel title="Preferences" open={panel === "preferences"} onClose={() => setPanel(null)}>
        <PreferencesPanel
          preferences={preferences}
          updatePreference={updatePreference}
          onReset={resetDevice}
          accountSettings={accountSettings}
        />
      </Panel>
      {SHOW_CONNECTIONS_ENTRY && (
        <Panel title="Connections" open={panel === "connections"} onClose={() => setPanel(null)}>
          <ConnectionsPanel connections={connections} onNotify={notify} />
        </Panel>
      )}

      <div className="toast-region" role="status">
        {toast && (
          <div className="toast" key={toast.id}>
            <p>{toast.message}</p>
            {toast.undo && (
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  toast.undo?.();
                  notify("Undone.");
                }}
              >
                Undo
              </button>
            )}
            <button type="button" className="icon-button" onClick={() => setToast(null)}>
              <X size={18} aria-hidden="true" />
              <span className="visually-hidden">Dismiss message</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
