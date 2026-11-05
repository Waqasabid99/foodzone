import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { logger } from "@/lib/logger";
import { addDays, workDateForPunch, zonedDateOf } from "@/server/attendance/shift";
import { recordSync } from "@/server/services/attendance-device.service";
import { branchFilter } from "@/server/hr/access";

/**
 * Punch ingestion.
 *
 * Punches are **raw, append-only and never edited**. The terminal's record of
 * when somebody arrived is evidence; a system that lets it be rewritten is not
 * an attendance system, it is a spreadsheet with extra steps. Corrections are
 * MANUAL punches added alongside, and the day is re-derived from all of them.
 *
 * Two properties matter more than anything else here:
 *
 *   * **De-duplication on `(deviceId, deviceLogId)`.** Terminals keep a local
 *     buffer and replay it after any network wobble, so the same punch arrives
 *     repeatedly. Without the unique key a re-sync doubles everybody's hours.
 *   * **An unknown biometric id is kept, not dropped.** Enrolment mistakes are
 *     routine — somebody is added to the device before HR creates their record.
 *     Discarding those punches loses real attendance that nobody can recover;
 *     storing them unlinked means the day they are matched, the history is
 *     still there.
 */

const SELECT = {
  id: true,
  deviceId: true,
  employeeId: true,
  biometricId: true,
  deviceLogId: true,
  punchedAt: true,
  direction: true,
  method: true,
  note: true,
  isProcessed: true,
  createdById: true,
  createdAt: true,
  employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true, branchId: true } },
  device: { select: { id: true, name: true, serialNumber: true } },
};

/** How many punches one push may carry. A terminal's buffer is rarely bigger. */
export const MAX_BATCH = 1000;

/**
 * Ingests a batch from a device.
 *
 * Returns counts rather than throwing on a partial failure: a device that gets
 * an error for a batch of 200 because one row was malformed will retry the
 * whole batch for ever. Accepting what is valid and reporting the rest is the
 * only behaviour that converges.
 */
export async function ingestPunches({ device, punches, actor = null }) {
  if (!Array.isArray(punches) || punches.length === 0) {
    return { accepted: 0, duplicates: 0, unmatched: 0, rejected: 0, cursor: device.lastLogCursor ?? null };
  }
  if (punches.length > MAX_BATCH) {
    throw ApiError.validation(`That is ${punches.length} punches`, {
      punches: [`Send at most ${MAX_BATCH} at a time`],
    });
  }

  // One lookup for the whole batch rather than one per punch.
  const biometricIds = [...new Set(punches.map((punch) => punch.biometricId).filter(Boolean))];
  const employees = biometricIds.length
    ? await prisma.employee.findMany({
        where: { biometricId: { in: biometricIds } },
        select: { id: true, biometricId: true, status: true, employeeCode: true },
      })
    : [];
  const byBiometric = new Map(employees.map((employee) => [employee.biometricId, employee]));

  let accepted = 0;
  let duplicates = 0;
  let unmatched = 0;
  let rejected = 0;
  let cursor = device.lastLogCursor ?? null;

  for (const punch of punches) {
    const punchedAt = new Date(punch.punchedAt);

    if (Number.isNaN(punchedAt.getTime())) {
      rejected += 1;
      continue;
    }

    // A terminal with a wrong clock can report next year. Better refused than
    // folded into a day that has already been paid.
    if (punchedAt > new Date(Date.now() + 86_400_000)) {
      logger.warn("punch from the future rejected", { deviceId: device.id, punchedAt: punch.punchedAt });
      rejected += 1;
      continue;
    }

    const employee = punch.biometricId ? byBiometric.get(punch.biometricId) : null;
    if (!employee) unmatched += 1;

    try {
      await prisma.attendancePunch.create({
        data: {
          deviceId: device.id,
          employeeId: employee?.id ?? null,
          biometricId: punch.biometricId ?? null,
          deviceLogId: punch.deviceLogId != null ? String(punch.deviceLogId) : null,
          punchedAt,
          direction: punch.direction ?? "UNKNOWN",
          method: punch.method ?? "FINGERPRINT",
          latitude: punch.latitude ?? null,
          longitude: punch.longitude ?? null,
          rawPayload: punch.raw ?? null,
          isProcessed: false,
        },
      });
      accepted += 1;
    } catch (error) {
      // The unique key did its job: this punch is already in.
      if (error?.code === "P2002") {
        duplicates += 1;
      } else {
        throw error;
      }
    }

    if (punch.deviceLogId != null) {
      const value = String(punch.deviceLogId);
      // Cursors are compared as numbers when they look like numbers, because
      // "10" sorts before "9" as a string and would rewind the device.
      const numeric = Number(value);
      const currentNumeric = cursor != null ? Number(cursor) : Number.NaN;
      if (Number.isFinite(numeric) && Number.isFinite(currentNumeric)) {
        if (numeric > currentNumeric) cursor = value;
      } else if (cursor == null || value > cursor) {
        cursor = value;
      }
    }
  }

  await recordSync({ deviceId: device.id, cursor, status: "ONLINE", punchCount: accepted });

  return { accepted, duplicates, unmatched, rejected, cursor };
}

