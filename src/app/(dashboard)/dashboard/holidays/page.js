import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import HolidaysEditor from "@/components/dashboard/people/HolidaysEditor";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listHolidays } from "@/server/services/leave.service";
import { scopedBranches } from "@/server/content/branch-scope";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Holidays — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The closure calendar attendance derivation reads.
 *
 * Without it, a day the restaurant was shut reads as everybody being absent,
 * and payroll docks a full team for a day nobody was asked to work.
 */
export default async function HolidaysPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/holidays"));
  if (!hasPermission(grantedPermissionKeys(principal), "holidays.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);

  const thisYear = new Date().getUTCFullYear();
  const asked = Number(one(params.year));
  const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : thisYear;

  const branches = await scopedBranches(principal, "holidays.read");
  const holidays = await listHolidays({ year, scope: branchScope(principal, "holidays.read") });

  const years = [thisYear - 1, thisYear, thisYear + 1];

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Holidays"
        description="Days the business is closed. Attendance reads this, so a closure is recorded as a holiday rather than as everybody being absent."
        actions={
          <div className="flex flex-wrap gap-2">
            {years.map((value) => (
              <Link
                key={value}
                href={`/dashboard/holidays?year=${value}`}
                className={`rounded-field px-4 py-2 text-label-bold ${value === year ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface hover:bg-surface-container-highest"}`}
              >
                {value}
              </Link>
            ))}
          </div>
        }
      />

      <HolidaysEditor
        holidays={serialize(holidays)}
        branches={serialize(branches)}
        canManage={can(principal, "holidays.manage")}
      />
    </div>
  );
}
