import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { clearCart, getPricedCart, orderChannelFor, resolveCart } from "@/server/services/cart.service";

/**
 * The caller's cart, priced against the branch's live menu.
 *
 * Works signed in (matched by user) or as a guest (matched by `x-session-id`),
 * which is what lets someone fill a basket before they have an account.
 */
export const GET = apiHandler(
  { rateLimit: RateLimits.read, scope: "cart" },
  async ({ request, sessionId, client }) => {
    const principal = await optionalAuth(request);
    const cart = await resolveCart({ userId: principal?.userId ?? null, sessionId });
    return ok(await getPricedCart({ cart, channel: orderChannelFor(client) }));
  },
);

/** Empties the basket — and with it any creator attribution it carried. */
export const DELETE = apiHandler(
  { rateLimit: RateLimits.write, scope: "cart" },
  async ({ request, sessionId, client }) => {
    const principal = await optionalAuth(request);
    const cart = await resolveCart({ userId: principal?.userId ?? null, sessionId });
    return ok(await getPricedCart({ cart: await clearCart({ cart }), channel: orderChannelFor(client) }));
  },
);