/**
 * A punch typed by a supervisor.
 *
 * The correction path. It is a punch like any other so derivation treats it
 * identically, but it is marked MANUAL and carries who added it — a manual
 * punch is somebody vouching for an employee's hours, and that should have a
 * name against it.
 */
/**
 * The day a punch will be filed under, asked the way derivation asks it.
 *
 * Not the calendar date of the instant. A punch at 02:00 closes the night
 * shift that began yesterday, and east of Greenwich the instant's UTC date is
 * not even the branch's date for most of the evening. Anything that reads the
 * clock instead of the roster is looking at a different day from the one the
 * punch will land on — which, for the lock check below, means refusing a
 * correction to an open day or waving one into a day already paid.
 */
async function rosteredWorkDate({ employeeId, at, timezone, tx = prisma }) {
  const local = zonedDateOf(at, timezone);

  const assignments = await tx.shiftAssignment.findMany({
    where: { employeeId, workDate: { gte: addDays(local, -1), lte: addDays(local, 1) } },
    select: {
      workDate: true,
      isWeeklyOff: true,
      shift: { select: { id: true, startMinute: true, endMinute: true, graceMinutes: true } },
    },
  });

  return workDateForPunch({ punchedAt: at, assignments, timezone }).workDate;
}

export async function addManualPunch({ employeeId, punchedAt, direction = "UNKNOWN", note = null, actor }) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    // The branch's timezone, because which day a punch belongs to is a
    // question about the branch's clock, not the server's.
    select: { id: true, employeeCode: true, branchId: true, status: true, branch: { select: { timezone: true } } },
  });
  if (!employee) throw ApiError.validation("Employee not found", { employeeId: ["No such employee"] });

  const at = new Date(punchedAt);
  if (Number.isNaN(at.getTime())) {
    throw ApiError.validation("That is not a time", { punchedAt: ["Give a valid date and time"] });
  }

  const workDate = await rosteredWorkDate({ employeeId, at, timezone: employee.branch?.timezone ?? "UTC" });

  const locked = await prisma.attendanceDay.findUnique({
    where: { employeeId_workDate: { employeeId, workDate } },
    select: { isLocked: true, workDate: true },
  });
  if (locked?.isLocked) {
    // The day is inside a generated payslip. Changing it now would make the
    // payslip disagree with the attendance it claims to be based on.
    throw ApiError.conflict("That day has already been paid and is locked", {
      workDate: locked.workDate,
      hint: "Raise an adjustment in the next payroll period instead",
    });
  }

  const punch = await prisma.attendancePunch.create({
    data: {
      employeeId,
      biometricId: null,
      deviceId: null,
      punchedAt: at,
      direction,
      method: "MANUAL",
      note,
      createdById: actor?.userId ?? null,
      isProcessed: false,
    },
    select: SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: employee.branchId,
    action: "attendance_punch.manual",
    entityType: "Employee",
    entityId: employeeId,
    changes: { employeeCode: employee.employeeCode, punchedAt: at, direction, note },
  });

  return punch;
}

