import { apiHandler, ok, RateLimits } from "@/lib/api";
import { assertRecordAccess, productionCostVisible } from "@/server/inventory/access";
import { idParamSchema } from "@/server/validation/schemas";
import { cancelProductionSchema } from "@/server/validation/production.schemas";
import { cancelProduction, withoutRunCosts } from "@/server/services/production-order.service";

/**
 * Stops a run and puts any issued material back.
 *
 * Reversed rather than deleted: material that was issued and returned is two
 * facts, not none, and the ledger is append-only.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "production_orders.cancel",
    params: idParamSchema,
    body: cancelProductionSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => {
    const branchId = await assertRecordAccess(auth, "production", params.id, "production_orders.cancel");
    const run = await cancelProduction(params.id, { reason: body.reason, actor: auth });
    return ok(productionCostVisible(auth, branchId) ? run : withoutRunCosts(run));
  },
);
