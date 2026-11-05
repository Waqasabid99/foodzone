import Link from "next/link";
import { redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import ReceiveForm from "@/components/dashboard/purchasing/ReceiveForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { actionableLocations, itemOptions } from "@/server/content/inventory-admin";
import { orderForReceiving, receivableOrders, supplierOptions } from "@/server/content/purchasing-admin";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Receive a delivery — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Receiving, either against an order or without one.
 *
 * Both are real: most food arrives against a purchase order, and some arrives
 * because a chef rang a supplier at six in the morning. Refusing the second
 * would not stop it happening — it would stop it being recorded.
 */
export default async function NewGoodsReceiptPage({ searchParams }) {
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref("/dashboard/goods-receipts/new"));

  const locations = await actionableLocations(principal, "goods_receipts.create");
  if (!locations.length) redirect("/dashboard/goods-receipts");

  const params = await searchParams;
  const one = (value) => (Array.isArray(value) ? value[0] : value);
  const orderId = one(params.order) || null;

  const [suppliers, items, order, waiting] = await Promise.all([
    supplierOptions(),
    itemOptions(),
    orderForReceiving(orderId),
    receivableOrders(principal),
  ]);

  // An order named in the URL that the viewer cannot reach is treated as no
  // order at all rather than confirmed with an error.
  const reachable = order && inScope(branchScope(principal, "purchase_orders.read"), order.branchId) ? order : null;
  const usable = reachable?.items.some((line) => Number(line.outstanding) > 0) ? reachable : null;
  const forLocation = usable ? locations.filter((row) => row.branchId === usable.branchId) : locations;

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title="Receive a delivery"
        description="What actually turned up, and what was sent back. Saving keeps it as a draft; posting is what puts the stock in."
        back={usable ? { href: `/dashboard/purchase-orders/${usable.id}`, label: usable.poNumber } : { href: "/dashboard/goods-receipts", label: "Goods receipts" }}
      />

      {!usable && waiting.length ? (
        <div className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
          <p className="text-label-bold text-on-surface">Waiting on a delivery</p>
          <p className="text-body-md text-on-surface-variant">
            Receiving against the order fills in what was expected and at what price, and keeps the order&rsquo;s outstanding
            figures honest.
          </p>
          <ul className="flex flex-wrap gap-2">
            {serialize(waiting).slice(0, 8).map((row) => (
              <li key={row.id}>
                <Link
                  href={`/dashboard/goods-receipts/new?order=${row.id}`}
                  className="inline-flex rounded-field bg-surface-container-high px-3 py-2 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {row.poNumber} — {row.supplier.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {usable && !forLocation.length ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface">
          That order is for another branch, and you cannot receive stock there.
        </p>
      ) : (
        <ReceiveForm
          locations={serialize(forLocation)}
          suppliers={serialize(suppliers)}
          items={serialize(items)}
          order={usable ? serialize(usable) : null}
        />
      )}
    </div>
  );
}
