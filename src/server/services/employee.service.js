import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { Prisma } from "@/generated/prisma";
import { cursorArgs, toPage } from "@/lib/api/pagination";
import { withTransaction } from "@/server/utils/db";
import { recordAudit } from "@/server/utils/audit";
import { money } from "@/server/accounting/balance";

/**
 * Departments, employees and what they are paid.
 *
 * Two things shape this module:
 *
 *   * **An employee is not a user.** Staff sign in with the same `User` account
 *     they hold roles on, but plenty of employees never sign in at all — a
 *     kitchen porter who only exists to be rostered and paid. Linking the two
 *     is optional, and one user maps to at most one employee.
 *   * **Salary is behind its own permission.** `employees.read` shows who works
 *     here; `employees.view_salary` shows what they earn. A shift supervisor
 *     needs the first and must not have the second, and mixing them means
 *     everybody who can build a roster can read the payroll.
 *
 * An employee who has ever been rostered, punched or paid is never deleted —
 * those rows are the record of work done. Exit is a status.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);

/** Everything except pay. */
const BASE_SELECT = {
  id: true,
  userId: true,
  employeeCode: true,
  branchId: true,
  departmentId: true,
  designation: true,
  employmentType: true,
  status: true,
  firstName: true,
  lastName: true,
  personalEmail: true,
  phone: true,
  dateOfBirth: true,
  address: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  photoUrl: true,
  biometricId: true,
  joinedAt: true,
  confirmedAt: true,
  exitedAt: true,
  exitReason: true,
  createdAt: true,
  department: { select: { id: true, name: true, code: true } },
  branch: { select: { id: true, name: true, code: true } },
  user: { select: { id: true, name: true, email: true, status: true } },
};

const SALARY_SELECT = {
  salaryType: true,
  baseSalary: true,
  hourlyRate: true,
  overtimeMultiplier: true,
  currency: true,
  bankAccountName: true,
  bankAccountNumber: true,
  bankIfsc: true,
  taxIdentifier: true,
  salaryComponents: {
    select: {
      id: true,
      name: true,
      isEarning: true,
      amount: true,
      percentOfBase: true,
      isTaxable: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
    orderBy: { effectiveFrom: "desc" },
  },
};

function selectFor({ includeSalary = false } = {}) {
  return includeSalary ? { ...BASE_SELECT, ...SALARY_SELECT } : BASE_SELECT;
}

// --- departments ------------------------------------------------------------

const DEPARTMENT_SELECT = {
  id: true,
  name: true,
  code: true,
  headEmployeeId: true,
  isActive: true,
  _count: { select: { employees: true } },
};

export async function listDepartments({ isActive } = {}) {
  const rows = await prisma.department.findMany({
    where: { ...(isActive != null ? { isActive } : {}) },
    select: DEPARTMENT_SELECT,
    orderBy: { name: "asc" },
  });

  return rows.map(({ _count, ...row }) => ({ ...row, employeeCount: _count.employees }));
}

export async function createDepartment(data, actor = null) {
  const clash = await prisma.department.findFirst({
    where: { OR: [{ name: data.name }, { code: data.code }] },
    select: { id: true, name: true, code: true },
  });
  if (clash) {
    throw ApiError.conflict(
      clash.code === data.code ? `Department code ${data.code} is taken` : `A department called ${data.name} exists`,
    );
  }

  const department = await prisma.department.create({
    data: { name: data.name, code: data.code, isActive: data.isActive ?? true },
    select: DEPARTMENT_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "department.create",
    entityType: "Department",
    entityId: department.id,
    changes: { name: department.name, code: department.code },
  });

  return { ...department, employeeCount: 0 };
}

export async function updateDepartment(id, data, actor = null) {
  const department = await prisma.department.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!department) throw ApiError.notFound("Department not found");

  if (data.headEmployeeId) {
    const head = await prisma.employee.findUnique({
      where: { id: data.headEmployeeId },
      select: { id: true, departmentId: true, firstName: true },
    });
    if (!head) throw ApiError.validation("Employee not found", { headEmployeeId: ["No such employee"] });
  }

  if (data.isActive === false) {
    const staff = await prisma.employee.count({ where: { departmentId: id, status: "ACTIVE" } });
    if (staff > 0) {
      throw ApiError.conflict(`${staff} active employee(s) are still in this department`, {
        hint: "Move them to another department first",
      });
    }
  }

  const updated = await prisma.department.update({
    where: { id },
    data: {
      ...(data.name != null ? { name: data.name } : {}),
      ...(data.code != null ? { code: data.code } : {}),
      ...(data.headEmployeeId !== undefined ? { headEmployeeId: data.headEmployeeId } : {}),
      ...(data.isActive != null ? { isActive: data.isActive } : {}),
    },
    select: DEPARTMENT_SELECT,
  });

  const { _count, ...row } = updated;
  return { ...row, employeeCount: _count.employees };
}

