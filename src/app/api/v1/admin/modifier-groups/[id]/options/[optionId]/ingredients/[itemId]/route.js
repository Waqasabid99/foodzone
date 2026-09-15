import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { removeModifierIngredient } from "@/server/services/modifier-ingredient.service";

const paramsSchema = z.object({ id: cuidSchema, optionId: cuidSchema, itemId: cuidSchema });

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "recipes.update",
    params: paramsSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, auth }) => ok(await removeModifierIngredient(params.optionId, params.itemId, auth)),
);
