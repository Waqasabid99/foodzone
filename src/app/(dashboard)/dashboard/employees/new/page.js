import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import EmployeeForm from "@/components/dashboard/people/EmployeeForm";
import { getAuthContext } from "@/lib/api/auth";
import { can } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { departmentOptions, linkableAccounts } from "@/server/content/people-admin";
import { scopedBranches } from "@/server/content/branch-scope";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New employee — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewEmployeePage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/employees/new"));
  if (!can(principal, "employees.create")) redirect("/dashboard/employees");

  const [branches, departments, accounts] = await Promise.all([
    scopedBranches(principal, "employees.create"),
    departmentOptions(),
    can(principal, "users.read") ? linkableAccounts() : [],
  ]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="New employee"
        description="The contract side: who they are, where they work and on what terms. Pay is set afterwards, on their own page."
        back={{ href: "/dashboard/employees", label: "Employees" }}
      />
      <EmployeeForm
        branches={serialize(branches)}
        departments={serialize(departments)}
        accounts={serialize(accounts)}
        canLinkAccount={can(principal, "users.read")}
      />
    </div>
  );
}
