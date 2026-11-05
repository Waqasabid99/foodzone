import { Prisma } from "@/generated/prisma";
import {
  earlyLeaveMinutes,
  lateMinutes,
  shiftLengthMinutes,
  shiftWindow,
} from "@/server/attendance/shift";

/**
 * Folding raw punches into one attendance day.
 *
 * This is the most consequential arithmetic in the module, because it decides
 * what people are paid. It is pure for exactly that reason: the cases that go
 * wrong — somebody who forgot to punch out, a device that reports no direction
 * at all, a break taken across midnight, a double-tap on the sensor — are
 * miserable to reproduce against a database and trivial to assert here.
 *
 * Three rules run through it:
 *
 *   * **Punches are never edited.** They are raw and immutable; a correction is
 *     a MANUAL punch added alongside, and the day is re-derived. A system that
 *     lets somebody rewrite the terminal's record of when they arrived is not
 *     an attendance system.
 *   * **A missing punch is flagged, never guessed.** Assuming somebody left at
 *     their shift end is how unworked hours get paid, and assuming they never
 *     arrived is how worked hours get stolen. `MISSING_PUNCH` asks a human.
 *   * **Derivation is idempotent.** Re-running it over the same punches
 *     produces the same day, so a re-sync or a nightly re-run is safe.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** Two punches closer together than this are one person tapping twice. */
export const DOUBLE_TAP_SECONDS = 60;

/**
 * Removes accidental repeats.
 *
 * Biometric terminals routinely register the same finger twice within a second
 * or two. Left in, the pairing below reads the repeat as the matching OUT and
 * records a shift lasting four seconds.
 */
export function dedupePunches(punches, withinSeconds = DOUBLE_TAP_SECONDS) {
  const sorted = [...punches].sort((a, b) => new Date(a.punchedAt) - new Date(b.punchedAt));
  const kept = [];

  for (const punch of sorted) {
    const previous = kept[kept.length - 1];
    if (!previous) {
      kept.push(punch);
      continue;
    }

    const gap = (new Date(punch.punchedAt) - new Date(previous.punchedAt)) / 1000;
    const sameDirection = (previous.direction ?? "UNKNOWN") === (punch.direction ?? "UNKNOWN");

    // Only collapse repeats of the same kind. An IN followed a second later by
    // a deliberate OUT is somebody correcting themselves, not a double tap.
    if (gap < withinSeconds && sameDirection) continue;

    kept.push(punch);
  }

  return kept;
}

/**
 * Gives every punch a direction.
 *
 * Cheap terminals report `UNKNOWN` for everything, so directions are inferred
 * by alternating from the first punch: in, out, in, out. Punches that *do*
 * carry a direction are trusted and reset the alternation, so a device that
 * labels some of them does not fight the inference for the rest.
 */
export function resolveDirections(punches) {
  let expectIn = true;

  return punches.map((punch) => {
    const stated = punch.direction && punch.direction !== "UNKNOWN" ? punch.direction : null;

    if (stated) {
      if (stated === "IN") expectIn = false;
      else if (stated === "OUT") expectIn = true;
      return { ...punch, direction: stated, inferred: false };
    }

    const direction = expectIn ? "IN" : "OUT";
    expectIn = !expectIn;
    return { ...punch, direction, inferred: true };
  });
}

/**
 * Pairs punches into worked intervals and break intervals.
 *
 * An unmatched IN at the end is the classic forgotten punch-out and is reported
 * rather than closed off at the shift end.
 */
export function pairIntervals(punches) {
  const work = [];
  const breaks = [];
  let openIn = null;
  let openBreak = null;
  let unmatched = 0;

  for (const punch of punches) {
    const at = new Date(punch.punchedAt);

    switch (punch.direction) {
      case "IN":
        // A second IN with no OUT between: the first one never closed.
        if (openIn) unmatched += 1;
        openIn = at;
        break;

      case "OUT":
        if (openIn) {
          work.push({ from: openIn, to: at });
          openIn = null;
        } else {
          unmatched += 1;
        }
        break;

      case "BREAK_START":
        openBreak = at;
        break;

      case "BREAK_END":
        if (openBreak) {
          breaks.push({ from: openBreak, to: at });
          openBreak = null;
        } else {
          unmatched += 1;
        }
        break;

      default:
        break;
    }
  }

  // Still open at the end of the day: somebody forgot to punch out.
  const openAtEnd = Boolean(openIn) || Boolean(openBreak);
  if (openIn) unmatched += 1;
  if (openBreak) unmatched += 1;

  return { work, breaks, unmatched, openAtEnd };
}

function totalMinutes(intervals) {
  return intervals.reduce((sum, interval) => sum + Math.max(0, (interval.to - interval.from) / 60_000), 0);
}

/**
 * Turns a day's punches into the row payroll reads.
 *
 * `timezone` is the branch's, because a shift's "10:00" is a wall clock and
 * the punches are instants; without it every late minute is the UTC offset.
 *
 * `shift` may be null — an unrostered day, or somebody who turned up when they
 * were not expected. The day is still derived; there is simply nothing to be
 * late for, so lateness and overtime are not computed against a window that
 * does not exist.
 */
