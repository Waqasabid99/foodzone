import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { addDays, daysBetween, startOfDay } from "@/server/attendance/shift";

/**
 * Leave and holidays.
 *
 * The balance is the interesting part, and it is deliberately **decremented on
 * approval, not on request**. Holding a balance against pending requests sounds
 * fairer but means a manager sitting on an approval blocks the employee from
 * asking for anything else — and a rejected request has to give the days back,
 * which is one more path to get wrong. Approval is the commitment.
 *
 * Overlapping requests are refused outright. Two approved leaves covering the
 * same day would each consume a day of balance while the employee is only
 * absent once, and attendance derivation would have to pick one arbitrarily.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const TYPE_SELECT = {
  id: true,
  name: true,
  code: true,
  isPaid: true,
  annualQuota: true,
  carryForward: true,
  isActive: true,
  _count: { select: { requests: true } },
};

const REQUEST_SELECT = {
  id: true,
  employeeId: true,
  leaveTypeId: true,
  startDate: true,
  endDate: true,
  totalDays: true,
  reason: true,
  status: true,
  reviewedById: true,
  reviewedAt: true,
  reviewNote: true,
  createdAt: true,
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, branchId: true } },
  leaveType: { select: { id: true, name: true, code: true, isPaid: true } },
};

// --- leave types ------------------------------------------------------------

export async function listLeaveTypes({ isActive } = {}) {
  const rows = await prisma.leaveType.findMany({
    where: { ...(isActive != null ? { isActive } : {}) },
    select: TYPE_SELECT,
    orderBy: { name: "asc" },
  });

  return rows.map(({ _count, ...row }) => ({ ...row, requestCount: _count.requests }));
}

export async function createLeaveType(data, actor = null) {
  const clash = await prisma.leaveType.findFirst({
    where: { OR: [{ name: data.name }, { code: data.code }] },
    select: { id: true, code: true },
  });
  if (clash) throw ApiError.conflict(`A leave type with that ${clash.code === data.code ? "code" : "name"} exists`);

  const type = await prisma.leaveType.create({
    data: {
      name: data.name,
      code: data.code,
      isPaid: data.isPaid ?? true,
      annualQuota: D(data.annualQuota ?? 0),
      carryForward: data.carryForward ?? false,
      isActive: data.isActive ?? true,
    },
    select: TYPE_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "leave_type.create",
    entityType: "LeaveType",
    entityId: type.id,
    changes: { name: type.name, code: type.code, annualQuota: Number(type.annualQuota) },
  });

  const { _count, ...row } = type;
  return { ...row, requestCount: 0 };
}

export async function updateLeaveType(id, data, actor = null) {
  const type = await prisma.leaveType.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!type) throw ApiError.notFound("Leave type not found");

  const updated = await prisma.leaveType.update({
    where: { id },
    data: {
      ...(data.name != null ? { name: data.name } : {}),
      ...(data.isPaid != null ? { isPaid: data.isPaid } : {}),
      ...(data.annualQuota != null ? { annualQuota: D(data.annualQuota) } : {}),
      ...(data.carryForward != null ? { carryForward: data.carryForward } : {}),
      ...(data.isActive != null ? { isActive: data.isActive } : {}),
    },
    select: TYPE_SELECT,
  });

  const { _count, ...row } = updated;
  return { ...row, requestCount: _count.requests };
}

// --- balances ---------------------------------------------------------------

/**
 * Opens a year's balances for an employee.
 *
 * Idempotent, so the yearly job can be re-run. Carry-forward is taken from the
 * previous year's unused days when the type allows it, which is the only place
 * last year's balance affects this one.
 */
