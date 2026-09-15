import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import {
  addDays,
  crossesMidnight,
  daysBetween,
  formatMinutes,
  parseTimeToMinutes,
  shiftLengthMinutes,
  startOfDay,
} from "@/server/attendance/shift";

/**
 * Shifts and the roster.
 *
 * A shift is a template — "evening, 6pm to 2am, half-hour break". The roster
 * says which employee works which shift on which date, and it is per-date
 * rather than a weekly pattern because restaurant rotas are not weekly: cover
 * changes around holidays, football matches and whoever is off sick.
 *
 * A weekly off is a roster row too, not the absence of one. That distinction
 * matters at derivation time: a day nobody rostered is unknown, while a day
 * rostered as off is a day the employee was not expected and must not be marked
 * absent for.
 */

const SHIFT_SELECT = {
  id: true,
  branchId: true,
  name: true,
  startMinute: true,
  endMinute: true,
  breakMinutes: true,
  graceMinutes: true,
  halfDayThresholdMinutes: true,
  fullDayThresholdMinutes: true,
  isActive: true,
  _count: { select: { assignments: true } },
};

function shape(shift) {
  const { _count, ...row } = shift;

  return {
    ...row,
    startTime: formatMinutes(row.startMinute),
    endTime: formatMinutes(row.endMinute),
    lengthMinutes: shiftLengthMinutes(row),
    crossesMidnight: crossesMidnight(row),
    assignmentCount: _count?.assignments ?? 0,
  };
}

/** Accepts either "HH:MM" or raw minutes, so a client can send whichever it has. */
function toMinutes(value, field) {
  if (typeof value === "number") return value;
  if (typeof value === "string") return parseTimeToMinutes(value);
  throw ApiError.validation(`${field} is required`, { [field]: ["Give a time as HH:MM"] });
}

export async function createShift(data, actor = null) {
  const branch = await prisma.branch.findUnique({ where: { id: data.branchId }, select: { id: true } });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });

  const startMinute = toMinutes(data.startMinute ?? data.startTime, "startMinute");
  let endMinute = toMinutes(data.endMinute ?? data.endTime, "endMinute");

  // A shift ending "before" it starts is a night shift somebody entered as a
  // wall-clock time. Rolling it past midnight is what the caller meant, and
  // storing it as-is would make every duration negative.
  if (endMinute <= startMinute) endMinute += 1440;

  const length = endMinute - startMinute;
  if (length > 1440) {
    throw ApiError.validation("A shift cannot be longer than 24 hours", {
      endMinute: [`That is ${Math.round(length / 60)} hours`],
    });
  }
  if ((data.breakMinutes ?? 0) >= length) {
    throw ApiError.validation("The break is longer than the shift", { breakMinutes: ["Shorten the break"] });
  }

  const clash = await prisma.shift.findFirst({
    where: { branchId: data.branchId, name: data.name },
    select: { id: true },
  });
  if (clash) throw ApiError.conflict(`This branch already has a shift called ${data.name}`);

  const shift = await prisma.shift.create({
    data: {
      branchId: data.branchId,
      name: data.name,
      startMinute,
      endMinute,
      breakMinutes: data.breakMinutes ?? 0,
      graceMinutes: data.graceMinutes ?? 10,
      halfDayThresholdMinutes: data.halfDayThresholdMinutes ?? Math.floor((length - (data.breakMinutes ?? 0)) / 2),
      fullDayThresholdMinutes: data.fullDayThresholdMinutes ?? length - (data.breakMinutes ?? 0),
      isActive: data.isActive ?? true,
    },
    select: SHIFT_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: data.branchId,
    action: "shift.create",
    entityType: "Shift",
    entityId: shift.id,
    changes: { name: shift.name, start: formatMinutes(startMinute), end: formatMinutes(endMinute) },
  });

  return shape(shift);
}

export async function listShifts({ branchId, isActive } = {}) {
  const rows = await prisma.shift.findMany({
    where: { ...(branchId ? { branchId } : {}), ...(isActive != null ? { isActive } : {}) },
    select: SHIFT_SELECT,
    orderBy: { startMinute: "asc" },
  });

  return rows.map(shape);
}

