import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Printer } from "lucide-react";
import PageHeader from "@/components/dashboard/PageHeader";
import Chip from "@/components/dashboard/inventory/Chip";
import OrderStatusActions from "@/components/dashboard/service/OrderStatusActions";
import OrderNotes from "@/components/dashboard/service/OrderNotes";
import OrderDiscount from "@/components/dashboard/service/OrderDiscount";
import TakePayment from "@/components/dashboard/service/TakePayment";
import AskForTheBill from "@/components/dashboard/service/AskForTheBill";
import OrderLines from "@/components/dashboard/service/OrderLines";
import InvoiceActions from "@/components/dashboard/service/InvoiceActions";
import { Section } from "@/components/dashboard/products/ProductDetailsForm";
import { getAuthContext } from "@/lib/api/auth";
import { isNotFound } from "@/lib/api/errors";
import { branchScope, can, grantedPermissionKeys } from "@/lib/api/permissions";
import { inScope } from "@/server/access/scope";
import { serialize } from "@/lib/api/serialize";
import { getOrder } from "@/server/services/order.service";
import { orderPayments } from "@/server/services/payment.service";
import { orderScope } from "@/server/ordering/access";
import { openRegister, userNames } from "@/server/content/service-admin";
import { formatMoney } from "@/lib/format";
import { ORDER_STATES, ORDER_TYPE_LABELS, PAYMENT_STATES, channelLabel, methodLabel, waitingFor } from "@/lib/service";
import { hasPermission } from "@/lib/dashboard-nav";
import { loginHref } from "@/lib/redirects";

