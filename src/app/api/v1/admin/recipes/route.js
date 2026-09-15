import { apiHandler, can, created, ok, RateLimits } from "@/lib/api";
import { createRecipeSchema, listRecipesSchema } from "@/server/validation/production.schemas";
import { createRecipe, listRecipes } from "@/server/services/recipe.service";

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

export const POST = apiHandler(
  {
    auth: true,
    permissions: "recipes.create",
    body: createRecipeSchema,
    rateLimit: RateLimits.write,
  },
  async ({ body, auth }) => created(await createRecipe(body, auth)),
);
