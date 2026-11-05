import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import TablesEditor from "@/components/dashboard/service/TablesEditor";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listTables } from "@/server/services/table.service";
import { areaOptions, scopedBranches, tableOccupancy } from "@/server/content/service-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Tables — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The dining room, one branch at a time.
 *
 * Per branch rather than a combined list because a table only means anything
 * in its own room: "T-4" exists at every outlet and seating somebody at the
 * wrong one is the whole failure mode.
 */
export default async function TablesPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/tables"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "tables.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const branches = await scopedBranches(principal, "tables.read");

  if (!branches.length) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Tables" description="The dining room." />
        <p className="rounded-card bg-surface-container-lowest px-6 py-10 text-center text-body-md text-on-surface-variant">
          You do not have a dining room to manage.
        </p>
      </div>
    );
  }

  const branchId = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : branches[0].id;
  const [page, areas, seated] = await Promise.all([
    listTables({ branchId, scope: branchScope(principal, "tables.read"), limit: 200 }),
    areaOptions(branchId),
    // A room with no idea which tables are occupied is a seating plan, not a
    // floor. The cashier's question is "where can I put these four people".
    hasPermission(permissions, "orders.read") ? tableOccupancy(principal, branchId) : {},
  ]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Tables"
        description="The room as it stands: who is sitting where, and what is still laid out. A table can be tagged on an order and given its own QR code, so a customer scanning it is already seated."
      />

      {branches.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {branches.map((branch) => (
            <Link
              key={branch.id}
              href={`/dashboard/tables?branch=${branch.id}`}
              aria-current={branch.id === branchId ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold ${branch.id === branchId ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {branch.name}
            </Link>
          ))}
        </div>
      ) : null}

      <TablesEditor
        key={branchId}
        branchId={branchId}
        tables={serialize(page.items)}
        areas={areas}
        seated={serialize(seated)}
        canSeat={can(principal, "orders.create", { branchId })}
        canCreate={can(principal, "tables.create", { branchId })}
        canUpdate={can(principal, "tables.update", { branchId })}
        canDelete={can(principal, "tables.delete", { branchId })}
      />
    </div>
  );
}
