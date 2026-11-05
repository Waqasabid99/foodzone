import Link from "next/link";
import { redirect } from "next/navigation";
import { Plus, UserCog } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import ListFilters from "@/components/dashboard/inventory/ListFilters";
import Chip from "@/components/dashboard/inventory/Chip";
import EmptyState from "@/components/dashboard/inventory/EmptyState";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listUsers } from "@/server/services/user.service";
import { listRoles } from "@/server/services/role.service";
import { listBranches } from "@/server/services/branch.service";
import { USER_STATES, roleSummary } from "@/lib/people";
import { lastSeen } from "@/lib/customer-form";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Users — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Everyone who can sign in, and what they may do. Employees (contracts, pay,
 * attendance) are a separate thing under People; this is the login account.
 */
export default async function UsersPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/users"));
  if (!hasPermission(grantedPermissionKeys(principal), "users.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const search = String(one(params.q) ?? "").trim().slice(0, 100);
  const status = USER_STATES[one(params.status)] ? one(params.status) : "";
  const cursor = one(params.cursor) || undefined;

  const [roles, branchPage] = await Promise.all([listRoles(), listBranches({ limit: 100 })]);
  const branches = branchPage.items ?? branchPage;
  const roleKey = roles.some((role) => role.key === one(params.role)) ? one(params.role) : "";
  const branchId = branches.some((branch) => branch.id === one(params.branch)) ? one(params.branch) : "";

  const query = {
    ...(search ? { search } : {}),
    ...(status ? { status } : {}),
    ...(roleKey ? { roleKey } : {}),
    ...(branchId ? { branchId } : {}),
    limit: PAGE_SIZE,
  };
  const page = await listUsers({ ...query, cursor }).catch((error) => {
    if (cursor) return listUsers(query);
    throw error;
  });
  const users = serialize(page.items);

  const href = (extra = {}) => {
    const query = new URLSearchParams();
    const values = { q: search, status, role: roleKey, branch: branchId, ...extra };
    for (const [key, value] of Object.entries(values)) if (value) query.set(key, String(value));
    const text = query.toString();
    return text ? `/dashboard/users?${text}` : "/dashboard/users";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Users"
        description="Everyone who can sign in, and what each of them may do. A new person is emailed an invitation and sets their own password."
        actions={
          can(principal, "users.create") ? (
            <Link href="/dashboard/users/new" className="inline-flex items-center gap-2 rounded-field bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase tracking-wide text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
              <Plus aria-hidden="true" className="size-4" />
              New user
            </Link>
          ) : null
        }
      />

      <ListFilters
        id="users"
        fields={[
          { type: "search", name: "q", label: "Search", value: search, placeholder: "Name, email or phone" },
          { type: "select", name: "status", label: "Status", value: status, options: [{ value: "", label: "Any status" }, ...Object.entries(USER_STATES).map(([value, state]) => ({ value, label: state.label }))] },
          { type: "select", name: "role", label: "Role", value: roleKey, options: [{ value: "", label: "Any role" }, ...roles.map((role) => ({ value: role.key, label: role.name }))] },
          ...(branches.length > 1
            ? [{ type: "select", name: "branch", label: "Branch", value: branchId, options: [{ value: "", label: "Any branch" }, ...branches.map((branch) => ({ value: branch.id, label: branch.name }))] }]
            : []),
        ]}
      />

      {users.length ? (
        <>
          <ul className="flex flex-col gap-3">
            {users.map((user) => {
              const state = USER_STATES[user.status] ?? USER_STATES.ACTIVE;
              return (
                <li key={user.id} className="flex flex-wrap items-start justify-between gap-3 rounded-card bg-surface-container-lowest p-5">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Link href={`/dashboard/users/${user.id}`} className="text-label-bold text-on-surface hover:underline">{user.name}</Link>
                      <Chip tone={state.tone}>{state.label}</Chip>
                      {user.invitePending ? <Chip tone="bg-warning-container text-on-warning-container">Invitation not accepted</Chip> : null}
                      {user.isSuperAdmin ? <Chip tone="bg-tertiary-container text-on-tertiary-container">Super admin</Chip> : null}
                    </p>
                    <p className="mt-1 text-body-md text-on-surface-variant">{user.email ?? user.phone ?? "No contact details"}</p>
                    <p className="text-body-md text-on-surface-variant">{roleSummary(user.roles)}</p>
                  </div>
                  <p className="text-right text-body-md text-on-surface-variant">
                    {user.lastLoginAt ? `Last signed in ${lastSeen(user.lastLoginAt).toLowerCase()}` : "Never signed in"}
                  </p>
                </li>
              );
            })}
          </ul>
          {cursor || page.nextCursor ? (
            <div className="flex flex-wrap gap-2">
              {cursor ? <Link href={href({ cursor: "" })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Newest</Link> : null}
              {page.nextCursor ? <Link href={href({ cursor: page.nextCursor })} className="rounded-field bg-surface-container-high px-4 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest">Older</Link> : null}
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState
          icon={UserCog}
          title={search || status || roleKey || branchId ? "Nobody matches that" : "No users yet"}
          action={can(principal, "users.create") ? { href: "/dashboard/users/new", label: "Invite someone" } : null}
        >
          {search || status || roleKey || branchId ? "Try a different search or clear the filters." : "Invite your first colleague."}
        </EmptyState>
      )}
    </div>
  );
}
