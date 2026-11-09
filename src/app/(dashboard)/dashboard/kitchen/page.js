import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import KitchenBoard from "@/components/dashboard/service/KitchenBoard";
import { getAuthContext } from "@/lib/api/auth";
import { can, grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { stationQueue } from "@/server/services/kds.service";
import { scopedBranches, stationOptions } from "@/server/content/service-admin";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { isRealtimeEnabled } from "@/server/realtime/broker";

export const metadata = { title: "Kitchen — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The kitchen display.
 *
 * One branch at a time, always — a board showing two kitchens' tickets is a
 * board that gets the wrong food cooked. The branch is a real choice rather
 * than a filter because of that: there is no "all branches" view and there
 * should not be.
 */
export default async function KitchenPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/kitchen"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "kds.read")) redirect("/dashboard");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const branches = (await scopedBranches(principal, "kds.read")).filter((row) => row.isActive);

  if (!branches.length) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Kitchen" description="Tickets as they come in." />
        <p className="rounded-card bg-surface-container-lowest px-6 py-10 text-center text-body-md text-on-surface-variant">
          You are not assigned to a kitchen.
        </p>
      </div>
    );
  }

  const branchId = branches.some((row) => row.id === one(params.branch)) ? one(params.branch) : branches[0].id;
  const [stations, initial] = await Promise.all([
    stationOptions(),
    stationQueue({ branchId, stationId: one(params.station) || null }),
  ]);
  const stationId = stations.some((row) => row.id === one(params.station)) ? one(params.station) : "";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kitchen"
        description="Oldest first. The board refreshes itself, so nobody has to touch it with their hands full."
      />

      {branches.length > 1 || stations.length ? (
        <div className="flex flex-wrap gap-2">
          {branches.length > 1
            ? branches.map((branch) => (
                <Link
                  key={branch.id}
                  href={`/dashboard/kitchen?branch=${branch.id}`}
                  aria-current={branch.id === branchId ? "page" : undefined}
                  className={`rounded-field px-4 py-2.5 text-label-bold ${branch.id === branchId ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
                >
                  {branch.name}
                </Link>
              ))
            : null}
          {stations.length ? (
            <>
              <Link
                href={`/dashboard/kitchen?branch=${branchId}`}
                aria-current={stationId ? undefined : "page"}
                className={`rounded-field px-4 py-2.5 text-label-bold ${stationId ? "bg-surface-container-lowest text-on-surface hover:bg-surface-container" : "bg-secondary-container text-on-secondary-container"}`}
              >
                Every station
              </Link>
              {stations.map((station) => (
                <Link
                  key={station.id}
                  href={`/dashboard/kitchen?branch=${branchId}&station=${station.id}`}
                  aria-current={station.id === stationId ? "page" : undefined}
                  className={`rounded-field px-4 py-2.5 text-label-bold ${station.id === stationId ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-lowest text-on-surface hover:bg-surface-container"}`}
                >
                  {station.name}
                </Link>
              ))}
            </>
          ) : null}
        </div>
      ) : null}

      <KitchenBoard
        key={`${branchId}-${stationId}`}
        branchId={branchId}
        stationId={stationId}
        stationName={stations.find((row) => row.id === stationId)?.name ?? null}
        initial={{ tickets: serialize(initial) }}
        canBump={can(principal, "kds.update_item_status", { branchId })}
        canSetAside={can(principal, "kds.set_aside", { branchId })}
        liveEnabled={isRealtimeEnabled()}
      />
    </div>
  );
}
