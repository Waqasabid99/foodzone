import { apiHandler, created, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { reviseRecipeSchema } from "@/server/validation/production.schemas";
import { reviseRecipe } from "@/server/services/recipe.service";

/**
 * Creates the next version of a recipe.
 *
 * Anything not given is carried forward. The old version stays exactly as it
 * was, so a run costed against it last month still reads correctly.
 */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "recipes.update",
    params: idParamSchema,
    body: reviseRecipeSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => created(await reviseRecipe(params.id, body, auth)),
);
