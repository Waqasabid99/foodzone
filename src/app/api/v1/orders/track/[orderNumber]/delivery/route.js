import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { ApiError } from "@/lib/api";
import { trackDelivery } from "@/server/services/delivery.service";

/**
 * Where the driver is, for a customer following their order.
 *
 * Narrow on purpose. A tracking link travels through messaging apps and is
 * authenticated by nothing but the order number it names, so it returns the
 * driver's **first name**, vehicle and position — and the position only while
 * they are actually carrying this order, never before and never once they have
 * moved on to someone else's.
 */
const paramsSchema = z.object({ orderNumber: z.string().trim().min(3).max(60) });

export const GET = apiHandler(
  { params: paramsSchema, rateLimit: RateLimits.read },
  async ({ params }) => {
    const order = await prisma.order.findUnique({
      where: { orderNumber: params.orderNumber },
      select: { id: true, type: true },
    });
    if (!order) throw ApiError.notFound("Order not found");

    const tracking = await trackDelivery({ orderId: order.id });
    if (!tracking) throw ApiError.notFound("This order has no delivery yet");

    return ok(tracking);
  },
);
