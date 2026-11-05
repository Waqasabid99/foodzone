import Link from "next/link";
import { redirect } from "next/navigation";
import { Fingerprint } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import AttendanceActions from "@/components/dashboard/people/AttendanceActions";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listAttendance } from "@/server/services/attendance.service";
import { unmatchedPunches } from "@/server/services/punch.service";
import { employeeOptions } from "@/server/content/people-admin";
import { scopedBranches } from "@/server/content/branch-scope";
import {
  ATTENDANCE_STATES,
  addDayKeys,
  dayKey,
  dayLabel,
  durationLabel,
  employeeName,
  timeLabel,
  weekStart,
} from "@/lib/hr";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Attendance — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

/**
 * The days payroll will read.
 *
 * An attendance day is derived from punches, not typed: the punches are the
 * truth, and re-running derivation over the same ones must produce the same
 * day. What a human does here is look at the ones the machine could not decide
 * — a missing punch, an absence — and sign the rest off.
 */
export default async function AttendancePage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/attendance"));
  if (!hasPermission(grantedPermissionKeys(principal), "attendance.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ""));

  // Defaults to the current week: "how is this week looking" is the question
  // this screen is opened with far more often than any other.
  const from = isDate(one(params.from)) ? one(params.from) : weekStart(dayKey(new Date()));
  const to = isDate(one(params.to)) ? one(params.to) : addDayKeys(from, 6);
  const status = ATTENDANCE_STATES[one(params.status)] ? one(params.status) : "";
  const cursor = one(params.cursor) || undefined;

  const scope = branchScope(principal, "attendance.read");
  const [branches, employees] = await Promise.all([
    scopedBranches(principal, "attendance.read"),
    employeeOptions(branchScope(principal, "employees.read"), { includeLeft: true }),
  ]);
  const branchId = branches.some((branch) => branch.id === one(params.branch)) ? one(params.branch) : "";
  const employeeId = employees.some((employee) => employee.id === one(params.employee)) ? one(params.employee) : "";

  const query = {
    from,
    to,
    ...(status ? { status } : {}),
    ...(branchId ? { branchId } : {}),
    ...(employeeId ? { employeeId } : {}),
    scope,
    limit: PAGE_SIZE,
  };

  const canPunches = hasPermission(grantedPermissionKeys(principal), "attendance_punches.read");
  const [page, waiting] = await Promise.all([
    listAttendance({ ...query, cursor }).catch((error) => {
      if (cursor) return listAttendance(query);
      throw error;
    }),
    canPunches ? unmatchedPunches({ limit: 1, scope: branchScope(principal, "attendance_punches.read") }) : null,
  ]);

  const days = serialize(page.items);
  const unapproved = days.filter((day) => !day.approvedAt && !day.isLocked).length;
  const needsEyes = days.filter((day) => day.status === "MISSING_PUNCH").length;
  const orphaned = waiting?.byBiometric?.length ?? 0;

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { from, to, status, branch: branchId, employee: employeeId, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/attendance?${text}` : "/dashboard/attendance";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Attendance"
        description="Derived from the terminal's punches, corrected by a human where it has to be, and signed off before payroll reads it."
        actions={
          canPunches ? (
            <Link href="/dashboard/attendance/unmatched" className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              Unmatched punches{orphaned ? ` (${orphaned})` : ""}
            </Link>
          ) : null
        }
      />

      {orphaned ? (
        <p className="rounded-card bg-warning-container px-5 py-3 text-body-md text-on-warning-container">
          {orphaned} biometric {orphaned === 1 ? "id is" : "ids are"} punching without anybody attached, so that
          attendance is being recorded and not counted.{" "}
          <Link href="/dashboard/attendance/unmatched" className="underline">Match them up</Link>.
        </p>
      ) : null}

      <ListFilters
        id="attendance"
        fields={[
          { type: "date", name: "from", label: "From", value: from },
          { type: "date", name: "to", label: "Until", value: to },
          { type: "select", name: "status", label: "Status", value: status, options: [{ value: "", label: "Any status" }, ...Object.entries(ATTENDANCE_STATES).map(([value, state]) => ({ value, label: state.label }))] },
          ...(employees.length
            ? [{ type: "select", name: "employee", label: "Who", value: employeeId, options: [{ value: "", label: "Everyone" }, ...employees.map((employee) => ({ value: employee.id, label: employeeName(employee) }))] }]
            : []),
          ...(branches.length > 1
            ? [{ type: "select", name: "branch", label: "Branch", value: branchId, options: [{ value: "", label: "Any branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))] }]
            : []),
        ]}
      />

      <AttendanceActions
        from={from}
        to={to}
        branchId={branchId || null}
        employeeId={employeeId || null}
        pending={unapproved}
        canDerive={can(principal, "attendance.edit", branchId ? { branchId } : undefined)}
        canApprove={can(principal, "attendance.approve", branchId ? { branchId } : undefined)}
      />

      {needsEyes ? (
        <p className="rounded-card bg-error-container px-5 py-3 text-body-md text-on-error-container">
          {needsEyes} {needsEyes === 1 ? "day is" : "days are"} missing a punch. Nothing is guessed there — assuming
          somebody left at their shift end pays unworked hours, and assuming they never arrived steals worked ones.
        </p>
      ) : null}

      {days.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {days.map((day) => {
              const state = ATTENDANCE_STATES[day.status] ?? ATTENDANCE_STATES.ABSENT;
              return (
                <li key={day.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/attendance/${day.id}`} className="text-label-bold text-on-surface hover:underline">
                        {employeeName(day.employee)}
                      </Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                      {day.isManualOverride ? <Chip>Corrected</Chip> : null}
                      {day.isLocked ? <Chip tone="bg-surface-container-high text-on-surface-variant">Paid</Chip> : null}
                      {day.approvedAt && !day.isLocked ? <Chip tone="bg-success-container text-on-success-container">Approved</Chip> : null}
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">
                      {dayLabel(dayKey(day.workDate))}
                      {day.shift ? ` · ${day.shift.name}` : ""}
                      {day.firstInAt ? ` · ${timeLabel(day.firstInAt)}–${day.lastOutAt ? timeLabel(day.lastOutAt) : "no out"}` : " · no punches"}
                    </p>
                  </div>
                  <p className="text-right text-body-md text-on-surface-variant">
                    <span className="block text-label-bold text-on-surface">{durationLabel(day.workedMinutes)}</span>
                    {Number(day.payableFactor) === 1
                      ? "full day"
                      : Number(day.payableFactor) === 0
                        ? "unpaid"
                        : `${day.payableFactor} of a day`}
                    {day.lateMinutes ? ` · ${day.lateMinutes}m late` : ""}
                  </p>
                </li>
              );
            })}
          </ul>

          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Most recent</Link> : null}
              {page.nextCursor ? <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Older</Link> : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState icon={Fingerprint} title="Nothing recorded for those days">
          Either nobody worked, or the punches have not been folded into days yet. Rebuilding is safe to run as often as
          you like.
        </EmptyState>
      )}
    </div>
  );
}
