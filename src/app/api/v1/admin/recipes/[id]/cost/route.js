import { apiHandler, ok } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { costRecipe } from "@/server/services/recipe-cost.service";
import { ApiError } from "@/lib/api";

/**
 * The full cost tree, priced at today's item costs.
 *
 * `missingCosts` lists every ingredient with no cost on it. A recipe made of
 * never-received items rolls up to zero, which reads as a wonderfully
 * profitable dish rather than as missing data — so it is reported rather than
 * hidden.
 */
export const GET = apiHandler(
  { auth: true, permissions: "recipes.view_cost", params: idParamSchema },
  async ({ params }) => {
    const costed = await costRecipe({ recipeId: params.id });
    if (!costed) throw ApiError.notFound("Recipe not found");
    return ok(costed);
  },
);
