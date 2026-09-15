import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { cartContextSchema } from "@/server/validation/ordering.schemas";
import { getPricedCart, orderChannelFor, resolveCart, setCartContext } from "@/server/services/cart.service";

/**
 * Sets the branch and order type, which together decide every price in the
 * basket — switching either reprices the whole cart on the next read.
 */
export const PUT = apiHandler(
  { body: cartContextSchema, rateLimit: RateLimits.write, scope: "cart" },
  async ({ request, body, sessionId, client }) => {
    const principal = await optionalAuth(request);
    const cart = await resolveCart({ userId: principal?.userId ?? null, sessionId });
    const updated = await setCartContext({ cart, branchId: body.branchId, type: body.type });

    return ok(await getPricedCart({ cart: updated, channel: orderChannelFor(client) }));
  },
);
