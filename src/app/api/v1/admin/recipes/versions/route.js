import { apiHandler, can, ok } from "@/lib/api";
import { recipeVersionsSchema } from "@/server/validation/production.schemas";
import { recipeVersions } from "@/server/services/recipe.service";

/** Every version of one dish, newest first — what changed and when. */
export const GET = apiHandler(
  { auth: true, permissions: "recipes.read", query: recipeVersionsSchema },
  async ({ query, auth }) =>
    ok(await recipeVersions({ ...query, includeCost: can(auth, "recipes.view_cost") })),
);
