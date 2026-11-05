import { apiHandler, ok, RateLimits } from "@/lib/api";
import { groupParamSchema, updateAttachedGroupSchema } from "@/server/validation/catalog.schemas";
import { detachModifierGroup, updateAttachedGroup } from "@/server/services/modifier.service";
import { CacheTag } from "@/lib/cache-tags";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "products.update",
    params: groupParamSchema,
    body: updateAttachedGroupSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.update_modifier_group", entityType: "Product" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params, body }) =>
    ok(await updateAttachedGroup({ productId: params.id, groupId: params.groupId, data: body })),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "products.update",
    params: groupParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.detach_modifier_group", entityType: "Product" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params }) => ok(await detachModifierGroup({ productId: params.id, groupId: params.groupId })),
);
