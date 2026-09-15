"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "react-toastify";
import { AlertTriangle, Bike, MapPin, ShoppingBag, Store, UtensilsCrossed } from "lucide-react";
import CartLine from "@/components/cart/CartLine";
import CartSummary from "@/components/cart/CartSummary";
import { useCart, clearCart, setCartType, cartItemCount } from "@/hooks/useCart";

const ORDER_TYPES = [
  { value: "DELIVERY", label: "Delivery", icon: Bike },
  { value: "PICKUP", label: "Pickup", icon: Store },
  { value: "DINE_IN", label: "Dine in", icon: UtensilsCrossed },
];

/**
 * The basket.
 *
 * Read entirely in the browser, and it has to be: a guest's cart is matched by
 * a session id held in `localStorage`, which the server cannot see while
 * rendering. Server-rendering this page would show every signed-out visitor an
 * empty basket and then swap it a moment later, which is worse than a short,
 * honest loading state.
 */
export default function CartView({ currency = "PKR" }) {
  const { status, cart, error } = useCart();
  const [busy, setBusy] = useState(false);

  if (status === "loading") {
    return (
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4" aria-hidden="true">
          {[0, 1].map((key) => (
            <div key={key} className="h-32 animate-pulse rounded-card bg-surface-container" />
          ))}
        </div>
        <div aria-hidden="true" className="h-80 animate-pulse rounded-card bg-surface-container" />
        <p className="sr-only">Loading your order</p>
      </div>
    );
  }

  if (status === "error") {
    return (
      <p role="alert" className="rounded-card bg-error-container px-6 py-8 text-body-md text-on-error-container">
        We couldn&apos;t load your order{error ? `: ${error}` : ""}. Please refresh in a moment.
      </p>
    );
  }

  const lines = cart?.items ?? [];
  const count = cartItemCount(cart);

  if (lines.length === 0) return <EmptyCart />;

  // A line the kitchen pulled cannot be ordered, so checkout stays shut until
  // it is removed — better to say so here than to fail at the payment step.
  const blocked = lines.filter((line) => line.problem);
  const totals = cart.totals ?? {};
  const belowMinimum = cart.minimumOrderAmount > 0 && (totals.subtotal ?? 0) < cart.minimumOrderAmount;

  // Everything blocked at once almost always means the order type, not the
  // items: a branch with only a delivery menu has nothing to sell a pickup
  // customer. Telling someone to delete their whole basket when switching back
  // to Delivery would fix it is bad advice, so the two cases are separated.
  const allBlocked = blocked.length > 0 && blocked.length === lines.length;

  const canCheckout = blocked.length === 0 && !belowMinimum && count > 0;
  const blockedReason = allBlocked
    ? "Not available for this order type"
    : blocked.length
      ? "Remove the unavailable items to continue"
      : belowMinimum
        ? "Minimum order not reached"
        : "Add an item to continue";

  async function changeType(type) {
    if (busy || cart.type === type) return;
    setBusy(true);
    try {
      await setCartType(type);
    } catch (typeError) {
      toast.error(typeError.message);
    } finally {
      setBusy(false);
    }
  }

  async function empty() {
    if (busy) return;
    setBusy(true);
    try {
      await clearCart();
      toast.info("Order cleared.");
    } catch (clearError) {
      toast.error(clearError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex flex-wrap items-center gap-2 text-body-md text-on-surface-variant">
          <ShoppingBag aria-hidden="true" className="size-4 text-primary" />
          {count} {count === 1 ? "item" : "items"}
          {cart.branch ? (
            <>
              <span aria-hidden="true">·</span>
              <MapPin aria-hidden="true" className="size-4 text-primary" />
              <span className="text-on-surface">{cart.branch.name}</span>
            </>
          ) : null}
        </p>

        <button
          type="button"
          onClick={empty}
          disabled={busy}
          className="text-label-bold text-on-surface-variant underline underline-offset-2 transition-colors hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40"
        >
          Clear order
        </button>
      </div>

      {/* Order type is priced, not cosmetic: it selects the menu, decides
          whether a delivery fee applies, and gates some promotions. */}
      <fieldset>
        <legend className="sr-only">How would you like your order?</legend>
        <div className="flex flex-wrap gap-2">
          {ORDER_TYPES.map(({ value, label, icon: Icon }) => {
            const active = cart.type === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => changeType(value)}
                disabled={busy}
                aria-pressed={active}
                className={`flex items-center gap-2 rounded-full px-5 py-2.5 text-label-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${
                  active
                    ? "bg-primary-container text-on-primary-container"
                    : "bg-surface-container-lowest text-on-surface hover:bg-surface-container-high"
                }`}
              >
                <Icon aria-hidden="true" className="size-4" />
                {label}
              </button>
            );
          })}
        </div>
      </fieldset>

      {blocked.length ? (
        <p role="alert" className="flex items-start gap-2 rounded-field bg-error-container px-4 py-3 text-body-md text-on-error-container">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            {allBlocked ? (
              <>
                Nothing in your order is available for{" "}
                {ORDER_TYPES.find((option) => option.value === cart.type)?.label.toLowerCase() ??
                  "this order type"}
                {cart.branch ? ` at ${cart.branch.name}` : ""}. Try another order type above, or
                choose a different location.
              </>
            ) : (
              <>
                {blocked.length === 1 ? "One item is" : `${blocked.length} items are`} no longer
                available here. Remove {blocked.length === 1 ? "it" : "them"} to check out.
              </>
            )}
          </span>
        </p>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px] lg:items-start">
        <ul className="flex flex-col gap-4">
          {lines.map((line) => (
            <CartLine key={line.id} line={line} currency={cart.branch?.currency || currency} />
          ))}
        </ul>

        <CartSummary
          cart={cart}
          currency={cart.branch?.currency || currency}
          canCheckout={canCheckout}
          blockedReason={blockedReason}
        />
      </div>
    </div>
  );
}

function EmptyCart() {
  return (
    <div className="rounded-card bg-surface-container-lowest px-6 py-16 text-center">
      <ShoppingBag aria-hidden="true" className="mx-auto size-10 text-on-surface-variant" />
      <h2 className="mt-4 font-display text-headline-md text-on-surface">Your order is empty</h2>
      <p className="mt-2 text-body-md text-on-surface-variant">
        Nothing on the griddle yet. Pick something from the menu and it will show up here.
      </p>
      <Link
        href="/menu"
        className="mt-6 inline-flex items-center gap-2 rounded-full bg-primary-container px-8 py-3 font-display text-label-bold uppercase text-on-primary-container transition-shadow hover:shadow-e2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Browse the menu
      </Link>
    </div>
  );
}
