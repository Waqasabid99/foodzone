import { apiHandler, ApiError, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess, productionCostVisible } from "@/server/inventory/access";
import { idParamSchema } from "@/server/validation/schemas";
import { completeProductionSchema } from "@/server/validation/production.schemas";
import { completeProduction, withoutRunCosts } from "@/server/services/production-order.service";

/**
 * Books the output into stock at what the run actually cost.
 *
 * `wastedQuantity` is yield loss — made, but not usable. It is booked in and
 * immediately written off against this run, so the loss is a costed number
 * somebody can be asked about rather than a silent uplift in the cost of what
 * survived.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "production_orders.complete",
    params: idParamSchema,
    body: completeProductionSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    const branchId = await assertRecordAccess(auth, "production", params.id, "production_orders.complete");
    const visible = productionCostVisible(auth, branchId);
    // Labour, overhead and by-product costs are money. Someone who may not see
    // a run's cost may not set it either; left out, the recipe's own figures
    // are used.
    if (!visible && (body.laborCost != null || body.overheadCost != null || body.byProducts?.some((line) => line.unitCost != null))) {
      throw ApiError.forbidden("You cannot set a run's costs", { required: ["recipes.view_cost"] });
    }
    const run = await completeProduction(params.id, body, auth);
    return ok(visible ? run : withoutRunCosts(run));
  },
);
