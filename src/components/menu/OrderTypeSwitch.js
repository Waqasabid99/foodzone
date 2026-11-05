"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "react-toastify";
import { Bike, Store } from "lucide-react";
import { setCartType, useCart } from "@/hooks/useCart";
import { WEB_ORDER_TYPES, writeOrderTypeCookie } from "@/lib/order-type";

const OPTIONS = [
  { value: "DELIVERY", label: "Delivery", icon: Bike },
  { value: "PICKUP", label: "Pickup", icon: Store },
];

/**
 * Keeps a server-rendered price page on the same order type as the cart.
 *
 * The page's prices were resolved for `renderedType`, read from a cookie. When
 * the cart says otherwise — switched at checkout, or on another device — the
 * page is refreshed rather than left quoting the other menu. With `showSwitch`
 * the choice is also offered here, since on a branch with separate delivery
 * and pickup menus it changes what is on the page.
 */
export default function OrderTypeSwitch({ renderedType, showSwitch = false }) {
  const router = useRouter();
  const { status, cart } = useCart();
  const [pending, setPending] = useState(null);
  const refreshedFor = useRef(null);

  const cartType = status === "ready" && WEB_ORDER_TYPES.includes(cart?.type) ? cart.type : null;

  useEffect(() => {
    // Once per mismatch: the refresh re-renders with the cookie the cart just
    // wrote, and a type the cookie cannot hold must not loop.
    if (!cartType || cartType === renderedType || refreshedFor.current === cartType) return;
    refreshedFor.current = cartType;
    router.refresh();
  }, [cartType, renderedType, router]);

  if (!showSwitch) return null;

  async function choose(type) {
    if (pending || type === (cartType ?? renderedType)) return;
    setPending(type);
    try {
      await setCartType(type);
    } catch (failure) {
      // Without a cart the page can still show the right prices; the cart
      // picks the type up when it is created.
      if (status === "error") {
        writeOrderTypeCookie(type);
        router.refresh();
      } else {
        toast.error(failure?.message ?? "That could not be changed.");
      }
    } finally {
      setPending(null);
    }
  }

  const current = pending ?? cartType ?? renderedType;

  return (
    <fieldset>
      <legend className="sr-only">How would you like your order? Prices can differ.</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map(({ value, label, icon: Icon }) => {
          const active = current === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => choose(value)}
              disabled={Boolean(pending)}
              aria-pressed={active}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-label-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60 ${
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
  );
}
