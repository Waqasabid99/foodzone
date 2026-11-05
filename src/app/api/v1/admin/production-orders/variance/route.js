import { apiHandler, ApiError, ok } from "@/lib/api";
import { productionVarianceSchema } from "@/server/validation/production.schemas";
import { productionVarianceReport } from "@/server/services/production-order.service";
import { inScope, productionCostScope } from "@/server/inventory/access";

/**
 * What the kitchen was supposed to spend against what it did, by run and by
 * recipe.
 *
 * Only completed runs count. A run still on the bench has a real material cost
 * and no output yet, and counting it would make every period look catastrophic
 * until the last batch came out.
 *
 * The report is nothing but money, so it covers only the branches whose
 * production costs the caller may see.
 */
export const GET = apiHandler(
  { auth: true, permissions: "production_orders.read", query: productionVarianceSchema, branch: "query" },
  async ({ query, auth }) => {
    const scope = productionCostScope(auth);
    if (!scope.all && !scope.ids.length) {
      throw ApiError.forbidden("Production costs are not shown to you", { required: ["recipes.view_cost"] });
    }
    if (query.branchId && !inScope(scope, query.branchId)) {
      throw ApiError.forbidden("Production costs at this branch are not shown to you", { branchId: query.branchId });
    }
    return ok(await productionVarianceReport({ ...query, scope }));
  },
);
