import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ActionButton from "@/components/dashboard/inventory/ActionButton";
import UserProfileForm from "@/components/dashboard/admin/UserProfileForm";
import UserRoles from "@/components/dashboard/admin/UserRoles";
import UserOverrides from "@/components/dashboard/admin/UserOverrides";
import TemporaryPassword from "@/components/dashboard/admin/TemporaryPassword";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getUser, listSessions } from "@/server/services/user.service";
import { listPermissions, listRoles, listUserOverrides, listUserRoles } from "@/server/services/role.service";
import { listBranches } from "@/server/services/branch.service";
import { USER_STATES, deviceLabel } from "@/lib/people";
import { lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const dynamic = "force-dynamic";
export const metadata = { title: "User — FoodZone", robots: { index: false, follow: false } };

const when = (date) => new Date(date).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function UserPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/users/${id}`));
  if (!hasPermission(grantedPermissionKeys(principal), "users.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getUser(id));
  if (!raw) notFound();
  const user = serialize(raw);

  const canAssign = can(principal, "roles.assign");
  const canUpdate = can(principal, "users.update");
  const canSuspend = can(principal, "users.suspend") && principal.userId !== user.id;
  const canSessions = can(principal, "users.manage_sessions");
  const canPassword = can(principal, "users.reset_password");
  const canDelete = can(principal, "users.delete") && principal.userId !== user.id && !user.isSuperAdmin;
  // A super admin's account is only touchable by another super admin.
  const locked = user.isSuperAdmin && !principal.isSuperAdmin;

  const [assignments, overrides, roles, modules, branchPage, sessions] = await Promise.all([
    listUserRoles(id),
    listUserOverrides(id),
    listRoles(),
    listPermissions(),
    listBranches({ limit: 100 }),
    canSessions ? listSessions(id) : [],
  ]);
  const branches = serialize(branchPage.items ?? branchPage);
  const state = USER_STATES[user.status] ?? USER_STATES.ACTIVE;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={user.name}
        description={[user.email, user.phone].filter(Boolean).join(" · ") || "No contact details"}
        back={{ href: "/dashboard/users", label: "Users" }}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={state.tone}>{state.label}</Chip>
            {user.isSuperAdmin ? <Chip tone="bg-tertiary-container text-on-tertiary-container">Super admin</Chip> : null}
            {user.invitePending ? <Chip tone="bg-warning-container text-on-warning-container">Invitation not accepted</Chip> : null}
          </div>
        }
      />

      {locked ? (
        <p role="status" className="rounded-card bg-warning-container px-5 py-3 text-body-md text-on-warning-container">
          This is a super admin account. Only another super admin can change it.
        </p>
      ) : null}

      <Section title="Account">
        <dl className="grid gap-4 text-body-md sm:grid-cols-3">
          <Detail label="Signed in last">{user.lastLoginAt ? lastSeen(user.lastLoginAt) : "Never"}</Detail>
          <Detail label="Email verified">{user.emailVerified ? "Yes" : "Not yet"}</Detail>
          <Detail label="Account created">{when(user.createdAt)}</Detail>
        </dl>
        {canUpdate && !locked ? <UserProfileForm user={user} /> : null}
      </Section>

      <Section title="Roles" description="What this person may do, and where. A role granted at a branch stops at that branch.">
        <UserRoles user={user} assignments={serialize(assignments)} roles={serialize(roles)} branches={branches} canAssign={canAssign && !locked} />
      </Section>

      <Section title="Exceptions" description="One extra permission, or one taken away, on top of the roles. A refusal always wins.">
        <UserOverrides user={user} overrides={serialize(overrides)} modules={serialize(modules.modules)} branches={branches} canAssign={canAssign && !locked} />
      </Section>

      {canSessions ? (
        <Section title="Where they are signed in" description="Signing out revokes the device immediately, not when its session would have expired.">
          {sessions.length ? (
            <ul className="flex flex-col gap-2">
              {serialize(sessions).map((session) => (
                <li key={session.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                  <p className="text-body-md">
                    <span className="block text-label-bold text-on-surface">{deviceLabel(session)}</span>
                    <span className="text-on-surface-variant">
                      {session.ipAddress ?? "Unknown address"}
                      {session.lastUsedAt ? ` · last used ${lastSeen(session.lastUsedAt).toLowerCase()}` : ` · started ${lastSeen(session.createdAt).toLowerCase()}`}
                    </span>
                  </p>
                  {locked ? null : (
                    <ActionButton method="delete" endpoint={`/admin/users/${user.id}/sessions/${session.id}`} success="Signed out on that device.">
                      Sign out
                    </ActionButton>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">Not signed in anywhere right now.</p>
          )}
          {sessions.length > 1 && !locked ? (
            <ActionButton
              method="delete"
              endpoint={`/admin/users/${user.id}/sessions`}
              tone="danger"
              confirm={`Sign ${user.name} out of every device?`}
              success="Signed out everywhere."
            >
              Sign out everywhere
            </ActionButton>
          ) : null}
        </Section>
      ) : null}

      {!locked && (canPassword || canSuspend || user.invitePending) ? (
        <Section title="Getting them back in">
          <div className="flex flex-col gap-5">
            {user.invitePending && can(principal, "users.create") ? (
              <div className="flex flex-col gap-2">
                <ActionButton endpoint={`/admin/users/${user.id}/invite`} body={{}} success="Invitation sent again.">
                  Send the invitation again
                </ActionButton>
                <p className="text-body-md text-on-surface-variant">They have not set a password yet. A fresh code replaces the old one.</p>
              </div>
            ) : null}

            {canPassword ? <TemporaryPassword user={user} /> : null}

            {canSuspend ? (
              user.status === "SUSPENDED" ? (
                <div className="flex flex-col gap-2">
                  <ActionButton
                    method="patch"
                    endpoint={`/admin/users/${user.id}/status`}
                    body={{ status: "ACTIVE" }}
                    success={`${user.name} can sign in again.`}
                  >
                    Reactivate this account
                  </ActionButton>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <ActionButton
                    method="patch"
                    endpoint={`/admin/users/${user.id}/status`}
                    body={{ status: "SUSPENDED" }}
                    tone="danger"
                    confirm={`Suspend ${user.name}? They are signed out everywhere straight away.`}
                    success={`${user.name} is suspended.`}
                  >
                    Suspend this account
                  </ActionButton>
                  <p className="text-body-md text-on-surface-variant">Suspending signs them out everywhere and keeps everything they have done.</p>
                </div>
              )
            ) : null}
          </div>
        </Section>
      ) : null}

      {canDelete && !locked ? (
        <Section title="Delete" description="The account stops working and disappears from these lists. What they did — orders, approvals, audit trail — is kept, because those records are about the business, not the account.">
          <ActionButton
            method="delete"
            endpoint={`/admin/users/${user.id}`}
            tone="danger"
            confirm={`Delete ${user.name}? They are signed out everywhere and cannot sign in again.`}
            success={`${user.name} deleted.`}
            redirectTo="/dashboard/users"
          >
            Delete this account
          </ActionButton>
        </Section>
      ) : null}

      {hasPermission(grantedPermissionKeys(principal), "audit_logs.read") ? (
        <p className="text-body-md text-on-surface-variant">
          <Link href={`/dashboard/audit-log?actor=${user.id}`} className="text-primary hover:underline">See what this person has done</Link>
        </p>
      ) : null}
    </div>
  );
}

function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-label-bold font-normal text-on-surface-variant">{label}</dt>
      <dd className="mt-0.5 text-on-surface">{children}</dd>
    </div>
  );
}
