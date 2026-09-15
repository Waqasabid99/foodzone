import { apiHandler, ok } from "@/lib/api";
import { menuCostReportSchema } from "@/server/validation/production.schemas";
import { menuCostReport } from "@/server/services/recipe-cost.service";

/**
 * Menu engineering: cost against price, worst food-cost percentage first.
 *
 * An uncosted dish comes back with `foodCostPercent: null` rather than zero —
 * unknown is not the same as free, and reporting it as 0% would put it at the
 * top of the most-profitable list.
 */
export const GET = apiHandler(
  { auth: true, permissions: "recipes.view_cost", query: menuCostReportSchema, branch: "query" },
  async ({ query }) => ok(await menuCostReport(query)),
);
