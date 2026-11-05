import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getPayslip } from "@/server/services/payroll.service";
import { assertRecordAccess } from "@/server/hr/access";
import { PAYROLL_STATES, durationLabel, employeeName } from "@/lib/hr";
import { formatMoney } from "@/lib/format";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Payslip — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One payslip, showing its working.
 *
 * The attendance figures are frozen at generation on purpose: a payslip has to
 * be able to explain itself months later, and a live join would quietly change
 * what it claims to have paid for.
 */
export default async function PayslipPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/payslips/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "payslips.view_all")) redirect("/dashboard");

  const allowed = await assertRecordAccess(principal, "payslip", id, "payslips.view_all")
    .then(() => true)
    .catch(() => false);
  if (!allowed) notFound();

  const raw = await nullIfMissing(getPayslip(id));
  if (!raw) notFound();
  const payslip = serialize(raw);

  const state = PAYROLL_STATES[payslip.status] ?? PAYROLL_STATES.DRAFT;
  const currency = payslip.employee?.currency ?? "PKR";
  const earnings = (payslip.lines ?? []).filter((line) => line.isEarning);
  const deductions = (payslip.lines ?? []).filter((line) => !line.isEarning);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={employeeName(payslip.employee)}
        description={`${payslip.employee?.employeeCode ?? ""} · ${payslip.employee?.salaryType === "MONTHLY" ? "monthly salary" : payslip.employee?.salaryType === "DAILY" ? "daily rate" : "hourly rate"}`}
        back={{ href: `/dashboard/payroll/${payslip.periodId}`, label: "Pay run" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={state.tone}>{state.label}</Chip>
            {payslip.paidAt ? <Chip tone="bg-secondary-container text-on-secondary-container">Paid</Chip> : null}
          </div>
        }
      />

      <Section title="What it was worked out from" description="Frozen when the payslip was generated, so it still adds up months later.">
        <dl className="grid gap-4 text-body-md sm:grid-cols-3">
          <Detail label="Payable days">{Number(payslip.payableDays)}</Detail>
          <Detail label="Present">{Number(payslip.presentDays)}</Detail>
          <Detail label="On leave">{Number(payslip.leaveDays)}</Detail>
          <Detail label="Absent">{Number(payslip.absentDays)}</Detail>
          <Detail label="Worked">{durationLabel(payslip.workedMinutes)}</Detail>
          <Detail label="Overtime">{durationLabel(payslip.overtimeMinutes)}</Detail>
        </dl>
      </Section>

      <Section title="The money">
        <div className="flex flex-col gap-4">
          <Lines title="Earnings" lines={earnings} currency={currency} />
          {deductions.length ? <Lines title="Deductions" lines={deductions} currency={currency} /> : null}

          <dl className="flex flex-col gap-2 border-t border-surface-container-high pt-4 text-body-md">
            <Total label="Gross" value={formatMoney(payslip.grossAmount, currency)} />
            <Total label="Deductions" value={`− ${formatMoney(payslip.deductionAmount, currency)}`} />
            <Total label="Net pay" value={formatMoney(payslip.netAmount, currency)} strong />
          </dl>
        </div>
      </Section>

      {payslip.paidAt || payslip.paymentReference ? (
        <Section title="Payment">
          <dl className="grid gap-4 text-body-md sm:grid-cols-2">
            <Detail label="Paid on">
              {payslip.paidAt ? new Date(payslip.paidAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
            </Detail>
            <Detail label="Reference">{payslip.paymentReference ?? "—"}</Detail>
          </dl>
        </Section>
      ) : null}

      <p className="text-body-md text-on-surface-variant">
        <Link href={`/dashboard/employees/${payslip.employeeId}`} className="text-primary hover:underline">
          {employeeName(payslip.employee)}&rsquo;s record
        </Link>
      </p>
    </div>
  );
}

function Lines({ title, lines, currency }) {
  if (!lines.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-label-bold text-on-surface">{title}</p>
      <ul className="flex flex-col gap-1">
        {lines.map((line) => (
          <li key={line.id} className="flex flex-wrap items-baseline justify-between gap-3 rounded-field bg-surface-container-low px-4 py-2.5">
            <span className="min-w-0 text-body-md text-on-surface">
              {line.label}
              {line.quantity != null && line.rate != null ? (
                <span className="block text-on-surface-variant">
                  {Number(line.quantity)} × {formatMoney(line.rate, currency)}
                </span>
              ) : null}
              {/* Where it was credited, frozen when the payslip was generated —
                  which is what somebody remitting the money needs to know. */}
              {line.account ? (
                <span className="block text-on-surface-variant">
                  {line.account.code} {line.account.name}
                </span>
              ) : null}
            </span>
            <span className="text-label-bold text-on-surface">{formatMoney(line.amount, currency)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Total({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={strong ? "text-label-bold text-on-surface" : "text-on-surface-variant"}>{label}</dt>
      <dd className={strong ? "font-display text-headline-md text-on-surface" : "text-on-surface"}>{value}</dd>
    </div>
  );
}

function Detail({ label, children }) {
  return (
    <div className="min-w-0">
      <dt className="text-label-bold font-normal text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 break-words text-on-surface">{children}</dd>
    </div>
  );
}
