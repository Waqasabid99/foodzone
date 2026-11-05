import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import PurchaseOrderForm from "@/components/dashboard/purchasing/PurchaseOrderForm";
import { getAuthContext } from "@/lib/api/auth";
import { serialize } from "@/lib/api/serialize";
import { itemOptions } from "@/server/content/inventory-admin";
import { actionableBranches, priceList, supplierOptions } from "@/server/content/purchasing-admin";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "New purchase order — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function NewPurchaseOrderPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/purchase-orders/new"));

  const branches = await actionableBranches(principal, "purchase_orders.create");
  if (!branches.length) redirect("/dashboard/purchase-orders");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const [suppliers, items] = await Promise.all([supplierOptions(), itemOptions()]);

  // A supplier chosen on their own page arrives in the URL, so the form can
  // open already priced rather than waiting for a second choice.
  const preset = suppliers.some((row) => row.id === one(params.supplier)) ? one(params.supplier) : null;
  const priceLists = preset ? { [preset]: await priceList(preset) } : {};

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="New purchase order"
        description="What to buy, from whom, at what price. Nothing is committed until somebody approves it."
        back={{ href: "/dashboard/purchase-orders", label: "Purchase orders" }}
      />
      {suppliers.length ? (
        <PurchaseOrderForm
          branches={serialize(branches)}
          suppliers={serialize(suppliers)}
          items={serialize(items)}
          priceLists={priceLists}
          defaultSupplierId={preset ?? ""}
        />
      ) : (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface">
          There is nobody to buy from yet. Add a supplier first.
        </p>
      )}
    </div>
  );
}
