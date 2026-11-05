import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import { PackageCheck } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import PurchaseOrderActions from "@/components/dashboard/purchasing/PurchaseOrderActions";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getPurchaseOrder } from "@/server/services/purchase-order.service";
import { listGoodsReceipts } from "@/server/services/goods-receipt.service";
import { userNames } from "@/server/content/purchasing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { formatQuantity } from "@/lib/inventory";
import { GRN_STATES, PO_STAGE_HINT, PO_STATES, dateLabel, poEditable, poReceivable } from "@/lib/purchasing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Purchase order — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One order, and what is still owed on it.
 *
 * The outstanding column is the reason this page exists: it is the difference
 * between what was asked for and what has actually turned up, which is what
 * somebody chasing a supplier needs in front of them.
 */
export default async function PurchaseOrderPage({ params }) {
  const { timeZone } = await getSiteIdentity();
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/purchase-orders/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "purchase_orders.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getPurchaseOrder(id));
  // Out of scope answers "not found" rather than "forbidden": that this order
  // exists at another branch is itself something a scoped buyer has no business
  // being told.
  if (!raw || !inScope(branchScope(principal, "purchase_orders.read"), raw.branchId)) notFound();

  const order = serialize(raw);
  const branchId = order.branchId;
  const [names, receipts] = await Promise.all([
    userNames([order.createdById, order.approvedById]),
    hasPermission(permissions, "goods_receipts.read")
      ? listGoodsReceipts({ purchaseOrderId: id, scope: branchScope(principal, "goods_receipts.read"), limit: 20 })
      : { items: [] },
  ]);

  const currency = order.currency ?? "PKR";
  const editable = poEditable(order.status) && can(principal, "purchase_orders.update", { branchId });
  const canReceive = poReceivable(order.status) && can(principal, "goods_receipts.create", { branchId });
  const outstanding = order.items.filter((line) => Number(line.outstandingQuantity) > 0);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={order.poNumber}
        description={`${order.supplier.name} · raised ${dateLabel(order.orderDate, timeZone)}${names[order.createdById] ? ` by ${names[order.createdById]}` : ""}`}
        back={{ href: "/dashboard/purchase-orders", label: "Purchase orders" }}
        actions={
          <>
            <Chip tone={PO_STATES[order.status]?.tone}>{PO_STATES[order.status]?.label ?? order.status}</Chip>
            {editable ? (
              <Link
                href={`/dashboard/purchase-orders/${id}/edit`}
                className="rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Edit
              </Link>
            ) : null}
            {canReceive ? (
              <Link
                href={`/dashboard/goods-receipts/new?order=${id}`}
                className="inline-flex items-center gap-2 rounded-field bg-primary-container px-4 py-2.5 text-label-bold text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <PackageCheck aria-hidden="true" className="size-4" />
                Receive a delivery
              </Link>
            ) : null}
          </>
        }
      />

      <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface-variant">
        {PO_STAGE_HINT[order.status]}
      </p>

      <PurchaseOrderActions
        order={order}
        currency={currency}
        can={{
          submit: can(principal, "purchase_orders.create", { branchId }),
          approve: can(principal, "purchase_orders.approve", { branchId }),
          send: can(principal, "purchase_orders.send", { branchId }),
          cancel: can(principal, "purchase_orders.cancel", { branchId }),
        }}
      />

      <Section title="What was ordered">
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-xl border-collapse text-left text-body-md">
            <caption className="sr-only">Order lines</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="py-2 pr-4 font-normal">Item</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Ordered</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Arrived</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Still to come</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Unit price</th>
                <th scope="col" className="py-2 text-right font-normal">Line</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((line) => {
                const unit = line.uom?.code ?? line.item.uom?.code ?? null;
                const left = Number(line.outstandingQuantity);
                return (
                  <tr key={line.id} className="border-b border-outline-variant align-top">
                    <th scope="row" className="py-3 pr-4 text-left font-normal text-on-surface">
                      {line.item.name}
                      <span className="block font-mono text-label-bold font-normal text-on-surface-variant">{line.item.sku}</span>
                    </th>
                    <td className="py-3 pr-4 text-right tabular-nums text-on-surface">{formatQuantity(line.quantity, { unit })}</td>
                    <td className="py-3 pr-4 text-right tabular-nums text-on-surface-variant">{formatQuantity(line.receivedQuantity, { unit })}</td>
                    <td className={`py-3 pr-4 text-right tabular-nums ${left > 0 ? "text-on-surface" : "text-on-surface-variant"}`}>
                      {left > 0 ? formatQuantity(line.outstandingQuantity, { unit }) : "—"}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-on-surface-variant">{formatMoney(line.unitPrice, currency)}</td>
                    <td className="py-3 text-right tabular-nums text-on-surface">{formatMoney(line.lineTotal, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <dl className="grid gap-2 rounded-field bg-surface-container p-4 text-body-md">
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Goods</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(order.subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Tax</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(order.taxTotal, currency)}</dd>
          </div>
          {Number(order.shippingCost) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Delivery</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(order.shippingCost, currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
            <dt className="text-label-bold text-on-surface">Order total</dt>
            <dd className="text-label-bold tabular-nums text-on-surface">{formatMoney(order.grandTotal, currency)}</dd>
          </div>
        </dl>

        {outstanding.length && order.status !== "DRAFT" ? (
          <p className="text-body-md text-on-surface-variant">
            {outstanding.length} {outstanding.length === 1 ? "line is" : "lines are"} still outstanding
            {order.expectedAt ? `, expected ${dateLabel(order.expectedAt, timeZone)}` : ""}.
          </p>
        ) : null}
        {order.notes ? <p className="text-body-md text-on-surface-variant">“{order.notes}”</p> : null}
      </Section>

      {hasPermission(permissions, "goods_receipts.read") ? (
        <Section title="Deliveries against this order">
          {receipts.items.length ? (
            <ul className="flex flex-col gap-2">
              {serialize(receipts.items).map((receipt) => (
                <li key={receipt.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={`/dashboard/goods-receipts/${receipt.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                      {receipt.grnNumber}
                    </Link>
                    <Chip tone={GRN_STATES[receipt.status]?.tone}>{GRN_STATES[receipt.status]?.label ?? receipt.status}</Chip>
                    <span className="text-body-md text-on-surface-variant">{dateLabel(receipt.receivedAt, timeZone)}</span>
                  </span>
                  <span className="tabular-nums text-body-md text-on-surface">{formatMoney(receipt.grandTotal, currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">Nothing has arrived against this order yet.</p>
          )}
        </Section>
      ) : null}

      {order.approvedAt ? (
        <p className="text-body-md text-on-surface-variant">
          Approved {dateLabel(order.approvedAt, timeZone)}
          {names[order.approvedById] ? ` by ${names[order.approvedById]}` : ""}.
        </p>
      ) : null}
    </div>
  );
}
