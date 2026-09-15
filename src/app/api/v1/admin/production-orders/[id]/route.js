import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateProductionOrderSchema } from "@/server/validation/production.schemas";
import { getProductionOrder, updateProductionOrder } from "@/server/services/production-order.service";

/** Includes planned against actual consumption, line by line. */
export const GET = apiHandler(
  { auth: true, permissions: "production_orders.read", params: idParamSchema },
  async ({ params }) => ok(await getProductionOrder(params.id)),
);

/** Only while planned — once material is issued the run is a physical fact. */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "production_orders.create",
    params: idParamSchema,
    body: updateProductionOrderSchema,
    rateLimit: RateLimits.write,
    audit: { action: "production_order.update", entityType: "ProductionOrder" },
  },
  async ({ params, body, auth }) => ok(await updateProductionOrder(params.id, body, auth)),
);
