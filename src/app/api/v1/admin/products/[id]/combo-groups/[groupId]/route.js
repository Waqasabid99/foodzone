import { apiHandler, ok, RateLimits } from "@/lib/api";
import { groupParamSchema, updateComboGroupSchema } from "@/server/validation/catalog.schemas";
import { deleteComboGroup, updateComboGroup } from "@/server/services/combo.service";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "combos.update",
    params: groupParamSchema,
    body: updateComboGroupSchema,
    rateLimit: RateLimits.write,
    audit: { action: "combo_group.update", entityType: "ComboGroup", entityId: ({ params }) => params.groupId },
  },
  async ({ params, body }) =>
    ok(await updateComboGroup({ comboProductId: params.id, groupId: params.groupId, data: body })),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "combos.delete",
    params: groupParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "combo_group.delete", entityType: "ComboGroup", entityId: ({ params }) => params.groupId },
  },
  async ({ params }) => ok(await deleteComboGroup({ comboProductId: params.id, groupId: params.groupId })),
);