export const metadata = { title: "Order — FoodZone", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const when = (value) =>
  value ? new Date(value).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";

/**
 * One order: what was asked for, where it has got to, and what is owed.
 *
 * This is the front desk. Everything somebody standing at a counter needs to
 * do to an order that already exists is on this page, in the order they need
 * it: move it along, take the money, print the receipt.
 */
export default async function OrderPage({ params }) {
  const { id } = await params;
  const principal = await getAuthContext();
  if (!principal) redirect(loginHref(`/dashboard/orders/${id}`));
  const permissions = grantedPermissionKeys(principal);
  if (!hasPermission(permissions, "orders.read")) redirect("/dashboard");

  // Only a genuine not-found becomes "Not here". A dropped database
  // connection used to land on the same screen, which told a cashier that the
  // order they had just taken did not exist.
  const raw = await getOrder(id).catch((error) => {
    if (isNotFound(error)) return null;
    throw error;
  });
  // Out of scope answers not-found: that an order exists at another outlet,
  // with a real customer behind it, is not something to confirm by guessing.
  if (!raw || !inScope(orderScope(principal), raw.branchId)) notFound();

  const order = serialize(raw);
  const branchId = order.branchId;
  const [takings, names, register] = await Promise.all([
    // Always loaded, permission or not: what is owed is worked out from these
    // rows, because `Order.paidTotal` is a column nothing maintains. The
    // service already does that sum, so it is not repeated here.
    orderPayments(id),
    userNames([order.placedById, order.cancelledById, order.setAsideById]),
    can(principal, "payments.capture", { branchId }) ? openRegister(principal, branchId) : null,
  ]);

  const currency = order.currency ?? "PKR";
  const wait = waitingFor(order.placedAt);
  const state = ORDER_STATES[order.status] ?? { label: order.status, tone: "" };
  const payments = takings.payments ?? [];
  const outstanding = String(takings.amountDue ?? order.grandTotal);
  const paid = String(Number(order.grandTotal) - Number(outstanding));
  const canPay = can(principal, "payments.capture", { branchId }) && !["CANCELLED", "REJECTED"].includes(order.status);

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={order.orderNumber}
        description={`${ORDER_TYPE_LABELS[order.type] ?? order.type} · ${channelLabel(order.channel)} · placed ${when(order.placedAt)}${names[order.placedById] ? ` by ${names[order.placedById]}` : ""}`}
        back={{ href: "/dashboard/orders", label: "Orders" }}
        actions={
          <>
            <Chip tone={state.tone}>{state.label}</Chip>
            {!order.isTerminal ? <Chip>{wait.label} old</Chip> : null}
            {hasPermission(permissions, "invoices.read") ? (
              <Link
                href={`/dashboard/orders/${id}/receipt`}
                className="inline-flex items-center gap-2 rounded-field bg-surface-container-high px-4 py-2.5 text-label-bold text-on-surface hover:bg-surface-container-highest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Printer aria-hidden="true" className="size-4" />
                Receipt
              </Link>
            ) : null}
          </>
        }
      />

      {/* The kitchen has handed this one back. Above the actions, because it
          changes which action is the right one. */}
      {order.setAsideAt ? (
        <section className="flex flex-col gap-2 rounded-card bg-warning-container px-5 py-4 text-on-warning-container">
          <p className="text-label-bold">The kitchen set this aside</p>
          <p className="text-body-md">
            &ldquo;{order.setAsideReason}&rdquo;
            {names[order.setAsideById] ? ` — ${names[order.setAsideById]}` : ""}
          </p>
          <p className="text-body-md">
            It is off the kitchen&rsquo;s board, but the order is still live and still owed. Send it back to be made, or
            cancel it.
          </p>
        </section>
      ) : null}

      {/* Above the actions, like the set-aside notice and for the same reason:
          a table waiting to pay changes which of the buttons below is the
          right one to press. */}
      <AskForTheBill
        order={order}
        canAsk={can(principal, "orders.request_bill", { branchId }) && !order.isTerminal && order.paymentState !== "PAID"}
        canClear={
          can(principal, "orders.request_bill", { branchId }) || can(principal, "payments.capture", { branchId })
        }
      />

      <OrderStatusActions
        order={order}
        canAdvance={can(principal, "orders.update_status", { branchId })}
        canCancel={can(principal, "orders.cancel", { branchId })}
      />

      <Section title="What was ordered">
        <OrderLines
          order={order}
          currency={currency}
          canEdit={can(principal, "orders.edit_items", { branchId }) && !order.isTerminal}
          canAdd={can(principal, "orders.edit_items", { branchId }) && !order.isTerminal && order.type !== "DELIVERY"}
        />

        <dl className="grid gap-2 rounded-field bg-surface-container p-4 text-body-md">
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Subtotal</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(order.subtotal, currency)}</dd>
          </div>
          {Number(order.discountTotal) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Discount</dt>
              <dd className="tabular-nums text-on-surface">−{formatMoney(order.discountTotal, currency)}</dd>
            </div>
          ) : null}
          {Number(order.deliveryFee) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Delivery</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(order.deliveryFee, currency)}</dd>
            </div>
          ) : null}
          {/* Packaging and the service charge were left out, so a takeaway
              read "subtotal 120, tax 0, total 150" and the cashier had nothing
              to point at when the customer asked where the 30 came from. */}
          {Number(order.packagingFee) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Packaging</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(order.packagingFee, currency)}</dd>
            </div>
          ) : null}
          {Number(order.serviceCharge) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Service charge</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(order.serviceCharge, currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Tax</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(order.taxTotal, currency)}</dd>
          </div>
          {Number(order.tipAmount) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Tip</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(order.tipAmount, currency)}</dd>
            </div>
          ) : null}
          {Number(order.roundOff) ? (
            <div className="flex justify-between gap-4">
              <dt className="text-on-surface-variant">Rounding</dt>
              <dd className="tabular-nums text-on-surface">{formatMoney(order.roundOff, currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
            <dt className="text-label-bold text-on-surface">Total</dt>
            <dd className="text-label-bold tabular-nums text-on-surface">{formatMoney(order.grandTotal, currency)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-on-surface-variant">Paid</dt>
            <dd className="tabular-nums text-on-surface">{formatMoney(paid, currency)}</dd>
          </div>
          {Number(outstanding) > 0 ? (
            <div className="flex justify-between gap-4 border-t border-outline-variant pt-2">
              <dt className="text-label-bold text-error">Still owed</dt>
              <dd className="text-label-bold tabular-nums text-error">{formatMoney(outstanding, currency)}</dd>
            </div>
          ) : null}
        </dl>
      </Section>

      <Section title="Who it is for">
        <ul className="flex flex-col gap-1 text-body-md text-on-surface">
          <li>{order.guestName ?? order.user?.name ?? "No name taken"}</li>
          {order.guestPhone || order.user?.phone ? <li className="text-on-surface-variant">{order.guestPhone ?? order.user?.phone}</li> : null}
          {order.table?.name ? <li className="text-on-surface-variant">Table {order.table.name}{order.guestCount ? ` · ${order.guestCount} covers` : ""}</li> : null}
          {order.addressSnapshot ? (
            <li className="text-on-surface-variant">
              {[order.addressSnapshot.line1, order.addressSnapshot.city].filter(Boolean).join(", ")}
            </li>
          ) : null}
          {order.cancelReason ? <li className="text-error">Cancelled: {order.cancelReason}</li> : null}
        </ul>
      </Section>

      {canPay ? (
        <TakePayment
          order={order}
          outstanding={outstanding}
          register={serialize(register)}
          canCollect={can(principal, "payments.mark_collected", { branchId })}
        />
      ) : null}

      {hasPermission(permissions, "payments.read") ? (
        <Section title="Payments">
          {payments.length ? (
            <ul className="flex flex-col gap-2">
              {serialize(payments).map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 rounded-field bg-surface-container-low px-4 py-3">
                  <span className="text-body-md text-on-surface">
                    {methodLabel(payment.method)}
                    <span className="text-on-surface-variant">
                      {" · "}
                      {PAYMENT_STATES[payment.status] ?? payment.status}
                      {payment.reference ? ` · ${payment.reference}` : ""}
                    </span>
                  </span>
                  <span className="tabular-nums text-body-md text-on-surface">{formatMoney(payment.amount, currency)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-md text-on-surface-variant">Nothing paid against this order yet.</p>
          )}
        </Section>
      ) : null}

      {hasPermission(permissions, "invoices.read") ? (
        <InvoiceActions
          orderId={id}
          invoice={order.invoice ?? null}
          currency={currency}
          canCreate={can(principal, "invoices.create", { branchId })}
          canVoid={can(principal, "invoices.void", { branchId })}
        />
      ) : null}

      {hasPermission(permissions, "orders.apply_manual_discount") || order.discounts?.length ? (
        <Section title="Discounts">
          <OrderDiscount
            order={order}
            currency={currency}
            discounts={order.discounts ?? []}
            canApply={can(principal, "orders.apply_manual_discount", { branchId })}
          />
        </Section>
      ) : null}

      <Section title="Notes">
        <OrderNotes order={order} canEdit={can(principal, "orders.update", { branchId })} />
      </Section>

      {order.statusHistory?.length ? (
        <Section title="What happened">
          <ol className="flex flex-col gap-2 text-body-md">
            {order.statusHistory.map((entry) => (
              <li key={entry.id} className="flex flex-wrap justify-between gap-3">
                <span className="text-on-surface">{ORDER_STATES[entry.toStatus]?.label ?? entry.toStatus}</span>
                <span className="text-on-surface-variant">{when(entry.createdAt)}</span>
              </li>
            ))}
          </ol>
        </Section>
      ) : null}

      {hasPermission(permissions, "deliveries.read") && order.delivery ? (
        <p className="text-body-md text-on-surface-variant">
          <Link href="/dashboard/deliveries" className="text-primary hover:underline">
            This order has a delivery
          </Link>{" "}
          attached.
        </p>
      ) : null}
    </div>
  );
}
