import { apiHandler, ok } from "@/lib/api";
import { productMixSchema } from "@/server/validation/finance.schemas";
import { productMixReport } from "@/server/services/operational-report.service";

/**
 * What actually sold, best first.
 *
 * Costed from the recipe roll-up cached on the variant, so the margin here is
 * the same one the menu-cost report shows.
 */
export const GET = apiHandler(
  { auth: true, permissions: "reports.view_sales", query: productMixSchema, branch: "query" },
  async ({ query }) => ok(await productMixReport(query)),
);