export async function openBalances({ employeeId, year, actor = null }) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employeeCode: true, joinedAt: true },
  });
  if (!employee) throw ApiError.notFound("Employee not found");

  const types = await prisma.leaveType.findMany({
    where: { isActive: true },
    select: { id: true, annualQuota: true, carryForward: true, name: true },
  });

  const opened = [];

  for (const type of types) {
    const previous = type.carryForward
      ? await prisma.leaveBalance.findUnique({
          where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year: year - 1 } },
          select: { entitledDays: true, usedDays: true, carriedDays: true },
        })
      : null;

    const carried = previous
      ? Prisma.Decimal.max(
          D(previous.entitledDays).plus(D(previous.carriedDays)).minus(D(previous.usedDays)),
          0,
        )
      : D(0);

    const balance = await prisma.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId, leaveTypeId: type.id, year } },
      create: { employeeId, leaveTypeId: type.id, year, entitledDays: D(type.annualQuota), carriedDays: carried },
      // Used days are not touched on a re-run: they are what has been taken.
      update: { entitledDays: D(type.annualQuota), carriedDays: carried },
      select: { id: true, leaveTypeId: true, year: true, entitledDays: true, usedDays: true, carriedDays: true },
    });

    opened.push({ ...balance, leaveType: type.name });
  }

  return { employeeId, year, balances: opened };
}

export async function leaveBalances({ employeeId, year = new Date().getUTCFullYear() }) {
  const rows = await prisma.leaveBalance.findMany({
    where: { employeeId, year },
    select: {
      id: true,
      year: true,
      entitledDays: true,
      usedDays: true,
      carriedDays: true,
      leaveType: { select: { id: true, name: true, code: true, isPaid: true } },
    },
  });

  return rows.map((row) => ({
    ...row,
    availableDays: D(row.entitledDays).plus(D(row.carriedDays)).minus(D(row.usedDays)),
  }));
}

// --- requests ---------------------------------------------------------------

/** Whole days, inclusive of both ends; half-days are given explicitly. */
function requestedDays({ startDate, endDate, totalDays }) {
  if (totalDays != null) return D(totalDays);
  return D(daysBetween(startDate, endDate));
}