// --- employees --------------------------------------------------------------

async function nextEmployeeCode(tx, { branch }) {
  const count = await tx.employee.count({ where: { branchId: branch.id } });
  const code = `${branch.code}-${String(count + 1).padStart(4, "0")}`;

  // A branch that has had leavers can collide on the count, so step past any
  // code already taken rather than failing on the unique constraint.
  let candidate = code;
  let suffix = count + 1;
  while (await tx.employee.findUnique({ where: { employeeCode: candidate }, select: { id: true } })) {
    suffix += 1;
    candidate = `${branch.code}-${String(suffix).padStart(4, "0")}`;
  }

  return candidate;
}

export async function createEmployee(data, actor = null) {
  const branch = await prisma.branch.findUnique({
    where: { id: data.branchId },
    select: { id: true, code: true, currency: true },
  });
  if (!branch) throw ApiError.validation("Branch not found", { branchId: ["No such branch"] });

  if (data.userId) {
    const user = await prisma.user.findUnique({
      where: { id: data.userId },
      select: { id: true, employee: { select: { id: true, employeeCode: true } } },
    });
    if (!user) throw ApiError.validation("User not found", { userId: ["No such user"] });
    if (user.employee) {
      throw ApiError.conflict(`That account is already employee ${user.employee.employeeCode}`, {
        employeeId: user.employee.id,
      });
    }
  }

  if (data.biometricId) {
    const enrolled = await prisma.employee.findUnique({
      where: { biometricId: data.biometricId },
      select: { id: true, employeeCode: true },
    });
    if (enrolled) {
      // Two people sharing a biometric id means every punch is attributed to
      // whichever of them the lookup happens to find.
      throw ApiError.conflict(`Biometric id ${data.biometricId} is already enrolled to ${enrolled.employeeCode}`);
    }
  }

  if (data.departmentId) {
    const department = await prisma.department.findUnique({
      where: { id: data.departmentId },
      select: { id: true, isActive: true, name: true },
    });
    if (!department) throw ApiError.validation("Department not found", { departmentId: ["No such department"] });
    if (!department.isActive) {
      throw ApiError.validation(`${department.name} is not active`, { departmentId: ["Choose another department"] });
    }
  }

  const employee = await withTransaction(async (tx) => {
    const employeeCode = data.employeeCode ?? (await nextEmployeeCode(tx, { branch }));

    return tx.employee.create({
      data: {
        employeeCode,
        userId: data.userId ?? null,
        branchId: data.branchId,
        departmentId: data.departmentId ?? null,
        designation: data.designation ?? null,
        employmentType: data.employmentType ?? "FULL_TIME",
        status: "ACTIVE",
        firstName: data.firstName,
        lastName: data.lastName ?? null,
        personalEmail: data.personalEmail ?? null,
        phone: data.phone ?? null,
        dateOfBirth: data.dateOfBirth ?? null,
        address: data.address ?? null,
        emergencyContactName: data.emergencyContactName ?? null,
        emergencyContactPhone: data.emergencyContactPhone ?? null,
        photoUrl: data.photoUrl ?? null,
        biometricId: data.biometricId ?? null,
        salaryType: data.salaryType ?? "MONTHLY",
        baseSalary: money(data.baseSalary ?? 0),
        hourlyRate: data.hourlyRate != null ? money(data.hourlyRate) : null,
        overtimeMultiplier: D(data.overtimeMultiplier ?? 1.5),
        currency: data.currency ?? branch.currency ?? "PKR",
        bankAccountName: data.bankAccountName ?? null,
        bankAccountNumber: data.bankAccountNumber ?? null,
        bankIfsc: data.bankIfsc ?? null,
        taxIdentifier: data.taxIdentifier ?? null,
        joinedAt: data.joinedAt ? new Date(data.joinedAt) : new Date(),
      },
      select: selectFor({ includeSalary: true }),
    });
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: data.branchId,
    action: "employee.create",
    entityType: "Employee",
    entityId: employee.id,
    changes: { employeeCode: employee.employeeCode, name: `${employee.firstName} ${employee.lastName ?? ""}`.trim() },
  });

  return employee;
}

