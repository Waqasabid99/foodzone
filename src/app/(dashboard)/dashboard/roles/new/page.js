import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import NewRoleForm from "@/components/dashboard/admin/NewRoleForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getRole, listPermissions } from "@/server/services/role.service";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New role — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewRolePage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/roles/new"));
  if (!can(principal, "roles.create")) redirect("/dashboard/roles");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const copyId = one(params.copy);
  const [modules, copyFrom] = await Promise.all([
    listPermissions(),
    copyId ? getRole(copyId).catch(() => null) : null,
  ]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={copyFrom ? `New role from ${copyFrom.name}` : "New role"}
        description="A role is a set of permissions you can hand to people. You can only include permissions you hold yourself."
        back={{ href: "/dashboard/roles", label: "Roles" }}
      />
      <NewRoleForm
        modules={serialize(modules.modules)}
        holds={grantedPermissionKeys(principal)}
        isSuperAdmin={principal.isSuperAdmin}
        maxLevel={principal.isSuperAdmin ? 1 : principal.level + 1}
        copyFrom={copyFrom ? serialize(copyFrom) : null}
      />
    </div>
  );
}
