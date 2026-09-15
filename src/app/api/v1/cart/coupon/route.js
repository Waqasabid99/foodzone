import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { applyCouponSchema } from "@/server/validation/pricing.schemas";
import {
  applyCouponToCart,
  getPricedCart,
  orderChannelFor,
  removeCouponFromCart,
  resolveCart,
} from "@/server/services/cart.service";

/**
 * Puts a code on the basket, or takes it off.
 *
 * Rate limited as a write rather than a read even though it changes little:
 * the coupon box is the one endpoint in the API that tells an anonymous caller
 * whether a guessed string is a real code, so it must not be free to hammer.
 */
export const POST = apiHandler(
  { body: applyCouponSchema, rateLimit: RateLimits.write, scope: "cart" },
  async ({ request, sessionId, body, client }) => {
    const principal = await optionalAuth(request);
    const cart = await resolveCart({ userId: principal?.userId ?? null, sessionId });
    const updated = await applyCouponToCart({ cart, code: body.code });

    return ok(await getPricedCart({ cart: updated, channel: orderChannelFor(client) }));
  },
);

export const DELETE = apiHandler(
  { rateLimit: RateLimits.write, scope: "cart" },
  async ({ request, sessionId, client }) => {
    const principal = await optionalAuth(request);
    const cart = await resolveCart({ userId: principal?.userId ?? null, sessionId });
    const updated = await removeCouponFromCart({ cart });

    return ok(await getPricedCart({ cart: updated, channel: orderChannelFor(client) }));
  },
);
