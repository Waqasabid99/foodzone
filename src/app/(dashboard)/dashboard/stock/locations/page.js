import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import LocationsEditor from "@/components/dashboard/inventory/LocationsEditor";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { scopedBranches } from "@/server/content/inventory-admin";
import { listLocations } from "@/server/services/inventory-item.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Stock locations — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** The places stock is kept, per branch. Each branch manages its own. */
export default async function StockLocationsPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/stock/locations"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "stock_locations.read")) redirect("/dashboard");

  const [branches, locations] = await Promise.all([
    scopedBranches(principal, "stock_locations.read"),
    listLocations({ scope: branchScope(principal, "stock_locations.read") }),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Stock locations"
        description="Where stock is kept — a store room, a walk-in fridge, the bar. Count and move stock between them; each branch has its own."
        back={{ href: "/dashboard/stock", label: "Stock" }}
      />
      {branches.map((branch) => (
        <LocationsEditor
          key={branch.id}
          branch={branch}
          locations={locations.filter((location) => location.branchId === branch.id)}
          canManage={can(principal, "stock_locations.manage", { branchId: branch.id })}
        />
      ))}
    </div>
  );
}
