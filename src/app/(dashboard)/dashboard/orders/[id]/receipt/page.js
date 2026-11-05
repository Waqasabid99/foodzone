import Link from "next/link";
import { requireReachable } from "@/lib/api/page";
import { notFound, redirect } from "next/navigation";
import PrintNow from "@/components/dashboard/service/PrintNow";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { assertOrderAccess } from "@/server/services/order.service";
import { receiptPayload } from "@/server/services/invoice.service";
import { formatMoney } from "@/lib/format";
import { ORDER_TYPE_LABELS } from "@/lib/order-status";
import { timeLabel } from "@/lib/finance";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Receipt — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * The receipt, as paper.
 *
 * The endpoint behind this returns the same content as JSON, which is right for
 * the phone app and for emailing — but the button on the order screen said
 * "Receipt" next to a printer icon and opened a page of JSON, which is of no
 * use to somebody holding a customer's change.
 *
 * Laid out for an 80mm roll: one narrow column, no colour, nothing that
 * depends on a background printing. It is a normal page as well, so it can be
 * read on screen and shown to a customer who is querying a line.
 */
const WIDTH = "mx-auto w-full max-w-[20rem] font-mono text-[0.8125rem] leading-snug";

function Row({ label, value, bold = false }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "font-bold" : ""}`}>
      <span className="min-w-0">{label}</span>
      <span className="shrink-0 tabular-nums">{value}</span>
    </div>
  );
}

export default async function ReceiptPage({ params, searchParams }) {
  const principal = await getAuthContext();
  const { id } = await params;
  const query = await searchParams;
  if (!principal) redirect(loginHref(`/dashboard/orders/${id}/receipt`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "invoices.read")) redirect("/dashboard");

  await requireReachable(assertOrderAccess(principal, id, "invoices.read"));
  const receipt = serialize(
    await requireReachable(receiptPayload(id)));

  const { store, branch, order, customer, lines, discounts, taxLines, totals, invoice } = receipt;
  const currency = totals.currency ?? "PKR";
  const money = (value) => formatMoney(value, currency);
  // Only the charges that actually applied: a receipt listing five zero lines
  // is harder to check than one listing the two that are real.
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
        <div className="flex flex-wrap items-center gap-4">
          <Link href={`/dashboard/orders/${id}`} className="text-label-bold text-primary hover:underline">
            ‹ Back to the order
          </Link>
          {/* Where a counter actually goes next: the queue has not stopped. */}
          <Link href="/dashboard/orders/new" className="text-label-bold text-primary hover:underline">
            Take another order
          </Link>
        </div>
        <PrintNow auto={query?.print === "1"} />
      </div>

      <article className={`${WIDTH} bg-white p-4 text-black print:p-0`}>
        <header className="flex flex-col items-center gap-0.5 text-center">
          <p className="text-base font-bold uppercase tracking-wide">{store.name ?? branch.legalName ?? branch.name}</p>
          {branch.legalName && branch.legalName !== store.name ? <p>{branch.legalName}</p> : null}
          <p>{branch.name}</p>
          {branch.addressLine1 ? <p>{branch.addressLine1}</p> : null}
          {branch.addressLine2 ? <p>{branch.addressLine2}</p> : null}
          {branch.city ? <p>{[branch.city, branch.postalCode].filter(Boolean).join(" ")}</p> : null}
          {branch.phone ? <p>{branch.phone}</p> : null}
          {branch.taxIdentifier ? <p>Tax no. {branch.taxIdentifier}</p> : null}
        </header>

        <hr className="my-3 border-dashed border-black" />

        <div className="flex flex-col gap-0.5">
          <Row label="Order" value={order.orderNumber} bold />
          {invoice?.invoiceNumber ? <Row label="Invoice" value={invoice.invoiceNumber} /> : null}
          {/* Only when there is one: a collection receipt carrying "Table —"
              is a line that asks a question and then answers it with nothing. */}
          {order.table?.name ? (
            <Row label={ORDER_TYPE_LABELS[order.type] ?? order.type} value={`Table ${order.table.name}`} />
          ) : (
            <Row label="Kind" value={ORDER_TYPE_LABELS[order.type] ?? order.type} />
          )}
          <Row label="Date" value={timeLabel(order.placedAt)} />
          {customer.name ? <Row label="Customer" value={customer.name} /> : null}
          {customer.phone ? <Row label="Phone" value={customer.phone} /> : null}
        </div>

        <hr className="my-3 border-dashed border-black" />

        <ul className="flex flex-col gap-2">
          {lines.map((line, index) => (
            <li key={`${line.name}-${index}`} className="flex flex-col gap-0.5">
              <Row label={`${line.quantity}× ${line.name}`} value={money(line.lineTotal)} />
              {line.modifiers?.map((mod, position) => (
                <p key={`${mod.nameSnapshot}-${position}`} className="pl-4">
                  + {mod.quantity > 1 ? `${mod.quantity}× ` : ""}
                  {mod.nameSnapshot}
                  {Number(mod.priceDelta) ? ` (${money(mod.priceDelta)})` : ""}
                </p>
              ))}
              {line.includes?.map((child, position) => (
                <p key={`${child.name}-${position}`} className="pl-4">
                  · {child.quantity}× {child.name}
                </p>
              ))}
              {line.notes ? <p className="pl-4">“{line.notes}”</p> : null}
            </li>
          ))}
        </ul>

        <hr className="my-3 border-dashed border-black" />

        <div className="flex flex-col gap-0.5">
          <Row label="Subtotal" value={money(totals.subtotal)} />
          {discounts?.map((discount, index) => (
            <Row key={`${discount.label}-${index}`} label={discount.label ?? "Discount"} value={`−${money(discount.amount)}`} />
          ))}
          {extras.map(([label, amount, negative]) => (
            <Row key={label} label={label} value={`${negative ? "−" : ""}${money(amount)}`} />
          ))}
          {taxLines?.length ? (
            taxLines.map((tax, index) => <Row key={`${tax.name}-${index}`} label={tax.name} value={money(tax.amount)} />)
          ) : (
            <Row label="Tax" value={money(totals.taxTotal)} />
          )}
          <hr className="my-1 border-black" />
          <Row label="TOTAL" value={money(totals.grandTotal)} bold />
          <Row label="Paid" value={money(totals.paidTotal)} />
          {Number(totals.grandTotal) - Number(totals.paidTotal) > 0 ? (
            <Row label="Still owed" value={money(Number(totals.grandTotal) - Number(totals.paidTotal))} bold />
          ) : null}
        </div>

        <hr className="my-3 border-dashed border-black" />

        <footer className="flex flex-col items-center gap-0.5 text-center">
          <p>Thank you</p>
          {store.phone ? <p>{store.phone}</p> : null}
          {store.email ? <p>{store.email}</p> : null}
        </footer>
      </article>
    </div>
  );
}