export function deriveDay({
  punches = [],
  shift = null,
  workDate,
  timezone = "UTC",
  isHoliday = false,
  isWeeklyOff = false,
  leave = null,
}) {
  const cleaned = resolveDirections(dedupePunches(punches));
  const { work, breaks, unmatched, openAtEnd } = pairIntervals(cleaned);

  const firstInAt = cleaned.length ? new Date(cleaned[0].punchedAt) : null;
  const lastOut = [...cleaned].reverse().find((punch) => punch.direction === "OUT");
  const lastOutAt = lastOut ? new Date(lastOut.punchedAt) : null;

  const breakMinutes = Math.round(totalMinutes(breaks));
  const rawWorked = Math.round(totalMinutes(work));
  // A break punched explicitly comes out of the worked total; a shift's nominal
  // break is only used when the employee never punched one.
  const workedMinutes = Math.max(0, rawWorked - breakMinutes);

  const fullDay = shift?.fullDayThresholdMinutes ?? 480;
  const halfDay = shift?.halfDayThresholdMinutes ?? 240;

  const late = shift ? lateMinutes({ firstInAt, shift, workDate, timezone }) : 0;
  const early = shift && lastOutAt ? earlyLeaveMinutes({ lastOutAt, shift, workDate, timezone }) : 0;

  // Overtime is time beyond the shift's own length, not beyond eight hours —
  // a six-hour shift worked for eight is two hours of overtime to the person
  // who worked it.
  const expected = shift ? shiftLengthMinutes(shift) : fullDay;
  const overtimeMinutes = Math.max(0, workedMinutes - expected);

  const status = deriveStatus({
    workedMinutes,
    punchCount: cleaned.length,
    openAtEnd,
    late,
    fullDay,
    halfDay,
    isHoliday,
    isWeeklyOff,
    leave,
  });

  return {
    workDate,
    shiftId: shift?.id ?? null,
    status,
    firstInAt,
    lastOutAt,
    workedMinutes,
    breakMinutes,
    overtimeMinutes,
    lateMinutes: late,
    earlyLeaveMinutes: early,
    payableFactor: payableFactorFor({ status, workedMinutes, fullDay, halfDay, isHoliday, leave }),
    punchCount: cleaned.length,
    unmatchedPunches: unmatched,
    inferredDirections: cleaned.filter((punch) => punch.inferred).length,
  };
}

/**
 * What kind of day this was.
 *
 * Order matters. A holiday somebody worked is still a worked day, so presence
 * is checked before the calendar; but an absence on a holiday is a holiday, not
 * an absence, and docking pay for it would be wrong.
 */
export function deriveStatus({
  workedMinutes,
  punchCount,
  openAtEnd,
  late,
  fullDay,
  halfDay,
  isHoliday,
  isWeeklyOff,
  leave,
}) {
  if (punchCount === 0) {
    if (leave) return "ON_LEAVE";
    if (isHoliday) return "HOLIDAY";
    if (isWeeklyOff) return "WEEKLY_OFF";
    return "ABSENT";
  }

  // Somebody who punched in and never out. Guessing when they left is how
  // unworked hours get paid; this asks a human instead.
  if (openAtEnd || punchCount === 1) return "MISSING_PUNCH";

  if (workedMinutes >= fullDay) return late > 0 ? "LATE" : "PRESENT";
  if (workedMinutes >= halfDay) return "HALF_DAY";

  // Present for less than half a day and not on leave: too little to pay as a
  // half day, but they were here, so it is not a clean absence either.
  return "HALF_DAY";
}

/**
 * The payroll multiplier for the day.
 *
 * `MISSING_PUNCH` deliberately pays nothing until somebody corrects it. That is
 * the safe direction: an under-payment gets noticed and fixed by the person
 * affected, while an over-payment against hours nobody worked usually does not.
 */
export function payableFactorFor({ status, workedMinutes, fullDay, halfDay, isHoliday, leave }) {
  switch (status) {
    case "PRESENT":
    case "LATE":
      return D(1);

    case "HALF_DAY":
      return D(workedMinutes >= halfDay ? 0.5 : 0);

    case "HOLIDAY":
      return D(isHoliday === false ? 0 : 1);

    case "WEEKLY_OFF":
      return D(1);

    case "ON_LEAVE":
      // Unpaid leave is a day off that is not paid for.
      return D(leave?.isPaid === false ? 0 : 1);

    case "MISSING_PUNCH":
    case "ABSENT":
    default:
      return D(0);
  }
}

/**
 * Rolls a set of derived days into the figures a payslip is built from.
 *
 * Counted from the days themselves rather than from the punches, because the
 * day is the row a supervisor corrects — and payroll must pay what was
 * approved, not what the terminal happened to record.
 */
export function summariseDays(days) {
  const summary = {
    payableDays: D(0),
    presentDays: D(0),
    leaveDays: D(0),
    absentDays: D(0),
    holidayDays: D(0),
    weeklyOffDays: D(0),
    missingPunchDays: 0,
    workedMinutes: 0,
    overtimeMinutes: 0,
    lateMinutes: 0,
  };

  for (const day of days) {
    summary.payableDays = summary.payableDays.plus(D(day.payableFactor));
    summary.workedMinutes += day.workedMinutes ?? 0;
    summary.overtimeMinutes += day.overtimeMinutes ?? 0;
    summary.lateMinutes += day.lateMinutes ?? 0;

    switch (day.status) {
      case "PRESENT":
      case "LATE":
        summary.presentDays = summary.presentDays.plus(1);
        break;
      case "HALF_DAY":
        summary.presentDays = summary.presentDays.plus(0.5);
        break;
      case "ON_LEAVE":
        summary.leaveDays = summary.leaveDays.plus(1);
        break;
      case "HOLIDAY":
        summary.holidayDays = summary.holidayDays.plus(1);
        break;
      case "WEEKLY_OFF":
        summary.weeklyOffDays = summary.weeklyOffDays.plus(1);
        break;
      case "MISSING_PUNCH":
        summary.missingPunchDays += 1;
        break;
      case "ABSENT":
      default:
        summary.absentDays = summary.absentDays.plus(1);
        break;
    }
  }

  return summary;
}
