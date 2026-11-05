import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import InventoryCategoriesEditor from "@/components/dashboard/inventory/InventoryCategoriesEditor";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys, holdsCompanyWide } from "@/lib/api/permissions";
import { listInventoryCategories } from "@/server/services/uom.service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Stock categories — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function InventoryCategoriesPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/inventory-items/categories"));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "inventory_categories.read")) redirect("/dashboard");

  const categories = await listInventoryCategories();
  const canManage = holdsCompanyWide(principal, "inventory_categories.manage");

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title="Stock categories"
        description="How the store room groups its items — separate from the menu's categories, which are how customers browse."
        back={{ href: "/dashboard/inventory-items", label: "Items" }}
      />
      <InventoryCategoriesEditor categories={categories} canManage={canManage} />
    </div>
  );
}