async function loadEmployee(id, options) {
  const employee = await prisma.employee.findUnique({ where: { id }, select: selectFor(options) });
  if (!employee) throw ApiError.notFound("Employee not found");
  return employee;
}

export async function getEmployee(id, { includeSalary = false } = {}) {
  return loadEmployee(id, { includeSalary });
}

/**
 * Edits an employee.
 *
 * Pay fields are split out deliberately: `updateEmployee` cannot touch them at
 * all, so the endpoint that lets a supervisor fix a phone number can be open
 * to supervisors without also letting them award a raise.
 */
export async function updateEmployee(id, data, actor = null) {
  const employee = await loadEmployee(id);

  if (data.biometricId && data.biometricId !== employee.biometricId) {
    const enrolled = await prisma.employee.findUnique({
      where: { biometricId: data.biometricId },
      select: { id: true, employeeCode: true },
    });
    if (enrolled && enrolled.id !== id) {
      throw ApiError.conflict(`Biometric id ${data.biometricId} is already enrolled to ${enrolled.employeeCode}`);
    }
  }

  const updated = await prisma.employee.update({
    where: { id },
    data: {
      ...(data.departmentId !== undefined ? { departmentId: data.departmentId } : {}),
      ...(data.designation !== undefined ? { designation: data.designation } : {}),
      ...(data.employmentType != null ? { employmentType: data.employmentType } : {}),
      ...(data.firstName != null ? { firstName: data.firstName } : {}),
      ...(data.lastName !== undefined ? { lastName: data.lastName } : {}),
      ...(data.personalEmail !== undefined ? { personalEmail: data.personalEmail } : {}),
      ...(data.phone !== undefined ? { phone: data.phone } : {}),
      ...(data.dateOfBirth !== undefined ? { dateOfBirth: data.dateOfBirth } : {}),
      ...(data.address !== undefined ? { address: data.address } : {}),
      ...(data.emergencyContactName !== undefined ? { emergencyContactName: data.emergencyContactName } : {}),
      ...(data.emergencyContactPhone !== undefined ? { emergencyContactPhone: data.emergencyContactPhone } : {}),
      ...(data.photoUrl !== undefined ? { photoUrl: data.photoUrl } : {}),
      ...(data.biometricId !== undefined ? { biometricId: data.biometricId } : {}),
      ...(data.userId !== undefined ? { userId: data.userId } : {}),
    },
    select: BASE_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: employee.branchId,
    action: "employee.update",
    entityType: "Employee",
    entityId: id,
    changes: { employeeCode: employee.employeeCode },
  });

  return updated;
}

