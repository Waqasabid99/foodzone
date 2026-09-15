import { z } from "zod";
import { apiHandler, ok, RateLimits } from "@/lib/api";
import { cuidSchema } from "@/server/validation/schemas";
import { updateComboOptionSchema } from "@/server/validation/catalog.schemas";
import { deleteComboOption, updateComboOption } from "@/server/services/combo.service";

const paramsSchema = z.object({ id: cuidSchema, groupId: cuidSchema, optionId: cuidSchema });

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "combos.update",
    params: paramsSchema,
    body: updateComboOptionSchema,
    rateLimit: RateLimits.write,
    audit: { action: "combo_option.update", entityType: "ComboGroupOption", entityId: ({ params }) => params.optionId },
  },
  async ({ params, body }) =>
    ok(
      await updateComboOption({
        comboProductId: params.id,
        groupId: params.groupId,
        optionId: params.optionId,
        data: body,
      }),
    ),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "combos.update",
    params: paramsSchema,
    rateLimit: RateLimits.write,
    audit: { action: "combo_option.delete", entityType: "ComboGroupOption", entityId: ({ params }) => params.optionId },
  },
  async ({ params }) =>
    ok(await deleteComboOption({ comboProductId: params.id, groupId: params.groupId, optionId: params.optionId })),
);
