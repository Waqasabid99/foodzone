import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createDeliverySchema, listDeliveriesSchema } from "@/server/validation/delivery.schemas";
import { createDelivery, listDeliveries } from "@/server/services/delivery.service";
import { branchScope } from "@/lib/api/permissions";
import { assertOrderAccess } from "@/server/ordering/access";

export const GET = apiHandler(
  { auth: true, permissions: "deliveries.read", query: listDeliveriesSchema, branch: "query" },
  async ({ query, auth }) => ok(await listDeliveries({ ...query, scope: branchScope(auth, "deliveries.read") })),
);

/**
 * Creates the delivery job for an order.
 *
 * Idempotent — `Delivery.orderId` is unique and dispatch screens retry.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "deliveries.assign",
    body: createDeliverySchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => {
    // Whose order it is decides whose delivery this becomes. Without the
    // check, the difference between 404 and 409 tells a dispatcher at one
    // outlet whether an order id at another is real.
    await assertOrderAccess(auth, body.orderId, "deliveries.assign");
    return created(await createDelivery({ orderId: body.orderId, actor: auth }));
  },
);
