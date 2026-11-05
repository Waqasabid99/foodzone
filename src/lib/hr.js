/**
 * Words and form rules for the People screens.
 *
 * Pure, so the rules a form enforces before sending are tested beside the words
 * it shows. The server checks all of it again — this only saves a round trip
 * and puts the message next to the box that caused it.
 *
 * One idea runs through the whole section: **a time is minutes from midnight,
 * and an end past 1440 is the next morning.** A shift from 22:00 to 06:00 is
 * 1320 to 1800, never 1320 to 360, because the second form makes every duration
 * negative and every night worker look like they owe the company sixteen hours.
 */

// --- employees --------------------------------------------------------------

export const EMPLOYEE_STATES = {
  ACTIVE: { label: "Active", tone: "bg-success-container text-on-success-container" },
  ON_LEAVE: { label: "On leave", tone: "bg-warning-container text-on-warning-container" },
  SUSPENDED: { label: "Suspended", tone: "bg-error-container text-on-error-container" },
  RESIGNED: { label: "Resigned", tone: "bg-surface-container-high text-on-surface-variant" },
  TERMINATED: { label: "Terminated", tone: "bg-surface-container-high text-on-surface-variant" },
};

/** The two that mean somebody has gone. They take an exit date and a reason. */
export const EXIT_STATES = ["RESIGNED", "TERMINATED"];

export const EMPLOYMENT_TYPES = {
  FULL_TIME: "Full time",
  PART_TIME: "Part time",
  CONTRACT: "Contract",
  TEMPORARY: "Temporary",
  INTERN: "Intern",
};

export const SALARY_TYPES = {
  MONTHLY: { label: "Monthly salary", hint: "A fixed amount each month, prorated by the days they were payable." },
  DAILY: { label: "Daily rate", hint: "Paid per day worked, from approved attendance." },
  HOURLY: { label: "Hourly rate", hint: "Paid per hour worked, from approved attendance." },
};

export const employmentTypeLabel = (type) => EMPLOYMENT_TYPES[type] ?? type;
export const employeeName = (employee) =>
  [employee?.firstName, employee?.lastName].filter(Boolean).join(" ") || employee?.employeeCode || "Unnamed";

/** Whether this person has left, so screens can stop offering to roster them. */
export const hasLeft = (employee) => EXIT_STATES.includes(employee?.status);

// --- attendance -------------------------------------------------------------

/**
 * What each attendance status means, in the words a supervisor would use.
 *
 * `MISSING_PUNCH` deliberately reads as a question rather than a verdict: the
 * derivation refuses to guess whether somebody who never punched out left at
 * their shift end or went home early, because guessing high pays unworked hours
 * and guessing low steals worked ones.
 */
export const ATTENDANCE_STATES = {
  PRESENT: { label: "Present", tone: "bg-success-container text-on-success-container" },
  LATE: { label: "Late", tone: "bg-warning-container text-on-warning-container" },
  HALF_DAY: { label: "Half day", tone: "bg-warning-container text-on-warning-container" },
  ABSENT: { label: "Absent", tone: "bg-error-container text-on-error-container" },
  MISSING_PUNCH: { label: "Missing a punch", tone: "bg-error-container text-on-error-container" },
  ON_LEAVE: { label: "On leave", tone: "bg-secondary-container text-on-secondary-container" },
  HOLIDAY: { label: "Holiday", tone: "bg-tertiary-container text-on-tertiary-container" },
  WEEKLY_OFF: { label: "Day off", tone: "bg-surface-container-high text-on-surface-variant" },
};

export const attendanceLabel = (status) => ATTENDANCE_STATES[status]?.label ?? status;

/** The ones a human has to look at before payroll runs. */
export const NEEDS_ATTENTION = ["MISSING_PUNCH", "ABSENT"];

