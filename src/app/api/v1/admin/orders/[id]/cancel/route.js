import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { cancelOrderSchema } from "@/server/validation/ordering.schemas";
import { assertOrderAccess, cancelOrder } from "@/server/services/order.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "orders.cancel",
    params: idParamSchema,
    body: cancelOrderSchema,
    rateLimit: RateLimits.write,
    audit: { action: "order.cancel", entityType: "Order" },
  },
  async ({ auth, params, body }) => {
    await assertOrderAccess(auth, params.id, "orders.cancel");
    return ok(await cancelOrder({ orderId: params.id, reason: body.reason, actorId: auth.userId }));
  },
);
