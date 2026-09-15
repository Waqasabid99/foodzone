import { apiHandler, created, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { modifierOptionSchema } from "@/server/validation/catalog.schemas";
import { addOption } from "@/server/services/modifier.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "modifiers.update",
    params: idParamSchema,
    body: modifierOptionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "modifier_option.create", entityType: "ModifierOption" },
  },
  async ({ params, body }) => created(await addOption(params.id, body)),
);
