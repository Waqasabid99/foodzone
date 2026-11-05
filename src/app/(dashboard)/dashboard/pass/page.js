import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import PassBoard from "@/components/dashboard/service/PassBoard";
import BillRequests from "@/components/dashboard/service/BillRequests";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { readyToRun } from "@/server/services/kds.service";
import { billRequests } from "@/server/services/order.service";
import { scopedBranches } from "@/server/content/service-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "The pass — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * What is ready, and whose table it goes to.
 *
 * The waiter's screen. One branch at a time for the same reason the kitchen
 * is: a list that mixes two rooms' tables sends food to the wrong one, and
 * "table 6" only means something inside a room.
 *
 * Tables waiting to pay sit under the food rather than on a page of their own,
 * because they are the same walk. A waiter crossing the floor with a tray
 * wants to know on the way back which table was trying to catch their eye.
 */
export default async function PassPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/pass"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "kds.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const branches = (await scopedBranches(principal, "kds.read")).filter((row) => row.isActive);

  if (!branches.length) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="The pass" description="Food that is ready to go out." />
        <p className="rounded-card bg-surface-container-lowest px-6 py-10 text-center text-body-md text-on-surface-variant">
          You are not assigned to a kitchen.
        </p>
      </div>
    );
  }

  const branchId = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : branches[0].id;
  const [runs, waiting] = await Promise.all([
    readyToRun({ branchId }),
    hasPermission(permissions, "orders.read") ? billRequests({ branchId }) : [],
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="The pass"
        description="Food the kitchen has finished, by table, oldest first. It refreshes itself — the number is how long the plate has been standing, not how long ago they ordered."
      />

      {branches.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {branches.map((branch) => (
            <Link
              key={branch.id}
              href={`/dashboard/pass?branch=${branch.id}`}
              aria-current={branch.id === branchId ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold ${branch.id === branchId ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {branch.name}
            </Link>
          ))}
        </div>
      ) : null}

      <PassBoard
        key={branchId}
        branchId={branchId}
        initial={serialize(runs)}
        canHandOver={can(principal, "kds.update_item_status", { branchId })}
      />

      {waiting.length ? <BillRequests tickets={serialize(waiting)} canSettle={can(principal, "payments.capture", { branchId })} /> : null}
    </div>
  );
}
