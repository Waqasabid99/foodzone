import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { logger } from "@/lib/logger";
import { deriveDay, summariseDays } from "@/server/attendance/derive";
import { addDays, daysBetween, punchBelongsToShift, startOfDay } from "@/server/attendance/shift";

/**
 * Turning punches into the day payroll reads.
 *
 * `AttendanceDay` is a **derived cache** in exactly the way `StockLevel` is:
 * the punches are the truth, and re-running derivation over the same punches
 * must produce the same day. That is what makes a re-sync safe and a nightly
 * job re-runnable, and it is why nothing here writes a day from anything except
 * the punches plus the roster, the holiday calendar and approved leave.
 *
 * The one exception is a **manual override**, which is a human saying the
 * derivation got it wrong. Those are flagged, carry a reason and are not
 * overwritten by a later re-run — otherwise the correction silently evaporates
 * the next time the job runs, which is worse than not offering corrections.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const SELECT = {
  id: true,
  employeeId: true,
  branchId: true,
  workDate: true,
  shiftId: true,
  status: true,
  firstInAt: true,
  lastOutAt: true,
  workedMinutes: true,
  breakMinutes: true,
  overtimeMinutes: true,
  lateMinutes: true,
  earlyLeaveMinutes: true,
  payableFactor: true,
  isManualOverride: true,
  overrideReason: true,
  approvedById: true,
  approvedAt: true,
  isLocked: true,
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
  shift: { select: { id: true, name: true, startMinute: true, endMinute: true } },
};

/** Everything the derivation needs about one employee's day, in one go. */
async function contextFor({ employeeId, workDate, branchId, tx = prisma }) {
  const day = startOfDay(workDate);

  const [assignment, holiday, leave] = await Promise.all([
    tx.shiftAssignment.findUnique({
      where: { employeeId_workDate: { employeeId, workDate: day } },
      select: {
        isWeeklyOff: true,
        shift: {
          select: {
            id: true,
            startMinute: true,
            endMinute: true,
            breakMinutes: true,
            graceMinutes: true,
            halfDayThresholdMinutes: true,
            fullDayThresholdMinutes: true,
          },
        },
      },
    }),
    tx.holiday.findFirst({
      // A company-wide holiday has a null branch and applies everywhere.
      where: { date: day, OR: [{ branchId: null }, { branchId }] },
      select: { id: true, name: true, isPaid: true },
    }),
    tx.leaveRequest.findFirst({
      where: { employeeId, status: "APPROVED", startDate: { lte: day }, endDate: { gte: day } },
      select: { id: true, leaveType: { select: { id: true, name: true, isPaid: true } } },
    }),
  ]);

  return {
    shift: assignment?.shift ?? null,
    isWeeklyOff: assignment?.isWeeklyOff ?? false,
    isHoliday: Boolean(holiday),
    holiday,
    leave: leave ? { id: leave.id, isPaid: leave.leaveType?.isPaid ?? true, name: leave.leaveType?.name } : null,
  };
}

/**
 * Collects the punches that belong to one work date.
 *
 * Not simply "punches on this calendar date": a night shift's punch-out lands
 * the following morning, and grouping by date alone splits it across two days —
 * halving one and inventing the other.
 */
async function punchesFor({ employeeId, workDate, shift, tx = prisma }) {
  const day = startOfDay(workDate);

  // Widened by a day either side, then filtered by the shift window.
  const candidates = await tx.attendancePunch.findMany({
    where: { employeeId, punchedAt: { gte: addDays(day, -1), lt: addDays(day, 2) } },
    select: { id: true, punchedAt: true, direction: true, method: true },
    orderBy: { punchedAt: "asc" },
  });

  if (!shift) {
    return candidates.filter((punch) => startOfDay(punch.punchedAt).getTime() === day.getTime());
  }

  return candidates.filter((punch) => punchBelongsToShift({ punchedAt: punch.punchedAt, shift, workDate: day }));
}

/**
 * Derives one employee's day and writes it.
 *
 * Idempotent: the same punches produce the same row, so this is safe to run
 * nightly, on demand, and again after a re-sync.
 */