export const PUNCH_DIRECTIONS = {
  IN: "In",
  OUT: "Out",
  BREAK_START: "Break started",
  BREAK_END: "Back from break",
  UNKNOWN: "Not stated",
};

export const PUNCH_METHODS = {
  FINGERPRINT: "Fingerprint",
  FACE: "Face",
  CARD: "Card",
  PIN: "PIN",
  MANUAL: "Added by hand",
  MOBILE_GEO: "Phone",
};

export const DEVICE_STATES = {
  ONLINE: { label: "Online", tone: "bg-success-container text-on-success-container" },
  OFFLINE: { label: "Quiet", tone: "bg-warning-container text-on-warning-container" },
  ERROR: { label: "Error", tone: "bg-error-container text-on-error-container" },
  DECOMMISSIONED: { label: "Retired", tone: "bg-surface-container-high text-on-surface-variant" },
};

// --- times ------------------------------------------------------------------

export const MINUTES_PER_DAY = 1440;

/** 1320 -> "22:00"; 1800 -> "06:00 next day". Mirrors the server's own words. */
export function clockLabel(minute) {
  if (minute == null) return "—";
  const day = Math.floor(minute / MINUTES_PER_DAY);
  const withinDay = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const text = `${String(Math.floor(withinDay / 60)).padStart(2, "0")}:${String(withinDay % 60).padStart(2, "0")}`;
  return day > 0 ? `${text} next day` : text;
}