/**
 * Punches that arrived for a biometric id nobody is enrolled to.
 *
 * The queue that HR has to work: every row here is somebody whose attendance is
 * being recorded and not counted.
 */
export async function unmatchedPunches({ deviceId, branchId, from, to, scope = null, limit = 50, cursor } = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.attendancePunch.findMany({
    where: {
      employeeId: null,
      ...(deviceId ? { deviceId } : {}),
      ...(branchId ? { device: { branchId } } : {}),
      // No employee to scope by, so the terminal's branch is what places it.
      ...(filter ? { AND: [{ device: { branchId: filter } }] } : {}),
      ...(from || to
        ? { punchedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: SELECT,
    orderBy: { punchedAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);

  // Grouped by the id the device sent, because the fix is per-person: enrol
  // this biometric id to that employee and every one of their punches links.
  const byBiometric = new Map();
  for (const punch of page.items) {
    const key = punch.biometricId ?? "(none)";
    const bucket = byBiometric.get(key) ?? { biometricId: punch.biometricId, count: 0, firstSeen: punch.punchedAt, lastSeen: punch.punchedAt };
    bucket.count += 1;
    if (punch.punchedAt < bucket.firstSeen) bucket.firstSeen = punch.punchedAt;
    if (punch.punchedAt > bucket.lastSeen) bucket.lastSeen = punch.punchedAt;
    byBiometric.set(key, bucket);
  }

  return { ...page, byBiometric: [...byBiometric.values()].sort((a, b) => b.count - a.count) };
}

/**
 * Links orphaned punches to an employee.
 *
 * Run after enrolling a biometric id that had been punching unmatched. The
 * punches were always real; this is what makes them count.
 */
export async function claimUnmatchedPunches({ biometricId, employeeId, actor }) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, employeeCode: true, biometricId: true, branchId: true },
  });
  if (!employee) throw ApiError.validation("Employee not found", { employeeId: ["No such employee"] });

  const result = await withTransaction(async (tx) => {
    // Enrol the id too, so future punches match on arrival.
    if (employee.biometricId !== biometricId) {
      const clash = await tx.employee.findUnique({ where: { biometricId }, select: { id: true, employeeCode: true } });
      if (clash && clash.id !== employeeId) {
        throw ApiError.conflict(`${biometricId} is already enrolled to ${clash.employeeCode}`);
      }
      await tx.employee.update({ where: { id: employeeId }, data: { biometricId } });
    }

    return tx.attendancePunch.updateMany({
      where: { biometricId, employeeId: null },
      // Re-derivation has to run again for the days these land on.
      data: { employeeId, isProcessed: false },
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: employee.branchId,
    action: "attendance_punch.claim",
    entityType: "Employee",
    entityId: employeeId,
    changes: { biometricId, claimed: result.count, employeeCode: employee.employeeCode },
  });

  return { employeeId, biometricId, claimed: result.count };
}

export async function listPunches({ employeeId, deviceId, branchId, from, to, scope = null, limit = 50, cursor } = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.attendancePunch.findMany({
    where: {
      ...(employeeId ? { employeeId } : {}),
      ...(deviceId ? { deviceId } : {}),
      ...(branchId ? { employee: { branchId } } : {}),
      // An unlinked punch has no employee, so either end may place it.
      ...(filter
        ? { AND: [{ OR: [{ employee: { branchId: filter } }, { device: { branchId: filter } }] }] }
        : {}),
      ...(from || to
        ? { punchedAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to) } : {}) } }
        : {}),
    },
    select: SELECT,
    orderBy: { punchedAt: "desc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}