export async function requestLeave(data, actor) {
  const employee = await prisma.employee.findUnique({
    where: { id: data.employeeId },
    select: { id: true, employeeCode: true, branchId: true, status: true },
  });
  if (!employee) throw ApiError.validation("Employee not found", { employeeId: ["No such employee"] });
  if (["RESIGNED", "TERMINATED"].includes(employee.status)) {
    throw ApiError.conflict(`${employee.employeeCode} has left`);
  }

  const type = await prisma.leaveType.findUnique({
    where: { id: data.leaveTypeId },
    select: { id: true, name: true, isActive: true, annualQuota: true },
  });
  if (!type) throw ApiError.validation("Leave type not found", { leaveTypeId: ["No such leave type"] });
  if (!type.isActive) throw ApiError.validation(`${type.name} is not available`, { leaveTypeId: ["Choose another"] });

  const startDate = startOfDay(data.startDate);
  const endDate = startOfDay(data.endDate ?? data.startDate);
  if (endDate < startDate) {
    throw ApiError.validation("Leave ends before it starts", { endDate: ["Must be on or after the start"] });
  }

  const totalDays = requestedDays({ startDate, endDate, totalDays: data.totalDays });
  if (totalDays.lessThanOrEqualTo(0)) {
    throw ApiError.validation("Leave has to be for at least half a day", { totalDays: ["Must be more than zero"] });
  }

  // Two approved leaves over the same day each consume balance while the
  // employee is absent once, and derivation would have to pick one arbitrarily.
  const overlapping = await prisma.leaveRequest.findFirst({
    where: {
      employeeId: data.employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  if (overlapping) {
    throw ApiError.conflict("That overlaps leave already requested", {
      requestId: overlapping.id,
      from: overlapping.startDate,
      to: overlapping.endDate,
      status: overlapping.status,
    });
  }

  const request = await prisma.leaveRequest.create({
    data: {
      employeeId: data.employeeId,
      leaveTypeId: data.leaveTypeId,
      startDate,
      endDate,
      totalDays,
      reason: data.reason ?? null,
      status: "PENDING",
    },
    select: REQUEST_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: employee.branchId,
    action: "leave.request",
    entityType: "LeaveRequest",
    entityId: request.id,
    changes: { employeeCode: employee.employeeCode, type: type.name, days: Number(totalDays) },
  });

  return request;
}

async function loadRequest(id) {
  const request = await prisma.leaveRequest.findUnique({ where: { id }, select: REQUEST_SELECT });
  if (!request) throw ApiError.notFound("Leave request not found");
  return request;
}

/**
 * Approves leave and consumes the balance.
 *
 * The balance check and the decrement happen in one transaction, so two
 * approvals racing cannot both pass a check that each was the last day.
 *
 * Attendance days covering the leave are re-derived afterwards, because a day
 * already marked ABSENT has to become ON_LEAVE — otherwise the employee is
 * docked for leave somebody approved.
 */
export async function approveLeave(id, { note = null, actor }) {
  const request = await loadRequest(id);

  if (request.status !== "PENDING") {
    throw ApiError.conflict(`That request is already ${request.status.toLowerCase()}`, { status: request.status });
  }

  const year = new Date(request.startDate).getUTCFullYear();

  const approved = await withTransaction(async (tx) => {
    const quota = await tx.leaveType.findUnique({
      where: { id: request.leaveTypeId },
      select: { annualQuota: true, name: true },
    });

    // A zero quota means unlimited — sick leave in many places — so there is
    // nothing to check or consume.
    const tracked = D(quota.annualQuota).greaterThan(0);

    if (tracked) {
      const balance = await tx.leaveBalance.upsert({
        where: { employeeId_leaveTypeId_year: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year } },
        create: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year, entitledDays: D(quota.annualQuota) },
        update: {},
        select: { id: true, entitledDays: true, usedDays: true, carriedDays: true },
      });

      const available = D(balance.entitledDays).plus(D(balance.carriedDays)).minus(D(balance.usedDays));

      if (available.lessThan(D(request.totalDays))) {
        throw ApiError.conflict(`Only ${available} day(s) of ${quota.name} left`, {
          requested: Number(request.totalDays),
          available: Number(available),
        });
      }

      await tx.leaveBalance.update({
        where: { id: balance.id },
        data: { usedDays: { increment: D(request.totalDays) } },
      });
    }

    return tx.leaveRequest.update({
      where: { id },
      data: { status: "APPROVED", reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: note },
      select: REQUEST_SELECT,
    });
  });

  // A day already derived as ABSENT must become ON_LEAVE, or the employee is
  // docked for leave that was granted.
  const rederived = await rederiveLeaveDays(request);

  await recordAudit({
    actorId: actor.userId,
    branchId: request.employee?.branchId,
    action: "leave.approve",
    entityType: "LeaveRequest",
    entityId: id,
    changes: {
      employeeCode: request.employee?.employeeCode,
      type: request.leaveType?.name,
      days: Number(request.totalDays),
      attendanceDaysRederived: rederived,
    },
  });

  return approved;
}

/** Re-derives the attendance days a leave request covers. */
async function rederiveLeaveDays(request) {
  const { deriveAttendanceDay } = await import("@/server/services/attendance.service");
  const days = daysBetween(request.startDate, request.endDate);
  let count = 0;

  for (let index = 0; index < days; index += 1) {
    const workDate = addDays(request.startDate, index);
    try {
      const result = await deriveAttendanceDay({ employeeId: request.employeeId, workDate, force: false });
      if (!result.skipped) count += 1;
    } catch {
      // A day that cannot be re-derived is not a reason to fail the approval —
      // the leave is granted either way, and the nightly job will catch up.
    }
  }

  return count;
}

export async function rejectLeave(id, { note = null, actor }) {
  const request = await loadRequest(id);
  if (request.status !== "PENDING") {
    throw ApiError.conflict(`That request is already ${request.status.toLowerCase()}`);
  }

  const rejected = await prisma.leaveRequest.update({
    where: { id },
    data: { status: "REJECTED", reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: note },
    select: REQUEST_SELECT,
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: request.employee?.branchId,
    action: "leave.reject",
    entityType: "LeaveRequest",
    entityId: id,
    changes: { employeeCode: request.employee?.employeeCode, note },
  });

  return rejected;
}

/**
 * Cancels leave and gives the balance back.
 *
 * Only approved leave returns days: a pending request never consumed any, and
 * returning days for it would quietly inflate the balance.
 */
export async function cancelLeave(id, { reason = null, actor }) {
  const request = await loadRequest(id);

  if (["CANCELLED", "REJECTED"].includes(request.status)) {
    throw ApiError.conflict(`That request is already ${request.status.toLowerCase()}`);
  }

  const year = new Date(request.startDate).getUTCFullYear();

  const cancelled = await withTransaction(async (tx) => {
    if (request.status === "APPROVED") {
      await tx.leaveBalance.updateMany({
        where: { employeeId: request.employeeId, leaveTypeId: request.leaveTypeId, year },
        data: { usedDays: { decrement: D(request.totalDays) } },
      });
    }

    return tx.leaveRequest.update({
      where: { id },
      data: { status: "CANCELLED", reviewNote: reason ?? request.reviewNote },
      select: REQUEST_SELECT,
    });
  });

  if (request.status === "APPROVED") await rederiveLeaveDays(request);

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: request.employee?.branchId,
    action: "leave.cancel",
    entityType: "LeaveRequest",
    entityId: id,
    changes: { employeeCode: request.employee?.employeeCode, wasApproved: request.status === "APPROVED", reason },
  });

  return cancelled;
}

