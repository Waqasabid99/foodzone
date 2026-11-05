import Link from "next/link";
import { nullIfUnreachable } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import CorrectionForm from "@/components/dashboard/people/CorrectionForm";
import ManualPunchForm from "@/components/dashboard/people/ManualPunchForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { prisma } from "@/lib/prisma";
import { punchesForDay, userNames } from "@/server/content/people-admin";
import { assertRecordAccess } from "@/server/hr/access";
import {
  ATTENDANCE_STATES,
  PUNCH_DIRECTIONS,
  PUNCH_METHODS,
  clockLabel,
  dayKey,
  dayLabel,
  durationLabel,
  employeeName,
  timeLabel,
} from "@/lib/hr";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Attendance day — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One person, one day — and the punches it was derived from.
 *
 * Showing the punches beside the figures is the whole point of the page: a
 * supervisor deciding whether a day is right needs to see what the terminal
 * actually recorded, not just the number the derivation arrived at.
 */
export default async function AttendanceDayPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/attendance/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "attendance.read")) redirect("/dashboard");

  const branchId = await nullIfUnreachable(assertRecordAccess(principal, "attendanceDay", id, "attendance.read"));
  if (!branchId) notFound();

  const raw = await prisma.attendanceDay.findUnique({
    where: { id },
    select: {
      id: true,
      employeeId: true,
      branchId: true,
      workDate: true,
      status: true,
      firstInAt: true,
      lastOutAt: true,
      workedMinutes: true,
      breakMinutes: true,
      overtimeMinutes: true,
      lateMinutes: true,
      earlyLeaveMinutes: true,
      payableFactor: true,
      isManualOverride: true,
      overrideReason: true,
      approvedById: true,
      approvedAt: true,
      isLocked: true,
      employee: { select: { id: true, employeeCode: true, firstName: true, lastName: true } },
      shift: { select: { id: true, name: true, startMinute: true, endMinute: true, graceMinutes: true } },
    },
  });
  if (!raw) notFound();

  const day = serialize(raw);
  const workDate = dayKey(day.workDate);
  const state = ATTENDANCE_STATES[day.status] ?? ATTENDANCE_STATES.ABSENT;

  const canEdit = can(principal, "attendance.edit", { branchId });
  const canAddPunch = can(principal, "attendance_punches.create_manual", { branchId });
  const canSeePunches = hasPermission(grantedPermissionKeys(principal), "attendance_punches.read");

  const punches = canSeePunches ? serialize(await punchesForDay({ employeeId: day.employeeId, workDate })) : [];
  const names = await userNames([day.approvedById, ...punches.map((punch) => punch.createdById)]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={employeeName(day.employee)}
        description={`${dayLabel(workDate)}${day.shift ? ` · ${day.shift.name}, ${clockLabel(day.shift.startMinute)}–${clockLabel(day.shift.endMinute)}` : " · not rostered"}`}
        back={{ href: "/dashboard/attendance", label: "Attendance" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={state.tone}>{state.label}</Chip>
            {day.isManualOverride ? <Chip>Corrected</Chip> : null}
            {day.isLocked ? <Chip tone="bg-surface-container-high text-on-surface-variant">Paid</Chip> : null}
            {day.approvedAt && !day.isLocked ? <Chip tone="bg-success-container text-on-success-container">Approved</Chip> : null}
          </div>
        }
      />

      <Section title="The day">
        <dl className="grid gap-4 text-body-md sm:grid-cols-3">
          <Detail label="First in">{timeLabel(day.firstInAt)}</Detail>
          <Detail label="Last out">{day.lastOutAt ? timeLabel(day.lastOutAt) : "Never punched out"}</Detail>
          <Detail label="Worked">{durationLabel(day.workedMinutes)}</Detail>
          <Detail label="Break">{durationLabel(day.breakMinutes)}</Detail>
          <Detail label="Overtime">{durationLabel(day.overtimeMinutes)}</Detail>
          <Detail label="Late">{day.lateMinutes ? `${day.lateMinutes} minutes` : "On time"}</Detail>
          <Detail label="Left early">{day.earlyLeaveMinutes ? `${day.earlyLeaveMinutes} minutes` : "No"}</Detail>
          <Detail label="Pays">
            {Number(day.payableFactor) === 1 ? "A full day" : Number(day.payableFactor) === 0 ? "Nothing" : `${day.payableFactor} of a day`}
          </Detail>
          <Detail label="Signed off">
            {day.approvedAt ? `${names.get(day.approvedById) ?? "Someone"}, ${new Date(day.approvedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "Not yet"}
          </Detail>
        </dl>

        {day.isManualOverride && day.overrideReason ? (
          <p className="rounded-field bg-secondary-container px-4 py-3 text-body-md text-on-secondary-container">
            Corrected by hand: {day.overrideReason}
          </p>
        ) : null}

        {day.status === "MISSING_PUNCH" ? (
          <p className="rounded-field bg-error-container px-4 py-3 text-body-md text-on-error-container">
            A punch is missing, so nothing was assumed. Guessing they left at the shift end would pay unworked hours;
            guessing they never came would steal worked ones. Add the punch you know happened, or correct the day
            outright.
          </p>
        ) : null}
      </Section>

      {canSeePunches ? (
        <Section title="What the terminal recorded" description="Raw and never edited. A correction is a new punch alongside these, not a change to one.">
          {punches.length ? (
            <ul className="flex flex-col gap-2">
              {punches.map((punch) => (
                <li key={punch.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-2.5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-label-bold text-on-surface">{timeLabel(punch.punchedAt)}</span>
                    <Chip>{PUNCH_DIRECTIONS[punch.direction] ?? punch.direction}</Chip>
                    {punch.method === "MANUAL" ? <Chip tone="bg-secondary-container text-on-secondary-container">By hand</Chip> : null}
                  </span>
                  <span className="text-right text-body-md text-on-surface-variant">
                    {PUNCH_METHODS[punch.method] ?? punch.method}
                    {punch.device ? ` · ${punch.device.name}` : ""}
                    {punch.createdById ? ` · added by ${names.get(punch.createdById) ?? "someone"}` : ""}
                    {punch.note ? ` · ${punch.note}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">
              No punches at all for this day, or either side of it.
            </p>
          )}
        </Section>
      ) : null}

      {canAddPunch && !day.isLocked ? (
        <Section title="Add a punch" description="For when somebody really was here and the terminal has no record of it.">
          <ManualPunchForm employees={[]} employeeId={day.employeeId} date={workDate} />
        </Section>
      ) : null}

      {canEdit ? (
        <Section title="Correct this day" description="When the derivation is wrong and adding a punch will not fix it.">
          <CorrectionForm day={day} />
        </Section>
      ) : null}

      <p className="text-body-md text-on-surface-variant">
        <Link href={`/dashboard/employees/${day.employeeId}`} className="text-primary hover:underline">
          {employeeName(day.employee)}&rsquo;s record
        </Link>
      </p>
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