/** 1800 -> "06:00", for the value of a `<input type="time">`. */
export function clockValue(minute) {
  if (minute == null) return "";
  const withinDay = ((Number(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(withinDay / 60)).padStart(2, "0")}:${String(withinDay % 60).padStart(2, "0")}`;
}

/** "08:30" -> 510. Returns null for anything that is not a time. */
export function minutesFromClock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 47 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 505 -> "8h 25m". Zero is "none" rather than "0h 0m". */
export function durationLabel(minutes) {
  const value = Math.round(Number(minutes ?? 0));
  if (!Number.isFinite(value) || value <= 0) return "none";
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** How long a shift runs, net of its unpaid break — the same sum the server does. */
export function shiftLength({ startMinute, endMinute, breakMinutes = 0 }) {
  return Math.max(0, Number(endMinute) - Number(startMinute) - Number(breakMinutes ?? 0));
}

// --- dates ------------------------------------------------------------------

/**
 * Dates are handled as plain `YYYY-MM-DD` strings throughout these screens.
 *
 * A roster day and an attendance day are `@db.Date` columns compared at UTC
 * midnight. Turning one into a local `Date` and back is how a rota silently
 * shifts by a day for anybody east or west of the server, so the text form
 * never becomes a local date at all.
 */
export function dayKey(date) {
  if (!date) return "";
  if (typeof date === "string") return date.slice(0, 10);
  return new Date(date).toISOString().slice(0, 10);
}

export function addDayKeys(key, days) {
  const at = new Date(`${dayKey(key)}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/** The Monday of the week a date falls in. Rotas are read Monday to Sunday. */
export function weekStart(key) {
  const at = new Date(`${dayKey(key)}T00:00:00Z`);
  const weekday = (at.getUTCDay() + 6) % 7;
  return addDayKeys(dayKey(key), -weekday);
}

export function weekDays(start, count = 7) {
  return Array.from({ length: count }, (_, index) => addDayKeys(start, index));
}

/** "Mon 22 Sep", without dragging the viewer's timezone into a date column. */
export function dayLabel(key, { weekday = true } = {}) {
  const at = new Date(`${dayKey(key)}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return "—";
  return at.toLocaleDateString("en-GB", {
    ...(weekday ? { weekday: "short" } : {}),
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * Clock time of a real timestamp — a punch, not a roster slot.
 *
 * Takes the zone for the same reason `dateLabel` does, and because the two are
 * usually rendered side by side: left to the viewer's own clock, a date fixed
 * to the store and a time fixed to the laptop can name different days in one
 * sentence.
 */
export function timeLabel(at, timeZone = undefined) {
  if (!at) return "—";
  return new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
}

export const isWeekend = (key) => {
  const weekday = new Date(`${dayKey(key)}T00:00:00Z`).getUTCDay();
  return weekday === 0 || weekday === 6;
};

// --- form rules -------------------------------------------------------------

const text = (value) => String(value ?? "").trim();

export function employeePayload(form, { mode = "create" } = {}) {
  const errors = {};

  const firstName = text(form.firstName);
  if (firstName.length < 1) errors.firstName = "Enter their first name.";
  else if (firstName.length > 120) errors.firstName = "Keep it under 120 characters.";

  const lastName = text(form.lastName);
  if (lastName.length > 120) errors.lastName = "Keep it under 120 characters.";

  if (mode === "create" && !form.branchId) errors.branchId = "Choose the branch they work at.";

  const personalEmail = text(form.personalEmail).toLowerCase();
  if (personalEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(personalEmail)) {
    errors.personalEmail = "That does not look like an email address.";
  }

  const phone = text(form.phone);
  if (phone && (phone.length < 7 || phone.length > 30)) errors.phone = "Enter a valid phone number.";

  const emergencyContactPhone = text(form.emergencyContactPhone);
  if (emergencyContactPhone && (emergencyContactPhone.length < 7 || emergencyContactPhone.length > 30)) {
    errors.emergencyContactPhone = "Enter a valid phone number.";
  }

  // A biometric id belongs to one person: shared, every punch is credited to
  // whichever of them the lookup happens to find first.
  const biometricId = text(form.biometricId);
  if (biometricId.length > 60) errors.biometricId = "Keep it under 60 characters.";

  if (mode === "create" && !form.joinedAt) errors.joinedAt = "When did they start?";

  const optional = (value) => (text(value) ? text(value) : null);

  const body = {
    firstName,
    lastName: lastName || null,
    departmentId: form.departmentId || null,
    designation: optional(form.designation),
    employmentType: form.employmentType || "FULL_TIME",
    personalEmail: personalEmail || null,
    phone: phone || null,
    dateOfBirth: form.dateOfBirth || null,
    address: optional(form.address),
    emergencyContactName: optional(form.emergencyContactName),
    emergencyContactPhone: emergencyContactPhone || null,
    biometricId: biometricId || null,
    userId: form.userId || null,
    ...(mode === "create"
      ? { branchId: form.branchId, joinedAt: form.joinedAt, ...(text(form.employeeCode) ? { employeeCode: text(form.employeeCode) } : {}) }
      : {}),
  };

  return { body, errors };
}

export function salaryPayload(form) {
  const errors = {};
  const salaryType = form.salaryType || "MONTHLY";

  const baseSalary = Number(form.baseSalary);
  if (!Number.isFinite(baseSalary) || baseSalary < 0) errors.baseSalary = "Enter an amount, or zero.";

  const hourly = text(form.hourlyRate);
  const hourlyRate = hourly ? Number(hourly) : null;
  if (hourly && (!Number.isFinite(hourlyRate) || hourlyRate < 0)) errors.hourlyRate = "Enter an amount, or leave it empty.";
  // Hourly pay with no rate computes to nothing, and nobody notices until the
  // payslip says zero.
  if (salaryType === "HOURLY" && !hourlyRate) errors.hourlyRate = "An hourly rate is how this person is paid.";

  const overtimeMultiplier = Number(form.overtimeMultiplier);
  if (!Number.isFinite(overtimeMultiplier) || overtimeMultiplier < 1 || overtimeMultiplier > 5) {
    errors.overtimeMultiplier = "Between 1 and 5 — 1.5 means time and a half.";
  }

  return {
    body: {
      salaryType,
      baseSalary,
      hourlyRate,
      overtimeMultiplier,
      bankAccountName: text(form.bankAccountName) || null,
      bankAccountNumber: text(form.bankAccountNumber) || null,
      bankIfsc: text(form.bankIfsc) || null,
      taxIdentifier: text(form.taxIdentifier) || null,
    },
    errors,
  };
}

export function componentPayload(form) {
  const errors = {};
  const name = text(form.name);
  if (name.length < 1) errors.name = "Name it — this is the line on their payslip.";
  else if (name.length > 120) errors.name = "Keep it under 120 characters.";

  const basis = form.basis === "PERCENT" ? "PERCENT" : "AMOUNT";
  const amount = Number(form.amount);
  const percentOfBase = Number(form.percentOfBase);

  // Exactly one of the two. A component that is both is ambiguous, and
  // whichever the code reads first decides somebody's pay.
  if (basis === "AMOUNT" && (!Number.isFinite(amount) || amount <= 0)) errors.amount = "Enter an amount above zero.";
  if (basis === "PERCENT" && (!Number.isFinite(percentOfBase) || percentOfBase <= 0 || percentOfBase > 100)) {
    errors.percentOfBase = "Between 0 and 100 percent.";
  }

  if (!form.effectiveFrom) errors.effectiveFrom = "From when?";
  if (form.effectiveTo && form.effectiveFrom && form.effectiveTo < form.effectiveFrom) {
    errors.effectiveTo = "That is before it starts.";
  }

  const isEarning = form.isEarning !== false;

  return {
    body: {
      name,
      isEarning,
      ...(basis === "AMOUNT" ? { amount } : { percentOfBase }),
      isTaxable: form.isTaxable !== false,
      // Only a deduction posts to an account of its own; gross pay is expensed
      // as one figure, so sending it on an earning would be refused.
      ...(isEarning ? {} : { accountId: form.accountId || null }),
      effectiveFrom: form.effectiveFrom,
      effectiveTo: form.effectiveTo || null,
    },
    errors,
  };
}

export function shiftPayload(form, { mode = "create" } = {}) {
  const errors = {};

  const name = text(form.name);
  if (name.length < 1) errors.name = "Name the shift — 'Evening' or 'Split, lunch'.";
  else if (name.length > 120) errors.name = "Keep it under 120 characters.";

  if (mode === "create" && !form.branchId) errors.branchId = "Which branch works this shift?";

  const startMinute = minutesFromClock(form.startTime);
  const rawEnd = minutesFromClock(form.endTime);
  if (startMinute == null) errors.startTime = "Give a start time.";
  if (rawEnd == null) errors.endTime = "Give an end time.";

  // An end at or before the start is a night shift somebody typed as wall-clock
  // time. Rolling it forward a day is what they meant.
  const endMinute = startMinute != null && rawEnd != null && rawEnd <= startMinute ? rawEnd + MINUTES_PER_DAY : rawEnd;
  const length = startMinute != null && endMinute != null ? endMinute - startMinute : null;

  const breakMinutes = Number(form.breakMinutes ?? 0);
  if (!Number.isInteger(breakMinutes) || breakMinutes < 0 || breakMinutes > 480) {
    errors.breakMinutes = "Between 0 and 480 minutes.";
  } else if (length != null && breakMinutes >= length) {
    errors.breakMinutes = "The break is longer than the shift.";
  }

  const graceMinutes = Number(form.graceMinutes ?? 0);
  if (!Number.isInteger(graceMinutes) || graceMinutes < 0 || graceMinutes > 120) {
    errors.graceMinutes = "Between 0 and 120 minutes.";
  }

  const paid = length != null ? length - (Number.isInteger(breakMinutes) ? breakMinutes : 0) : null;
  const fullDayThresholdMinutes = Number(form.fullDayThresholdMinutes);
  const halfDayThresholdMinutes = Number(form.halfDayThresholdMinutes);

  if (!Number.isInteger(fullDayThresholdMinutes) || fullDayThresholdMinutes < 0 || fullDayThresholdMinutes > 1440) {
    errors.fullDayThresholdMinutes = "Between 0 and 1440 minutes.";
  } else if (paid != null && fullDayThresholdMinutes > paid) {
    // Otherwise nobody working this shift can ever earn a full day.
    errors.fullDayThresholdMinutes = `This shift only pays ${durationLabel(paid)}, so a full day cannot need more.`;
  }
  if (!Number.isInteger(halfDayThresholdMinutes) || halfDayThresholdMinutes < 0 || halfDayThresholdMinutes > 1440) {
    errors.halfDayThresholdMinutes = "Between 0 and 1440 minutes.";
  } else if (Number.isInteger(fullDayThresholdMinutes) && halfDayThresholdMinutes > fullDayThresholdMinutes) {
    errors.halfDayThresholdMinutes = "A half day cannot need more than a full one.";
  }

  return {
    body: {
      name,
      ...(mode === "create" ? { branchId: form.branchId } : {}),
      startMinute,
      endMinute,
      breakMinutes,
      graceMinutes,
      halfDayThresholdMinutes,
      fullDayThresholdMinutes,
      isActive: form.isActive !== false,
    },
    length,
    paidMinutes: paid,
    errors,
  };
}

/** Sensible thresholds for a shift of this length, so the form opens filled in. */
export function suggestThresholds({ startTime, endTime, breakMinutes = 0 }) {
  const start = minutesFromClock(startTime);
  const rawEnd = minutesFromClock(endTime);
  if (start == null || rawEnd == null) return null;
  const end = rawEnd <= start ? rawEnd + MINUTES_PER_DAY : rawEnd;
  const paid = Math.max(0, end - start - Number(breakMinutes ?? 0));
  return { fullDayThresholdMinutes: paid, halfDayThresholdMinutes: Math.floor(paid / 2) };
}

export function rosterPayload(form) {
  const errors = {};
  if (!form.employeeIds?.length) errors.employeeIds = "Choose at least one person.";
  const isWeeklyOff = Boolean(form.isWeeklyOff);
  // Even a day off names a shift: the column is required, and the flag is what
  // derivation reads.
  if (!form.shiftId) {
    errors.shiftId = isWeeklyOff ? "Name the shift they would otherwise work." : "Choose a shift.";
  }
  if (!form.from) errors.from = "From which day?";
  if (form.to && form.from && form.to < form.from) errors.to = "That is before the first day.";

  return {
    body: { shiftId: form.shiftId, from: form.from, to: form.to || form.from, isWeeklyOff },
    employeeIds: form.employeeIds ?? [],
    errors,
  };
}

export function correctionPayload(form) {
  const errors = {};
  const reason = text(form.reason);
  // A correction with no explanation cannot be reviewed by anybody later.
  if (reason.length < 1) errors.reason = "Say why — this is what a reviewer reads.";
  else if (reason.length > 500) errors.reason = "Keep it under 500 characters.";

  const payableFactor = Number(form.payableFactor);
  if (!Number.isFinite(payableFactor) || payableFactor < 0 || payableFactor > 2) {
    errors.payableFactor = "Between 0 and 2 — 1 is a full day, 0.5 a half day.";
  }

  const workedMinutes = Number(form.workedMinutes ?? 0);
  if (!Number.isInteger(workedMinutes) || workedMinutes < 0 || workedMinutes > 1440) {
    errors.workedMinutes = "Between 0 and 1440 minutes.";
  }
  const overtimeMinutes = Number(form.overtimeMinutes ?? 0);
  if (!Number.isInteger(overtimeMinutes) || overtimeMinutes < 0 || overtimeMinutes > 1440) {
    errors.overtimeMinutes = "Between 0 and 1440 minutes.";
  }

  return {
    body: { status: form.status, workedMinutes, overtimeMinutes, payableFactor, reason },
    errors,
  };
}

export function manualPunchPayload(form) {
  const errors = {};
  if (!form.employeeId) errors.employeeId = "Whose punch is this?";
  if (!form.date) errors.date = "Which day?";
  if (minutesFromClock(form.time) == null) errors.time = "Give a time, as HH:MM.";

  const note = text(form.note);
  if (note.length > 500) errors.note = "Keep it under 500 characters.";

  return {
    body: {
      employeeId: form.employeeId,
      // Sent with an offset so the server stores the moment the supervisor
      // meant, not the same wall-clock reading in another zone.
      punchedAt: form.date && form.time ? new Date(`${form.date}T${form.time}`).toISOString() : null,
      direction: form.direction || "UNKNOWN",
      note: note || null,
    },
    errors,
  };
}

export function devicePayload(form, { mode = "create" } = {}) {
  const errors = {};
  const name = text(form.name);
  if (name.length < 1) errors.name = "Name it after where it hangs — 'Back door', 'Kitchen'.";
  else if (name.length > 120) errors.name = "Keep it under 120 characters.";

  const serialNumber = text(form.serialNumber);
  if (mode === "create") {
    if (!serialNumber) errors.serialNumber = "The serial is how the terminal identifies itself.";
    else if (serialNumber.length > 80) errors.serialNumber = "Keep it under 80 characters.";
    if (!form.branchId) errors.branchId = "Which branch is it at?";
  }

  return {
    body: {
      name,
      vendor: text(form.vendor) || null,
      model: text(form.model) || null,
      ipAddress: text(form.ipAddress) || null,
      timezone: text(form.timezone) || null,
      ...(mode === "create" ? { branchId: form.branchId, serialNumber } : {}),
    },
    errors,
  };
}

/** How long a terminal has been quiet, in words. */
export function silenceLabel(minutes) {
  if (minutes == null) return "never synced";
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

// --- leave ------------------------------------------------------------------

export const LEAVE_STATES = {
  PENDING: { label: "Waiting", tone: "bg-warning-container text-on-warning-container" },
  APPROVED: { label: "Approved", tone: "bg-success-container text-on-success-container" },
  REJECTED: { label: "Turned down", tone: "bg-error-container text-on-error-container" },
  CANCELLED: { label: "Cancelled", tone: "bg-surface-container-high text-on-surface-variant" },
};

/**
 * Balance is consumed on approval, never on request.
 *
 * Holding days against a pending request sounds fairer but means a manager
 * sitting on an approval blocks the employee from asking for anything else,
 * and a rejection then has to hand the days back — one more path to get wrong.
 */
export const leaveAvailable = (balance) =>
  Number(balance?.entitledDays ?? 0) + Number(balance?.carriedDays ?? 0) - Number(balance?.usedDays ?? 0);

// --- payroll ----------------------------------------------------------------

export const PAYROLL_STATES = {
  DRAFT: { label: "Draft", tone: "bg-surface-container-high text-on-surface-variant" },
  PROCESSING: { label: "Being worked on", tone: "bg-warning-container text-on-warning-container" },
  APPROVED: { label: "Approved", tone: "bg-success-container text-on-success-container" },
  PAID: { label: "Paid", tone: "bg-secondary-container text-on-secondary-container" },
  CANCELLED: { label: "Cancelled", tone: "bg-error-container text-on-error-container" },
};

/** What each stage of a payroll run actually commits to. */
export const PAYROLL_STAGE_HINT = {
  DRAFT: "Nothing is committed. Generate as often as you like — a corrected attendance day flows straight through.",
  PROCESSING: "Payslips exist but nothing is committed yet.",
  APPROVED: "The wage bill is in the ledger and the attendance behind it is frozen.",
  PAID: "The money has gone out. This run cannot be cancelled.",
  CANCELLED: "Cancelled, and the attendance it had frozen is free again.",
};

// --- more form rules --------------------------------------------------------

export function leaveTypePayload(form, { mode = "create" } = {}) {
  const errors = {};
  const name = text(form.name);
  if (name.length < 1) errors.name = "Name it — 'Annual', 'Sick', 'Unpaid'.";
  else if (name.length > 120) errors.name = "Keep it under 120 characters.";

  const code = text(form.code).toUpperCase();
  if (mode === "create") {
    if (!code) errors.code = "A short code, such as AL.";
    else if (code.length > 20) errors.code = "Keep it under 20 characters.";
  }

  const annualQuota = Number(form.annualQuota ?? 0);
  if (!Number.isFinite(annualQuota) || annualQuota < 0 || annualQuota > 365) {
    errors.annualQuota = "Between 0 and 365 days. Zero means no yearly limit.";
  }

  return {
    body: {
      name,
      ...(mode === "create" ? { code } : {}),
      isPaid: form.isPaid !== false,
      annualQuota,
      carryForward: Boolean(form.carryForward),
      isActive: form.isActive !== false,
    },
    errors,
  };
}

export function leavePayload(form) {
  const errors = {};
  if (!form.employeeId) errors.employeeId = "Whose leave is this?";
  if (!form.leaveTypeId) errors.leaveTypeId = "What kind of leave?";
  if (!form.startDate) errors.startDate = "From which day?";
  if (form.endDate && form.startDate && form.endDate < form.startDate) {
    errors.endDate = "That is before the first day.";
  }

  // Given explicitly only for half-days; otherwise the range decides, and two
  // sources of truth for the same number is how a balance drifts.
  const half = Boolean(form.halfDay);
  const days = half ? 0.5 : null;
  if (half && form.endDate && form.endDate !== form.startDate) {
    errors.endDate = "A half day is one day.";
  }

  const reason = text(form.reason);
  if (reason.length > 1000) errors.reason = "Keep it under 1000 characters.";

  return {
    body: {
      employeeId: form.employeeId,
      leaveTypeId: form.leaveTypeId,
      startDate: form.startDate,
      endDate: form.endDate || form.startDate,
      ...(days != null ? { totalDays: days } : {}),
      reason: reason || null,
    },
    errors,
  };
}

export function holidayPayload(form) {
  const errors = {};
  const name = text(form.name);
  if (name.length < 1) errors.name = "What is the day called?";
  else if (name.length > 120) errors.name = "Keep it under 120 characters.";
  if (!form.date) errors.date = "Which day?";

  return {
    body: {
      name,
      date: form.date,
      // No branch means company-wide, which is what most holidays are.
      branchId: form.branchId || null,
      isPaid: form.isPaid !== false,
    },
    errors,
  };
}

export function payrollPeriodPayload(form) {
  const errors = {};
  const name = text(form.name);
  if (name.length < 1) errors.name = "Name the run — 'September 2026'.";
  else if (name.length > 120) errors.name = "Keep it under 120 characters.";

  if (!form.startDate) errors.startDate = "From which day?";
  if (!form.endDate) errors.endDate = "Until which day?";
  if (form.startDate && form.endDate && form.endDate < form.startDate) {
    errors.endDate = "That is before the start.";
  }
  if (form.payDate && form.endDate && form.payDate < form.endDate) {
    // Not fatal, but paying before the period closes means paying for days
    // nobody has worked yet.
    errors.payDate = "Pay day is usually on or after the period ends.";
  }

  return {
    body: {
      name,
      startDate: form.startDate,
      endDate: form.endDate,
      payDate: form.payDate || null,
      branchId: form.branchId || null,
    },
    errors,
  };
}

/** The first and last day of the month a date falls in. */
export function monthRange(key) {
  const at = new Date(`${dayKey(key)}T00:00:00Z`);
  const first = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const last = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** "September 2026", for naming a payroll run after the month it covers. */
export function monthName(key) {
  const at = new Date(`${dayKey(key)}T00:00:00Z`);
  return at.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}
