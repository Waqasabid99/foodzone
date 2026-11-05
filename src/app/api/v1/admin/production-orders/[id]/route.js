import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateProductionOrderSchema } from "@/server/validation/production.schemas";
import { getProductionOrder, updateProductionOrder, withoutRunCosts } from "@/server/services/production-order.service";
import { assertRecordAccess, productionCostVisible } from "@/server/inventory/access";

/** Includes planned against actual consumption, line by line. */
export const GET = apiHandler(
  { auth: true, permissions: "production_orders.read", params: idParamSchema },
  async ({ params, auth }) => {
    const branchId = await assertRecordAccess(auth, "production", params.id, "production_orders.read");
    const run = await getProductionOrder(params.id);
    return ok(productionCostVisible(auth, branchId) ? run : withoutRunCosts(run));
  },
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
  async ({ params, body, auth }) => {
    const branchId = await assertRecordAccess(auth, "production", params.id, "production_orders.create");
    const run = await updateProductionOrder(params.id, body, auth);
    return ok(productionCostVisible(auth, branchId) ? run : withoutRunCosts(run));
  },
);
