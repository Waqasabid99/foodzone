import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import DispatchBoard from "@/components/dashboard/delivery/DispatchBoard";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listDeliveries } from "@/server/services/delivery.service";
import { driverPositions } from "@/server/services/driver.service";
import { scopedBranches } from "@/server/content/delivery-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Dispatch — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The dispatch board.
 *
 * One branch at a time, always. A board mixing two outlets' jobs sends a
 * rider across town for a drop the other branch was about to cover, so the
 * branch is a real choice here rather than a filter — there is no "all
 * branches" view and there should not be.
 */
export default async function DispatchPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/dispatch"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "deliveries.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const branches = (await scopedBranches(principal, "deliveries.read")).filter((row) => row.isActive);

  if (!branches.length) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Dispatch" description="Jobs waiting, and who can take them." />
        <p className="rounded-card bg-surface-container-lowest px-6 py-10 text-center text-body-md text-on-surface-variant">
          You are not dispatching for any branch.
        </p>
      </div>
    );
  }

  const branchId = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : branches[0].id;
  const scope = branchScope(principal, "deliveries.read");

  // The same three reads the dispatch endpoint makes, so the first paint is
  // the real board rather than a spinner that fills in a moment later.
  const [pending, active, drivers] = await Promise.all([
    listDeliveries({ branchId, unassigned: true, scope, limit: 100 }),
    listDeliveries({ branchId, scope, limit: 100 }),
    hasPermission(permissions, "drivers.track") ? driverPositions({ branchId }) : [],
  ]);

  const initial = {
    branchId,
    unassigned: pending.items,
    inFlight: active.items.filter((delivery) => delivery.driverId && delivery.status !== "DELIVERED"),
    drivers,
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dispatch"
        description="What needs a rider, and who can take it. The board refreshes itself, so nobody has to remember to."
        actions={
          <Link
            href="/dashboard/deliveries"
            className="rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Every delivery
          </Link>
        }
      />

      {branches.length > 1 ? (
        <div className="flex flex-wrap gap-2">
          {branches.map((branch) => (
            <Link
              key={branch.id}
              href={`/dashboard/dispatch?branch=${branch.id}`}
              aria-current={branch.id === branchId ? "page" : undefined}
              className={`rounded-field px-4 py-2.5 text-label-bold ${branch.id === branchId ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
            >
              {branch.name}
            </Link>
          ))}
        </div>
      ) : null}

      <DispatchBoard
        key={branchId}
        branchId={branchId}
        initial={serialize(initial)}
        currency={branches.find((row) => row.id === branchId)?.currency ?? "PKR"}
        canAssign={can(principal, "deliveries.assign", { branchId })}
      />
    </div>
  );
}
