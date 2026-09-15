"use client";

import Link from "next/link";
import { ArrowRight, ShoppingBag } from "lucide-react";
import { useCart, cartItemCount } from "@/hooks/useCart";
import { formatMoney } from "@/lib/format";

/**
 * The floating "current order" bar.
 *
 * Reads the real cart, so it appears only when there is genuinely something in
 * it — an order summary showing a total nobody has built is the kind of detail
 * that makes a whole storefront feel fake.
 *
 * The total is whatever the server last priced, never a sum computed here.
 * Discounts, per-branch prices, modifier deltas and tax all land server-side,
 * and a number added up in the browser would drift from the one at checkout.
 */
export default function OrderSummaryBar({ currency, prepMinutes = null }) {
  const { cart } = useCart();
  const count = cartItemCount(cart);

  if (!cart || count === 0) return null;

  // `grandTotal` is what checkout will charge: discounts, tax, fees and
  // rounding already applied by the pricing engine.
  const total = cart.totals?.grandTotal ?? null;

  return (
    <div className="pointer-events-none sticky bottom-4 z-40 flex justify-center px-margin-mobile">
      <div className="pointer-events-auto flex w-full max-w-lg flex-wrap items-center gap-3 rounded-banner bg-inverse-surface px-5 py-4 text-inverse-on-surface shadow-e3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary-container font-display text-label-bold text-on-primary-container">
          {count}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-display text-label-bold uppercase">
            Current order ({count} {count === 1 ? "item" : "items"})
          </span>
          {prepMinutes ? (
            <span className="block text-label-bold font-normal opacity-70">
              Estimated ready in about {prepMinutes} minutes
            </span>
          ) : null}
        </span>

        {total !== null ? (
          <span className="font-display text-headline-md">{formatMoney(total, currency)}</span>
        ) : null}

        <Link
          href="/cart"
          className="flex w-full items-center justify-center gap-2 rounded-full bg-primary-container px-6 py-3 font-display text-label-bold uppercase text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ShoppingBag aria-hidden="true" className="size-4" />
          Review order
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </div>
  );
}
