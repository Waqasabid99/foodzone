import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import ReceiptActions from "@/components/dashboard/purchasing/ReceiptActions";
import BillFromReceipt from "@/components/dashboard/purchasing/BillFromReceipt";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getGoodsReceipt } from "@/server/services/goods-receipt.service";
import { billForReceipt, userNames } from "@/server/content/purchasing-admin";
import { getSiteIdentity } from "@/server/content/site";
import { formatMoney } from "@/lib/format";
import { formatQuantity } from "@/lib/inventory";
import { GRN_STAGE_HINT, GRN_STATES, dateLabel, receiptTotals } from "@/lib/purchasing";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Goods receipt — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One delivery.
 *
 * Delivered, rejected and accepted are shown as three separate columns rather
 * than one net figure, because they answer three different questions: what the
 * supplier says they brought, what was refused, and what the restaurant is
 * actually paying for and now holds.
 */
export default async function GoodsReceiptPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/goods-receipts/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "goods_receipts.read")) redirect("/dashboard");

  const raw = await nullIfMissing(getGoodsReceipt(id));
  if (!raw || !inScope(branchScope(principal, "goods_receipts.read"), raw.branchId)) notFound();

  const receipt = serialize(raw);
  const branchId = receipt.branchId;
  const [names, bill, { currency, timeZone }] = await Promise.all([
    userNames([receipt.receivedById, receipt.approvedById]),
    billForReceipt(principal, id),
    getSiteIdentity(),
  ]);

  const posted = receipt.status === "COMPLETED";
  const totals = receiptTotals(receipt.items, { landedCost: receipt.landedCost });
  // `billForReceipt` answers null two ways — there is no bill, and bills are
  // not this viewer's to see — and only one of those is a fact about the
  // books. Without the distinction a branch manager was told his delivery was
  // still sitting in goods received not invoiced, days after finance had
  // billed and paid it.
  const seesBills = can(principal, "supplier_bills.read", { branchId });
  const canBill = posted && !bill && can(principal, "supplier_bills.create", { branchId });

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={receipt.grnNumber}
        description={`${receipt.supplier.name} · arrived ${dateLabel(receipt.receivedAt, timeZone)} into ${receipt.location.name}${names[receipt.receivedById] ? ` · checked in by ${names[receipt.receivedById]}` : ""}`}
        back={{ href: "/dashboard/goods-receipts", label: "Goods receipts" }}
        actions={<Chip tone={GRN_STATES[receipt.status]?.tone}>{GRN_STATES[receipt.status]?.label ?? receipt.status}</Chip>}
      />

      {GRN_STAGE_HINT[receipt.status] ? (
        <p className="rounded-card bg-surface-container-lowest px-5 py-4 text-body-md text-on-surface-variant">
          {GRN_STAGE_HINT[receipt.status]}
        </p>
      ) : null}

      <ReceiptActions
        receipt={receipt}
        currency={currency}
        canPost={can(principal, "goods_receipts.approve", { branchId })}
        canCancel={can(principal, "goods_receipts.create", { branchId })}
      />

      <Section title="What arrived">
        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-xl border-collapse text-left text-body-md">
            <caption className="sr-only">Delivery lines</caption>
            <thead>
              <tr className="border-b border-outline-variant text-label-bold text-on-surface-variant">
                <th scope="col" className="py-2 pr-4 font-normal">Item</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Delivered</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Rejected</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Accepted</th>
                <th scope="col" className="py-2 pr-4 text-right font-normal">Price</th>
                <th scope="col" className="py-2 text-right font-normal">Line</th>
              </tr>
            </thead>
            <tbody>
              {receipt.items.map((line, index) => {
                const unit = line.uom?.code ?? line.item.uom?.code ?? null;
                const rejected = Number(line.rejectedQuantity);
                return (
                  <tr key={line.id} className="border-b border-outline-variant align-top">
                    <th scope="row" className="py-3 pr-4 text-left font-normal text-on-surface">
                      {line.item.name}
                      {line.batchNumber ? (
                        <span className="block font-mono text-label-bold font-normal text-on-surface-variant">Batch {line.batchNumber}</span>
                      ) : null}
                      {line.expiryDate ? (
                        <span className="block text-label-bold font-normal text-on-surface-variant">Use by {dateLabel(line.expiryDate)}</span>
                      ) : null}
                    </th>
                    <td className="py-3 pr-4 text-right tabular-nums text-on-surface">{formatQuantity(line.quantity, { unit })}</td>
                    <td className={`py-3 pr-4 text-right tabular-nums ${rejected ? "text-error" : "text-on-surface-variant"}`}>
                      {rejected ? formatQuantity(line.rejectedQuantity, { unit }) : "—"}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-on-surface">
                      {formatQuantity(totals.lines[index]?.accepted ?? 0, { unit })}
                    </td>
                    <td className="py-3 pr-4 text-right tabular-nums text-on-surface-variant">{formatMoney(line.unitCost, currency)}</td>
                    <td className="py-3 text-right tabular-nums text-on-surface">{formatMoney(line.lineTotal, currency)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <dl className="grid gap-2 rounded-field bg-surface-container p-4 text-body-md">
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Goods accepted</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(receipt.subtotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Tax</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(receipt.taxTotal, currency)}</dd>
          </div>
          {Number(receipt.landedCost) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Freight</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(receipt.landedCost, currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
            <dt className="text-label-bold text-on-surface">Delivery total</dt>
            <dd className="text-label-bold tabular-nums text-on-surface">{formatMoney(receipt.grandTotal, currency)}</dd>
          </div>
        </dl>

        {Number(receipt.landedCost) ? (
          <p className="text-body-md text-on-surface-variant">
            Freight is spread across the lines by value before the batches are priced, so it lands in the cost of the
            food rather than in an expense nobody attributes. Margins are honest as a result.
          </p>
        ) : null}
        {receipt.notes ? <p className="text-body-md text-on-surface-variant">“{receipt.notes}”</p> : null}
      </Section>

      <Section title="Paperwork">
        <ul className="flex flex-col gap-2 text-body-md text-on-surface">
          <li>
            {receipt.purchaseOrder ? (
              <>
                Against{" "}
                <Link href={`/dashboard/purchase-orders/${receipt.purchaseOrder.id}`} className="font-mono text-label-bold hover:underline">
                  {receipt.purchaseOrder.poNumber}
                </Link>
                .
              </>
            ) : (
              "No purchase order — received direct."
            )}
          </li>
          {receipt.supplierInvoiceNumber ? <li>Their delivery note: {receipt.supplierInvoiceNumber}</li> : null}
          <li className="text-on-surface-variant">
            {bill ? (
              <>
                Billed on{" "}
                <Link href={`/dashboard/supplier-bills/${bill.id}`} className="font-mono text-label-bold text-on-surface hover:underline">
                  {bill.billNumber}
                </Link>
                .
              </>
            ) : !seesBills ? (
              "Whether this has been invoiced is kept on the finance side."
            ) : posted ? (
              "Not yet invoiced. The value sits in goods received not invoiced until the supplier's bill arrives."
            ) : (
              "Nothing can be billed until this is posted."
            )}
          </li>
        </ul>
        {canBill ? <BillFromReceipt receiptId={id} grnNumber={receipt.grnNumber} /> : null}
      </Section>
    </div>
  );
}
