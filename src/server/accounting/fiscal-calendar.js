/**
 * Which fiscal year a date belongs to, and the months inside it.
 *
 * Pure arithmetic and no imports, so the seed (plain node, relative imports)
 * and the service layer (aliased, database-bound) can share one definition of
 * the calendar. Two definitions is how a seed and a UI come to disagree about
 * which year today is in.
 *
 * ## Why July
 *
 * Pakistan's financial year runs 1 July to 30 June, and that is the default
 * here. It is a default and not a constant: a client with a different year
 * sets `FISCAL_YEAR_START_MONTH` once, before anything is posted.
 *
 * The year is named for the span it covers — "FY 2026-27" — which is how it is
 * written and said locally, and matches the years already in the books.
 *
 * ## Why this has to be right
 *
 * `assertPostable` refuses any date that falls in no accounting period. Get
 * the year off by one and a fresh install produces a year that has not begun
 * yet, every posting is refused, and the chart of accounts is decoration. The
 * failure is total rather than subtle, which is some comfort — but it lands on
 * whoever installed the system, on their first day.
 */

/** Pakistan's financial year: 1 July to 30 June. */
export const DEFAULT_FISCAL_YEAR_START_MONTH = 7;

/**
 * Reads the configured start month, 1-12.
 *
 * Reads `process.env` directly rather than going through `env()`, because the
 * seed runs with only a database URL in its environment and must not be made
 * to satisfy the whole application schema to insert a fiscal year. The variable
 * is still declared in `lib/env.js` so it is documented with the rest.
 *
 * Refuses anything it does not understand. A silent fallback to July would let
 * `FISCAL_YEAR_START_MONTH=13` build a year nobody chose, and the first sign of
 * it would be a set of books whose quarters land in the wrong places.
 */
export function fiscalYearStartMonth(raw = process.env.FISCAL_YEAR_START_MONTH) {
  if (raw == null) return DEFAULT_FISCAL_YEAR_START_MONTH;

  const text = String(raw).trim();
  if (text === "") return DEFAULT_FISCAL_YEAR_START_MONTH;

  // Digits only: Number(" 7 ") is 7 but Number("7.5") is also a number, and a
  // fiscal year cannot start halfway through a month.
  if (!/^\d+$/.test(text)) {
    throw new Error(`FISCAL_YEAR_START_MONTH must be a whole number from 1 to 12, not ${JSON.stringify(String(raw))}`);
  }

  const month = Number(text);
  if (month < 1 || month > 12) {
    throw new Error(`FISCAL_YEAR_START_MONTH must be a whole number from 1 to 12, not ${month}`);
  }

  return month;
}

/** Dates are stored as `@db.Date`; comparing them needs the time stripped. */
function asDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a date: ${JSON.stringify(String(value))}`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * The fiscal year containing `date`: `{ name, startDate, endDate }`.
 *
 * Both bounds are inclusive, as they are in the database — a year ends on 30
 * June, not at midnight on 1 July.
 */
export function fiscalYearFor(date = new Date(), { startMonth = fiscalYearStartMonth() } = {}) {
  const month = fiscalYearStartMonth(startMonth);
  const day = asDate(date);

  /*
   * Before the start month, the current year began in the *previous* calendar
   * year. With a July start, March 2026 belongs to the year that opened in
   * July 2025 — the one mistake worth being deliberate about here.
   */
  const startYear = day.getUTCMonth() + 1 >= month ? day.getUTCFullYear() : day.getUTCFullYear() - 1;

  const startDate = new Date(Date.UTC(startYear, month - 1, 1));
  // Day 0 of the month after the span is the last day of the span: correct for
  // 30-day months and for 29 February without a leap-year rule of our own.
  const endDate = new Date(Date.UTC(startYear + 1, month - 1, 0));

  return { name: fiscalYearName(startYear, month), startDate, endDate };
}

/**
 * "FY 2026-27" for a year that straddles two calendar years, "FY 2026" for one
 * that does not. "FY 2026-26" would be nonsense.
 */
export function fiscalYearName(startYear, startMonth = fiscalYearStartMonth()) {
  if (fiscalYearStartMonth(startMonth) === 1) return `FY ${startYear}`;
  return `FY ${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * The calendar months between two dates, inclusive of both ends.
 *
 * Periods are generated rather than entered, because a year with a missing
 * month is a hole that only shows up when something tries to post into it, long
 * after whoever set it up has moved on.
 */
export function monthsBetween(startDate, endDate) {
  const start = asDate(startDate);
  const end = asDate(endDate);
  const months = [];

  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));

  while (cursor <= end) {
    const monthStart = new Date(cursor);
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));

    months.push({
      // The first and last periods are clipped to the year, so a year that
      // starts mid-month gets a short first period rather than one that
      // reaches back before the year began.
      startDate: monthStart < start ? start : monthStart,
      endDate: monthEnd > end ? end : monthEnd,
      name: new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(monthStart),
    });

    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }

  return months;
}

