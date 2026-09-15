import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { createProductionOrderSchema, listProductionOrdersSchema } from "@/server/validation/production.schemas";
import { createProductionOrder, listProductionOrders } from "@/server/services/production-order.service";

export const GET = apiHandler(
  { auth: true, permissions: "production_orders.read", query: listProductionOrdersSchema, branch: "query" },
  async ({ query }) => ok(await listProductionOrders(query)),
);

/**
 * Plans a run. Nothing moves — a planned run is a piece of paper.
 *
 * Only a recipe that makes an inventory item can be produced: a burger is not
 * something the store room holds, and its recipe is depleted at sale time.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "production_orders.create",
    body: createProductionOrderSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createProductionOrder(body, auth)),
);
