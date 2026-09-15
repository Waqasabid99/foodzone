import { apiHandler, created, RateLimits } from "@/lib/api";
import { comboOptionSchema, groupParamSchema } from "@/server/validation/catalog.schemas";
import { addComboOption } from "@/server/services/combo.service";

export const POST = apiHandler(
  {
    auth: true,
    permissions: "combos.update",
    params: groupParamSchema,
    body: comboOptionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "combo_option.create", entityType: "ComboGroupOption" },
  },
  async ({ params, body }) =>
    created(await addComboOption({ comboProductId: params.id, groupId: params.groupId, option: body })),
);