// --- how much runway is left, and what comes next ---------------------------

/**
 * When the warning starts, and when it escalates.
 *
 * Sixty days is the first notice because opening a year is a decision, not a
 * chore: a business may want a short transition year, or to change its year
 * end, and that is a conversation rather than a click. Seven is the last one
 * that still leaves a working week.
 *
 * Nothing here creates a year. An automatically created year would be worse
 * than none: its periods cannot simply be deleted once anything has posted
 * into them (`JournalEntry.period` is `onDelete: Restrict`), and an overlapping
 * year then blocks the correct one — so a wrong guess has to be unpicked by
 * hand from the ledger up.
 */
export const RUNWAY_THRESHOLDS = [60, 30, 7];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How much of the fiscal calendar is left: `{ state, daysLeft, threshold }`.
 *
 *   OK        nothing to say
 *   EXPIRING  a year is still open but ends soon — a reminder
 *   LAPSED    nothing covers today. Postings are already being refused and
 *             parked, so this is an outage of the books, not a reminder.
 *
 * `threshold` is which notice this is, so a daily job can warn once per step
 * instead of every morning. A date exactly on a threshold counts as crossed:
 * a job that runs once a day would otherwise step straight over it.
 *
 * Pure — the caller supplies the clock, so every boundary is testable without
 * waiting for June.
 */
export function runwayStatus({ yearEndDate = null, now = new Date() } = {}) {
  if (!yearEndDate) return { state: "LAPSED", daysLeft: null, threshold: 0 };

  const end = asDate(yearEndDate);
  const today = asDate(now);
  // Whole days, both bounds date-only: the last day of the year reads 0, which
  // is true — it is the last day you can post into, and tomorrow you cannot.
  const daysLeft = Math.round((end.getTime() - today.getTime()) / DAY_MS);

  if (daysLeft < 0) return { state: "LAPSED", daysLeft, threshold: 0 };

  /*
   * The *tightest* threshold that still applies, so the notice escalates.
   * Searched from the smallest up: scanning the list as written would match 60
   * first and report the sixty-day notice on the day before the year ends.
   */
  const threshold = [...RUNWAY_THRESHOLDS].sort((a, b) => a - b).find((days) => daysLeft <= days) ?? null;
  return { state: threshold === null ? "OK" : "EXPIRING", daysLeft, threshold };
}

/**
 * The year to offer next, continuing the shape of the last one.
 *
 * The day after the latest year on file, running twelve months. It follows the
 * *books* rather than `FISCAL_YEAR_START_MONTH`, because a business that ran a
 * short transition year, or that changed its year end, keeps its own calendar
 * — and the configured default describes a fresh install, not this one.
 *
 * With nothing on file it falls back to that default, which is the same year
 * the seed would have opened.
 *
 * Offered, never imposed: every field stays editable on the form.
 */
export function nextFiscalYearAfter(latestEndDate = null, { now = new Date(), startMonth } = {}) {
  if (!latestEndDate) return fiscalYearFor(now, startMonth == null ? {} : { startMonth });

  const previousEnd = asDate(latestEndDate);
  const startDate = new Date(previousEnd.getTime() + DAY_MS);
  // Twelve months, then back a day, so the year ends the day before its own
  // anniversary — right for 30-day months and for February without a
  // leap-year rule of our own.
  const endDate = new Date(
    Date.UTC(startDate.getUTCFullYear() + 1, startDate.getUTCMonth(), startDate.getUTCDate()) - DAY_MS,
  );

  return {
    // Named from the month it starts in, so a July year reads "FY 2027-28" and
    // a January one "FY 2027" — matching however this business already writes
    // it rather than however this install is configured.
    name: fiscalYearName(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1),
    startDate,
    endDate,
  };
}
