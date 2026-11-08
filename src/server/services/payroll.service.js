import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { logger } from "@/lib/logger";
import { money } from "@/server/accounting/balance";
import { enqueue } from "@/server/jobs/outbox";
import { branchFilter } from "@/server/hr/access";
import { buildPayslip } from "@/server/attendance/payroll";
import { summariseDays } from "@/server/attendance/derive";
import { daysBetween, startOfDay } from "@/server/attendance/shift";
import { activeComponents } from "@/server/services/employee.service";
import { getSettings } from "@/server/services/setting.service";

/**
 * Payroll.
 *
 * The end of everything the attendance module does, and the point at which
 * getting it wrong costs real money to real people. Four rules:
 *
 *   * **Payroll reads `AttendanceDay`, never punches.** The day is the row a
 *     supervisor corrected and approved; paying from raw punches would pay what
 *     the terminal recorded rather than what a human confirmed, and would
 *     silently discard every correction.
 *   * **Generating a payslip locks the days it paid.** Otherwise a later
 *     re-derivation changes the attendance a payslip claims to be based on, and
 *     the two disagree with no way to tell which is right.
 *   * **Approval and payment are separate from generation.** Generating is a
 *     calculation and can be re-run; approving is a commitment and posts to the
 *     ledger; marking paid records that money actually left.
 *   * **Re-running generation replaces draft payslips.** Payroll is iterative —
 *     somebody fixes an attendance day and runs it again — so a draft period
 *     regenerates cleanly rather than accumulating duplicates.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

const PAYSLIP_SELECT = {
  id: true,
  periodId: true,
  employeeId: true,
  payableDays: true,
  presentDays: true,
  leaveDays: true,
  absentDays: true,
  workedMinutes: true,
  overtimeMinutes: true,
  grossAmount: true,
  deductionAmount: true,
  netAmount: true,
  status: true,
  paidAt: true,
  paymentReference: true,
  notes: true,
  employee: {
    select: { id: true, employeeCode: true, firstName: true, lastName: true, salaryType: true, currency: true },
  },
  lines: {
    select: {
      id: true, code: true, label: true, isEarning: true, quantity: true, rate: true, amount: true,
      account: { select: { id: true, code: true, name: true } },
    },
    orderBy: { id: "asc" },
  },
};

const PERIOD_SELECT = {
  id: true,
  branchId: true,
  name: true,
  startDate: true,
  endDate: true,
  payDate: true,
  status: true,
  totalGross: true,
  totalDeductions: true,
  totalNet: true,
  processedById: true,
  approvedById: true,
  approvedAt: true,
  createdAt: true,
  _count: { select: { payslips: true } },
};

function shapePeriod(period) {
  const { _count, ...row } = period;
  return { ...row, payslipCount: _count?.payslips ?? 0 };
}

export async function createPayrollPeriod(data, actor = null) {
  const startDate = startOfDay(data.startDate);
  const endDate = startOfDay(data.endDate);

  if (endDate < startDate) {
    throw ApiError.validation("The period ends before it starts", { endDate: ["Must be after the start"] });
  }

  const existing = await prisma.payrollPeriod.findFirst({
    where: { branchId: data.branchId ?? null, startDate, endDate },
    select: { id: true, name: true, status: true },
  });
  if (existing) {
    throw ApiError.conflict(`${existing.name} already covers those dates`, { periodId: existing.id });
  }

  // Overlapping periods would pay the same day twice.
  const overlapping = await prisma.payrollPeriod.findFirst({
    where: {
      branchId: data.branchId ?? null,
      status: { not: "CANCELLED" },
      startDate: { lte: endDate },
      endDate: { gte: startDate },
    },
    select: { id: true, name: true },
  });
  if (overlapping) {
    throw ApiError.conflict(`Those dates overlap ${overlapping.name}`, { periodId: overlapping.id });
  }

  const period = await prisma.payrollPeriod.create({
    data: {
      branchId: data.branchId ?? null,
      name: data.name,
      startDate,
      endDate,
      payDate: data.payDate ? startOfDay(data.payDate) : null,
      status: "DRAFT",
    },
    select: PERIOD_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: data.branchId ?? null,
    action: "payroll_period.create",
    entityType: "PayrollPeriod",
    entityId: period.id,
    changes: { name: period.name, from: startDate, to: endDate },
  });

  return shapePeriod(period);
}

async function loadPeriod(id) {
  const period = await prisma.payrollPeriod.findUnique({ where: { id }, select: PERIOD_SELECT });
  if (!period) throw ApiError.notFound("Payroll period not found");
  return period;
}

export async function getPayrollPeriod(id) {
  return shapePeriod(await loadPeriod(id));
}

/**
 * Generates payslips for everyone in the period.
 *
 * Re-runnable while the period is a draft: existing draft payslips are replaced
 * so a corrected attendance day flows straight through. Once the period is
 * approved, generation is refused — the figures have been committed.
 */
