import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import UserForm from "@/components/dashboard/admin/UserForm";
import { getAuthContext } from "@/lib/api/auth";
import { can } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listRoles } from "@/server/services/role.service";
import { listBranches } from "@/server/services/branch.service";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New user — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewUserPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/users/new"));
  if (!can(principal, "users.create")) redirect("/dashboard/users");

  const [roles, branchPage] = await Promise.all([listRoles(), listBranches({ limit: 100 })]);
  // You cannot grant a role at or above your own seniority, so the ones you
  // could not grant are not offered.
  const grantable = principal.isSuperAdmin ? roles : roles.filter((role) => role.level > principal.level);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="New user"
        description="They are emailed an invitation and choose their own password, which also proves the address is theirs. Nobody else ever knows it."
        back={{ href: "/dashboard/users", label: "Users" }}
      />
      <UserForm roles={serialize(grantable)} branches={serialize(branchPage.items ?? branchPage)} />
    </div>
  );
}
