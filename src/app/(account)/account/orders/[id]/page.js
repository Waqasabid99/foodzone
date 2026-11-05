import Link from "next/link";
import { nullIfMissing } from "@/lib/api/errors";
import { notFound, redirect } from "next/navigation";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import OrderActions from "@/components/account/OrderActions";
import { getAuthContext } from "@/lib/api/auth";
import { grantedPermissionKeys } from "@/lib/api/permissions";
import { serialize } from "@/lib/api/serialize";
import { getOwnOrder } from "@/server/services/order.service";
import { formatMoney } from "@/lib/format";
import { dateLabel, timeLabel } from "@/lib/finance";
import { ORDER_TYPE_LABELS, PAYMENT_STATES, chipClass, needsAction, orderProgress } from "@/lib/account";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";
import { getSiteIdentity } from "@/server/content/site";

export const metadata = { title: "Order — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * One order, from the customer's side.
 *
 * Carries what they paid and what is in the box, and nothing from the kitchen
 * side of the ticket. The progress line is the point of the page: somebody
 * opening this is almost always asking "where is my food", and the answer
 * should be the first thing they read rather than something assembled from a
 * status chip and a timestamp.
 */
export default async function MyOrderPage({ params }) {
  const { timeZone } = await getSiteIdentity();
  const principal = await getAuthContext();
  const { id } = await params;
  if (!principal) redirect(loginHref(`/account/orders/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "self.view_own_orders")) redirect("/");

  // Somebody else's order is a 404, never a 403 — see the API route.
  const raw = await nullIfMissing(getOwnOrder({ id, userId: principal.userId }));
  if (!raw) notFound();

  const order = serialize(raw);
  const money = (value) => formatMoney(value, order.currency);
  const progress = orderProgress(order);
  const action = needsAction(order);

  const charges = [
    ["Items", order.subtotal],
    ...(Number(order.discountTotal) ? [["Discount", `−${money(order.discountTotal)}`, true]] : []),
    ...(Number(order.deliveryFee) ? [["Delivery", order.deliveryFee]] : []),
    ...(Number(order.packagingFee) ? [["Packaging", order.packagingFee]] : []),
    ...(Number(order.serviceCharge) ? [["Service", order.serviceCharge]] : []),
    ...(Number(order.taxTotal) ? [["Tax", order.taxTotal]] : []),
    ...(Number(order.tipAmount) ? [["Tip", order.tipAmount]] : []),
    ...(Number(order.roundOff) ? [["Rounding", order.roundOff]] : []),
  ];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader
        title={order.orderNumber}
        description={`${dateLabel(order.placedAt, timeZone)} at ${timeLabel(order.placedAt, timeZone)} · ${ORDER_TYPE_LABELS[order.type] ?? order.type}`}
        back={{ href: "/account", label: "My orders" }}
      />

      <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={chipClass(progress.tone)}>{progress.label}</Chip>
          <span className="text-body-md text-on-surface-variant">{PAYMENT_STATES[order.paymentState] ?? order.paymentState}</span>
        </div>

        {progress.of && progress.done > 0 ? (
          <div
            className="flex gap-1"
            role="img"
            aria-label={`Step ${progress.done} of ${progress.of}: ${progress.label}`}
          >
            {Array.from({ length: progress.of }, (_, index) => (
              <span
                key={index}
                className={`h-1.5 flex-1 rounded-full ${index < progress.done ? "bg-primary" : "bg-surface-container-high"}`}
              />
            ))}
          </div>
        ) : null}

        {order.cancelReason ? (
          <p className="text-body-md text-on-surface-variant">Reason given: {order.cancelReason}</p>
        ) : null}

        {action ? (
          <p className="rounded-field bg-warning-container px-4 py-3 text-body-md text-on-warning-container">
            <span className="font-semibold">{action.label}.</span> {action.detail}
          </p>
        ) : null}

        <OrderActions order={order} />
      </section>

      <section className="flex flex-col gap-3 rounded-card bg-surface-container-lowest p-5">
        <h2 className="font-display text-headline-md text-on-surface">What you ordered</h2>
        {/*
          `items` arrives with combo children nested under `includes`, so a
          meal deal reads as one line with its contents under it rather than
          as the deal plus its parts listed again at zero.
        */}
        <ul className="flex flex-col gap-2">
          {(order.items ?? []).map((item) => (
            <li key={item.id} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-body-md text-on-surface">
                  {item.quantity} × {item.nameSnapshot}
                </span>
                <span className="tabular-nums text-body-md text-on-surface-variant">{money(item.lineTotal ?? 0)}</span>
              </div>
              {item.includes?.length ? (
                <p className="pl-4 text-body-md text-on-surface-variant">
                  Includes {item.includes.map((child) => child.nameSnapshot).join(", ")}
                </p>
              ) : null}
              {item.modifiers?.length ? (
                <p className="pl-4 text-body-md text-on-surface-variant">
                  {item.modifiers.map((modifier) => modifier.nameSnapshot).filter(Boolean).join(", ")}
                </p>
              ) : null}
              {item.notes ? <p className="pl-4 text-body-md text-on-surface-variant">“{item.notes}”</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
        <h2 className="font-display text-headline-md text-on-surface">What it cost</h2>
        {charges.map(([label, value, preformatted]) => (
          <p key={label} className="flex items-baseline justify-between gap-2 text-body-md text-on-surface-variant">
            <span>{label}</span>
            <span className="tabular-nums">{preformatted ? value : money(value)}</span>
          </p>
        ))}
        <p className="mt-1 flex items-baseline justify-between gap-2 border-t border-outline-variant pt-2 text-label-bold text-on-surface">
          <span>Total</span>
          <span className="tabular-nums">{money(order.grandTotal)}</span>
        </p>
        {Number(order.refundedTotal) ? (
          <p className="flex items-baseline justify-between gap-2 text-body-md text-on-surface-variant">
            <span>Refunded</span>
            <span className="tabular-nums">{money(order.refundedTotal)}</span>
          </p>
        ) : null}
      </section>

      {order.addressSnapshot ? (
        <section className="flex flex-col gap-2 rounded-card bg-surface-container-lowest p-5">
          <h2 className="font-display text-headline-md text-on-surface">Where it went</h2>
          <p className="text-body-md text-on-surface-variant">
            {[
              order.addressSnapshot.recipientName,
              order.addressSnapshot.line1,
              order.addressSnapshot.line2,
              order.addressSnapshot.city,
            ]
              .filter(Boolean)
              .join(", ")}
          </p>
        </section>
      ) : null}

      {hasPermission(permissions, "self.review_own_order") && ["DELIVERED", "COMPLETED"].includes(order.status) ? (
        <Link
          href="/account/reviews"
          className="rounded-card bg-surface-container-low px-5 py-4 text-body-md text-on-surface-variant hover:bg-surface-container"
        >
          Enjoyed it? Leave a review →
        </Link>
      ) : null}
    </div>
  );
}
