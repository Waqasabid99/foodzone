import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { recostRecipe } from "@/server/services/recipe-cost.service";

/**
 * Rolls the cost up and caches it on the recipe, and on the variant it makes.
 *
 * The variant's `standardCost` is what an order line snapshots as COGS at sale
 * time, so a stale one misstates the margin on every sale until this runs.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "recipes.view_cost",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "recipe.recost", entityType: "Recipe" },
  },
  async ({ params, auth }) => ok(await recostRecipe({ recipeId: params.id, actor: auth })),
);
