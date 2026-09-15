import { apiHandler, ok, RateLimits } from "@/lib/api";
import { optionParamSchema, updateModifierOptionSchema } from "@/server/validation/catalog.schemas";
import { deleteOption, updateOption } from "@/server/services/modifier.service";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "modifiers.update",
    params: optionParamSchema,
    body: updateModifierOptionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "modifier_option.update", entityType: "ModifierOption", entityId: ({ params }) => params.optionId },
  },
  async ({ params, body }) => ok(await updateOption({ groupId: params.id, optionId: params.optionId, data: body })),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "modifiers.update",
    params: optionParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "modifier_option.delete", entityType: "ModifierOption", entityId: ({ params }) => params.optionId },
  },
  async ({ params }) => ok(await deleteOption({ groupId: params.id, optionId: params.optionId })),
);
