import { z } from "zod";
import { apiHandler, ApiError, ok, RateLimits } from "@/lib/api";
import { prisma } from "@/lib/prisma";

/**
 * Has this order been paid yet?
 *
 * The one question the post-gateway page needs, and nothing else. It exists
 * rather than reusing order tracking because tracking is keyed on the short,
 * guessable order *number* and therefore demands ownership or the phone number
 * on the order — neither of which a guest has in hand while their browser is
 * being handed back from a gateway.
 *
 * Keyed on the order id instead: a cuid, long and unguessable, and already
 * known to whoever just placed the order. What it returns is deliberately two
 * facts — the reference to show them, and whether the money has arrived. No
 * totals, no customer, no items; a URL like this gets forwarded.
 */
export const GET = apiHandler(
  { query: z.object({ order: z.string().trim().min(10).max(64) }), rateLimit: RateLimits.public, scope: "orders:track" },
  async ({ query }) => {
    const order = await prisma.order.findUnique({
      where: { id: query.order },
      select: { orderNumber: true, paymentState: true, status: true },
    });
    if (!order) throw ApiError.notFound("Order not found");

    return ok({ reference: order.orderNumber, paymentState: order.paymentState, status: order.status });
  },
);