/** Pay changes, behind `employees.manage_salary`. Always audited. */
export async function updateSalary(id, data, actor) {
  const employee = await loadEmployee(id, { includeSalary: true });

  const updated = await prisma.employee.update({
    where: { id },
    data: {
      ...(data.salaryType != null ? { salaryType: data.salaryType } : {}),
      ...(data.baseSalary != null ? { baseSalary: money(data.baseSalary) } : {}),
      ...(data.hourlyRate !== undefined ? { hourlyRate: data.hourlyRate != null ? money(data.hourlyRate) : null } : {}),
      ...(data.overtimeMultiplier != null ? { overtimeMultiplier: D(data.overtimeMultiplier) } : {}),
      ...(data.bankAccountName !== undefined ? { bankAccountName: data.bankAccountName } : {}),
      ...(data.bankAccountNumber !== undefined ? { bankAccountNumber: data.bankAccountNumber } : {}),
      ...(data.bankIfsc !== undefined ? { bankIfsc: data.bankIfsc } : {}),
      ...(data.taxIdentifier !== undefined ? { taxIdentifier: data.taxIdentifier } : {}),
    },
    select: selectFor({ includeSalary: true }),
  });

  // A pay change is exactly what an audit trail is for, so the before and after
  // are both recorded rather than just the fact that something changed.
  await recordAudit({
    actorId: actor.userId,
    branchId: employee.branchId,
    action: "employee.salary_change",
    entityType: "Employee",
    entityId: id,
    changes: {
      employeeCode: employee.employeeCode,
      from: { salaryType: employee.salaryType, baseSalary: Number(employee.baseSalary) },
      to: { salaryType: updated.salaryType, baseSalary: Number(updated.baseSalary) },
    },
  });

  return updated;
}

/** Changes employment status. Exit dates are recorded, rows are not deleted. */
export async function setEmployeeStatus(id, { status, reason = null, exitedAt = null, actor }) {
  const employee = await loadEmployee(id);

  const exiting = ["RESIGNED", "TERMINATED"].includes(status);

  const updated = await prisma.employee.update({
    where: { id },
    data: {
      status,
      ...(exiting
        ? { exitedAt: exitedAt ? new Date(exitedAt) : new Date(), exitReason: reason }
        : { exitedAt: null, exitReason: null }),
    },
    select: BASE_SELECT,
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: employee.branchId,
    action: "employee.status_change",
    entityType: "Employee",
    entityId: id,
    changes: { employeeCode: employee.employeeCode, from: employee.status, to: status, reason },
  });

  return updated;
}

/**
 * Deletes an employee.
 *
 * Only one who never worked here — no punches, no attendance, no payslips. Once
 * any of those exist the row is the explanation for work done and money paid,
 * and removing it orphans both.
 */
export async function deleteEmployee(id, actor = null) {
  const employee = await loadEmployee(id);

  const [punches, days, payslips] = await Promise.all([
    prisma.attendancePunch.count({ where: { employeeId: id } }),
    prisma.attendanceDay.count({ where: { employeeId: id } }),
    prisma.payslip.count({ where: { employeeId: id } }),
  ]);

  if (punches + days + payslips > 0) {
    throw ApiError.conflict("This employee has attendance or payroll history", {
      punches,
      attendanceDays: days,
      payslips,
      hint: "Mark them as resigned or terminated instead",
    });
  }

  await prisma.employee.delete({ where: { id } });

  await recordAudit({
    actorId: actor?.userId ?? null,
    branchId: employee.branchId,
    action: "employee.delete",
    entityType: "Employee",
    entityId: id,
    changes: { employeeCode: employee.employeeCode },
  });

  return { id, deleted: true };
}

