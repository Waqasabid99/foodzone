import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import DepartmentsEditor from "@/components/dashboard/people/DepartmentsEditor";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listDepartments } from "@/server/services/employee.service";
import { departmentHeads, employeeOptions } from "@/server/content/people-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Departments — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Departments are company-wide: they describe the kind of work somebody does,
 * which does not change when they move branch.
 */
export default async function DepartmentsPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/departments"));
  if (!hasPermission(grantedPermissionKeys(principal), "departments.read")) redirect("/dashboard");

  const canManage = can(principal, "departments.manage");

  const [departments, employees] = await Promise.all([
    listDepartments(),
    canManage && hasPermission(grantedPermissionKeys(principal), "employees.read")
      ? employeeOptions(branchScope(principal, "employees.read"))
      : [],
  ]);

  // The head is an employee id with no relation behind it, so the name is
  // looked up rather than joined.
  const heads = await departmentHeads(departments);
  const withHeads = departments.map((department) => ({
    ...department,
    head: department.headEmployeeId ? (heads.get(department.headEmployeeId) ?? null) : null,
  }));

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="Departments"
        description="How the work is grouped — kitchen, front of house, delivery. Optional on an employee, but they make rosters and reports readable."
      />
      <DepartmentsEditor departments={serialize(withHeads)} employees={serialize(employees)} canManage={canManage} />
    </div>
  );
}
