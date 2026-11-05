import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reorder } from "@/server/services/reorder.service";
import { getPricedCart, orderChannelFor, resolveCart } from "@/server/services/cart.service";

/**
 * Puts a past order back in the basket.
 *
 * Returns the cart *and* what could not be added, because the second is the
 * part a customer has to be told about: a meal rebuilt without its drink looks
 * like it worked until the order arrives.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "self.view_own_orders",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth, sessionId, client }) => {
    const cart = await resolveCart({ userId: auth.userId, sessionId });
    const result = await reorder({ orderId: params.id, userId: auth.userId, cart });

    return ok({
      ...result,
      cart: await getPricedCart({ cart: await resolveCart({ userId: auth.userId, sessionId }), channel: orderChannelFor(client) }),
    });
  },
);
