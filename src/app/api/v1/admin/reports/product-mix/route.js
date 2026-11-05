import { apiHandler, ok } from "@/lib/api";
import { branchScope } from "@/lib/api/permissions";
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
  async ({ query, auth }) => ok(await productMixReport({ ...query, scope: branchScope(auth, "reports.view_sales") })),
);
