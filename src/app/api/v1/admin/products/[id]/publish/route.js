import { apiHandler, ok, RateLimits } from "@/lib/api";
import { idParamSchema } from "@/server/validation/schemas";
import { publishProductSchema } from "@/server/validation/catalog.schemas";
import { setProductPublished } from "@/server/services/product.service";
import { CacheTag } from "@/lib/cache-tags";

/**
 * Publishing is its own permission, so a menu writer can draft an item that
 * only a manager can put in front of customers.
 */
export const PUT = apiHandler(
  {
    auth: true,
    permissions: "products.publish",
    params: idParamSchema,
    body: publishProductSchema,
    rateLimit: RateLimits.write,
    audit: { action: "product.publish", entityType: "Product" },
    invalidates: [CacheTag.CATALOG],
  },
  async ({ params, body }) => ok(await setProductPublished(params.id, body.isActive)),
);