export async function listLeaveRequests({ employeeId, branchId, status, leaveTypeId, from, to, limit = 20, cursor } = {}) {
  const rows = await prisma.leaveRequest.findMany({
    where: {
      ...(employeeId ? { employeeId } : {}),
      ...(branchId ? { employee: { branchId } } : {}),
      ...(status ? { status } : {}),
      ...(leaveTypeId ? { leaveTypeId } : {}),
      ...(from || to
        ? { startDate: { ...(from ? { gte: startOfDay(from) } : {}), ...(to ? { lte: startOfDay(to) } : {}) } }
        : {}),
    },
    select: REQUEST_SELECT,
    orderBy: { startDate: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

// --- holidays ---------------------------------------------------------------

export async function listHolidays({ branchId, year } = {}) {
  const window = year
    ? { gte: new Date(Date.UTC(year, 0, 1)), lte: new Date(Date.UTC(year, 11, 31)) }
    : undefined;

  return prisma.holiday.findMany({
    where: {
      // A company-wide holiday has a null branch and applies to every branch.
      ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {}),
      ...(window ? { date: window } : {}),
    },
    select: { id: true, branchId: true, name: true, date: true, isPaid: true },
    orderBy: { date: "asc" },
  });
}

export async function createHoliday(data, actor = null) {
  const date = startOfDay(data.date);

  const existing = await prisma.holiday.findFirst({
    where: { branchId: data.branchId ?? null, date, name: data.name },
    select: { id: true },
  });
  if (existing) throw ApiError.conflict(`${data.name} is already on the calendar for that date`);

  const holiday = await prisma.holiday.create({
    data: {
      branchId: data.branchId ?? null,
      name: data.name,
      date,
      isPaid: data.isPaid ?? true,
    },
    select: { id: true, branchId: true, name: true, date: true, isPaid: true },
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: data.branchId ?? null,
    action: "holiday.create",
    entityType: "Holiday",
    entityId: holiday.id,
    changes: { name: holiday.name, date: holiday.date, isPaid: holiday.isPaid },
  });

  return holiday;
}

export async function deleteHoliday(id, actor = null) {
  const holiday = await prisma.holiday.findUnique({
    where: { id },
    select: { id: true, name: true, date: true, branchId: true },
  });
  if (!holiday) throw ApiError.notFound("Holiday not found");

  await prisma.holiday.delete({ where: { id } });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: holiday.branchId,
    action: "holiday.delete",
    entityType: "Holiday",
    entityId: id,
    changes: { name: holiday.name, date: holiday.date },
  });

  return { id, deleted: true };
}
