import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import RolePermissions from "@/components/dashboard/admin/RolePermissions";
import RoleDetailsForm from "@/components/dashboard/admin/RoleDetailsForm";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getRole, listPermissions } from "@/server/services/role.service";
import { listUsers } from "@/server/services/user.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";
export const metadata = { title: "Role — FoodZone", robots: { index: false, follow: false } };

export default async function RolePage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/roles/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "roles.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getRole(id));
  if (!raw) notFound();
  const role = serialize(raw);

  const [modules, holders] = await Promise.all([
    listPermissions(),
    listUsers({ roleKey: role.key, limit: 10 }).catch(() => ({ items: [] })),
  ]);

  // A built-in role is fixed on purpose: an upgrade must never change what a
  // job can do underneath you. Seniority still applies to your own level.
  const seniorEnough = principal.isSuperAdmin || role.level > principal.level;
  const canEdit = can(principal, "roles.update") && !role.isSystem && seniorEnough;
  const canDelete = can(principal, "roles.delete") && !role.isSystem && seniorEnough && role.userCount === 0;
  const holds = grantedPermissionKeys(principal);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={role.name}
        description={role.description ?? (role.scope === "GLOBAL" ? "Covers every branch." : "Granted one branch at a time.")}
        back={{ href: "/dashboard/roles", label: "Roles" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip>{role.scope === "GLOBAL" ? "Company-wide" : "Per branch"}</Chip>
            <Chip>Level {role.level}</Chip>
            {role.isSystem ? <Chip tone="bg-tertiary-container text-on-tertiary-container">Built in</Chip> : null}
          </div>
        }
      />

      {role.isSystem ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">
          Built-in roles cannot be edited or deleted. To vary this one, <Link href={`/dashboard/roles/new?copy=${role.id}`} className="text-primary hover:underline">start a role from it</Link> and change the copy.
        </p>
      ) : !seniorEnough ? (
        <p className="rounded-card bg-warning-container px-5 py-3 text-body-md text-on-warning-container">
          This role is at or above your own seniority, so you cannot change it.
        </p>
      ) : null}

      {canEdit ? (
        <Section title="Details">
          <RoleDetailsForm role={role} maxLevel={principal.isSuperAdmin ? 1 : principal.level + 1} />
        </Section>
      ) : null}

      <Section
        title="Permissions"
        description={canEdit ? "Tick what this role may do. Saving applies to everyone who holds it." : "What this role may do."}
      >
        <RolePermissions
          role={role}
          modules={serialize(modules.modules)}
          granted={role.permissions}
          holds={holds}
          canEdit={canEdit}
          isSuperAdmin={principal.isSuperAdmin}
        />
      </Section>

      <Section title="Who holds it" description={`${role.userCount} ${role.userCount === 1 ? "person has" : "people have"} this role.`}>
        {holders.items.length ? (
          <ul className="flex flex-wrap gap-2">
            {serialize(holders.items).map((user) => (
              <li key={user.id}>
                <Link href={`/dashboard/users/${user.id}`} className="inline-flex rounded-field bg-surface-container-low px-3 py-2 text-label-bold text-on-surface hover:bg-surface-container">
                  {user.name}
                </Link>
              </li>
            ))}
            {role.userCount > holders.items.length ? (
              <li className="self-center text-body-md text-on-surface-variant">and {role.userCount - holders.items.length} more</li>
            ) : null}
          </ul>
        ) : (
          <p className="text-body-md text-on-surface-variant">Nobody yet.</p>
        )}
      </Section>

      {canDelete ? (
        <Section title="Delete" description="Only possible while nobody holds it.">
          <ActionButton
            method="delete"
            endpoint={`/admin/roles/${role.id}`}
            tone="danger"
            confirm={`Delete the ${role.name} role?`}
            success="Role deleted."
            redirectTo="/dashboard/roles"
          >
            Delete this role
          </ActionButton>
        </Section>
      ) : null}
    </div>
  );
}
