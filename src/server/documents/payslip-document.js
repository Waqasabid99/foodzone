import { documentDate, documentMoney, textLines } from "@/server/documents/model";
import { safeText } from "@/server/documents/text";

/** Minutes as hours and minutes, because a payslip is read by the person paid. */
function hoursLabel(minutes) {
  const total = Math.max(0, Math.round(Number(minutes ?? 0)));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/** A day count: whole days print whole, halves print as halves. */
function daysLabel(value) {
  const days = Number(value ?? 0);
  return Number.isInteger(days) ? String(days) : days.toFixed(2);
}

/**
 * A payslip, as a document model.
 *
 * This is the one document in the system an employee is entitled to receive,
 * and the one most likely to be handed to somebody else — a landlord, a bank,
 * a visa application. That shapes every decision here:
 *
 *   * **It shows the arithmetic, not just the answer.** Gross, each earning and
 *     each deduction with its quantity and rate where there is one, then net.
 *     A slip that says only "net 48,200" cannot be checked by the person who
 *     earned it, and an unverifiable payslip is how payroll disputes start.
 *   * **Attendance is printed beside the pay.** The deduction for four absent
 *     days is only defensible next to the four absent days.
 *   * **A draft says DRAFT across it.** A payslip is a statement of fact about
 *     money owed; one generated from numbers that may still be regenerated
 *     must not be able to circulate as final. Approved and paid slips carry no
 *     banner, and a paid one carries its reference.
 *   * **Deductions are drawn as negatives.** A column of positive numbers that
 *     happen to be subtracted is how somebody reads their net pay wrongly.
 */
export function payslipDocument({ payslip, period, branch = null }) {
  const currency = payslip?.employee?.currency ?? "PKR";
  const timeZone = branch?.timezone ?? undefined;
  const money = (amount) => documentMoney(amount, currency);

  const employee = payslip?.employee ?? {};
  const name = [employee.firstName, employee.lastName].filter(Boolean).join(" ") || "—";

  const earnings = (payslip?.lines ?? []).filter((line) => line.isEarning);
  const deductions = (payslip?.lines ?? []).filter((line) => !line.isEarning);

  const rows = [];
  for (const line of earnings) {
    rows.push({
      component: safeText(line.label ?? line.code),
      basis: basisLabel(line),
      amount: money(line.amount),
    });
  }
  // A heading row rather than a second table: one column of figures down the
  // page is easier to add up by eye than two tables side by side.
  if (deductions.length) {
    rows.push({ component: "Deductions", basis: "", amount: "", heading: true });
    for (const line of deductions) {
      rows.push({
        component: safeText(line.label ?? line.code),
        basis: basisLabel(line),
        amount: `-${money(line.amount)}`,
      });
    }
  }

  const banner =
    payslip?.status === "DRAFT"
      ? "DRAFT - not yet approved"
      : payslip?.status === "CANCELLED"
        ? "CANCELLED"
        : null;

  return {
    title: "PAYSLIP",
    reference: safeText(period?.name ?? ""),
    banner,
    issuedLabel: period?.payDate ? `Pay date ${documentDate(period.payDate, { timeZone })}` : "",
    issuer: {
      name: safeText(branch?.legalName ?? branch?.name ?? ""),
      lines: textLines([branch?.city, branch?.phone, branch?.email]),
    },
    parties: [
      {
        title: "Employee",
        lines: textLines([
          name,
          employee.employeeCode ? `Code ${employee.employeeCode}` : null,
          employee.designation,
          employee.salaryType ? `${String(employee.salaryType).toLowerCase()} salary` : null,
        ]),
      },
      {
        title: "Period",
        lines: textLines([
          period?.name,
          period?.startDate && period?.endDate
            ? `${documentDate(period.startDate, { timeZone })} to ${documentDate(period.endDate, { timeZone })}`
            : null,
          `Payable ${daysLabel(payslip?.payableDays)} days` +
            ` · present ${daysLabel(payslip?.presentDays)}` +
            ` · leave ${daysLabel(payslip?.leaveDays)}` +
            ` · absent ${daysLabel(payslip?.absentDays)}`,
          `Worked ${hoursLabel(payslip?.workedMinutes)}` +
            (Number(payslip?.overtimeMinutes) ? `, overtime ${hoursLabel(payslip.overtimeMinutes)}` : ""),
        ]),
      },
    ],
    table: {
      columns: [
        { key: "component", label: "Component", width: 230 },
        { key: "basis", label: "Basis", width: 160 },
        { key: "amount", label: "Amount", width: 100, align: "right" },
      ],
      rows,
    },
    totals: [
      { label: "Gross", value: money(payslip?.grossAmount) },
      { label: "Deductions", value: `-${money(payslip?.deductionAmount)}` },
      { label: "Net pay", value: money(payslip?.netAmount), strong: true },
    ],
    notes: textLines([
      payslip?.notes,
      payslip?.status === "PAID" && payslip?.paidAt
        ? `Paid ${documentDate(payslip.paidAt, { timeZone })}${payslip.paymentReference ? ` · ref ${payslip.paymentReference}` : ""}`
        : null,
      employee.bankAccountNumber ? `Credited to account ending ${String(employee.bankAccountNumber).slice(-4)}` : null,
    ]),
    footer: safeText(`${name} · ${period?.name ?? ""}`.trim()),
  };
}

/**
 * What a component was computed from, when that is known.
 *
 * "30 days at 1,500" is the line an employee checks; a fixed allowance has no
 * basis to show and gets a blank rather than a made-up one.
 */
function basisLabel(line) {
  const quantity = Number(line.quantity ?? 0);
  const rate = Number(line.rate ?? 0);
  if (!quantity || !rate) return "";

  const amount = quantity % 1 === 0 ? String(quantity) : quantity.toFixed(2);
  return safeText(`${amount} x ${rate.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
}
