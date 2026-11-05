import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ItemForm from "@/components/dashboard/inventory/ItemForm";
import { getAuthContext } from "@/lib/api/auth";
import { holdsCompanyWide } from "@/lib/api/permissions";
import { categoryOptions, unitOptions } from "@/server/content/inventory-admin";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New stock item — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewInventoryItemPage() {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/inventory-items/new"));
  if (!holdsCompanyWide(principal, "inventory_items.create")) redirect("/dashboard/inventory-items");

  const [categories, units] = await Promise.all([categoryOptions(), unitOptions()]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        title="New stock item"
        description="Something the kitchen keeps on a shelf. It starts with no stock; a delivery, a transfer or an adjustment puts some there."
        back={{ href: "/dashboard/inventory-items", label: "Stock items" }}
      />
      {units.length ? (
        <ItemForm categories={categories} units={units} />
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface">
          Add units first — every item is counted in one.{" "}
          <Link href="/dashboard/inventory-items/units" className="text-label-bold text-primary hover:underline">Set up units</Link>
        </p>
      )}
    </div>
  );
}
