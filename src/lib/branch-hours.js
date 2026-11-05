import { formatClock, parseClock } from "@/lib/menu-schedule";

/**
 * A branch's trading week, as a form holds it and as the API wants it.
 *
 * Kept out of the component because the one genuinely tricky part — a window
 * that runs past midnight — is arithmetic, and arithmetic is worth testing on
 * its own. "11:00 until 02:00" is not 11:00 to 02:00; it is 660 to 1560,
 * minutes counted past the same midnight, and getting that wrong either closes
 * a shop nine hours early or has it trading around the clock.
 */

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** One row per weekday, in week order, whatever the API returned. */
export function hoursToForm(hours = []) {
  return DAY_NAMES.map((name, dayOfWeek) => {
    // One window a day in this editor. The model allows several and the page
    // still displays them all; splitting a lunch and a dinner service is a
    // bigger idea than this screen is trying to be.
    const row = hours.find((entry) => entry.dayOfWeek === dayOfWeek) ?? null;
    return {
      dayOfWeek,
      name,
      open: Boolean(row),
      opensAt: row ? formatClock(row.opensAt) : "11:00",
      closesAt: row ? formatClock(row.closesAt) : "23:00",
      // Kept rather than re-derived: 02:00 as a closing time is ambiguous on
      // its own, and the checkbox is what resolves it.
      overnight: row ? row.closesAt > 1440 : false,
    };
  });
}

/**
 * The form, as `PUT /admin/branches/{id}/hours` wants it.
 *
 * Returns `{ hours, errors }`: a day whose times do not make sense is named
 * rather than silently dropped, because a dropped day is a day the shop is
 * shut and nobody meant it.
 */
export function hoursPayload(rows = []) {
  const hours = [];
  const errors = {};

  for (const row of rows) {
    if (!row.open) continue;

    const opensAt = parseClock(row.opensAt);
    const closesAt = parseClock(row.closesAt);

    if (opensAt === null || closesAt === null) {
      errors[row.dayOfWeek] = "Use a 24-hour time, like 11:00.";
      continue;
    }

    // Past midnight is the next day's clock, so it is measured past 1440.
    const closing = row.overnight ? closesAt + 1440 : closesAt;

    if (closing <= opensAt) {
      errors[row.dayOfWeek] = row.overnight
        ? "Closing is already past midnight, so it has to be after the opening time."
        : "Closing must be after opening. For a late night, tick “past midnight”.";
      continue;
    }

    hours.push({ dayOfWeek: row.dayOfWeek, opensAt, closesAt: closing, channel: null });
  }

  return { hours, errors };
}

/** "11:00–02:00 (next day)", for a row that is open. */
export function describeRow(row) {
  if (!row.open) return "Closed";
  return `${row.opensAt}–${row.closesAt}${row.overnight ? " (next day)" : ""}`;
}
