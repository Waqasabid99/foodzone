"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, ShoppingCart } from "lucide-react";
import FoodImage from "@/components/ui/FoodImage";
import { formatMoney } from "@/lib/format";
import { useCart, cartItemCount } from "@/hooks/useCart";

/**
 * The cart, with what is in it.
 *
 * The icon used to be a plain link to the cart page, which is a whole
 * navigation to answer "did that go in?" — and it lost whatever the customer
 * was reading. The panel answers it in place, and keeps the two things anybody
 * opens a basket for within one press: see it, or go and pay.
 *
 * Nothing is shown on the badge while the cart is still loading. A zero that
 * turns into a three a moment later is worse than an icon that stays quiet
 * until it knows: the first tells you your basket is empty, which may not be
 * true.
 *
 * **No arithmetic here.** The total is whatever the server last priced —
 * discounts, per-branch prices, modifier deltas and tax all land server-side,
 * and a number added up in the browser would drift from the one at checkout.
 */

/** Enough to recognise the basket; the cart page is for reading all of it. */
const PREVIEW_LINES = 3;

export default function CartButton() {
  const { status, cart } = useCart();
  const boxRef = useRef(null);
  const [open, setOpen] = useState(false);

  const count = status === "ready" ? cartItemCount(cart) : 0;
  const lines = cart?.items ?? [];
  const currency = cart?.branch?.currency || "PKR";
  const total = cart?.totals?.grandTotal ?? null;
  const hidden = Math.max(0, lines.length - PREVIEW_LINES);

  /*
   * Dismissal. Closing on a link press rather than on a route change: React
   * now refuses a synchronous setState in an effect body, and watching the
   * pathname to close is exactly that.
   */
  useEffect(() => {
    if (!open) return undefined;

    function onPointerDown(event) {
      if (!boxRef.current?.contains(event.target)) setOpen(false);
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        // The count belongs in the name, not just in a badge somebody has to
        // see. "Cart" alone tells a screen reader nothing about what is in it.
        aria-label={count ? `Cart, ${count} ${count === 1 ? "item" : "items"}` : "Cart, empty"}
        className="relative grid size-10 place-items-center rounded-full text-on-surface transition-colors hover:bg-surface-container-high focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ShoppingCart aria-hidden="true" className="size-5" />

        {count > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-label-bold text-[0.6875rem] leading-5 text-on-primary"
          >
            {/* A basket of 120 would stretch the icon out of the row it sits in. */}
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Your order"
          // Pinned to the right edge and capped against the viewport, so it
          // cannot push the page sideways on a phone.
          className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-card bg-surface-container-lowest shadow-e3"
        >
          {count === 0 ? (
            <div className="flex flex-col items-center gap-3 px-5 py-8 text-center">
              <ShoppingCart aria-hidden="true" className="size-7 text-on-surface-variant" />
              <p className="text-body-md text-on-surface-variant">Your bag is empty.</p>
              <Link
                href="/menu"
                onClick={() => setOpen(false)}
                className="rounded-full bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase text-on-primary-container hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Browse the menu
              </Link>
            </div>
          ) : (
            <>
              <ul className="flex flex-col divide-y divide-outline-variant">
                {lines.slice(0, PREVIEW_LINES).map((line) => (
                  <li key={line.id} className="flex items-center gap-3 px-4 py-3">
                    <span className="relative size-12 shrink-0 overflow-hidden rounded-field bg-surface-container">
                      <FoodImage src={line.imageUrl} alt="" sizes="48px" className="size-full" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-label-bold text-on-surface">
                        {line.quantity} × {line.name}
                      </span>
                      {/*
                        A line the kitchen can no longer serve comes back with
                        `problem` and no price. Flagged rather than hidden:
                        finding out at checkout is worse.
                      */}
                      {line.problem ? (
                        <span className="flex items-center gap-1 text-label-bold font-normal text-error">
                          <AlertTriangle aria-hidden="true" className="size-3.5" />
                          {line.problem}
                        </span>
                      ) : line.variantName ? (
                        <span className="block truncate text-label-bold font-normal text-on-surface-variant">
                          {line.variantName}
                        </span>
                      ) : null}
                    </span>

                    {line.lineTotal != null ? (
                      <span className="shrink-0 text-label-bold text-on-surface">
                        {formatMoney(line.lineTotal, currency)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>

              {hidden ? (
                <p className="border-t border-outline-variant px-4 py-2 text-label-bold font-normal text-on-surface-variant">
                  and {hidden} more {hidden === 1 ? "item" : "items"}
                </p>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-outline-variant bg-surface-container-low px-4 py-4">
                {total !== null ? (
                  <p className="flex items-baseline justify-between gap-3">
                    <span className="text-label-bold text-on-surface-variant">Total</span>
                    <span className="font-display text-headline-md text-on-surface">
                      {formatMoney(total, currency)}
                    </span>
                  </p>
                ) : null}

                <Link
                  href="/cart"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-full bg-primary-container px-5 py-2.5 font-display text-label-bold uppercase text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Proceed to cart
                  <ArrowRight aria-hidden="true" className="size-4" />
                </Link>

                {/*
                  Checkout is the second button, not the first. Quantities,
                  coupons and the delivery choice all live on the cart page,
                  and sending somebody past them to pay is how an order goes
                  out with a line they meant to remove.
                */}
                <Link
                  href="/checkout"
                  onClick={() => setOpen(false)}
                  className="text-center text-label-bold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Checkout now
                </Link>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}
