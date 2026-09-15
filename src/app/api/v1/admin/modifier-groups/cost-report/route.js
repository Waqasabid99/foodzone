import { apiHandler, ok } from "@/lib/api";
import { modifierCostReportSchema } from "@/server/validation/production.schemas";
import { modifierCostReport } from "@/server/services/modifier-ingredient.service";

/**
 * What each add-on costs against what it is priced at, worst margin first.
 *
 * Menu costing that stops at the recipe understates every dish a customer
 * customises, and add-ons are where a lot of the margin actually sits.
 */
export const GET = apiHandler(
  { auth: true, permissions: "recipes.view_cost", query: modifierCostReportSchema },
  async ({ query }) => ok(await modifierCostReport(query)),
);
