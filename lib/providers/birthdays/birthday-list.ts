import type { BirthdayItem, BirthdaysPanel } from "@/lib/briefing-types";
import { shiftDateKey } from "@/lib/briefing-window";
import type { BirthdayRecord } from "@/lib/data/birthdays";
import { facebookBirthdays, familyBirthdays } from "@/lib/data/birthdays";

/** Days of already-passed birthdays to keep on the card. */
export const BIRTHDAY_LOOKBACK_DAYS = 3;
/** Days ahead to look. */
export const BIRTHDAY_LOOKAHEAD_DAYS = 7;

const MONTH_DAY = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * The keys under which a record claims to be one particular person.
 *
 * Two are needed because the sources disagree in both directions. Matching on
 * date and name catches the Facebook export's duplicate profiles, where the
 * same name appears twice on one date. Matching on profile id catches the
 * family list's hand-checked claims, where the names differ ("Franklin Donald
 * Fish" against "Don Fish") or, for two people, the dates do — a name key alone
 * would leave them on the card twice, on two different days.
 *
 * Names are compared loosely: case, punctuation, and accents are dropped. Two
 * people who genuinely share a name *and* a birthday would collapse into one,
 * which is the accepted trade for catching duplicate profiles.
 */
function identityKeys(record: BirthdayRecord): string[] {
  const name = record.name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const keys = [`on:${record.on}|${name}`];
  if (record.facebookId) keys.push(`fb:${record.facebookId}`);
  return keys;
}

/**
 * Combines the source lists into one entry per person or couple.
 *
 * The family list is passed first and therefore wins on everything it states —
 * name, date, year, and whether the person has died — because it is maintained
 * by hand and the Facebook export is neither complete nor always right. A
 * Facebook record matched to a family one contributes only what the family list
 * left blank, in practice just the profile id behind the row's link.
 */
export function mergeBirthdays(
  ...lists: readonly BirthdayRecord[][]
): BirthdayRecord[] {
  const byKey = new Map<string, BirthdayRecord>();
  const canonical: BirthdayRecord[] = [];

  for (const record of lists.flat()) {
    if (!MONTH_DAY.test(record.on) || !record.name.trim()) continue;
    const keys = identityKeys(record);
    const existing = keys.reduce<BirthdayRecord | undefined>(
      (found, key) => found ?? byKey.get(key),
      undefined,
    );

    if (!existing) {
      const added = { ...record, name: record.name.trim() };
      canonical.push(added);
      for (const key of keys) byKey.set(key, added);
      continue;
    }

    existing.facebookId ??= record.facebookId;
    existing.note ??= record.note;
    existing.since ??= record.since;
    existing.died ??= record.died;
    // Point every key either record answered to at the survivor, not just the
    // survivor's own. A family row that claims one of two duplicate Facebook
    // profiles absorbs that profile's name-and-date key as well, so the second
    // duplicate still lands on the same person instead of becoming a new row.
    for (const key of [...identityKeys(existing), ...keys]) {
      byKey.set(key, existing);
    }
  }

  return canonical;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function labelFor(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/**
 * Every `MM-DD` in the window, mapped to how far it is from `date` and how it
 * should be labelled. Built from real calendar dates rather than month
 * arithmetic so a window spanning New Year works without a special case.
 */
interface WindowDay {
  offset: number;
  label: string;
  /** Calendar year the occasion falls in, which an age is counted against. */
  year: number;
}

function windowDays(date: string): Map<string, WindowDay> {
  const days = new Map<string, WindowDay>();
  for (
    let offset = -BIRTHDAY_LOOKBACK_DAYS;
    offset <= BIRTHDAY_LOOKAHEAD_DAYS;
    offset += 1
  ) {
    const dateKey = shiftDateKey(date, offset);
    const entry = {
      offset,
      label: labelFor(dateKey),
      year: Number(dateKey.slice(0, 4)),
    };
    days.set(dateKey.slice(5), entry);
    // A 29 February birthday has no date to land on in a common year, so it is
    // observed on the 28th rather than skipped for three years out of four.
    if (dateKey.endsWith("-02-28") && !isLeapYear(Number(dateKey.slice(0, 4)))) {
      days.set("02-29", entry);
    }
  }
  return days;
}

/**
 * The line under the name. Only the family list carries years, so most rows
 * have nothing to say here.
 *
 * Someone who has died never gets an age: they are not having a birthday, and
 * counting one up would be the wrong thing for the card to say. Their row shows
 * the years they lived instead.
 */
function detailFor(record: BirthdayRecord, year: number): string | undefined {
  if (record.died !== undefined) {
    return `Remembering · ${record.since ?? "?"}–${record.died}`;
  }
  if (record.since === undefined) return undefined;
  const years = year - record.since;
  if (years < 0) return undefined;
  if (record.kind === "anniversary") {
    return years === 0 ? `Married ${record.since}` : `${years} years`;
  }
  return years === 0 ? `Born ${record.since}` : `Turns ${years}`;
}

/**
 * Birthdays and anniversaries around the day being shown, oldest first.
 *
 * Local data, so this is synchronous and cannot fail: there is no network call
 * and no cache. `date` is the day the briefing is rendering, which the pager
 * can move off today — the window follows it so a past or future page shows the
 * occasions around *that* day.
 */
export function birthdaysInWindow(date: string): BirthdaysPanel {
  const days = windowDays(date);
  const records = mergeBirthdays(familyBirthdays, facebookBirthdays);

  const items = records.flatMap((record): BirthdayItem[] => {
    const day = days.get(record.on);
    if (!day) return [];
    return [
      {
        id: record.facebookId
          ? `birthday-fb-${record.facebookId}`
          : `birthday-${record.on}-${record.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: record.name,
        on: record.on,
        kind: record.kind ?? "birthday",
        offset: day.offset,
        dateLabel: day.label,
        detail: detailFor(record, day.year),
        inMemoriam: record.died !== undefined,
        note: record.note,
        profileUrl: record.facebookId
          ? `https://www.facebook.com/${encodeURIComponent(record.facebookId)}`
          : undefined,
      },
    ];
  });

  items.sort(
    (left, right) =>
      left.offset - right.offset || left.name.localeCompare(right.name),
  );

  return {
    items,
    onDayCount: items.filter((item) => item.offset === 0).length,
  };
}
