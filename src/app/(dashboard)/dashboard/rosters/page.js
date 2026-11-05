import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import RosterGrid from "@/components/dashboard/people/RosterGrid";
import RosterBulkForm from "@/components/dashboard/people/RosterBulkForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { roster } from "@/server/services/shift.service";
import { employeeOptions, shiftOptions } from "@/server/content/people-admin";
import { scopedBranches } from "@/server/content/branch-scope";
import { addDayKeys, dayKey, dayLabel, weekDays, weekStart } from "@/lib/hr";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Rosters — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The rota, a week at a time.
 *
 * Per-date rather than a weekly repeating pattern, because restaurant cover is
 * not weekly: it moves around holidays, matches and whoever is off sick. A
 * week is simply the window this screen shows.
 */
export default async function RostersPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/rosters"));
  if (!hasPermission(grantedPermissionKeys(principal), "rosters.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const asked = String(one(params.week) ?? "").slice(0, 10);
  const start = weekStart(/^\d{4}-\d{2}-\d{2}$/.test(asked) ? asked : dayKey(new Date()));
  const days = weekDays(start);
  const end = days[days.length - 1];

  const readScope = branchScope(principal, "rosters.read");
  const branches = await scopedBranches(principal, "rosters.read");
  const branchId = branches.some((branch) => branch.id === one(params.branch)) ? one(params.branch) : "";

  const [employees, shifts, assignments] = await Promise.all([
    employeeOptions(branchScope(principal, "employees.read"), { branchId: branchId || null }),
    shiftOptions(branchScope(principal, "shifts.read"), { branchId: branchId || null }),
    roster({ ...(branchId ? { branchId } : {}), from: start, to: end, scope: readScope }),
  ]);

  const canManage = can(principal, "rosters.manage", branchId ? { branchId } : undefined);
  const href = (week) => {
    const query = new URLSearchParams();
    if (week) query.set("week", week);
    if (branchId) query.set("branch", branchId);
    const text = query.toString();
    return text ? `/dashboard/rosters?${text}` : "/dashboard/rosters";
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Rosters"
        description={`Week of ${dayLabel(start, { weekday: false })} to ${dayLabel(end, { weekday: false })}. Changing a day overwrites it — rostering is iterative, so a second answer is a correction.`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Link href={href(addDayKeys(start, -7))} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
              Previous week
            </Link>
            <Link href={href(weekStart(dayKey(new Date())))} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
              This week
            </Link>
            <Link href={href(addDayKeys(start, 7))} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">
              Next week
            </Link>
          </div>
        }
      />

      {branches.length > 1 ? (
        <ListFilters
          id="rosters"
          hidden={{ week: start }}
          fields={[
            { type: "select", name: "branch", label: "Branch", value: branchId, options: [{ value: "", label: "Every branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))] },
          ]}
        />
      ) : null}

      <RosterGrid
        employees={serialize(employees)}
        shifts={serialize(shifts)}
        assignments={serialize(assignments)}
        days={days}
        canManage={canManage}
      />

      {canManage && shifts.length ? (
        <RosterBulkForm employees={serialize(employees)} shifts={serialize(shifts)} from={start} to={end} />
      ) : null}

      {canManage && !shifts.length ? (
        <p className="rounded-card bg-warning-container px-5 py-4 text-body-md text-on-warning-container">
          There are no shifts to roster onto yet.{" "}
          <Link href="/dashboard/shifts/new" className="underline">Create one first</Link>.
        </p>
      ) : null}
    </div>
  );
}