export async function generatePayroll(id, { employeeIds = null, actor }) {
  const period = await loadPeriod(id);

  if (!["DRAFT", "PROCESSING"].includes(period.status)) {
    throw ApiError.conflict(`A ${period.status.toLowerCase()} period cannot be regenerated`, {
      status: period.status,
      hint: "Cancel it and create a new period instead",
    });
  }

  const periodDays = daysBetween(period.startDate, period.endDate);

  const employees = await prisma.employee.findMany({
    where: {
      ...(employeeIds ? { id: { in: employeeIds } } : {}),
      ...(period.branchId ? { branchId: period.branchId } : {}),
      status: { notIn: ["RESIGNED", "TERMINATED"] },
      // Somebody who joined after the period ended has nothing to be paid for.
      joinedAt: { lte: period.endDate },
    },
    select: {
      id: true,
      employeeCode: true,
      salaryType: true,
      baseSalary: true,
      hourlyRate: true,
      overtimeMultiplier: true,
      currency: true,
    },
  });

  const results = { generated: 0, skipped: [], totalGross: D(0), totalDeductions: D(0), totalNet: D(0) };

  for (const employee of employees) {
    const days = await prisma.attendanceDay.findMany({
      where: {
        employeeId: employee.id,
        workDate: { gte: period.startDate, lte: period.endDate },
      },
      select: {
        id: true,
        status: true,
        workedMinutes: true,
        overtimeMinutes: true,
        lateMinutes: true,
        payableFactor: true,
        approvedAt: true,
      },
    });

    if (!days.length) {
      results.skipped.push({ employeeId: employee.id, employeeCode: employee.employeeCode, reason: "NO_ATTENDANCE" });
      continue;
    }

    const attendance = summariseDays(days);
    const components = await activeComponents({
      employeeId: employee.id,
      periodStart: period.startDate,
      periodEnd: period.endDate,
    });

    const slip = buildPayslip({
      employee,
      attendance: {
        payableDays: attendance.payableDays,
        workedMinutes: attendance.workedMinutes,
        overtimeMinutes: attendance.overtimeMinutes,
      },
      components,
      periodDays,
      periodStart: period.startDate,
      periodEnd: period.endDate,
    });

    await withTransaction(async (tx) => {
      const existing = await tx.payslip.findUnique({
        where: { periodId_employeeId: { periodId: id, employeeId: employee.id } },
        select: { id: true, status: true },
      });

      // A payslip already approved or paid is not regenerated: somebody has
      // committed to it, and in the paid case the money has gone.
      if (existing && !["DRAFT", "PROCESSING"].includes(existing.status)) {
        results.skipped.push({
          employeeId: employee.id,
          employeeCode: employee.employeeCode,
          reason: `ALREADY_${existing.status}`,
        });
        return;
      }

      if (existing) {
        await tx.payslipLine.deleteMany({ where: { payslipId: existing.id } });
        await tx.payslip.delete({ where: { id: existing.id } });
      }

      await tx.payslip.create({
        data: {
          periodId: id,
          employeeId: employee.id,
          payableDays: attendance.payableDays,
          presentDays: attendance.presentDays,
          leaveDays: attendance.leaveDays,
          absentDays: attendance.absentDays,
          workedMinutes: attendance.workedMinutes,
          overtimeMinutes: attendance.overtimeMinutes,
          grossAmount: slip.grossAmount,
          deductionAmount: slip.deductionAmount,
          netAmount: slip.netAmount,
          status: "DRAFT",
          lines: {
            create: slip.lines.map((line) => ({
              code: line.code,
              label: line.label,
              isEarning: line.isEarning,
              quantity: line.quantity != null ? D(line.quantity) : null,
              rate: line.rate != null ? D(line.rate) : null,
              amount: line.amount,
              accountId: line.accountId ?? null,
            })),
          },
        },
      });

      results.generated += 1;
      results.totalGross = results.totalGross.plus(D(slip.grossAmount));
      results.totalDeductions = results.totalDeductions.plus(D(slip.deductionAmount));
      results.totalNet = results.totalNet.plus(D(slip.netAmount));
    });
  }

  const updated = await prisma.payrollPeriod.update({
    where: { id },
    data: {
      status: "PROCESSING",
      processedById: actor?.userId ?? null,
      totalGross: money(results.totalGross),
      totalDeductions: money(results.totalDeductions),
      totalNet: money(results.totalNet),
    },
    select: PERIOD_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: period.branchId,
    action: "payroll.generate",
    entityType: "PayrollPeriod",
    entityId: id,
    changes: {
      name: period.name,
      generated: results.generated,
      skipped: results.skipped.length,
      totalNet: Number(results.totalNet),
    },
  });

  return {
    ...shapePeriod(updated),
    generated: results.generated,
    skipped: results.skipped,
    periodDays,
  };
}

