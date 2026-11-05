import Link from "next/link";
import { requireReachable } from "@/lib/api/page";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PrintNow from "@/components/dashboard/service/PrintNow";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { assertOrderAccess } from "@/server/services/order.service";
import { getInvoice, receiptPayload } from "@/server/services/invoice.service";
import { formatMoney } from "@/lib/format";
import { ORDER_TYPE_LABELS } from "@/lib/order-status";
import { addressLines, timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Invoice — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The tax document, on A4.
 *
 * Deliberately a different shape from the receipt rather than the same page
 * with a different heading. A receipt proves a payment and is read standing
 * up; an invoice is filed, so it carries both parties in full, the number, the
 * date it was issued, and the tax broken out line by line.
 *
 * Voided invoices still render — somebody chasing a gap in the series needs to
 * see what the number was spent on — but they say so across the top, so a
 * voided copy can never be mistaken for a live one on a desk.
 */
function Party({ title, lines }) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-label-bold uppercase tracking-wide text-on-surface-variant print:text-black">{title}</p>
      {lines.filter(Boolean).map((line, index) => (
        <p key={`${line}-${index}`}>{line}</p>
      ))}
    </div>
  );
}

export default async function InvoicePage({ params }) {
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/dashboard/orders/${id}/invoice`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "invoices.read")) redirect("/dashboard");

  await requireReachable(assertOrderAccess(principal, id, "invoices.read"));

  const [invoice, receipt] = await Promise.all([
    nullIfMissing(getInvoice(id)),
    nullIfMissing(receiptPayload(id)),
  ]);
  if (!invoice || !receipt) notFound();

  const doc = serialize(invoice);
  const { branch, order, customer, lines, discounts, taxLines, totals } = serialize(receipt);
  const currency = totals.currency ?? "PKR";
  const money = (value) => formatMoney(value, currency);
  const extras = [
    ["Discount", totals.discountTotal, true],
    ["Delivery", totals.deliveryFee],
    ["Packaging", totals.packagingFee],
    ["Service charge", totals.serviceCharge],
    ["Tip", totals.tipAmount],
    ["Rounding", totals.roundOff],
  ].filter(([, amount]) => Number(amount));

  return (
    <div className="flex flex-col gap-6">
      <div data-print="hide" className="flex flex-wrap items-center justify-between gap-3">
        <Link href={`/dashboard/orders/${id}`} className="text-label-bold text-primary hover:underline">
          ‹ Back to the order
        </Link>
        <PrintNow />
      </div>

      <article className="mx-auto w-full max-w-3xl bg-white p-8 text-body-md text-black print:p-0">
        {doc.isVoid ? (
          <p className="mb-6 border-2 border-black px-4 py-3 text-center text-label-bold uppercase tracking-widest">
            Void — {doc.voidReason ?? "no reason recorded"}
          </p>
        ) : null}

        <header className="flex flex-wrap items-start justify-between gap-6">
          <div className="flex flex-col gap-0.5">
            <p className="font-display text-headline-md">{branch.legalName ?? branch.name}</p>
            {addressLines(branch).map((line, index) => (
              <p key={`${line}-${index}`}>{line}</p>
            ))}
            {branch.phone ? <p>{branch.phone}</p> : null}
            {branch.email ? <p>{branch.email}</p> : null}
            {branch.taxIdentifier ? <p>Tax no. {branch.taxIdentifier}</p> : null}
          </div>
          <div className="text-right">
            <p className="font-display text-headline-md uppercase tracking-wide">Invoice</p>
            <p className="font-mono">{doc.invoiceNumber}</p>
            <p>Issued {timeLabel(doc.issuedAt)}</p>
          </div>
        </header>

        <hr className="my-6 border-black" />

        <div className="grid gap-6 sm:grid-cols-2">
          <Party
            title="Billed to"
            lines={[
              doc.billingName ?? customer.name ?? "Walk-in customer",
              ...addressLines(doc.billingAddress ?? customer.address),
              doc.billingTaxId ? `Tax no. ${doc.billingTaxId}` : null,
              customer.phone,
            ]}
          />
          <Party
            title="Against"
            lines={[
              `Order ${order.orderNumber}`,
              `${ORDER_TYPE_LABELS[order.type] ?? order.type}${order.table?.name ? ` · table ${order.table.name}` : ""}`,
              `Placed ${timeLabel(order.placedAt)}`,
            ]}
          />
        </div>

        <table className="mt-6 w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-black">
              <th scope="col" className="py-2 pr-3 font-bold">Item</th>
              <th scope="col" className="py-2 pr-3 text-right font-bold">Qty</th>
              <th scope="col" className="py-2 pr-3 text-right font-bold">Unit</th>
              <th scope="col" className="py-2 text-right font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={`${line.name}-${index}`} className="border-b border-outline-variant print:border-black">
                <td className="py-2 pr-3">
                  {line.name}
                  {line.modifiers?.length ? (
                    <span className="block text-label-bold font-normal">
                      {line.modifiers.map((mod) => mod.nameSnapshot).join(", ")}
                    </span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">{line.quantity}</td>
                <td className="py-2 pr-3 text-right tabular-nums">{money(line.unitPrice)}</td>
                <td className="py-2 text-right tabular-nums">{money(line.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-4 flex justify-end">
          <dl className="w-full max-w-xs">
            <div className="flex justify-between gap-6 py-1">
              <dt>Subtotal</dt>
              <dd className="tabular-nums">{money(totals.subtotal)}</dd>
            </div>
            {discounts?.map((discount, index) => (
              <div key={`${discount.label}-${index}`} className="flex justify-between gap-6 py-1">
                <dt>{discount.label ?? "Discount"}</dt>
                <dd className="tabular-nums">−{money(discount.amount)}</dd>
              </div>
            ))}
            {extras.map(([label, amount, negative]) => (
              <div key={label} className="flex justify-between gap-6 py-1">
                <dt>{label}</dt>
                <dd className="tabular-nums">{`${negative ? "−" : ""}${money(amount)}`}</dd>
              </div>
            ))}
            {taxLines?.length ? (
              taxLines.map((tax, index) => (
                <div key={`${tax.name}-${index}`} className="flex justify-between gap-6 py-1">
                  <dt>
                    {tax.name}
                    {tax.rate ? ` (${tax.rate}%)` : ""}
                  </dt>
                  <dd className="tabular-nums">{money(tax.amount)}</dd>
                </div>
              ))
            ) : (
              <div className="flex justify-between gap-6 py-1">
                <dt>Tax</dt>
                <dd className="tabular-nums">{money(totals.taxTotal)}</dd>
              </div>
            )}
            <div className="mt-1 flex justify-between gap-6 border-t border-black py-2 font-bold">
              <dt>Total</dt>
              <dd className="tabular-nums">{money(totals.grandTotal)}</dd>
            </div>
            <div className="flex justify-between gap-6 py-1">
              <dt>Paid</dt>
              <dd className="tabular-nums">{money(totals.paidTotal)}</dd>
            </div>
          </dl>
        </div>
      </article>
    </div>
  );
}
