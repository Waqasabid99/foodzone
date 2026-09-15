"use client";

import { useEffect, useSyncExternalStore } from "react";
import { api } from "@/lib/api-client";

/**
 * The basket, read from and written to the server.
 *
 * Server-side for guests as well as signed-in customers, which is what makes
 * the rest of ordering work: prices come from the branch's live menu rather
 * than from whatever the browser last saw, an 86'd item is refused at the point
 * it is added instead of at checkout, and a basket filled before signing up is
 * claimed by the account afterwards.
 *
 * One module-level store, so the header badge, the floating summary and every
 * Add button on the menu all read the same cart without a request each.
 */

const EMPTY = Object.freeze({ status: "loading", cart: null, error: null });

let state = EMPTY;
let loadPromise = null;
const listeners = new Set();

function setState(next) {
  state = next;
  for (const listener of listeners) listener();
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const getServerSnapshot = () => EMPTY;

/** Replaces the cart with what the server just told us it is. */
function applyCart(cart) {
  setState({ status: "ready", cart, error: null });
  return cart;
}

export function loadCart({ force = false } = {}) {
  if (loadPromise && !force) return loadPromise;

  loadPromise = (async () => {
    try {
      applyCart(await api.get("/cart"));
    } catch (error) {
      // An unreachable cart is not worth an error banner on a menu page. The
      // Add buttons surface their own failure when one is actually pressed.
      setState({ status: "error", cart: null, error: error.message });
    } finally {
      loadPromise = null;
    }
  })();

  return loadPromise;
}

/**
 * Adds a line.
 *
 * Every write returns the whole repriced cart, so the local copy is replaced
 * rather than patched — the server is the only thing that knows what a line
 * costs once modifiers, combos, branch pricing and promotions are applied, and
 * a client-side guess would disagree with checkout.
 */
export async function addCartItem({ productId, variantId = null, quantity = 1, branchId = null }) {
  const cart = await api.post("/cart/items", {
    productId,
    ...(variantId ? { variantId } : {}),
    quantity,
    // Adding from a branch menu sets the cart's branch in the same call, which
    // is what the endpoint is built for — otherwise the first add would price
    // against no branch at all.
    ...(branchId ? { branchId } : {}),
  });

  return applyCart(cart);
}

export async function setCartBranch(branchId) {
  return applyCart(await api.put("/cart/context", { branchId }));
}

/**
 * Switches delivery / pickup / dine-in.
 *
 * Not cosmetic: the order type decides which menu prices the basket, whether a
 * delivery fee applies, and which promotions are eligible. The server reprices
 * the whole cart and returns it, which is why the response replaces the local
 * copy wholesale.
 */
export async function setCartType(type) {
  return applyCart(await api.put("/cart/context", { type }));
}

export async function updateCartItem(itemId, { quantity, notes }) {
  return applyCart(
    await api.patch(`/cart/items/${itemId}`, {
      ...(quantity !== undefined ? { quantity } : {}),
      ...(notes !== undefined ? { notes } : {}),
    }),
  );
}

/** Quantity 0 is how the stepper removes a line, and the API treats it as such. */
export async function removeCartItem(itemId) {
  return applyCart(await api.delete(`/cart/items/${itemId}`));
}

export async function clearCart() {
  return applyCart(await api.delete("/cart"));
}

export async function applyCoupon(code) {
  return applyCart(await api.post("/cart/coupon", { code }));
}

export async function removeCoupon() {
  return applyCart(await api.delete("/cart/coupon"));
}

export function useCart() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (state.status === "loading") loadCart();
  }, []);

  return snapshot;
}

/**
 * Total number of units in the basket, for a badge.
 *
 * Prefers the server's own count. Its `items` array also carries lines the
 * kitchen has since made unavailable, which are shown so they can be removed
 * but are not part of what is being ordered — counting the array here would
 * quietly include them.
 */
export function cartItemCount(cart) {
  if (typeof cart?.totals?.itemCount === "number") return cart.totals.itemCount;
  return (cart?.items ?? []).reduce((total, item) => total + (item.quantity ?? 0), 0);
}
