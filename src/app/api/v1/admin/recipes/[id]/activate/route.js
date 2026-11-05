import { apiHandler, can, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { activateRecipeVersion, withoutCosts } from "@/server/services/recipe.service";

/** Makes one version the live one — the way to roll back a bad revision. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "recipes.update",
    params: idParamSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => {
    const recipe = await activateRecipeVersion(params.id, auth);
    return ok(can(auth, "recipes.view_cost") ? recipe : withoutCosts(recipe));
  },
);
