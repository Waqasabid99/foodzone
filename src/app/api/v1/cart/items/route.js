import { apiHandler, created, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { addCartItemSchema } from "@/server/validation/ordering.schemas";
import { addItem, getPricedCart, orderChannelFor, resolveCart } from "@/server/services/cart.service";

/**
 * Adds a line.
 *
 * The line is fully validated against the live menu before it is stored — the
 * product is on sale at this branch, the variant belongs to it, every modifier
 * belongs to a group actually attached to the product, and the group's min/max
 * rules hold. An invalid line must never reach the cart, or every later read
 * has to cope with it.
 */
export const POST = apiHandler(
  { body: addCartItemSchema, rateLimit: RateLimits.write, scope: "cart" },
  async ({ request, body, sessionId, client }) => {
    const principal = await optionalAuth(request);
    const cart = await resolveCart({ userId: principal?.userId ?? null, sessionId });
    const updated = await addItem({ cart, input: body });

    return created(await getPricedCart({ cart: updated, channel: orderChannelFor(client) }));
  },
);
