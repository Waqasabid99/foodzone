import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { updateModifierGroupSchema } from "@/server/validation/catalog.schemas";
import { deleteModifierGroup, getModifierGroup, updateModifierGroup } from "@/server/services/modifier.service";

export const GET = apiHandler(
  { auth: true, permissions: "modifiers.read", params: idParamSchema },
  async ({ params }) => ok(await getModifierGroup(params.id)),
);

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "modifiers.update",
    params: idParamSchema,
    body: updateModifierGroupSchema,
    rateLimit: RateLimits.write,
    audit: { action: "modifier_group.update", entityType: "ModifierGroup" },
  },
  async ({ params, body }) => ok(await updateModifierGroup(params.id, body)),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "modifiers.delete",
    params: idParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "modifier_group.delete", entityType: "ModifierGroup" },
  },
  async ({ params }) => ok(await deleteModifierGroup(params.id)),
);
