import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionalAuth } from "@/lib/api/auth";
import { orderNumberParamSchema, trackQuerySchema } from "@/server/validation/ordering.schemas";
import { trackOrder } from "@/server/services/order.service";

/**
 * Order tracking.
 *
 * Deliberately narrow: status, timings and the branch — never prices, customer
 * details or internal notes. A tracking link gets forwarded and screenshotted,
 * so it carries only what someone waiting at the door needs.
 *
 * An order number is short and guessable, so it alone is not enough: the caller
 * must own the order, or know the phone number on it.
 */
export const GET = apiHandler(
  {
    params: orderNumberParamSchema,
    query: trackQuerySchema,
    rateLimit: RateLimits.public,
    scope: "orders:track",
  },
  async ({ request, params, query }) => {
    const principal = await optionalAuth(request);
    return ok(
      await trackOrder({
        orderNumber: params.orderNumber,
        userId: principal?.userId ?? null,
        phone: query.phone ?? null,
      }),
    );
  },
);
