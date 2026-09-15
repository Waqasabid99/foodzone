import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { changeStatusSchema } from "@/server/validation/ordering.schemas";
import { assertOrderAccess, changeOrderStatus } from "@/server/services/order.service";

/**
 * Advances an order.
 *
 * An illegal move is a 409 that names what *is* allowed, so a tablet with a
 * stale screen can correct itself instead of guessing. Repeating the current
 * status is a no-op, not an error — a busy kitchen taps twice.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "orders.update_status",
    params: idParamSchema,
    body: changeStatusSchema,
    rateLimit: RateLimits.write,
    audit: { action: "order.status", entityType: "Order" },
  },
  async ({ auth, params, body }) => {
    await assertOrderAccess(auth, params.id, "orders.update_status");
    return ok(
      await changeOrderStatus({
        orderId: params.id,
        toStatus: body.status,
        note: body.note ?? null,
        actorId: auth.userId,
      }),
    );
  },
);
