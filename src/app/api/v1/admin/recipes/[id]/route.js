import { apiHandler, can, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateRecipeSchema } from "@/server/validation/production.schemas";
import { deleteRecipe, getRecipe, updateRecipe } from "@/server/services/recipe.service";

export const GET = apiHandler(
  { auth: true, permissions: "recipes.read", params: idParamSchema },
  async ({ params, auth }) => ok(await getRecipe(params.id, { includeCost: can(auth, "recipes.view_cost") })),
);

/**
 * Edits a recipe in place.
 *
 * Refused once the recipe has production history — that version *is* the
 * history, and editing it would move every past variance. `POST {id}/revise`
 * creates the next version instead.
 */
export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "recipes.update",
    params: idParamSchema,
    body: updateRecipeSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => ok(await updateRecipe(params.id, body, auth)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "recipes.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => ok(await deleteRecipe(params.id, auth)),
);
