import { Prisma } from "@/generated/prisma";
import { money } from "@/server/accounting/balance";

/**
 * Payslip arithmetic.
 *
 * Pure, because this is somebody's wages. A rounding error here is not a report
 * that looks odd — it is a person paid the wrong amount, every month, until
 * they notice. The awkward cases are all here and all asserted: a monthly
 * salary prorated across a partial month, overtime at a multiplier derived from
 * a monthly rate, a percentage component of a base that was itself prorated.
 *
 * Two conventions, both chosen because the alternative is quietly unfair:
 *
 *   * **A monthly salary is prorated over the period's own days**, not over a
 *     fixed 30. February and July pay the same monthly figure, so a day off in
 *     February must cost the same fraction as a day off in July.
 *   * **Percentage components are computed on the *prorated* base**, not the
 *     full one. An allowance defined as 10% of salary should fall when the
 *     salary falls, or somebody absent for half a month keeps a full month's
 *     allowance.
 */

const D = (value) => new Prisma.Decimal(value ?? 0);
const ZERO = D(0);

/** Minutes to hours, to three places — enough for a per-minute rate to survive. */
export function hoursOf(minutes) {
  return D(minutes ?? 0).dividedBy(60).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * What one hour of this employee's time is worth.
 *
 * Falls back to deriving an hourly rate from the monthly salary when none is
 * set, because overtime has to be payable for a salaried cook as well as for an
 * hourly one. `standardHoursPerMonth` is the divisor that makes that derivation
 * explicit rather than a magic number buried in a formula.
 */
export function hourlyRateFor(employee, { standardHoursPerMonth = 208 } = {}) {
  if (employee.hourlyRate != null && D(employee.hourlyRate).greaterThan(0)) {
    return D(employee.hourlyRate);
  }

  const base = D(employee.baseSalary);
  if (base.lessThanOrEqualTo(0)) return ZERO;

  switch (employee.salaryType) {
    case "HOURLY":
      return base;
    case "DAILY":
      // A daily rate spread over an eight-hour day.
      return base.dividedBy(8);
    case "MONTHLY":
    default:
      return base.dividedBy(standardHoursPerMonth);
  }
}

/**
 * Basic pay for the period.
 *
 * The three salary types genuinely differ, and collapsing them is how a
 * part-timer ends up on a full-timer's wage:
 *
 *   MONTHLY  the salary, prorated by payable days over the period's days
 *   DAILY    the daily rate for each payable day
 *   HOURLY   the hourly rate for the minutes actually worked
 */
export function basicPay({ employee, payableDays, periodDays, workedMinutes }) {
  const base = D(employee.baseSalary);

  switch (employee.salaryType) {
    case "HOURLY":
      return {
        amount: money(hourlyRateFor(employee).times(hoursOf(workedMinutes))),
        quantity: hoursOf(workedMinutes),
        rate: money(hourlyRateFor(employee)),
        unit: "hours",
      };

    case "DAILY":
      return {
        amount: money(base.times(D(payableDays))),
        quantity: D(payableDays),
        rate: money(base),
        unit: "days",
      };

    case "MONTHLY":
    default: {
      // Prorated over the period's own length: a day off in February costs the
      // same fraction as one in July, which a fixed 30-day divisor would not.
      const days = D(periodDays);
      const factor = days.greaterThan(0) ? D(payableDays).dividedBy(days) : ZERO;

      return {
        amount: money(base.times(factor)),
        quantity: D(payableDays),
        rate: money(days.greaterThan(0) ? base.dividedBy(days) : ZERO),
        unit: "days",
      };
    }
  }
}

/**
 * Overtime pay.
 *
 * Hourly employees are paid overtime at their own rate times the multiplier;
 * salaried ones at a rate derived from their salary. Returning zero for a
 * salaried employee — the tempting simplification — means a manager who covers
 * two double shifts is paid nothing for either.
 */
export function overtimePay({ employee, overtimeMinutes, standardHoursPerMonth = 208 }) {
  const minutes = D(overtimeMinutes ?? 0);
  if (minutes.lessThanOrEqualTo(0)) return null;

  const rate = hourlyRateFor(employee, { standardHoursPerMonth }).times(D(employee.overtimeMultiplier ?? 1.5));
  const hours = hoursOf(minutes);

  return {
    amount: money(rate.times(hours)),
    quantity: hours,
    rate: money(rate),
    unit: "hours",
  };
}

/**
 * Resolves a recurring salary component for this period.
 *
 * A component is either a flat amount or a percentage of base. The percentage
 * is taken on the **prorated** base passed in, so an allowance defined as a
 * share of salary moves with the salary rather than staying whole while the pay
 * it is a share of halves.
 */
export function componentAmount({ component, proratedBase }) {
  if (component.amount != null && D(component.amount).greaterThan(0)) {
    return money(component.amount);
  }

  if (component.percentOfBase != null) {
    return money(D(proratedBase).times(D(component.percentOfBase)).dividedBy(100));
  }

  return money(0);
}

/** Whether a component applies to a period at all. */
export function componentApplies(component, { periodStart, periodEnd }) {
  const from = component.effectiveFrom ? new Date(component.effectiveFrom) : null;
  const to = component.effectiveTo ? new Date(component.effectiveTo) : null;

  // Starts after the period ends, or ended before it began.
  if (from && from > new Date(periodEnd)) return false;
  if (to && to < new Date(periodStart)) return false;
  return true;
}

/**
 * Builds every line of a payslip and totals it.
 *
 * Lines carry `quantity` and `rate` alongside the amount so a payslip can show
 * its working. "Basic 12,000" invites a dispute; "22 days at 545.45" answers one.
 */
export function buildPayslip({
  employee,
  attendance,
  components = [],
  periodDays,
  periodStart,
  periodEnd,
  standardHoursPerMonth = 208,
}) {
  const lines = [];

  const basic = basicPay({
    employee,
    payableDays: attendance.payableDays,
    periodDays,
    workedMinutes: attendance.workedMinutes,
  });

  lines.push({
    code: "BASIC",
    label: "Basic pay",
    isEarning: true,
    quantity: basic.quantity,
    rate: basic.rate,
    amount: basic.amount,
  });

  const overtime = overtimePay({
    employee,
    overtimeMinutes: attendance.overtimeMinutes,
    standardHoursPerMonth,
  });
  if (overtime) {
    lines.push({
      code: "OT",
      label: "Overtime",
      isEarning: true,
      quantity: overtime.quantity,
      rate: overtime.rate,
      amount: overtime.amount,
    });
  }

  for (const component of components) {
    if (!componentApplies(component, { periodStart, periodEnd })) continue;

    const amount = componentAmount({ component, proratedBase: basic.amount });
    if (D(amount).isZero()) continue;

    lines.push({
      code: component.isEarning ? "EARNING" : "DEDUCTION",
      label: component.name,
      isEarning: component.isEarning,
      quantity: null,
      rate: component.percentOfBase != null ? D(component.percentOfBase) : null,
      amount,
      // Where this component's money lands in the ledger, frozen onto the line
      // so a later edit to the component cannot restate a payslip already
      // issued. Only deductions carry one: earnings are expensed together as
      // gross pay, so an account on an earning would be read by nothing.
      accountId: component.isEarning ? null : component.accountId ?? null,
    });
  }

  const grossAmount = lines
    .filter((line) => line.isEarning)
    .reduce((sum, line) => sum.plus(D(line.amount)), ZERO);
  const deductionAmount = lines
    .filter((line) => !line.isEarning)
    .reduce((sum, line) => sum.plus(D(line.amount)), ZERO);

  return {
    lines,
    grossAmount: money(grossAmount),
    deductionAmount: money(deductionAmount),
    // Floored at zero: deductions larger than the pay are a data problem, and
    // paying a negative wage is not a thing that can happen.
    netAmount: money(Prisma.Decimal.max(grossAmount.minus(deductionAmount), 0)),
  };
}
