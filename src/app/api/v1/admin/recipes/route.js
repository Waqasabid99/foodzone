import { apiHandler, ApiError, can, created, ok, RateLimits } from "@/lib/api";
import { createRecipeSchema, listRecipesSchema } from "@/server/validation/production.schemas";
import { createRecipe, listRecipes, withoutCosts } from "@/server/services/recipe.service";

/**
 * Costs are withheld unless the caller holds `recipes.view_cost`.
 *
 * A kitchen porter who can read a recipe should not be able to read its margin.
 */
export const GET = apiHandler(
  { auth: true, permissions: "recipes.read", query: listRecipesSchema },
  async ({ query, auth }) =>
    ok(await listRecipes({ ...query, includeCost: can(auth, "recipes.view_cost") })),
);

/**
 * Recipes belong to the whole company — one burger, made the same way at
 * every outlet — but a branch Head Chef may write them, not only a
 * company-wide role. That is a decision, not an oversight: the chefs are who
 * the recipes come from. So these routes check the permission with no branch
 * (any grant of it counts), unlike items and units, which need a company-wide
 * grant. Every change is versioned and audited with its author.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "recipes.create",
    body: createRecipeSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => {
    if (!can(auth, "recipes.view_cost") && (body.laborCost != null || body.overheadCost != null)) {
      throw ApiError.forbidden("You cannot set a recipe's costs", { required: ["recipes.view_cost"] });
    }
    const recipe = await createRecipe(body, auth);
    return created(can(auth, "recipes.view_cost") ? recipe : withoutCosts(recipe));
  },
);
