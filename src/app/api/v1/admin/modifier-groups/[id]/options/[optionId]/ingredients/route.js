import { z } from "zod";
import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { modifierIngredientSchema } from "@/server/validation/production.schemas";
import { listModifierIngredients, setModifierIngredient } from "@/server/services/modifier-ingredient.service";

const paramsSchema = z.object({ id: cuidSchema, optionId: cuidSchema });

/**
 * What a modifier costs the store room.
 *
 * "Extra cheese" is 30g of cheese. Without these rows every add-on a customer
 * chooses is food that leaves the kitchen and never leaves the system, and the
 * usage variance that should catch portioning drift absorbs it instead.
 */
export const GET = apiHandler(
  { auth: true, permissions: "recipes.read", params: paramsSchema },
  async ({ params }) => ok(await listModifierIngredients(params.optionId)),
);

/** Upserted on (option, item): a second POST corrects the quantity. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "recipes.update",
    params: paramsSchema,
    body: modifierIngredientSchema,
    rateLimit: RateLimits.write,
  },
  async ({ params, body, auth }) => created(await setModifierIngredient(params.optionId, body, auth)),
);
