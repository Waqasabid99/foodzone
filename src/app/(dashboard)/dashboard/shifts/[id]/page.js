import Link from "next/link";
import { nullIfUnreachable } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ShiftForm from "@/components/dashboard/people/ShiftForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getShift } from "@/server/services/shift.service";
import { scopedBranches } from "@/server/content/branch-scope";
import { assertRecordAccess } from "@/server/hr/access";
import { clockLabel, durationLabel, shiftLength } from "@/lib/hr";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Shift — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function ShiftPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/shifts/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "shifts.read")) redirect("/dashboard");

  const branchId = await nullIfUnreachable(assertRecordAccess(principal, "shift", id, "shifts.read"));
  if (!branchId) notFound();

  const shift = serialize(await getShift(id));
  const canManage = can(principal, "shifts.manage", { branchId });
  const branches = canManage ? await scopedBranches(principal, "shifts.manage") : [];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={shift.name}
        description={`${clockLabel(shift.startMinute)} – ${clockLabel(shift.endMinute)} · ${durationLabel(shiftLength(shift))} paid`}
        back={{ href: "/dashboard/shifts", label: "Shifts" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {shift.crossesMidnight ? <Chip tone="bg-secondary-container text-on-secondary-container">Overnight</Chip> : null}
            {shift.isActive ? null : <Chip>Retired</Chip>}
          </div>
        }
      />

      <Section title="How it has been used">
        <dl className="grid gap-4 text-body-md sm:grid-cols-3">
          <div>
            <dt className="text-label-bold font-normal text-on-surface-variant">Rostered</dt>
            <dd className="mt-0.5 text-on-surface">{shift.assignmentCount} times</dd>
          </div>
          <div>
            <dt className="text-label-bold font-normal text-on-surface-variant">Days worked against it</dt>
            <dd className="mt-0.5 text-on-surface">{shift.workedDays}</dd>
          </div>
          <div>
            <dt className="text-label-bold font-normal text-on-surface-variant">Grace</dt>
            <dd className="mt-0.5 text-on-surface">{shift.graceMinutes} minutes</dd>
          </div>
        </dl>
        <Link href={`/dashboard/rosters?shift=${id}`} className="w-fit text-label-bold text-primary hover:underline">
          See it on the rota
        </Link>
      </Section>

      {canManage ? (
        <ShiftForm shift={shift} branches={serialize(branches)} />
      ) : (
        <p className="text-body-md text-on-surface-variant">You can see this shift but not change it.</p>
      )}
    </div>
  );
}