async function loadShift(id) {
  const shift = await prisma.shift.findUnique({ where: { id }, select: SHIFT_SELECT });
  if (!shift) throw ApiError.notFound("Shift not found");
  return shift;
}

export async function getShift(id) {
  return shape(await loadShift(id));
}

/**
 * Edits a shift.
 *
 * Changing the times of a shift that has already been worked would re-derive
 * history: somebody who was on time becomes late, and a day that paid in full
 * becomes a half day. Refused once an attendance day references it.
 */
export async function updateShift(id, data, actor = null) {
  const shift = await loadShift(id);

  const retiming =
    (data.startMinute ?? data.startTime) != null ||
    (data.endMinute ?? data.endTime) != null ||
    data.breakMinutes != null;

  if (retiming) {
    const worked = await prisma.attendanceDay.count({ where: { shiftId: id } });
    if (worked > 0) {
      throw ApiError.conflict(`${worked} attendance day(s) were derived against these times`, {
        hint: "Create a new shift and roster onto it instead — retiming this one would rewrite history",
      });
    }
  }

  const startMinute = data.startMinute ?? data.startTime ? toMinutes(data.startMinute ?? data.startTime, "startMinute") : shift.startMinute;
  let endMinute = data.endMinute ?? data.endTime ? toMinutes(data.endMinute ?? data.endTime, "endMinute") : shift.endMinute;
  if (endMinute <= startMinute) endMinute += 1440;

  const updated = await prisma.shift.update({
    where: { id },
    data: {
      ...(data.name != null ? { name: data.name } : {}),
      startMinute,
      endMinute,
      ...(data.breakMinutes != null ? { breakMinutes: data.breakMinutes } : {}),
      ...(data.graceMinutes != null ? { graceMinutes: data.graceMinutes } : {}),
      ...(data.halfDayThresholdMinutes != null ? { halfDayThresholdMinutes: data.halfDayThresholdMinutes } : {}),
      ...(data.fullDayThresholdMinutes != null ? { fullDayThresholdMinutes: data.fullDayThresholdMinutes } : {}),
      ...(data.isActive != null ? { isActive: data.isActive } : {}),
    },
    select: SHIFT_SELECT,
  });

  return shape(updated);
}

// --- roster -----------------------------------------------------------------

const ASSIGNMENT_SELECT = {
  id: true,
  employeeId: true,
  shiftId: true,
  workDate: true,
  isWeeklyOff: true,
  assignedById: true,
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, branchId: true } },
  shift: {
    select: {
      id: true,
      name: true,
      startMinute: true,
      endMinute: true,
      breakMinutes: true,
      graceMinutes: true,
      halfDayThresholdMinutes: true,
      fullDayThresholdMinutes: true,
    },
  },
};

/** How many days a single roster call may cover, so one request cannot write a year. */
const MAX_ROSTER_DAYS = 62;

/**
 * Rosters an employee onto a shift across a date range.
 *
 * Upserted per date, because rostering is iterative — a manager publishes a
 * week and then moves three people around. A second call for the same date is a
 * correction, not a duplicate.
 */
