import { prisma } from "@/lib/prisma";
import { branchFilter } from "@/server/hr/access";

/**
 * What the People screens need besides the records themselves: the pickers.
 *
 * Every one of these is scoped the same way the lists are. A picker that
 * offers staff from another branch is a slower version of the same leak — the
 * names are on screen before anything is submitted.
 */

/** Staff who can be rostered, punched for or paid, at the caller's branches. */
export async function employeeOptions(scope, { includeLeft = false, branchId = null } = {}) {
  const filter = branchFilter(scope);

  return prisma.employee.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(includeLeft ? {} : { status: { notIn: ["RESIGNED", "TERMINATED"] } }),
    },
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      status: true,
      branchId: true,
      designation: true,
      biometricId: true,
      department: { select: { id: true, name: true } },
    },
    orderBy: [{ firstName: "asc" }, { employeeCode: "asc" }],
    take: 2000,
  });
}

/** Shifts that can still be rostered onto. */
export async function shiftOptions(scope, { branchId = null, includeInactive = false } = {}) {
  const filter = branchFilter(scope);

  return prisma.shift.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(includeInactive ? {} : { isActive: true }),
    },
    select: { id: true, name: true, branchId: true, startMinute: true, endMinute: true, breakMinutes: true, isActive: true },
    orderBy: [{ startMinute: "asc" }, { name: "asc" }],
    take: 500,
  });
}

export async function departmentOptions({ includeInactive = false } = {}) {
  return prisma.department.findMany({
    where: includeInactive ? {} : { isActive: true },
    select: { id: true, name: true, code: true, isActive: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}

/**
 * Sign-in accounts that are not already somebody's employee record.
 *
 * The link is one-to-one, so offering an account that is taken produces a
 * conflict on save and no explanation of who took it. The employee's own
 * current account is kept in the list so an edit does not appear to clear it.
 */
export async function linkableAccounts({ currentUserId = null } = {}) {
  return prisma.user.findMany({
    where: {
      status: { in: ["ACTIVE", "PENDING_VERIFICATION"] },
      ...(currentUserId ? { OR: [{ employee: { is: null } }, { id: currentUserId }] } : { employee: { is: null } }),
    },
    select: { id: true, name: true, email: true, status: true },
    orderBy: { name: "asc" },
    take: 500,
  });
}

/** The people behind `assignedById`, `approvedById` and the like. */
export async function userNames(ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (!wanted.length) return new Map();

  const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, name: true } });
  return new Map(users.map((user) => [user.id, user.name]));
}

/** How many employees each department holds, including the inactive ones. */
export async function departmentHeads(departments) {
  const ids = departments.map((department) => department.headEmployeeId).filter(Boolean);
  if (!ids.length) return new Map();

  const heads = await prisma.employee.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true, employeeCode: true },
  });
  return new Map(heads.map((head) => [head.id, head]));
}

/**
 * One employee's recent attendance, for their own page.
 *
 * Capped rather than paged: the employee page answers "how have they been
 * doing lately", and the attendance screen answers everything else.
 */
export async function recentAttendance(employeeId, { days = 14 } = {}) {
  return prisma.attendanceDay.findMany({
    where: { employeeId },
    select: {
      id: true,
      workDate: true,
      status: true,
      firstInAt: true,
      lastOutAt: true,
      workedMinutes: true,
      overtimeMinutes: true,
      lateMinutes: true,
      payableFactor: true,
      isManualOverride: true,
      approvedAt: true,
      isLocked: true,
      shift: { select: { id: true, name: true } },
    },
    orderBy: { workDate: "desc" },
    take: days,
  });
}

/** The roster rows for one employee from today forward — what they work next. */
export async function upcomingShifts(employeeId, { from, days = 14 } = {}) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + days);

  return prisma.shiftAssignment.findMany({
    where: { employeeId, workDate: { gte: start, lt: end } },
    select: {
      id: true,
      workDate: true,
      isWeeklyOff: true,
      shift: { select: { id: true, name: true, startMinute: true, endMinute: true } },
    },
    orderBy: { workDate: "asc" },
  });
}

/** The punches behind one attendance day, widened for a night shift. */
export async function punchesForDay({ employeeId, workDate }) {
  const day = new Date(`${workDate}T00:00:00Z`);
  const from = new Date(day);
  from.setUTCDate(from.getUTCDate() - 1);
  const to = new Date(day);
  to.setUTCDate(to.getUTCDate() + 2);

  return prisma.attendancePunch.findMany({
    where: { employeeId, punchedAt: { gte: from, lt: to } },
    select: {
      id: true,
      punchedAt: true,
      direction: true,
      method: true,
      note: true,
      isProcessed: true,
      createdById: true,
      device: { select: { id: true, name: true } },
    },
    orderBy: { punchedAt: "asc" },
  });
}

/** How many employees at these branches have no biometric id enrolled yet. */
export async function unenrolledCount(scope) {
  const filter = branchFilter(scope);

  return prisma.employee.count({
    where: {
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      status: { notIn: ["RESIGNED", "TERMINATED"] },
      biometricId: null,
    },
  });
}