export async function listEmployees({
  branchId,
  departmentId,
  status,
  employmentType,
  search,
  includeSalary = false,
  limit = 20,
  cursor,
} = {}) {
  const rows = await prisma.employee.findMany({
    where: {
      ...(branchId ? { branchId } : {}),
      ...(departmentId ? { departmentId } : {}),
      ...(status ? { status } : {}),
      ...(employmentType ? { employmentType } : {}),
      ...(search
        ? {
            OR: [
              { firstName: { contains: search, mode: "insensitive" } },
              { lastName: { contains: search, mode: "insensitive" } },
              { employeeCode: { contains: search, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      employeeCode: true,
      firstName: true,
      lastName: true,
      designation: true,
      employmentType: true,
      status: true,
      branchId: true,
      biometricId: true,
      joinedAt: true,
      department: { select: { id: true, name: true } },
      ...(includeSalary ? { salaryType: true, baseSalary: true, currency: true } : {}),
    },
    orderBy: { employeeCode: "asc" },
    ...cursorArgs(cursor, limit),
  });

  return toPage(rows, limit);
}

// --- salary components ------------------------------------------------------

/**
 * Adds a recurring earning or deduction.
 *
 * Exactly one of a flat amount or a percentage of base — a component that is
 * both is ambiguous, and whichever the code happens to read first decides
 * somebody's pay.
 */
export async function addSalaryComponent(employeeId, data, actor) {
  await loadEmployee(employeeId);

  const hasAmount = data.amount != null && D(data.amount).greaterThan(0);
  const hasPercent = data.percentOfBase != null && D(data.percentOfBase).greaterThan(0);

  if (hasAmount === hasPercent) {
    throw ApiError.validation("A component is a fixed amount or a percentage, not both", {
      amount: ["Give exactly one of amount or percentOfBase"],
    });
  }

  const component = await prisma.employeeSalaryComponent.create({
    data: {
      employeeId,
      name: data.name,
      isEarning: data.isEarning ?? true,
      amount: hasAmount ? money(data.amount) : null,
      percentOfBase: hasPercent ? D(data.percentOfBase) : null,
      isTaxable: data.isTaxable ?? true,
      effectiveFrom: data.effectiveFrom ? new Date(data.effectiveFrom) : new Date(),
      effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
    },
    select: {
      id: true,
      name: true,
      isEarning: true,
      amount: true,
      percentOfBase: true,
      isTaxable: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });

  await recordAudit({
    actorId: actor.userId,
    action: "employee.component_added",
    entityType: "Employee",
    entityId: employeeId,
    changes: { name: component.name, isEarning: component.isEarning, amount: Number(component.amount ?? 0) },
  });

  return component;
}

/**
 * Ends a component rather than deleting it.
 *
 * A payslip already generated referenced it, and removing the row would leave
 * that payslip unable to explain one of its own lines.
 */
export async function endSalaryComponent(employeeId, componentId, { effectiveTo = new Date(), actor }) {
  const component = await prisma.employeeSalaryComponent.findFirst({
    where: { id: componentId, employeeId },
    select: { id: true, name: true },
  });
  if (!component) throw ApiError.notFound("Salary component not found");

  const ended = await prisma.employeeSalaryComponent.update({
    where: { id: componentId },
    data: { effectiveTo: new Date(effectiveTo) },
    select: { id: true, name: true, effectiveTo: true },
  });

  await recordAudit({
    actorId: actor?.userId ?? null,
    action: "employee.component_ended",
    entityType: "Employee",
    entityId: employeeId,
    changes: { name: component.name, effectiveTo },
  });

  return ended;
}

/** The components in force for a period, as payroll consumes them. */
export async function activeComponents({ employeeId, periodStart, periodEnd }) {
  return prisma.employeeSalaryComponent.findMany({
    where: {
      employeeId,
      effectiveFrom: { lte: new Date(periodEnd) },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: new Date(periodStart) } }],
    },
    select: {
      id: true,
      name: true,
      isEarning: true,
      amount: true,
      percentOfBase: true,
      isTaxable: true,
      effectiveFrom: true,
      effectiveTo: true,
    },
  });
}
