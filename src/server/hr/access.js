import { prisma } from "@/lib/prisma";
import { branchScope, can } from "@/lib/api/permissions";
import { branchFilter, inScope, intersectScopes, recordAccess, reaches, scopeWhere } from "@/server/access/scope";

export { branchFilter, inScope, intersectScopes, reaches, scopeWhere };

/**
 * Which branch an HR record belongs to, and whether the caller may see it.
 *
 * An employee works at one outlet, and a branch manager's `employees.read` is
 * a grant at *their* outlet — it answers "may they see staff?", not "whose?".
 * Without the list half of that, a supervisor at one branch could ask for
 * employees with no branch filter, pass the permission check and be handed
 * every person in the company. With `employees.view_salary` they would be
 * handed everyone's pay.
 *
 * Salary carries a second scope of its own, intersected with the first: a
 * grant to see pay at one branch must not reveal pay at another, even when the
 * employee list legitimately spans both.
 */

const LOOKUPS = {
  employee: (id) =>
    prisma.employee.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  shift: (id) =>
    prisma.shift.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  attendanceDay: (id) =>
    prisma.attendanceDay.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  device: (id) =>
    prisma.attendanceDevice
      .findUnique({ where: { id }, select: { branchId: true } })
      .then((row) => row && [row.branchId]),
  leaveRequest: (id) =>
    prisma.leaveRequest
      .findUnique({ where: { id }, select: { employee: { select: { branchId: true } } } })
      .then((row) => row && [row.employee.branchId]),
  // A company-wide run and a company-wide holiday both carry a null branch,
  // which `assertRecordAccess` reads as "only the permission decides".
  payrollPeriod: (id) =>
    prisma.payrollPeriod.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
  payslip: (id) =>
    prisma.payslip
      .findUnique({ where: { id }, select: { employee: { select: { branchId: true } } } })
      .then((row) => row && [row.employee.branchId]),
  holiday: (id) =>
    prisma.holiday.findUnique({ where: { id }, select: { branchId: true } }).then((row) => row && [row.branchId]),
};

const NOT_FOUND = {
  employee: "Employee not found",
  shift: "Shift not found",
  attendanceDay: "Attendance day not found",
  device: "Attendance terminal not found",
  leaveRequest: "Leave request not found",
  payrollPeriod: "Payroll run not found",
  payslip: "Payslip not found",
  holiday: "Holiday not found",
};

export const { recordBranches, assertRecordAccess } = recordAccess(LOOKUPS, NOT_FOUND);

/**
 * Whether one employee's pay may be shown.
 *
 * Asked per record rather than once per request, because a list can span
 * branches: somebody holding `employees.view_salary` at one outlet sees names
 * everywhere they manage and figures only where they hold the key.
 */
export function salaryVisible(principal, branchId) {
  return can(principal, "employees.view_salary", { branchId });
}

/** The branches whose salaries `permissionKey`'s holder may see. */
export function salaryScope(principal, permissionKey = "employees.read") {
  return intersectScopes(branchScope(principal, permissionKey), branchScope(principal, "employees.view_salary"));
}

/** Strips every pay figure from an employee row, keeping its shape. */
export function withoutPay(employee) {
  if (!employee) return employee;
  const {
    salaryType: _salaryType,
    baseSalary: _baseSalary,
    hourlyRate: _hourlyRate,
    overtimeMultiplier: _overtimeMultiplier,
    currency: _currency,
    bankAccountName: _bankAccountName,
    bankAccountNumber: _bankAccountNumber,
    bankIfsc: _bankIfsc,
    taxIdentifier: _taxIdentifier,
    salaryComponents: _salaryComponents,
    ...rest
  } = employee;
  return rest;
}