export async function deriveAttendanceDay({ employeeId, workDate, force = false, tx = prisma }) {
  const employee = await tx.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, branchId: true, employeeCode: true },
  });
  if (!employee) throw ApiError.notFound("Employee not found");

  const day = startOfDay(workDate);

  const existing = await tx.attendanceDay.findUnique({
    where: { employeeId_workDate: { employeeId, workDate: day } },
    select: { id: true, isLocked: true, isManualOverride: true },
  });

  // A paid day is frozen. Re-deriving it would make the payslip disagree with
  // the attendance it was built from.
  if (existing?.isLocked) return { skipped: true, reason: "LOCKED", employeeId, workDate: day };

  // A human said the machine got it wrong. Respect that until they say otherwise.
  if (existing?.isManualOverride && !force) {
    return { skipped: true, reason: "MANUAL_OVERRIDE", employeeId, workDate: day };
  }

  const context = await contextFor({ employeeId, workDate: day, branchId: employee.branchId, tx });
  const punches = await punchesFor({ employeeId, workDate: day, shift: context.shift, tx });

  const derived = deriveDay({
    punches,
    shift: context.shift,
    workDate: day,
    isHoliday: context.isHoliday,
    isWeeklyOff: context.isWeeklyOff,
    leave: context.leave,
  });

  const row = await tx.attendanceDay.upsert({
    where: { employeeId_workDate: { employeeId, workDate: day } },
    create: {
      employeeId,
      branchId: employee.branchId,
      workDate: day,
      shiftId: derived.shiftId,
      status: derived.status,
      firstInAt: derived.firstInAt,
      lastOutAt: derived.lastOutAt,
      workedMinutes: derived.workedMinutes,
      breakMinutes: derived.breakMinutes,
      overtimeMinutes: derived.overtimeMinutes,
      lateMinutes: derived.lateMinutes,
      earlyLeaveMinutes: derived.earlyLeaveMinutes,
      payableFactor: derived.payableFactor,
    },
    update: {
      shiftId: derived.shiftId,
      status: derived.status,
      firstInAt: derived.firstInAt,
      lastOutAt: derived.lastOutAt,
      workedMinutes: derived.workedMinutes,
      breakMinutes: derived.breakMinutes,
      overtimeMinutes: derived.overtimeMinutes,
      lateMinutes: derived.lateMinutes,
      earlyLeaveMinutes: derived.earlyLeaveMinutes,
      payableFactor: derived.payableFactor,
      isManualOverride: false,
      overrideReason: null,
    },
    select: SELECT,
  });

  if (punches.length) {
    await tx.attendancePunch.updateMany({
      where: { id: { in: punches.map((punch) => punch.id) } },
      data: { isProcessed: true },
    });
  }

  return { skipped: false, day: row, derived };
}

/**
 * Derives a whole branch over a date range.
 *
 * The nightly job. Runs per employee per day rather than in one query because
 * each day needs its own roster, holiday and leave context — and because a
 * failure on one employee must not lose the rest.
 */
export async function deriveRange({ branchId, employeeId = null, from, to, force = false }) {
  const start = startOfDay(from);
  const end = startOfDay(to ?? from);
  const days = daysBetween(start, end);

  if (days > 93) {
    throw ApiError.validation(`That is ${days} days`, { to: ["Derive at most 93 days at a time"] });
  }

  const employees = await prisma.employee.findMany({
    where: {
      ...(employeeId ? { id: employeeId } : {}),
      ...(branchId ? { branchId } : {}),
      status: { notIn: ["RESIGNED", "TERMINATED"] },
    },
    select: { id: true, employeeCode: true },
  });

  const results = { employees: employees.length, days, derived: 0, skipped: 0, failed: [] };

  for (const employee of employees) {
    for (let index = 0; index < days; index += 1) {
      const workDate = addDays(start, index);

      try {
        const result = await deriveAttendanceDay({ employeeId: employee.id, workDate, force });
        if (result.skipped) results.skipped += 1;
        else results.derived += 1;
      } catch (error) {
        logger.warn("attendance derivation failed", {
          employeeId: employee.id,
          workDate,
          error: error.message,
        });
        results.failed.push({ employeeId: employee.id, workDate, error: error.message });
      }
    }
  }

  return results;
}

async function loadDay(id) {
  const day = await prisma.attendanceDay.findUnique({ where: { id }, select: SELECT });
  if (!day) throw ApiError.notFound("Attendance day not found");
  return day;
}

/**
 * A supervisor correcting a day.
 *
 * Flagged as an override with a reason, and **not** overwritten by a later
 * re-derivation. A correction that silently evaporates on the next nightly run
 * is worse than no correction at all, because the person who made it believes
 * it stuck.
 */
export async function correctAttendanceDay(id, data, actor) {
  const day = await loadDay(id);

  if (day.isLocked) {
    throw ApiError.conflict("That day has been paid and is locked", {
      hint: "Raise an adjustment in the next payroll period instead",
    });
  }

  if (data.payableFactor != null && (D(data.payableFactor).lessThan(0) || D(data.payableFactor).greaterThan(2))) {
    throw ApiError.validation("A payable factor is between 0 and 2", {
      payableFactor: ["1 is a full day, 0.5 a half day, 0 unpaid"],
    });
  }

  const updated = await prisma.attendanceDay.update({
    where: { id },
    data: {
      ...(data.status != null ? { status: data.status } : {}),
      ...(data.workedMinutes != null ? { workedMinutes: data.workedMinutes } : {}),
      ...(data.overtimeMinutes != null ? { overtimeMinutes: data.overtimeMinutes } : {}),
      ...(data.lateMinutes != null ? { lateMinutes: data.lateMinutes } : {}),
      ...(data.payableFactor != null ? { payableFactor: D(data.payableFactor) } : {}),
      isManualOverride: true,
      overrideReason: data.reason,
      // A correction resets approval: the thing that was signed off has changed.
      approvedById: null,
      approvedAt: null,
    },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: day.branchId,
    action: "attendance.correct",
    entityType: "AttendanceDay",
    entityId: id,
    changes: {
      employeeCode: day.employee?.employeeCode,
      workDate: day.workDate,
      from: { status: day.status, payableFactor: Number(day.payableFactor) },
      to: { status: updated.status, payableFactor: Number(updated.payableFactor) },
      reason: data.reason,
    },
  });

  return updated;
}

