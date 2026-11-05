import { notFound, redirect } from "next/navigation";
import { nullIfMissing } from "@/lib/api/errors";
import PageHeader from "@/components/dashboard/PageHeader";
import PurchaseOrderForm from "@/components/dashboard/purchasing/PurchaseOrderForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getPurchaseOrder } from "@/server/services/purchase-order.service";
import { itemOptions } from "@/server/content/inventory-admin";
import { priceList, scopedBranches, supplierOptions } from "@/server/content/purchasing-admin";
import { poEditable } from "@/lib/purchasing";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Edit purchase order — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Editing is only possible before approval.
 *
 * After it, the order is what somebody signed off, and changing it silently
 * would defeat the approval — so this page sends you back rather than showing
 * a form that the server would refuse.
 */
export default async function EditPurchaseOrderPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/purchase-orders/${id}/edit`));

  const raw = await nullIfMissing(getPurchaseOrder(id));
  if (!raw || !inScope(branchScope(principal, "purchase_orders.read"), raw.branchId)) notFound();
  if (!poEditable(raw.status) || !can(principal, "purchase_orders.update", { branchId: raw.branchId })) {
    redirect(`/dashboard/purchase-orders/${id}`);
  }

  const order = serialize(raw);
  const [branches, suppliers, items, prices] = await Promise.all([
    scopedBranches(principal, "purchase_orders.read"),
    supplierOptions({ includeInactive: true }),
    itemOptions(),
    priceList(order.supplierId),
  ]);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={`Edit ${order.poNumber}`}
        description="Still a draft, so the lines and the prices can change. Once it is approved this stops being possible."
        back={{ href: `/dashboard/purchase-orders/${id}`, label: order.poNumber }}
      />
      <PurchaseOrderForm
        branches={serialize(branches)}
        suppliers={serialize(suppliers)}
        items={serialize(items)}
        order={order}
        priceLists={{ [order.supplierId]: prices }}
      />
    </div>
  );
}
