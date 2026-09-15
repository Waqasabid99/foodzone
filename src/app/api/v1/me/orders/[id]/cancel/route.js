import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { cancelOrderSchema } from "@/server/validation/ordering.schemas";
import { cancelOrder, getOwnOrder } from "@/server/services/order.service";

/**
 * A customer calling off their own order.
 *
 * Allowed only while nothing has been cooked. After that it takes staff, who
 * hold `orders.cancel` — the food exists and someone has to decide who pays
 * for it.
 */
export const POST = apiHandler(
  { auth: true, params: idParamSchema, body: cancelOrderSchema, rateLimit: RateLimits.write, scope: "me:orders" },
  async ({ auth, params, body }) => {
    // Ownership first: this throws NOT_FOUND for someone else's order.
    await getOwnOrder({ id: params.id, userId: auth.userId });

    return ok(
      await cancelOrder({ orderId: params.id, reason: body.reason, actorId: auth.userId, byCustomer: true }),
    );
  },
);