/** Drops the override so the machine's answer applies again. */
export async function revertCorrection(id, actor) {
  const day = await loadDay(id);
  if (day.isLocked) throw ApiError.conflict("That day has been paid and is locked");

  const result = await deriveAttendanceDay({ employeeId: day.employeeId, workDate: day.workDate, force: true });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: day.branchId,
    action: "attendance.revert_correction",
    entityType: "AttendanceDay",
    entityId: id,
    changes: { workDate: day.workDate, previousReason: day.overrideReason },
  });

  return result.day ?? (await loadDay(id));
}

/**
 * Approves days for payroll.
 *
 * Payroll pays what was approved, not what the terminal recorded — which is the
 * point of having a supervisor look at a `MISSING_PUNCH` before somebody loses a
 * day's pay to a flat battery.
 */
export async function approveAttendance({ branchId, employeeId = null, from, to, actor }) {
  const start = startOfDay(from);
  const end = startOfDay(to ?? from);

  const pending = await prisma.attendanceDay.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(employeeId ? { employeeId } : {}),
      workDate: { gte: start, lte: end },
      approvedAt: null,
      isLocked: false,
    },
    select: { id: true, status: true },
  });

  const unresolved = pending.filter((day) => day.status === "MISSING_PUNCH");

  const result = await prisma.attendanceDay.updateMany({
    where: { id: { in: pending.map((day) => day.id) } },
    data: { approvedById: actor.userId, approvedAt: new Date() },
  });

  await recordAudit({
    actorId: actor.userId,
    branchId,
    action: "attendance.approve",
    entityType: "AttendanceDay",
    entityId: null,
    changes: { from: start, to: end, approved: result.count, missingPunches: unresolved.length },
  });

  return {
    approved: result.count,
    // Reported rather than refused: sometimes the right answer really is "they
    // were here, the device was broken", and the supervisor has just said so.
    missingPunchesApproved: unresolved.length,
    from: start,
    to: end,
  };
}

export async function listAttendance({ branchId, employeeId, status, from, to, limit = 50, cursor } = {}) {
  const rows = await prisma.attendanceDay.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(employeeId ? { employeeId } : {}),
      ...(status ? { status } : {}),
      ...(from || to
        ? { workDate: { ...(from ? { gte: startOfDay(from) } : {}), ...(to ? { lte: startOfDay(to) } : {}) } }
        : {}),
    },
    select: SELECT,
    orderBy: [{ workDate: "desc" }, { employeeId: "asc" }],
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

/** One employee's month, with the totals payroll will use. */
export async function attendanceSummary({ employeeId, branchId, from, to }) {
  const days = await prisma.attendanceDay.findMany({
    where: {
      ...(employeeId ? { employeeId } : {}),
      ...(branchId ? { branchId } : {}),
      workDate: { gte: startOfDay(from), lte: startOfDay(to) },
    },
    select: {
      employeeId: true,
      workDate: true,
      status: true,
      workedMinutes: true,
      overtimeMinutes: true,
      lateMinutes: true,
      payableFactor: true,
      approvedAt: true,
      isLocked: true,
      employee: { select: { employeeCode: true, firstName: true, lastName: true } },
    },
    orderBy: { workDate: "asc" },
  });

  const byEmployee = new Map();
  for (const day of days) {
    const bucket = byEmployee.get(day.employeeId) ?? { employeeId: day.employeeId, employee: day.employee, days: [] };
    bucket.days.push(day);
    byEmployee.set(day.employeeId, bucket);
  }

  return [...byEmployee.values()].map((bucket) => {
    const summary = summariseDays(bucket.days);

    return {
      employeeId: bucket.employeeId,
      employee: bucket.employee,
      ...summary,
      payableDays: Number(summary.payableDays),
      presentDays: Number(summary.presentDays),
      leaveDays: Number(summary.leaveDays),
      absentDays: Number(summary.absentDays),
      holidayDays: Number(summary.holidayDays),
      weeklyOffDays: Number(summary.weeklyOffDays),
      unapprovedDays: bucket.days.filter((day) => !day.approvedAt).length,
      recordedDays: bucket.days.length,
    };
  });
}
