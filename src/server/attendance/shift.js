import { ApiError } from "@/lib/api";

/**
 * Shift time arithmetic.
 *
 * Shifts are stored as **minutes from midnight**, and `endMinute` is allowed to
 * exceed 1440. That single decision is what makes a night shift expressible at
 * all: 22:00–06:00 is 1320 to 1800, not 1320 to 360. Storing the end as 360
 * would make every duration calculation negative and every night worker appear
 * to have worked minus sixteen hours.
 *
 * Everything here is pure, because the awkward cases — a shift crossing
 * midnight, a punch at 02:00 that belongs to yesterday, a grace period that
 * straddles the hour — are exactly the ones that are painful to reproduce with
 * a database and trivial to assert against.
 *
 * All arithmetic is done in the branch's own day. A restaurant closing at 2am
 * thinks of that as the end of Friday, not the start of Saturday, and payroll
 * has to agree with the people being paid.
 */

export const MINUTES_PER_DAY = 1440;

/** "22:00" -> 1320. Accepts "H:MM" and "HH:MM". */
export function parseTimeToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
  if (!match) {
    throw ApiError.validation(`"${value}" is not a time`, { time: ["Use HH:MM, such as 09:30"] });
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours > 47 || minutes > 59) {
    throw ApiError.validation(`"${value}" is not a time`, { time: ["Hours 0-47, minutes 0-59"] });
  }

  return hours * 60 + minutes;
}

/** 1320 -> "22:00". Minutes past midnight wrap for display: 1800 -> "06:00 (+1)". */
export function formatMinutes(minute) {
  const day = Math.floor(minute / MINUTES_PER_DAY);
  const withinDay = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const text = `${String(Math.floor(withinDay / 60)).padStart(2, "0")}:${String(withinDay % 60).padStart(2, "0")}`;

  return day > 0 ? `${text} (+${day})` : text;
}

/** How long the shift runs, net of its unpaid break. */
export function shiftLengthMinutes(shift) {
  return Math.max(0, shift.endMinute - shift.startMinute - (shift.breakMinutes ?? 0));
}

export function crossesMidnight(shift) {
  return shift.endMinute > MINUTES_PER_DAY;
}

/** The UTC midnight of a date — how `@db.Date` columns are compared. */
export function startOfDay(date) {
  const value = new Date(date);
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function addDays(date, days) {
  const value = startOfDay(date);
  value.setUTCDate(value.getUTCDate() + days);
  return value;
}

export function addMinutes(date, minutes) {
  return new Date(new Date(date).getTime() + minutes * 60_000);
}

/** Whole days between two dates, inclusive of both ends. */
export function daysBetween(from, to) {
  return Math.floor((startOfDay(to) - startOfDay(from)) / 86_400_000) + 1;
}

/**
 * The real clock window a shift occupies on a given work date.
 *
 * For a night shift this ends on the following calendar day, which is the whole
 * point: a punch at 02:00 on Saturday belongs to Friday's shift, and anything
 * that groups punches by calendar date alone will put it on the wrong day and
 * pay the wrong person for it.
 */
export function shiftWindow({ shift, workDate }) {
  const base = startOfDay(workDate);

  return {
    start: addMinutes(base, shift.startMinute),
    end: addMinutes(base, shift.endMinute),
    graceEnd: addMinutes(base, shift.startMinute + (shift.graceMinutes ?? 0)),
  };
}

/**
 * How far outside its own window a punch may still count.
 *
 * People arrive early and leave late, and a terminal in the corridor catches
 * both. Without a margin, a punch four minutes before the shift opens is
 * orphaned and the employee reads as absent; with an unbounded one, yesterday's
 * late leaver is folded into today.
 */
export const PUNCH_MARGIN_MINUTES = 240;

export function punchBelongsToShift({ punchedAt, shift, workDate, marginMinutes = PUNCH_MARGIN_MINUTES }) {
  const { start, end } = shiftWindow({ shift, workDate });
  const at = new Date(punchedAt);

  return at >= addMinutes(start, -marginMinutes) && at <= addMinutes(end, marginMinutes);
}

/**
 * Which work date a punch belongs to, given the employee's roster.
 *
 * Checks the previous day first. A punch at 02:00 is far more likely to be the
 * end of a night shift than the start of a day one, and resolving it forwards
 * silently splits every night worker's shift across two days — halving one and
 * inventing the other.
 */
export function workDateForPunch({ punchedAt, assignments }) {
  const at = new Date(punchedAt);
  const candidates = [addDays(at, -1), startOfDay(at)];

  for (const workDate of candidates) {
    const assignment = assignments.find(
      (row) => startOfDay(row.workDate).getTime() === workDate.getTime() && row.shift && !row.isWeeklyOff,
    );
    if (!assignment) continue;

    if (punchBelongsToShift({ punchedAt: at, shift: assignment.shift, workDate })) {
      return { workDate, shift: assignment.shift, assignment };
    }
  }

  // No roster covers it. The punch is still real, so it lands on its own
  // calendar date with no shift and the day is derived without expectations.
  return { workDate: startOfDay(at), shift: null, assignment: null };
}

/** Minutes late, measured against the grace period rather than the start. */
export function lateMinutes({ firstInAt, shift, workDate }) {
  if (!firstInAt || !shift) return 0;

  const { graceEnd, start } = shiftWindow({ shift, workDate });
  if (new Date(firstInAt) <= graceEnd) return 0;

  // Measured from the actual start, not the end of grace: grace forgives
  // lateness, it does not redefine when the shift began.
  return Math.round((new Date(firstInAt) - start) / 60_000);
}

/** Minutes left early, measured against the shift end. */
export function earlyLeaveMinutes({ lastOutAt, shift, workDate }) {
  if (!lastOutAt || !shift) return 0;

  const { end } = shiftWindow({ shift, workDate });
  const out = new Date(lastOutAt);
  if (out >= end) return 0;

  return Math.round((end - out) / 60_000);
}
