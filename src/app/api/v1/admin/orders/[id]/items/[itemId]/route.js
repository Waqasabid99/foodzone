import { apiHandler, ok, RateLimits } from "@/lib/api";
import { z } from "zod";
import { cuidSchema } from "@/server/validation/schemas";
import { assertOrderAccess } from "@/server/services/order.service";
import { removeOrderItem } from "@/server/services/order-items.service";

const paramsSchema = z.object({ id: cuidSchema, itemId: cuidSchema });

/**
 * Takes a line back off an order.
 *
 * Only while the kitchen has not started it. Once a cook has picked it up the
 * food exists and somebody has to pay for it or write it off, so the service
 * refuses rather than quietly deleting a row and leaving the stock, the cost
 * of sale and the ticket disagreeing with the kitchen.
 */
export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "orders.edit_items",
    params: paramsSchema,
    rateLimit: RateLimits.write,
  },
  async ({ auth, params }) => {
    await assertOrderAccess(auth, params.id, "orders.edit_items");
    return ok(await removeOrderItem({ orderId: params.id, itemId: params.itemId, actorId: auth.userId }));
  },
);
