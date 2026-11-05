import { apiHandler, branchScope, created, ok, RateLimits } from "@/lib/api";
import { createProductionOrderSchema, listProductionOrdersSchema } from "@/server/validation/production.schemas";
import { createProductionOrder, listProductionOrders, withoutRunCosts } from "@/server/services/production-order.service";
import { assertRecordAccess, productionCostVisible } from "@/server/inventory/access";

/** Runs at the caller's own branches; each row's money only where they may see it. */
export const GET = apiHandler(
  { auth: true, permissions: "production_orders.read", query: listProductionOrdersSchema, branch: "query" },
  async ({ query, auth }) => {
    const page = await listProductionOrders({ ...query, scope: branchScope(auth, "production_orders.read") });
    return ok({
      ...page,
      items: page.items.map((row) => (productionCostVisible(auth, row.branchId) ? row : withoutRunCosts(row))),
    });
  },
);

/**
 * Plans a run. Nothing moves — a planned run is a piece of paper.
 *
 * Only a recipe that makes an inventory item can be produced: a burger is not
 * something the store room holds, and its recipe is depleted at sale time.
 * The location decides the branch, and the caller must be able to plan there.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "production_orders.create",
    body: createProductionOrderSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => {
    const branchId = await assertRecordAccess(auth, "location", body.locationId, "production_orders.create");
    const run = await createProductionOrder(body, auth);
    return created(productionCostVisible(auth, branchId) ? run : withoutRunCosts(run));
  },
);