/**
 * Approves the period and posts it.
 *
 * This is the commitment, so it is also when the attendance days it paid are
 * locked and when the ledger hears about it. Locking here rather than at
 * generation is deliberate: a draft can be regenerated freely, and freezing
 * attendance before anybody has agreed the numbers would block the corrections
 * that generation exists to pick up.
 */
export async function approvePayroll(id, actor) {
  const period = await loadPeriod(id);

  if (period.status !== "PROCESSING") {
    throw ApiError.conflict(
      period.status === "DRAFT"
        ? "Generate the payslips before approving the period"
        : `A ${period.status.toLowerCase()} period cannot be approved`,
      { status: period.status },
    );
  }

  const payslips = await prisma.payslip.count({ where: { periodId: id } });
  if (payslips === 0) {
    throw ApiError.conflict("There are no payslips in this period", { hint: "Generate them first" });
  }

  // Two people on the payroll. Checked on identity rather than permissions,
  // because the seeded HR manager holds `payroll.*` and a super admin holds
  // everything — so a permission test would let exactly the people this is
  // about approve their own run.
  const settings = await getSettings({ branchId: period.branchId });
  const needsSecondPerson = settings["payroll.require_separate_approver"] ?? true;
  const selfApproving = Boolean(period.processedById) && period.processedById === actor.userId;

  if (needsSecondPerson && selfApproving) {
    throw ApiError.forbidden("Payroll has to be approved by somebody other than the person who ran it", {
      processedById: period.processedById,
      setting: "payroll.require_separate_approver",
    });
  }

  const approved = await withTransaction(async (tx) => {
    // Freeze the attendance the payslips were built from.
    const locked = await tx.attendanceDay.updateMany({
      where: {
        workDate: { gte: period.startDate, lte: period.endDate },
        ...(period.branchId ? { branchId: period.branchId } : {}),
        employeeId: { in: (await tx.payslip.findMany({ where: { periodId: id }, select: { employeeId: true } })).map((row) => row.employeeId) },
      },
      data: { isLocked: true },
    });

    await tx.payslip.updateMany({ where: { periodId: id }, data: { status: "APPROVED" } });

    const row = await tx.payrollPeriod.update({
      where: { id },
      data: { status: "APPROVED", approvedById: actor.userId, approvedAt: new Date() },
      select: PERIOD_SELECT,
    });

    await enqueue({ eventType: "finance.payroll_approved", payload: { payrollPeriodId: id }, db: tx });

    logger.info("payroll approved", { periodId: id, lockedDays: locked.count });
    return row;
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: period.branchId,
    action: "payroll.approve",
    entityType: "PayrollPeriod",
    entityId: id,
    changes: {
      name: period.name,
      payslips,
      totalNet: Number(period.totalNet),
      // Only ever true where a branch has turned the second person off. It is
      // on the audit entry so the exception is visible without having to know
      // the setting's history.
      ...(selfApproving ? { selfApproved: true } : {}),
    },
  });

  return shapePeriod(approved);
}

/** Records that the money actually left. */
export async function markPayrollPaid(id, { paidAt = new Date(), reference = null, actor }) {
  const period = await loadPeriod(id);

  if (period.status !== "APPROVED") {
    throw ApiError.conflict(`A ${period.status.toLowerCase()} period cannot be marked paid`, {
      status: period.status,
      hint: "Approve it first",
    });
  }

  const paid = await withTransaction(async (tx) => {
    await tx.payslip.updateMany({
      where: { periodId: id },
      data: { status: "PAID", paidAt: new Date(paidAt), paymentReference: reference },
    });

    const row = await tx.payrollPeriod.update({
      where: { id },
      data: { status: "PAID", payDate: startOfDay(paidAt) },
      select: PERIOD_SELECT,
    });

    await enqueue({ eventType: "finance.payroll_paid", payload: { payrollPeriodId: id }, db: tx });
    return row;
  });

  await recordAudit({
    actorId: actor.userId,
    branchId: period.branchId,
    action: "payroll.mark_paid",
    entityType: "PayrollPeriod",
    entityId: id,
    changes: { name: period.name, reference, totalNet: Number(period.totalNet) },
  });

  return shapePeriod(paid);
}

