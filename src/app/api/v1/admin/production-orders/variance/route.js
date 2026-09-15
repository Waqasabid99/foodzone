import { apiHandler, ok } from "@/lib/api";
import { productionVarianceSchema } from "@/server/validation/production.schemas";
import { productionVarianceReport } from "@/server/services/production-order.service";

/**
 * What the kitchen was supposed to spend against what it did, by run and by
 * recipe.
 *
 * Only completed runs count. A run still on the bench has a real material cost
 * and no output yet, and counting it would make every period look catastrophic
 * until the last batch came out.
 */
export const GET = apiHandler(
  { auth: true, permissions: "production_orders.read", query: productionVarianceSchema, branch: "query" },
  async ({ query }) => ok(await productionVarianceReport(query)),
);
