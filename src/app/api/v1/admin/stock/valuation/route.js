import { apiHandler, branchScope, ok } from "@/lib/api";
import { stockQuerySchema } from "@/server/validation/inventory.schemas";
import { stockValuation } from "@/server/services/stock.service";

/**
 * What the stock is worth.
 *
 * Its own permission because it exposes cost prices, which are commercially
 * sensitive in a way that "how many buns are left" is not — a shift supervisor
 * needs the count, not the margin.
 */
export const GET = apiHandler(
  { auth: true, permissions: "stock.view_valuation", query: stockQuerySchema, branch: "query" },
  async ({ query, auth }) => ok(await stockValuation({ ...query, scope: branchScope(auth, "stock.view_valuation") })),
);
