"use client";

import Link from "next/link";
import { Bike, CheckCircle2, Clock, MapPin, Store, UtensilsCrossed } from "lucide-react";
import { formatMoney } from "@/lib/format";
import { formatTime } from "@/lib/constants";

const TYPE_COPY = {
  DELIVERY: { icon: Bike, heading: "On its way to you", when: "Estimated delivery" },
  PICKUP: { icon: Store, heading: "We're making it now", when: "Ready for pickup" },
  DINE_IN: { icon: UtensilsCrossed, heading: "Sent to the kitchen", when: "Ready at" },
};

/**
 * The receipt, rendered from the order the checkout call returned.
 *
 * Deliberately built from that response rather than fetched back: a guest has
 * no account to read an order through, and an order number is short enough to
 * guess, so an endpoint that served one to anyone who asked would leak. The
 * order is already in hand here, and it is the customer's own.
 *
 * The cost is that a refresh loses this view, which is why the order number is
 * the most prominent thing on it.
 */
export default function OrderPlaced({ order, signedIn }) {
  const copy = TYPE_COPY[order.type] ?? TYPE_COPY.DELIVERY;
  const Icon = copy.icon;
  const currency = order.currency ?? "PKR";
  const address = order.addressSnapshot;

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-banner bg-success-container px-6 py-10 text-center text-on-success-container">
        <CheckCircle2 aria-hidden="true" className="mx-auto size-12" />
        <h2 className="mt-4 font-display text-headline-lg">{copy.heading}</h2>
        <p className="mt-2 text-body-md opacity-90">
          Thanks{order.guestName ? `, ${order.guestName}` : ""} — we&apos;ve got your order.
        </p>

        <p className="mt-6 text-label-bold uppercase opacity-80">Order number</p>
        {/* The one thing worth writing down: it identifies the order to the
            branch on the phone, and this view does not survive a refresh. */}
        <p className="font-display text-headline-md tracking-wide">{order.orderNumber}</p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
        <div className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-6">
          <h3 className="font-display text-headline-md text-on-surface">What happens next</h3>

          <p className="flex items-start gap-3 text-body-md text-on-surface">
            <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
            <span>
              The kitchen has your order and will confirm it shortly.
              {order.branch?.name ? ` You're being served by ${order.branch.name}.` : ""}
            </span>
          </p>

          {order.promisedAt ? (
            <p className="flex items-start gap-3 text-body-md text-on-surface">
              <Clock aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <span>
                {copy.when} around <strong className="font-semibold">{formatTime(order.promisedAt)}</strong>.
              </span>
            </p>
          ) : null}

          {address ? (
            <p className="flex items-start gap-3 text-body-md text-on-surface">
              <MapPin aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-primary" />
              <span>
                {[address.line1, address.line2, address.city].filter(Boolean).join(", ")}
              </span>
            </p>
          ) : null}

          {/* Stated plainly because nothing was charged: the order is placed
              unpaid, and a customer who is not expecting to pay at the door
              finds that out at the worst possible moment. */}
          <p className="rounded-field bg-surface-container-low px-4 py-3 text-body-md text-on-surface-variant">
            Payment is taken{" "}
            {order.type === "DELIVERY" ? "when your order arrives" : "at the counter"} —{" "}
            <strong className="font-semibold text-on-surface">
              {formatMoney(order.grandTotal, currency)}
            </strong>
            .
          </p>
        </div>

        <aside className="flex flex-col gap-4 rounded-card bg-surface-container-lowest p-6">
          <h3 className="font-display text-headline-md text-on-surface">Your order</h3>

          <ul className="flex flex-col gap-2 text-body-md">
            {order.items?.map((item) => (
              <li key={item.id} className="flex justify-between gap-3">
                <span className="text-on-surface">
                  {item.quantity} × {item.nameSnapshot}
                </span>
                <span className="shrink-0 text-on-surface-variant">
                  {formatMoney(item.lineTotal, currency)}
                </span>
              </li>
            ))}
          </ul>

          <div className="flex items-baseline justify-between border-t border-outline-variant pt-3">
            <span className="font-display text-label-bold uppercase text-on-surface">Total</span>
            <span className="font-display text-headline-md text-primary">
              {formatMoney(order.grandTotal, currency)}
            </span>
          </div>

          <Link
            href="/menu"
            className="mt-2 flex items-center justify-center rounded-full bg-primary-container px-6 py-3.5 font-display text-label-bold uppercase text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Order something else
          </Link>

          {!signedIn ? (
            <p className="text-center text-label-bold font-normal text-on-surface-variant">
              Keep your order number handy — the branch will ask for it.
            </p>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
