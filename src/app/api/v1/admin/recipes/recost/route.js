import { apiHandler, ok, RateLimits } from "@/lib/api";
import { recostAllSchema } from "@/server/validation/production.schemas";
import { recostAllRecipes } from "@/server/services/recipe-cost.service";

/**
 * Recosts every active recipe.
 *
 * Run after a delivery moves ingredient costs, or nightly. `incomplete` counts
 * the recipes that could not be fully priced.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "recipes.view_cost",
    body: recostAllSchema,
    rateLimit: RateLimits.write,
    audit: { action: "recipe.recost_all", entityType: "Recipe" },
  },
  async ({ body }) => ok(await recostAllRecipes(body)),
);
