import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, ShieldCheck } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listRoles } from "@/server/services/role.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Roles — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Roles are how permissions reach people. The seeded ones cover the usual
 * jobs; anything unusual is a role of your own rather than a pile of
 * per-person exceptions, which nobody can audit later.
 */
export default async function RolesPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/roles"));
  if (!hasPermission(grantedPermissionKeys(principal), "roles.read")) redirect("/dashboard");

  const roles = serialize(await listRoles());
  const system = roles.filter((role) => role.isSystem);
  const custom = roles.filter((role) => !role.isSystem);
  const canCreate = can(principal, "roles.create");

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Roles"
        description="Each role is a set of permissions. Seniority decides who may grant what: you can only hand out roles below your own, and only permissions you hold yourself."
        actions={
          canCreate ? (
            <Link href="/dashboard/roles/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              New role
            </Link>
          ) : null
        }
      />

      {custom.length ? (
        <Section title="Your roles" description="Made here, and changeable here.">
          <RoleList roles={custom} principal={principal} />
        </Section>
      ) : null}

      <Section
        title="Built-in roles"
        description="These come with the system and cannot be renamed or deleted, so an upgrade never silently changes what a job can do. To vary one, copy it into a role of your own."
      >
        <RoleList roles={system} principal={principal} />
      </Section>

      {!custom.length && canCreate ? (
        <p className="flex items-center gap-2 text-body-md text-on-surface-variant">
          <ShieldCheck aria-hidden="true" className="size-4" />
          Nothing custom yet — <Link href="/dashboard/roles/new" className="text-primary hover:underline">make a role</Link> when a job does not fit one above.
        </p>
      ) : null}
    </div>
  );
}

function RoleList({ roles, principal }) {
  return (
    <ul className="flex flex-col gap-2">
      {roles.map((role) => {
        const grantable = principal.isSuperAdmin || role.level > principal.level;
        return (
          <li key={role.id} className="flex flex-wrap items-start justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/roles/${role.id}`} className="text-label-bold text-on-surface hover:underline">{role.name}</Link>
                <Chip>{role.scope === "GLOBAL" ? "Company-wide" : "Per branch"}</Chip>
                {role.isSystem ? <Chip>Built in</Chip> : null}
                {grantable ? null : <Chip tone="bg-warning-container text-on-warning-container">Above your level</Chip>}
              </p>
              {role.description ? <p className="mt-1 text-body-md text-on-surface-variant">{role.description}</p> : null}
            </div>
            <p className="text-right text-body-md text-on-surface-variant">
              <span className="block">{role.permissionCount} {role.permissionCount === 1 ? "permission" : "permissions"}</span>
              <span>{role.userCount} {role.userCount === 1 ? "person" : "people"}</span>
            </p>
          </li>
        );
      })}
    </ul>
  );
}
