import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import UnmatchedPunches from "@/components/dashboard/people/UnmatchedPunches";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { unmatchedPunches } from "@/server/services/punch.service";
import { employeeOptions, unenrolledCount } from "@/server/content/people-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Unmatched punches — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The queue HR has to work.
 *
 * A punch for a biometric id nobody is enrolled to is kept, not dropped —
 * discarding it loses real attendance that nobody can recover. Matching it here
 * is what makes it count, retrospectively as well as from now on.
 */
export default async function UnmatchedPunchesPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/attendance/unmatched"));
  if (!hasPermission(grantedPermissionKeys(principal), "attendance_punches.read")) redirect("/dashboard");

  const employeeScope = branchScope(principal, "employees.read");
  const [page, employees, unenrolled] = await Promise.all([
    unmatchedPunches({ limit: 200, scope: branchScope(principal, "attendance_punches.read") }),
    employeeOptions(employeeScope),
    unenrolledCount(employeeScope),
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Unmatched punches"
        description="Somebody is clocking in and it is not being counted — usually because they were added to the terminal before their record existed here."
        back={{ href: "/dashboard/attendance", label: "Attendance" }}
      />

      {unenrolled ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">
          {unenrolled} {unenrolled === 1 ? "person has" : "people have"} no biometric id on their record, so any punch
          they make will land here.
        </p>
      ) : null}

      <UnmatchedPunches
        groups={serialize(page.byBiometric ?? [])}
        employees={serialize(employees)}
        canClaim={can(principal, "employees.update")}
      />
    </div>
  );
}
