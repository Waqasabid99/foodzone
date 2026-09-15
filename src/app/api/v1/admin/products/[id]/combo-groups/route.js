import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { createComboGroupSchema } from "@/server/validation/catalog.schemas";
import { createComboGroup, listComboGroups } from "@/server/services/combo.service";

export const GET = apiHandler(
  { auth: true, permissions: "combos.read", params: idParamSchema },
  async ({ params }) => ok(await listComboGroups(params.id)),
);

/** A slot in the combo: "Pick 1 drink". */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "combos.create",
    params: idParamSchema,
    body: createComboGroupSchema,
    rateLimit: RateLimits.write,
    audit: { action: "combo_group.create", entityType: "ComboGroup" },
  },
  async ({ params, body }) => created(await createComboGroup(params.id, body)),
);
