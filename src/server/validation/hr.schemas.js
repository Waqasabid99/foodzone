import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";
import { amountSchema, nonNegativeAmountSchema, positiveAmountSchema } from "@/server/validation/finance.schemas";

/**
 * HR, attendance and payroll request schemas.
 *
 * Two rules carried from the rest of the system: **a request never states a
 * derived figure** — a payslip says which period and which employee, never what
 * the net pay is — and **a time is a time**, given as `HH:MM` or as minutes
 * from midnight, with night shifts expressed by an end past 1440 rather than by
 * a wrapped clock time.
 */

const shortText = z.string().trim().min(1).max(120);
const longText = z.string().trim().max(2000);

const timeSchema = z.union([
  z.string().trim().regex(/^\d{1,2}:\d{2}$/, "Use HH:MM"),
  z.number().int().min(0).max(2880),
]);

// --- departments ------------------------------------------------------------

export const createDepartmentSchema = z.object({
  name: shortText,
  code: z.string().trim().min(1).max(20),
  isActive: z.boolean().optional(),
});

export const updateDepartmentSchema = z
  .object({
    name: shortText.optional(),
    code: z.string().trim().min(1).max(20).optional(),
    headEmployeeId: cuidSchema.nullish(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

// --- employees --------------------------------------------------------------

export const employmentTypeSchema = z.enum(["FULL_TIME", "PART_TIME", "CONTRACT", "TEMPORARY", "INTERN"]);
export const employeeStatusSchema = z.enum(["ACTIVE", "ON_LEAVE", "SUSPENDED", "RESIGNED", "TERMINATED"]);
export const salaryTypeSchema = z.enum(["MONTHLY", "DAILY", "HOURLY"]);

export const createEmployeeSchema = z.object({
  userId: cuidSchema.nullish(),
  employeeCode: z.string().trim().max(40).optional(),
  branchId: cuidSchema,
  departmentId: cuidSchema.nullish(),
  designation: z.string().trim().max(120).nullish(),
  employmentType: employmentTypeSchema.optional(),
  firstName: shortText,
  lastName: z.string().trim().max(120).nullish(),
  personalEmail: z.email().max(200).nullish(),
  phone: z.string().trim().max(30).nullish(),
  dateOfBirth: z.coerce.date().nullish(),
  address: longText.nullish(),
  emergencyContactName: z.string().trim().max(120).nullish(),
  emergencyContactPhone: z.string().trim().max(30).nullish(),
  photoUrl: z.url().max(2000).nullish(),
  biometricId: z.string().trim().max(60).nullish(),
  salaryType: salaryTypeSchema.optional(),
  baseSalary: nonNegativeAmountSchema.optional(),
  hourlyRate: nonNegativeAmountSchema.nullish(),
  overtimeMultiplier: z.number().finite().min(1).max(5).optional(),
  currency: z.string().trim().length(3).optional(),
  bankAccountName: z.string().trim().max(160).nullish(),
  bankAccountNumber: z.string().trim().max(60).nullish(),
  bankIfsc: z.string().trim().max(30).nullish(),
  taxIdentifier: z.string().trim().max(40).nullish(),
  joinedAt: z.coerce.date().optional(),
});

/** Pay is deliberately absent: it moves through its own endpoint. */
export const updateEmployeeSchema = z
  .object({
    userId: cuidSchema.nullish(),
    departmentId: cuidSchema.nullish(),
    designation: z.string().trim().max(120).nullish(),
    employmentType: employmentTypeSchema.optional(),
    firstName: shortText.optional(),
    lastName: z.string().trim().max(120).nullish(),
    personalEmail: z.email().max(200).nullish(),
    phone: z.string().trim().max(30).nullish(),
    dateOfBirth: z.coerce.date().nullish(),
    address: longText.nullish(),
    emergencyContactName: z.string().trim().max(120).nullish(),
    emergencyContactPhone: z.string().trim().max(30).nullish(),
    photoUrl: z.url().max(2000).nullish(),
    biometricId: z.string().trim().max(60).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const updateSalarySchema = z
  .object({
    salaryType: salaryTypeSchema.optional(),
    baseSalary: nonNegativeAmountSchema.optional(),
    hourlyRate: nonNegativeAmountSchema.nullish(),
    overtimeMultiplier: z.number().finite().min(1).max(5).optional(),
    bankAccountName: z.string().trim().max(160).nullish(),
    bankAccountNumber: z.string().trim().max(60).nullish(),
    bankIfsc: z.string().trim().max(30).nullish(),
    taxIdentifier: z.string().trim().max(40).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const setEmployeeStatusSchema = z.object({
  status: employeeStatusSchema,
  reason: z.string().trim().max(500).nullish(),
  exitedAt: z.coerce.date().nullish(),
});

export const listEmployeesSchema = z.object({
  branchId: cuidSchema.optional(),
  departmentId: cuidSchema.optional(),
  status: employeeStatusSchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const salaryComponentSchema = z
  .object({
    name: shortText,
    isEarning: z.boolean().optional(),
    amount: positiveAmountSchema.nullish(),
    percentOfBase: z.number().finite().min(0).max(100).nullish(),
    isTaxable: z.boolean().optional(),
    /** Where a deduction is credited. Null falls to employee deductions payable. */
    accountId: cuidSchema.nullish(),
    effectiveFrom: z.coerce.date().optional(),
    effectiveTo: z.coerce.date().nullish(),
  })
  // Refused rather than ignored on an earning: gross pay is expensed as one
  // figure, so an account set there would be read by nothing — and a field that
  // silently does nothing is worse than one that is not offered.
  .refine((data) => !(data.accountId && data.isEarning !== false), {
    message: "Only a deduction posts to its own account",
    path: ["accountId"],
  });

export const endComponentSchema = z.object({ effectiveTo: z.coerce.date().optional() });

// --- shifts and roster ------------------------------------------------------

export const createShiftSchema = z.object({
  branchId: cuidSchema,
  name: shortText,
  startMinute: timeSchema.optional(),
  startTime: timeSchema.optional(),
  endMinute: timeSchema.optional(),
  endTime: timeSchema.optional(),
  breakMinutes: z.number().int().min(0).max(480).optional(),
  graceMinutes: z.number().int().min(0).max(120).optional(),
  halfDayThresholdMinutes: z.number().int().min(0).max(1440).optional(),
  fullDayThresholdMinutes: z.number().int().min(0).max(1440).optional(),
  isActive: z.boolean().optional(),
}).refine(
  (shift) => (shift.startMinute ?? shift.startTime) != null && (shift.endMinute ?? shift.endTime) != null,
  "Give a start and an end time",
);

export const updateShiftSchema = z
  .object({
    name: shortText.optional(),
    startMinute: timeSchema.optional(),
    startTime: timeSchema.optional(),
    endMinute: timeSchema.optional(),
    endTime: timeSchema.optional(),
    breakMinutes: z.number().int().min(0).max(480).optional(),
    graceMinutes: z.number().int().min(0).max(120).optional(),
    halfDayThresholdMinutes: z.number().int().min(0).max(1440).optional(),
    fullDayThresholdMinutes: z.number().int().min(0).max(1440).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const listShiftsSchema = z.object({
  branchId: cuidSchema.optional(),
  isActive: z.stringbool().optional(),
});

export const assignShiftSchema = z.object({
  employeeId: cuidSchema,
  shiftId: cuidSchema.nullish(),
  from: z.coerce.date(),
  to: z.coerce.date().optional(),
  isWeeklyOff: z.boolean().optional(),
});

export const rosterQuerySchema = z.object({
  branchId: cuidSchema.optional(),
  employeeId: cuidSchema.optional(),
  from: z.coerce.date(),
  to: z.coerce.date().optional(),
});

export const removeAssignmentSchema = z.object({
  employeeId: cuidSchema,
  workDate: z.coerce.date(),
});

// --- devices and punches ----------------------------------------------------

export const registerDeviceSchema = z.object({
  branchId: cuidSchema,
  name: shortText,
  serialNumber: z.string().trim().min(1).max(80),
  vendor: z.string().trim().max(60).nullish(),
  model: z.string().trim().max(60).nullish(),
  ipAddress: z.string().trim().max(60).nullish(),
  timezone: z.string().trim().max(60).nullish(),
});

export const updateDeviceSchema = z
  .object({
    name: shortText.optional(),
    vendor: z.string().trim().max(60).nullish(),
    model: z.string().trim().max(60).nullish(),
    ipAddress: z.string().trim().max(60).nullish(),
    timezone: z.string().trim().max(60).nullish(),
    isActive: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const punchDirectionSchema = z.enum(["IN", "OUT", "BREAK_START", "BREAK_END", "UNKNOWN"]);
export const punchMethodSchema = z.enum(["FINGERPRINT", "FACE", "CARD", "PIN", "MANUAL", "MOBILE_GEO"]);

/** What a terminal pushes. Deliberately tolerant: devices vary wildly. */
export const punchPushSchema = z.object({
  serialNumber: z.string().trim().min(1).max(80),
  punches: z
    .array(
      z.object({
        biometricId: z.string().trim().max(60).nullish(),
        deviceLogId: z.union([z.string().trim().max(60), z.number().int()]).nullish(),
        punchedAt: z.coerce.date(),
        direction: punchDirectionSchema.optional(),
        method: punchMethodSchema.optional(),
        latitude: z.number().finite().min(-90).max(90).nullish(),
        longitude: z.number().finite().min(-180).max(180).nullish(),
        raw: z.any().optional(),
      }),
    )
    .min(1)
    .max(1000),
});

export const manualPunchSchema = z.object({
  employeeId: cuidSchema,
  punchedAt: z.coerce.date(),
  direction: punchDirectionSchema.optional(),
  note: z.string().trim().max(500).nullish(),
});

export const claimPunchesSchema = z.object({
  biometricId: z.string().trim().min(1).max(60),
  employeeId: cuidSchema,
});

export const listPunchesSchema = z.object({
  employeeId: cuidSchema.optional(),
  deviceId: cuidSchema.optional(),
  branchId: cuidSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
});

// --- attendance -------------------------------------------------------------

export const attendanceStatusSchema = z.enum([
  "PRESENT",
  "ABSENT",
  "HALF_DAY",
  "LATE",
  "ON_LEAVE",
  "HOLIDAY",
  "WEEKLY_OFF",
  "MISSING_PUNCH",
]);

export const deriveAttendanceSchema = z.object({
  branchId: cuidSchema.optional(),
  employeeId: cuidSchema.optional(),
  from: z.coerce.date(),
  to: z.coerce.date().optional(),
  /** Re-derives days a supervisor has corrected. Off by default. */
  force: z.boolean().optional(),
});

export const correctAttendanceSchema = z.object({
  status: attendanceStatusSchema.optional(),
  workedMinutes: z.number().int().min(0).max(1440).optional(),
  overtimeMinutes: z.number().int().min(0).max(1440).optional(),
  lateMinutes: z.number().int().min(0).max(1440).optional(),
  payableFactor: z.number().finite().min(0).max(2).optional(),
  /** Required: a correction with no explanation is unreviewable. */
  reason: z.string().trim().min(1).max(500),
});

export const approveAttendanceSchema = z.object({
  branchId: cuidSchema.optional(),
  employeeId: cuidSchema.optional(),
  from: z.coerce.date(),
  to: z.coerce.date().optional(),
});

export const listAttendanceSchema = z.object({
  branchId: cuidSchema.optional(),
  employeeId: cuidSchema.optional(),
  status: attendanceStatusSchema.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
});

export const attendanceSummarySchema = z.object({
  branchId: cuidSchema.optional(),
  employeeId: cuidSchema.optional(),
  from: z.coerce.date(),
  to: z.coerce.date(),
});

// --- leave and holidays -----------------------------------------------------

export const leaveTypeSchema = z.object({
  name: shortText,
  code: z.string().trim().min(1).max(20),
  isPaid: z.boolean().optional(),
  /** Zero means unlimited — sick leave, in many places. */
  annualQuota: z.number().finite().min(0).max(365).optional(),
  carryForward: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export const updateLeaveTypeSchema = leaveTypeSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field to update");

export const requestLeaveSchema = z.object({
  employeeId: cuidSchema,
  leaveTypeId: cuidSchema,
  startDate: z.coerce.date(),
  endDate: z.coerce.date().optional(),
  /** Given explicitly for half-days; otherwise derived from the range. */
  totalDays: z.number().finite().min(0.5).max(365).optional(),
  reason: z.string().trim().max(1000).nullish(),
});

export const reviewLeaveSchema = z.object({ note: z.string().trim().max(500).nullish() });

export const listLeaveSchema = z.object({
  employeeId: cuidSchema.optional(),
  branchId: cuidSchema.optional(),
  leaveTypeId: cuidSchema.optional(),
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const openBalancesSchema = z.object({
  employeeId: cuidSchema,
  year: z.number().int().min(2000).max(2100).optional(),
});

export const balancesQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

export const holidaySchema = z.object({
  branchId: cuidSchema.nullish(),
  name: shortText,
  date: z.coerce.date(),
  isPaid: z.boolean().optional(),
});

export const listHolidaysSchema = z.object({
  branchId: cuidSchema.optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

// --- payroll ----------------------------------------------------------------

export const createPayrollPeriodSchema = z.object({
  branchId: cuidSchema.nullish(),
  name: shortText,
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  payDate: z.coerce.date().nullish(),
});

export const generatePayrollSchema = z.object({
  employeeIds: z.array(cuidSchema).max(500).optional(),
});

export const markPaidSchema = z.object({
  paidAt: z.coerce.date().optional(),
  reference: z.string().trim().max(120).nullish(),
});

export const cancelPayrollSchema = z.object({ reason: z.string().trim().max(500).nullish() });

export const listPayrollSchema = z.object({
  branchId: cuidSchema.optional(),
  status: z.enum(["DRAFT", "PROCESSING", "APPROVED", "PAID", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
});

export const listPayslipsSchema = z.object({
  periodId: cuidSchema.optional(),
  employeeId: cuidSchema.optional(),
  status: z.enum(["DRAFT", "PROCESSING", "APPROVED", "PAID", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().max(200).optional(),
});
