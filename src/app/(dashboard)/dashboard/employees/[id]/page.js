import Link from "next/link";
import { nullIfMissing, nullIfUnreachable } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import SalaryForm from "@/components/dashboard/people/SalaryForm";
import SalaryComponents from "@/components/dashboard/people/SalaryComponents";
import EmployeeStatusForm from "@/components/dashboard/people/EmployeeStatusForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import LeaveBalances from "@/components/dashboard/people/LeaveBalances";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getEmployee } from "@/server/services/employee.service";
import { recentAttendance, upcomingShifts } from "@/server/content/people-admin";
import { deductionAccounts } from "@/server/content/finance-admin";
import { getSiteIdentity } from "@/server/content/site";
import { assertRecordAccess, salaryVisible } from "@/server/hr/access";
import {
  ATTENDANCE_STATES,
  EMPLOYEE_STATES,
  clockLabel,
  dayKey,
  dayLabel,
  durationLabel,
  employeeName,
  employmentTypeLabel,
  hasLeft,
  timeLabel,
} from "@/lib/hr";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { leaveBalances } from "@/server/services/leave.service";

export const metadata = { title: "Employee — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const dateLabel = (value) => (value ? dayLabel(dayKey(value), { weekday: false }) : "—");

export default async function EmployeePage({ params }) {
  const { timeZone } = await getSiteIdentity();
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/employees/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "employees.read")) redirect("/dashboard");

  // Another branch's employee answers 404: that they exist elsewhere is itself
  // something a scoped supervisor has no business learning.
  const branchId = await nullIfUnreachable(assertRecordAccess(principal, "employee", id, "employees.read"));
  if (!branchId) notFound();

  const raw = await nullIfMissing(getEmployee(id, { includeSalary: true }));
  if (!raw) notFound();

  const canSeePay = salaryVisible(principal, branchId);
  const canManagePay = can(principal, "employees.manage_salary", { branchId });
  const canUpdate = can(principal, "employees.update", { branchId });
  const canDelete = can(principal, "employees.delete", { branchId });
  const canSeeAttendance = can(principal, "attendance.read", { branchId });
  const canSeeRoster = can(principal, "rosters.read", { branchId });

  const employee = serialize(raw);
  const state = EMPLOYEE_STATES[employee.status] ?? EMPLOYEE_STATES.ACTIVE;
  const name = employeeName(employee);
  const currency = employee.currency ?? "PKR";

  const canSeeLeave = can(principal, "leave_requests.read", { branchId });
  const leaveYear = new Date().getUTCFullYear();

  const [days, upcoming, balances, payAccounts] = await Promise.all([
    canSeeAttendance ? recentAttendance(id, { days: 10 }) : [],
    canSeeRoster ? upcomingShifts(id, { from: dayKey(new Date()), days: 14 }) : [],
    canSeeLeave ? leaveBalances({ employeeId: id, year: leaveYear }) : [],
    canManagePay ? deductionAccounts() : [],
  ]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={name}
        description={`${employee.employeeCode} · ${employee.designation ?? employmentTypeLabel(employee.employmentType)}${employee.department ? ` · ${employee.department.name}` : ""}`}
        back={{ href: "/dashboard/employees", label: "Employees" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={state.tone}>{state.label}</Chip>
            {employee.biometricId ? null : <Chip tone="bg-warning-container text-on-warning-container">Not enrolled</Chip>}
            {canUpdate ? (
              <Link href={`/dashboard/employees/${id}/edit`} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                Edit
              </Link>
            ) : null}
          </div>
        }
      />

      <Section title="The job">
        <dl className="grid gap-4 text-body-md sm:grid-cols-3">
          <Detail label="Branch">{employee.branch?.name ?? "—"}</Detail>
          <Detail label="Department">{employee.department?.name ?? "None"}</Detail>
          <Detail label="Employment">{employmentTypeLabel(employee.employmentType)}</Detail>
          <Detail label="Started">{dateLabel(employee.joinedAt, timeZone)}</Detail>
          <Detail label="Biometric id">{employee.biometricId ?? "Not enrolled"}</Detail>
          <Detail label="Sign-in account">
            {employee.user ? (
              can(principal, "users.read") ? (
                <Link href={`/dashboard/users/${employee.user.id}`} className="text-primary hover:underline">{employee.user.name}</Link>
              ) : (
                employee.user.name
              )
            ) : (
              "None — they do not sign in"
            )}
          </Detail>
        </dl>

        {employee.biometricId ? null : (
          <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            No biometric id, so punches from the terminal will not be credited to {name}. Enrol them on the device, then
            put the same id on this record — or match the punches already waiting in{" "}
            <Link href="/dashboard/attendance/unmatched" className="underline">unmatched punches</Link>.
          </p>
        )}
      </Section>

      {/* Leave had no screen at all: the balances existed and were never
          shown, so "how much has this person actually got left" was only ever
          answerable from the database. */}
      {canSeeLeave ? (
        <Section title="Leave" description={`Entitlement and what has been taken in ${leaveYear}.`}>
          <LeaveBalances
            employeeId={id}
            balances={serialize(balances)}
            year={leaveYear}
            canOpen={can(principal, "leave_types.manage", { branchId })}
          />
        </Section>
      ) : null}

      <Section title="Contact">
        <dl className="grid gap-4 text-body-md sm:grid-cols-3">
          <Detail label="Phone">{employee.phone ?? "—"}</Detail>
          <Detail label="Personal email">{employee.personalEmail ?? "—"}</Detail>
          <Detail label="Date of birth">{dateLabel(employee.dateOfBirth)}</Detail>
          <Detail label="Address">{employee.address ?? "—"}</Detail>
          <Detail label="In an emergency">
            {employee.emergencyContactName ? `${employee.emergencyContactName}${employee.emergencyContactPhone ? ` · ${employee.emergencyContactPhone}` : ""}` : "—"}
          </Detail>
        </dl>
      </Section>

      {canSeeRoster ? (
        <Section title="Coming up" description="The next fortnight, as rostered.">
          {upcoming.length ? (
            <ul className="flex flex-col gap-2">
              {serialize(upcoming).map((row) => (
                <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-2.5">
                  <span className="text-label-bold text-on-surface">{dayLabel(dayKey(row.workDate))}</span>
                  <span className="text-body-md text-on-surface-variant">
                    {row.isWeeklyOff
                      ? "Day off"
                      : row.shift
                        ? `${row.shift.name} · ${clockLabel(row.shift.startMinute)}–${clockLabel(row.shift.endMinute)}`
                        : "No shift"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">
              Nothing rostered.{" "}
              {can(principal, "rosters.manage", { branchId }) ? <Link href={`/dashboard/rosters?employee=${id}`} className="text-primary hover:underline">Build the rota</Link> : null}
            </p>
          )}
        </Section>
      ) : null}

      {canSeeAttendance ? (
        <Section title="Recent attendance" description="Derived from their punches. The attendance screen has the rest.">
          {days.length ? (
            <ul className="flex flex-col gap-2">
              {serialize(days).map((day) => {
                const dayState = ATTENDANCE_STATES[day.status] ?? ATTENDANCE_STATES.ABSENT;
                return (
                  <li key={day.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-2.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/attendance/${day.id}`} className="text-label-bold text-on-surface hover:underline">
                        {dayLabel(dayKey(day.workDate))}
                      </Link>
                      <Chip tone={dayState.tone}>{dayState.label}</Chip>
                      {day.isManualOverride ? <Chip>Corrected</Chip> : null}
                    </span>
                    <span className="text-body-md text-on-surface-variant">
                      {day.firstInAt ? `${timeLabel(day.firstInAt)}–${day.lastOutAt ? timeLabel(day.lastOutAt) : "?"}` : "No punches"} ·{" "}
                      {durationLabel(day.workedMinutes)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">No attendance recorded yet.</p>
          )}
          <Link href={`/dashboard/attendance?employee=${id}`} className="w-fit text-label-bold text-primary hover:underline">
            All of {name}&rsquo;s attendance
          </Link>
        </Section>
      ) : null}

      {canSeePay ? (
        <Section
          title="Pay"
          description={canManagePay ? "Changes are audited with the before and after." : "Read only — changing pay needs its own permission."}
        >
          {canManagePay ? (
            <SalaryForm employee={employee} currency={currency} />
          ) : (
            <dl className="grid gap-4 text-body-md sm:grid-cols-3">
              <Detail label="Basis">{employee.salaryType}</Detail>
              <Detail label="Base">{`${currency} ${employee.baseSalary}`}</Detail>
              <Detail label="Overtime">{`${employee.overtimeMultiplier}×`}</Detail>
            </dl>
          )}
        </Section>
      ) : null}

      {canSeePay ? (
        <Section title="Recurring earnings and deductions" description="Allowances, contributions, an advance being repaid. Ended rather than deleted, so old payslips still add up.">
          {canManagePay ? (
            <SalaryComponents
              employee={employee}
              components={employee.salaryComponents ?? []}
              currency={currency}
              deductionAccounts={serialize(payAccounts)}
            />
          ) : (employee.salaryComponents ?? []).length ? (
            <ul className="flex flex-col gap-1">
              {employee.salaryComponents.map((component) => (
                <li key={component.id} className="text-body-md text-on-surface-variant">
                  {component.name} — {component.amount != null ? `${currency} ${component.amount}` : `${component.percentOfBase}% of base`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">Nothing recurring.</p>
          )}
        </Section>
      ) : null}

      {canUpdate ? (
        <Section title="Where they stand" description="Leaving is a status, not a deletion — the work they did stays on the record.">
          <EmployeeStatusForm employee={employee} />
        </Section>
      ) : null}

      {hasLeft(employee) && employee.exitReason ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface-variant">
          Left on {dateLabel(employee.exitedAt, timeZone)} — {employee.exitReason}
        </p>
      ) : null}

      {canDelete ? (
        <Section
          title="Delete"
          description="Only somebody who never worked here. Once there are punches, attendance or payslips, the record is the explanation for work done and money paid, and it is kept."
        >
          <ActionButton
            method="delete"
            endpoint={`/admin/employees/${id}`}
            tone="danger"
            confirm={`Delete ${name}? This only works if they have no attendance or payroll history.`}
            success={`${name} deleted.`}
            redirectTo="/dashboard/employees"
          >
            Delete this record
          </ActionButton>
        </Section>
      ) : null}

      {hasPermission(grantedPermissionKeys(principal), "audit_logs.read") ? (
        <p className="text-body-md text-on-surface-variant">
          <Link href={`/dashboard/audit-log?entity=Employee&entityId=${id}`} className="text-primary hover:underline">
            Everything that has changed on this record
          </Link>
        </p>
      ) : null}
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
