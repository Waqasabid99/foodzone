import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import UnitsEditor from "@/components/dashboard/inventory/UnitsEditor";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { listUnits } from "@/server/services/uom.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Units — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/** What stock is counted in. Shared by every branch, so only a company-wide role changes it. */
export default async function UnitsPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/inventory-items/units"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "units.read")) redirect("/dashboard");

  const units = serialize(await listUnits());
  const canManage = holdsCompanyWide(principal, "units.manage");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Units"
        description="What stock is counted in. A unit can convert to a base unit of the same kind, so a recipe in grams draws correctly on flour stocked in kilograms."
        back={{ href: "/dashboard/inventory-items", label: "Items" }}
      />
      {!canManage && hasPermission(permissions, "units.manage") ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-3 text-body-md text-on-surface-variant">
          Units are shared by every branch, so only a company-wide role can change them.
        </p>
      ) : null}
      <UnitsEditor units={units} canManage={canManage} />
    </div>
  );
}
