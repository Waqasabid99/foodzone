import { apiHandler, created, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { attachModifierGroupSchema } from "@/server/validation/catalog.schemas";
import { attachModifierGroup, listProductModifierGroups } from "@/server/services/modifier.service";

export const GET = apiHandler(
  { auth: true, permissions: "products.read", params: idParamSchema },
  async ({ params }) => ok(await listProductModifierGroups(params.id)),
);

/** Attaches a reusable group to this product, with optional rule overrides. */
export const POST = apiHandler(
  {
    auth: true,
    permissions: "products.update",
    params: idParamSchema,
    body: attachModifierGroupSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.attach_modifier_group", entityType: "Product" },
  },
  async ({ params, body }) => created(await attachModifierGroup(params.id, body)),
);