/**
 * Cancels a period and unlocks the attendance it froze.
 *
 * Refused once paid: the money has gone, and a cancelled period would leave the
 * ledger holding an expense with nothing to explain it.
 */
export async function cancelPayroll(id, { reason = null, actor }) {
  const period = await loadPeriod(id);

  if (period.status === "PAID") {
    throw ApiError.conflict("This payroll has been paid and cannot be cancelled", {
      hint: "Correct it with an adjustment in the next period",
    });
  }
  if (period.status === "CANCELLED") return shapePeriod(period);

  const cancelled = await withTransaction(async (tx) => {
    const employeeIds = (await tx.payslip.findMany({ where: { periodId: id }, select: { employeeId: true } })).map(
      (row) => row.employeeId,
    );

    await tx.attendanceDay.updateMany({
      where: {
        employeeId: { in: employeeIds },
        workDate: { gte: period.startDate, lte: period.endDate },
      },
      data: { isLocked: false },
    });

    await tx.payslip.updateMany({ where: { periodId: id }, data: { status: "CANCELLED" } });

    const row = await tx.payrollPeriod.update({
      where: { id },
      data: { status: "CANCELLED" },
      select: PERIOD_SELECT,
    });

    if (period.status === "APPROVED") {
      await enqueue({ eventType: "finance.payroll_cancelled", payload: { payrollPeriodId: id, reason }, db: tx });
    }

    return row;
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: period.branchId,
    action: "payroll.cancel",
    entityType: "PayrollPeriod",
    entityId: id,
    changes: { name: period.name, reason, wasApproved: period.status === "APPROVED" },
  });

  return shapePeriod(cancelled);
}

export async function listPayrollPeriods({ branchId, status, scope = null, limit = 20, cursor } = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.payrollPeriod.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      // A company-wide run has no branch; only somebody unrestricted sees it.
      ...(filter ? { AND: [{ branchId: filter }] } : {}),
      ...(status ? { status } : {}),
    },
    select: PERIOD_SELECT,
    orderBy: { startDate: "desc" },
    ...cursorArgs(cursor, limit),
  });

  const page = toPage(rows, limit);
  return { ...page, items: page.items.map(shapePeriod) };
}

export async function listPayslips({ periodId, employeeId, status, scope = null, limit = 50, cursor } = {}) {
  const filter = branchFilter(scope);
  const rows = await prisma.payslip.findMany({
    where: {
      ...(periodId ? { periodId } : {}),
      ...(employeeId ? { employeeId } : {}),
      // A payslip is somebody's pay: scoped by the branch they work at.
      ...(filter ? { AND: [{ employee: { branchId: filter } }] } : {}),
      ...(status ? { status } : {}),
    },
    select: PAYSLIP_SELECT,
    orderBy: { id: "asc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

export async function getPayslip(id) {
  const payslip = await prisma.payslip.findUnique({ where: { id }, select: PAYSLIP_SELECT });
  if (!payslip) throw ApiError.notFound("Payslip not found");
  return payslip;
}

/**
 * Refuses unless this payslip is the caller's own, and final.
 *
 * The same two rules `myPayslips` lists by, enforced for a single record —
 * because a list endpoint that filters correctly and a detail endpoint that
 * forgets to is the classic way one of these leaks. A draft is excluded even
 * from its own employee: it is not yet a statement of what they are owed.
 */
export async function assertOwnPayslip({ userId, payslipId }) {
  const payslip = await prisma.payslip.findUnique({
    where: { id: payslipId },
    select: { id: true, status: true, employee: { select: { userId: true } } },
  });

  // The same answer for "no such payslip" and "not yours": a stranger probing
  // ids should not learn which ones exist.
  if (!payslip || payslip.employee?.userId !== userId) throw ApiError.notFound("Payslip not found");
  if (!["APPROVED", "PAID"].includes(payslip.status)) throw ApiError.notFound("Payslip not found");

  return payslip;
}

/**
 * The payslip an employee can see: their own.
 *
 * A separate path from `getPayslip` on purpose. Reading anybody's payslip needs
 * `payslips.view_all`; reading your own needs nothing but being you, and
 * conflating the two is how one endpoint ends up leaking the whole payroll.
 */
export async function myPayslips({ userId, limit = 12 }) {
  const employee = await prisma.employee.findUnique({ where: { userId }, select: { id: true } });
  if (!employee) throw ApiError.notFound("No employee record is linked to this account");

  const rows = await prisma.payslip.findMany({
    where: { employeeId: employee.id, status: { in: ["APPROVED", "PAID"] } },
    select: {
      ...PAYSLIP_SELECT,
      period: { select: { id: true, name: true, startDate: true, endDate: true, payDate: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows;
}
