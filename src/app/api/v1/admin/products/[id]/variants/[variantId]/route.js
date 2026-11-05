import { apiHandler, ok, RateLimits } from "@/lib/api";
import { updateVariantSchema, variantParamSchema } from "@/server/validation/catalog.schemas";
import { deleteVariant, updateVariant } from "@/server/services/product.service";
import { CacheTag } from "@/lib/cache-tags";

export const PATCH = apiHandler(
  {
    auth: true,
    permissions: "variants.update",
    params: variantParamSchema,
    body: updateVariantSchema,
    rateLimit: RateLimits.write,
    audit: { action: "variant.update", entityType: "ProductVariant", entityId: ({ params }) => params.variantId },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params, body }) =>
    ok(await updateVariant({ productId: params.id, variantId: params.variantId, data: body })),
);

export const DELETE = apiHandler(
  {
    auth: true,
    permissions: "variants.delete",
    params: variantParamSchema,
    rateLimit: RateLimits.write,
    audit: { action: "variant.delete", entityType: "ProductVariant", entityId: ({ params }) => params.variantId },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params }) => ok(await deleteVariant({ productId: params.id, variantId: params.variantId })),
);
