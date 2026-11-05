import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import StationsEditor from "@/components/dashboard/stations/StationsEditor";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { listStations } from "@/server/services/station.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Stations — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Where tickets go in the kitchen. Shared by every branch — a product routes
 * to one station everywhere — so changing them takes a company-wide role.
 */
export default async function StationsPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/stations"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "kitchen_stations.read")) redirect("/dashboard");

  const stations = await listStations();
  const canManage = holdsCompanyWide(principal, "kitchen_stations.manage");
  const branchOnly = !canManage && hasPermission(permissions, "kitchen_stations.manage");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Stations"
        description="The parts of the kitchen a ticket can go to — grill, fryer, bar. Each product is sent to one, chosen on the product's page; kitchen screens can show one station's tickets."
      />
      {branchOnly ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">
          Stations are shared by every branch, so only a company-wide role can change them.
        </p>
      ) : null}
      <StationsEditor stations={stations} canManage={canManage} canOpenProducts={hasPermission(permissions, "products.read")} />
    </div>
  );
}
