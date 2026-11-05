import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock, Plus } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listShifts } from "@/server/services/shift.service";
import { scopedBranches } from "@/server/content/branch-scope";
import { clockLabel, durationLabel, shiftLength } from "@/lib/hr";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Shifts — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The shift templates a rota is built from.
 *
 * Kept separate from the roster on purpose: a shift is "evening, 18:00 to
 * 02:00", and the roster says who works it on which day. Restaurant cover is
 * not weekly — it moves around holidays, matches and sickness — so the pattern
 * lives in the rota, not here.
 */
export default async function ShiftsPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/shifts"));
  if (!hasPermission(grantedPermissionKeys(principal), "shifts.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const showRetired = one(params.retired) === "1";

  const branches = await scopedBranches(principal, "shifts.read");
  const branchId = branches.some((branch) => branch.id === one(params.branch)) ? one(params.branch) : "";

  const shifts = serialize(
    await listShifts({
      ...(branchId ? { branchId } : {}),
      ...(showRetired ? {} : { isActive: true }),
      scope: branchScope(principal, "shifts.read"),
    }),
  );

  const branchName = (id) => branches.find((branch) => branch.id === id)?.name ?? "Another branch";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Shifts"
        description="The patterns a rota is built from. A shift ending earlier than it starts runs past midnight and belongs to the day it began."
        actions={
          can(principal, "shifts.manage") ? (
            <Link href="/dashboard/shifts/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              New shift
            </Link>
          ) : null
        }
      />

      <ListFilters
        id="shifts"
        fields={[
          ...(branches.length > 1
            ? [{ type: "select", name: "branch", label: "Branch", value: branchId, options: [{ value: "", label: "Any branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))] }]
            : []),
          { type: "checkbox", name: "retired", label: "Include retired", value: showRetired },
        ]}
      />

      {shifts.length ? (
        <ul className="flex flex-col gap-3">
          {shifts.map((shift) => (
            <li key={shift.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={`/dashboard/shifts/${shift.id}`} className="text-label-bold text-on-surface hover:underline">{shift.name}</Link>
                  {shift.crossesMidnight ? <Chip tone="bg-secondary-container text-on-secondary-container">Overnight</Chip> : null}
                  {shift.isActive ? null : <Chip>Retired</Chip>}
                </p>
                <p className="mt-1 text-body-md text-on-surface-variant">
                  {clockLabel(shift.startMinute)} – {clockLabel(shift.endMinute)}
                  {shift.breakMinutes ? ` · ${shift.breakMinutes}m break` : ""}
                  {branches.length > 1 ? ` · ${branchName(shift.branchId)}` : ""}
                </p>
              </div>
              <p className="text-right text-body-md text-on-surface-variant">
                <span className="block text-label-bold text-on-surface">{durationLabel(shiftLength(shift))} paid</span>
                {shift.assignmentCount ? `rostered ${shift.assignmentCount} times` : "never rostered"}
              </p>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={Clock}
          title={branchId || !showRetired ? "No shifts here" : "No shifts yet"}
          action={can(principal, "shifts.manage") ? { href: "/dashboard/shifts/new", label: "Create one" } : null}
        >
          A rota needs at least one shift to put people on.
        </EmptyState>
      )}
    </div>
  );
}
