import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createDeliverySchema, listDeliveriesSchema } from "@/server/validation/delivery.schemas";
import { createDelivery, listDeliveries } from "@/server/services/delivery.service";

export const GET = apiHandler(
  { auth: true, permissions: "deliveries.read", query: listDeliveriesSchema, branch: "query" },
  async ({ query }) => ok(await listDeliveries(query)),
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
  async ({ body, auth }) => created(await createDelivery({ orderId: body.orderId, actor: auth })),
);