export async function assignShift({ employeeId, shiftId, from, to, isWeeklyOff = false, actor }) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, branchId: true, status: true, employeeCode: true },
  });
  if (!employee) throw ApiError.validation("Employee not found", { employeeId: ["No such employee"] });
  if (["RESIGNED", "TERMINATED"].includes(employee.status)) {
    throw ApiError.conflict(`${employee.employeeCode} has left`, { status: employee.status });
  }

  let shift = null;
  if (!isWeeklyOff) {
    if (!shiftId) {
      throw ApiError.validation("Say which shift", { shiftId: ["Required unless this is a weekly off"] });
    }
    shift = await prisma.shift.findUnique({
      where: { id: shiftId },
      select: { id: true, branchId: true, isActive: true, name: true },
    });
    if (!shift) throw ApiError.validation("Shift not found", { shiftId: ["No such shift"] });
    if (!shift.isActive) throw ApiError.conflict(`${shift.name} is not active`);

    // A shift belongs to a branch; rostering somebody onto another branch's
    // shift produces a day nobody can work.
    if (shift.branchId !== employee.branchId) {
      throw ApiError.validation(`${shift.name} belongs to a different branch`, {
        shiftId: ["Choose a shift at the employee's own branch"],
      });
    }
  }

  const start = startOfDay(from);
  const end = startOfDay(to ?? from);
  if (end < start) {
    throw ApiError.validation("The range ends before it starts", { to: ["Must be on or after the start"] });
  }

  const days = daysBetween(start, end);
  if (days > MAX_ROSTER_DAYS) {
    throw ApiError.validation(`That is ${days} days`, { to: [`Roster at most ${MAX_ROSTER_DAYS} days at a time`] });
  }

  const written = await withTransaction(async (tx) => {
    const rows = [];

    for (let index = 0; index < days; index += 1) {
      const workDate = addDays(start, index);

      // A weekly off has no shift, but the column is required — so an off day
      // keeps whichever shift it would otherwise have been, and the flag is
      // what derivation reads.
      const resolvedShiftId = shift?.id ?? shiftId ?? null;
      if (!resolvedShiftId) {
        throw ApiError.validation("A roster row needs a shift, even for a day off", {
          shiftId: ["Give the shift this employee would normally work"],
        });
      }

      const row = await tx.shiftAssignment.upsert({
        where: { employeeId_workDate: { employeeId, workDate } },
        create: { employeeId, shiftId: resolvedShiftId, workDate, isWeeklyOff, assignedById: actor?.userId ?? null },
        update: { shiftId: resolvedShiftId, isWeeklyOff, assignedById: actor?.userId ?? null },
        select: ASSIGNMENT_SELECT,
      });

      rows.push(row);
    }

    return rows;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: employee.branchId,
    action: "roster.assign",
    entityType: "Employee",
    entityId: employeeId,
    changes: { shiftId: shift?.id ?? shiftId, from: startOfDay(start), to: startOfDay(end), days, isWeeklyOff },
  });

  return { employeeId, days: written.length, assignments: written };
}

export async function removeAssignment({ employeeId, workDate, actor }) {
  const existing = await prisma.shiftAssignment.findUnique({
    where: { employeeId_workDate: { employeeId, workDate: startOfDay(workDate) } },
    select: { id: true },
  });
  if (!existing) throw ApiError.notFound("No roster entry for that day");

  const derived = await prisma.attendanceDay.count({
    where: { employeeId, workDate: startOfDay(workDate) },
  });
  if (derived > 0) {
    throw ApiError.conflict("That day has already been derived into attendance", {
      hint: "Correct the attendance day instead",
    });
  }

  await prisma.shiftAssignment.delete({ where: { id: existing.id } });
  return { employeeId, workDate: startOfDay(workDate), deleted: true };
}

/** The roster for a branch over a window — the grid a manager publishes. */
export async function roster({ branchId, employeeId, from, to }) {
  const start = startOfDay(from);
  const end = startOfDay(to ?? from);

  const rows = await prisma.shiftAssignment.findMany({
    where: {
      ...(employeeId ? { employeeId } : {}),
      ...(branchId ? { employee: { branchId } } : {}),
      workDate: { gte: start, lte: end },
    },
    select: ASSIGNMENT_SELECT,
    orderBy: [{ workDate: "asc" }, { employeeId: "asc" }],
  });

  return rows.map((row) => ({
    ...row,
    startTime: row.shift ? formatMinutes(row.shift.startMinute) : null,
    endTime: row.shift ? formatMinutes(row.shift.endMinute) : null,
  }));
}

/** One employee's roster around a date, for punch resolution. */
export async function assignmentsAround({ employeeId, date, tx = prisma }) {
  const day = startOfDay(date);

  return tx.shiftAssignment.findMany({
    where: { employeeId, workDate: { gte: addDays(day, -1), lte: addDays(day, 1) } },
    select: ASSIGNMENT_SELECT,
  });
}
