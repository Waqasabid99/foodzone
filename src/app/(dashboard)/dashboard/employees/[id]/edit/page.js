import { notFound, redirect } from "next/navigation";
import { nullIfMissing, nullIfUnreachable } from "@/lib/api/errors";
import PageHeader from "@/components/dashboard/PageHeader";
import EmployeeForm from "@/components/dashboard/people/EmployeeForm";
import { getAuthContext } from "@/lib/api/auth";
import { can } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getEmployee } from "@/server/services/employee.service";
import { departmentOptions, linkableAccounts } from "@/server/content/people-admin";
import { scopedBranches } from "@/server/content/branch-scope";
import { assertRecordAccess } from "@/server/hr/access";
import { employeeName } from "@/lib/hr";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Edit employee — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function EditEmployeePage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/employees/${id}/edit`));

  // Refuses before anything is loaded, and answers 404 for another branch's
  // employee rather than confirming that they exist.
  const allowed = await nullIfUnreachable(assertRecordAccess(principal, "employee", id, "employees.update"));
  if (!allowed) notFound();

  const employee = await nullIfMissing(getEmployee(id));
  if (!employee) notFound();

  const [branches, departments, accounts] = await Promise.all([
    scopedBranches(principal, "employees.read"),
    departmentOptions({ includeInactive: true }),
    can(principal, "users.read") ? linkableAccounts({ currentUserId: employee.userId }) : [],
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title={`Edit ${employeeName(employee)}`}
        description="Pay is not here — it has its own form, behind its own permission."
        back={{ href: `/dashboard/employees/${id}`, label: employeeName(employee) }}
      />
      <EmployeeForm
        employee={serialize(employee)}
        branches={serialize(branches)}
        departments={serialize(departments)}
        accounts={serialize(accounts)}
        canLinkAccount={can(principal, "users.read")}
      />
    </div>
  );
}
